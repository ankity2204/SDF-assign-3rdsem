import dns from "node:dns";
dns.setServers(["8.8.8.8", "1.1.1.1"]);
import "dotenv/config";
import express from "express";
import cors from "cors";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import mongoose from "mongoose";
import { restaurants } from "./restaurants.js";

const PORT = process.env.PORT || 5000;
const DELIVERY_FEE = 30;
const STEPS = ["Order placed", "Preparing your food", "On the way", "Delivered"];

if (!process.env.MONGODB_URI) {
  console.error("Missing MONGODB_URI. Create backend/.env (see .env.example).");
  process.exit(1);
}
if (process.env.NODE_ENV === "production" && !process.env.JWT_SECRET) {
  console.error("Missing JWT_SECRET. Set it before running in production.");
  process.exit(1);
}
const JWT_SECRET = process.env.JWT_SECRET || "change-this-secret-before-deploying";

const app = express();
app.use(cors()); // lets the React app (a different port) call this server
app.use(express.json()); // lets us read JSON sent in the request body

/* ---------- Database models (what we store in MongoDB) ---------- */
const User = mongoose.model(
  "User",
  new mongoose.Schema({
    id: { type: String, required: true, unique: true },
    name: String,
    email: { type: String, required: true, unique: true },
    passwordHash: String,
  })
);

const Order = mongoose.model(
  "Order",
  new mongoose.Schema({
    id: { type: Number, required: true, unique: true },
    userId: { type: String, index: true },
    name: String,
    phone: String,
    address: String,
    paymentMethod: String,
    paymentStatus: String,
    items: [{ _id: false, id: Number, name: String, price: Number, qty: Number }],
    subtotal: Number,
    deliveryFee: Number,
    total: Number,
    createdAt: Number,
  })
);

/* ---------- Helpers ---------- */
// Express 4 does not catch errors from async routes, so we wrap each one.
const handle = (fn) => (req, res, next) => fn(req, res, next).catch(next);

// Turn a database document into a plain object for the browser.
function clean(doc) {
  const obj = doc.toObject ? doc.toObject() : { ...doc };
  delete obj._id;
  delete obj.__v;
  return obj;
}

function makeToken(user) {
  return jwt.sign({ id: user.id, name: user.name, email: user.email }, JWT_SECRET, {
    expiresIn: "7d",
  });
}

function sendSession(res, user, statusCode = 200) {
  const publicUser = { id: user.id, name: user.name, email: user.email };
  res.status(statusCode).json({ token: makeToken(publicUser), user: publicUser });
}

// Put this before any route that needs a logged-in user.
function requireLogin(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Please log in." });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: "Your login expired. Please log in again." });
  }
}

// The order status moves forward by itself: one step every 8 seconds.
function statusOf(order) {
  const seconds = (Date.now() - order.createdAt) / 1000;
  return STEPS[Math.min(STEPS.length - 1, Math.floor(seconds / 8))];
}

function findMenuItem(itemId) {
  for (const r of restaurants) {
    const item = r.menu.find((m) => m.id === itemId);
    if (item) return item;
  }
  return null;
}

/* ---------- Auth ---------- */
app.post(
  "/api/auth/register",
  handle(async (req, res) => {
    const { name = "", email = "", password = "" } = req.body;
    const cleanEmail = String(email).trim().toLowerCase();

    if (!String(name).trim()) return res.status(400).json({ error: "Enter your name." });
    if (!/^\S+@\S+\.\S+$/.test(cleanEmail)) return res.status(400).json({ error: "Enter a valid email address." });
    if (String(password).length < 6) return res.status(400).json({ error: "Password must be at least 6 characters." });

    if (await User.exists({ email: cleanEmail })) {
      return res.status(409).json({ error: "This email is already registered. Please log in." });
    }

    try {
      const user = await User.create({
        id: crypto.randomUUID(),
        name: String(name).trim(),
        email: cleanEmail,
        passwordHash: bcrypt.hashSync(String(password), 10), // never store the real password
      });
      sendSession(res, user, 201);
    } catch (err) {
      // Two people registering the same email at the same moment
      if (err.code === 11000) {
        return res.status(409).json({ error: "This email is already registered. Please log in." });
      }
      throw err;
    }
  })
);

app.post(
  "/api/auth/login",
  handle(async (req, res) => {
    const { email = "", password = "" } = req.body;
    const user = await User.findOne({ email: String(email).trim().toLowerCase() });

    if (!user || !bcrypt.compareSync(String(password), user.passwordHash)) {
      return res.status(401).json({ error: "Wrong email or password." });
    }
    sendSession(res, user);
  })
);

/* ---------- Restaurants ---------- */
app.get("/api/restaurants", (req, res) => {
  // The list does not need the full menus
  res.json(restaurants.map(({ menu, ...rest }) => rest));
});

app.get("/api/restaurants/:id", (req, res) => {
  const restaurant = restaurants.find((r) => r.id === Number(req.params.id));
  if (!restaurant) return res.status(404).json({ error: "Restaurant not found." });
  res.json(restaurant);
});

/* ---------- Orders (login needed) ---------- */
app.post(
  "/api/orders",
  requireLogin,
  handle(async (req, res) => {
    const { name = "", phone = "", address = "", items, paymentMethod = "COD" } = req.body;

    if (!String(name).trim() || !String(address).trim()) {
      return res.status(400).json({ error: "Enter your name and delivery address." });
    }
    if (!/^\d{10}$/.test(String(phone))) {
      return res.status(400).json({ error: "Enter a 10-digit phone number." });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "Your cart is empty." });
    }
    if (!["COD", "Card"].includes(paymentMethod)) {
      return res.status(400).json({ error: "Choose Card or Cash on delivery." });
    }

    // Prices come from the server, never from the browser, so nobody can change them.
    const lines = [];
    for (const entry of items) {
      const menuItem = findMenuItem(Number(entry.id));
      const qty = Number(entry.qty);
      if (!menuItem || !Number.isInteger(qty) || qty < 1 || qty > 20) {
        return res.status(400).json({ error: "One of the items in your cart is not valid." });
      }
      lines.push({ id: menuItem.id, name: menuItem.name, price: menuItem.price, qty });
    }

    const subtotal = lines.reduce((sum, l) => sum + l.price * l.qty, 0);

    let id;
    do {
      id = Math.floor(100000 + Math.random() * 900000);
    } while (await Order.exists({ id }));

    const order = await Order.create({
      id,
      userId: req.user.id,
      name: String(name).trim(),
      phone: String(phone),
      address: String(address).trim(),
      paymentMethod,
      paymentStatus: paymentMethod === "Card" ? "Paid" : "Pay on delivery",
      items: lines,
      subtotal,
      deliveryFee: DELIVERY_FEE,
      total: subtotal + DELIVERY_FEE,
      createdAt: Date.now(),
    });

    res.status(201).json({ ...clean(order), status: statusOf(order) });
  })
);

app.get(
  "/api/orders",
  requireLogin,
  handle(async (req, res) => {
    const mine = await Order.find({ userId: req.user.id }).sort({ createdAt: -1 });
    res.json(mine.map((o) => ({ ...clean(o), status: statusOf(o) })));
  })
);

app.get(
  "/api/orders/:id",
  requireLogin,
  handle(async (req, res) => {
    const order = await Order.findOne({ id: Number(req.params.id), userId: req.user.id });
    if (!order) return res.status(404).json({ error: "Order not found." });
    res.json({ ...clean(order), status: statusOf(order) });
  })
);

/* ---------- Unknown routes and errors ---------- */
app.use((req, res) => res.status(404).json({ error: "Not found." }));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Something went wrong on the server." });
});

/* ---------- Start: connect to the database, then listen ---------- */
try {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected to MongoDB");
} catch (err) {
  console.error("Could not connect to MongoDB:", err.message);
  console.error("Check MONGODB_URI in backend/.env, and that your IP is allowed in Atlas > Network Access.");
  process.exit(1);
}

app.listen(PORT, () => {
  console.log(`Backend running at http://localhost:${PORT}`);
});
