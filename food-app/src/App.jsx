import { useEffect, useReducer, useState, createContext, useContext } from "react";
import { BrowserRouter, Routes, Route, Link, Navigate, useParams, useNavigate, useLocation } from "react-router-dom";

// ---------- restaurants ----------
const categories = ["All", "Indian", "Pizza", "Burgers", "Healthy"];

const API = "http://localhost:5000/api";

// Talks to the backend. Sends the login token when we have one.
async function api(path, options = {}) {
  const token = localStorage.getItem("token");
  let res;
  try {
    res = await fetch(API + path, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
  } catch {
    throw new Error("Cannot reach the server. Is the backend running?");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Something went wrong. Please try again.");
  return data;
}

// ---------- CartContext ----------
const CartContext = createContext();

// The cart is a list of items: { id, name, price, qty, restaurantId }
function reducer(state, action) {
  switch (action.type) {
    case "ADD": {
      const exists = state.find((i) => i.id === action.item.id);
      if (exists) {
        return state.map((i) =>
          i.id === exists.id ? { ...i, qty: i.qty + 1 } : i
        );
      }
      return [...state, { ...action.item, qty: 1 }];
    }
    case "DECREASE":
      return state
        .map((i) => (i.id === action.id ? { ...i, qty: i.qty - 1 } : i))
        .filter((i) => i.qty > 0);
    case "CLEAR":
      return [];
    default:
      return state;
  }
}

function CartProvider({ children }) {
  const [cart, dispatch] = useReducer(reducer, [], () => readStorage("cart", []));

  useEffect(() => {
    try {
      localStorage.setItem("cart", JSON.stringify(cart));
    } catch {}
  }, [cart]);

  const total = cart.reduce((sum, i) => sum + i.price * i.qty, 0);
  const count = cart.reduce((sum, i) => sum + i.qty, 0);

  const value = {
    cart,
    total,
    count,
    addItem: (item) => dispatch({ type: "ADD", item }),
    decreaseItem: (id) => dispatch({ type: "DECREASE", id }),
    clearCart: () => dispatch({ type: "CLEAR" }),
  };

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

const useCart = () => useContext(CartContext);

// ---------- AuthContext ----------
// Accounts now live on the backend. The browser only keeps the login token.
const AuthContext = createContext();

function readStorage(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function AuthProvider({ children }) {
  const [user, setUser] = useState(() => readStorage("user", null));

  const saveSession = (data) => {
    localStorage.setItem("token", data.token);
    localStorage.setItem("user", JSON.stringify(data.user));
    setUser(data.user);
  };

  // Each function returns an error message, or null when it worked.
  const register = async (form) => {
    try {
      saveSession(await api("/auth/register", { method: "POST", body: JSON.stringify(form) }));
      return null;
    } catch (err) {
      return err.message;
    }
  };

  const login = async (form) => {
    try {
      saveSession(await api("/auth/login", { method: "POST", body: JSON.stringify(form) }));
      return null;
    } catch (err) {
      return err.message;
    }
  };

  const logout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, register, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

const useAuth = () => useContext(AuthContext);

// ---------- Navbar ----------
function Navbar() {
  const { count } = useCart();
  const { user, logout } = useAuth();

  return (
    <header className="navbar">
      <Link to="/" className="logo">
        Tiffin<span>Go</span>
      </Link>

      <div className="nav-right">
        {user ? (
          <>
            <Link to="/orders" className="nav-link">My orders</Link>
            <span className="hello">Hi, {user.name.split(" ")[0]}</span>
            <button className="nav-btn" onClick={logout}>Log out</button>
          </>
        ) : (
          <>
            <Link to="/login" className="nav-link">Log in</Link>
            <Link to="/register" className="nav-btn">Sign up</Link>
          </>
        )}
        <Link to="/cart" className="cart-link">
          Cart
          {count > 0 && <b className="badge">{count}</b>}
        </Link>
      </div>
    </header>
  );
}

// ---------- RestaurantCard ----------
function RestaurantCard({ restaurant }) {
  const { id, name, category, emoji, rating, time } = restaurant;

  return (
    <Link to={`/restaurant/${id}`} className="card">
      <div className="card-emoji">{emoji}</div>
      <div className="card-body">
        <h3>{name}</h3>
        <p className="muted">{category}</p>
        <p className="meta">
          <span className="rating">★ {rating}</span>
          <span>{time}</span>
        </p>
      </div>
    </Link>
  );
}

// ---------- QtyControl ----------
// Shows "Add" when the item is not in the cart, and − 1 + when it is.
function QtyControl({ item }) {
  const { cart, addItem, decreaseItem } = useCart();
  const inCart = cart.find((i) => i.id === item.id);

  if (!inCart) {
    return (
      <button className="btn btn-outline" onClick={() => addItem(item)}>
        Add
      </button>
    );
  }

  return (
    <div className="qty">
      <button onClick={() => decreaseItem(item.id)} aria-label="Remove one">−</button>
      <span>{inCart.qty}</span>
      <button onClick={() => addItem(item)} aria-label="Add one">+</button>
    </div>
  );
}

// ---------- MenuItem ----------
function MenuItem({ item, restaurantId }) {
  return (
    <div className="menu-item">
      <div>
        <h4>{item.name}</h4>
        <p className="muted">{item.desc}</p>
        <p className="price">₹{item.price}</p>
      </div>
      <QtyControl item={{ ...item, restaurantId }} />
    </div>
  );
}

// ---------- Home ----------
function Home() {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const location = useLocation();
  const [restaurants, setRestaurants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    api("/restaurants")
      .then(setRestaurants)
      .catch((err) => setLoadError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const filtered = restaurants.filter((r) => {
    const matchName = r.name.toLowerCase().includes(search.toLowerCase());
    const matchCategory = category === "All" || r.category === category;
    return matchName && matchCategory;
  });

  return (
    <main className="page">
      {location.state?.notice && <p className="notice">{location.state.notice}</p>}
      <section className="hero">
        <h1>Hungry? Food is a few taps away.</h1>
        <input
          className="search"
          type="search"
          placeholder="Search restaurants"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </section>

      <div className="chips">
        {categories.map((c) => (
          <button
            key={c}
            className={c === category ? "chip active" : "chip"}
            onClick={() => setCategory(c)}
          >
            {c}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="empty">Loading restaurants...</p>
      ) : loadError ? (
        <p className="error empty">{loadError}</p>
      ) : filtered.length === 0 ? (
        <p className="empty">No restaurants found. Try a different search or category.</p>
      ) : (
        <div className="grid">
          {filtered.map((r) => (
            <RestaurantCard key={r.id} restaurant={r} />
          ))}
        </div>
      )}
    </main>
  );
}

// ---------- Restaurant ----------
function Restaurant() {
  const { id } = useParams();
  const { count, total } = useCart();
  const [restaurant, setRestaurant] = useState(null);
  const [status, setStatus] = useState("loading");

  useEffect(() => {
    api(`/restaurants/${id}`)
      .then((data) => {
        setRestaurant(data);
        setStatus("done");
      })
      .catch(() => setStatus("error"));
  }, [id]);

  if (status === "loading") {
    return (
      <main className="page">
        <p className="empty">Loading menu...</p>
      </main>
    );
  }


  if (!restaurant) {
    return (
      <main className="page">
        <p className="empty">Restaurant not found.</p>
        <Link to="/" className="btn">Back to home</Link>
      </main>
    );
  }

  return (
    <main className="page">
      <FlowSteps current={0} />
      <Link to="/" className="back">← All restaurants</Link>

      <div className="rest-header">
        <span className="rest-emoji">{restaurant.emoji}</span>
        <div>
          <h1>{restaurant.name}</h1>
          <p className="muted">
            {restaurant.category} · ★ {restaurant.rating} · {restaurant.time}
          </p>
        </div>
      </div>

      <div className="menu">
        {restaurant.menu.map((item) => (
          <MenuItem key={item.id} item={item} restaurantId={restaurant.id} />
        ))}
      </div>

      {count > 0 && (
        <Link to="/cart" className="cart-bar">
          <span>{count} item{count > 1 ? "s" : ""} · ₹{total}</span>
          <span>View cart</span>
        </Link>
      )}
    </main>
  );
}

// ---------- Cart ----------
const DELIVERY_FEE = 30;

function Cart() {
  const { cart, total } = useCart();

  if (cart.length === 0) {
    return (
      <main className="page">
        <h1>Your cart</h1>
        <p className="empty">Your cart is empty. Pick something tasty from a restaurant.</p>
        <Link to="/" className="btn">Browse restaurants</Link>
      </main>
    );
  }

  return (
    <main className="page narrow">
      <FlowSteps current={1} />
      <h1>Your cart</h1>

      <div className="panel">
        {cart.map((item) => (
          <div key={item.id} className="cart-row">
            <div>
              <h4>{item.name}</h4>
              <p className="muted">₹{item.price} each</p>
            </div>
            <QtyControl item={item} />
            <strong>₹{item.price * item.qty}</strong>
          </div>
        ))}
      </div>

      <div className="panel bill">
        <div><span>Items total</span><span>₹{total}</span></div>
        <div><span>Delivery fee</span><span>₹{DELIVERY_FEE}</span></div>
        <div className="grand"><span>To pay</span><span>₹{total + DELIVERY_FEE}</span></div>
      </div>

      <Link to="/checkout" className="btn btn-full">Go to checkout</Link>
    </main>
  );
}

// ---------- Checkout ----------
const STEPS = ["Order placed", "Preparing your food", "On the way", "Delivered"];
const FLOW = ["Browse menu", "Cart", "Payment", "Order placed"];

// Shows where the customer is: Browse menu > Cart > Payment > Order placed
function FlowSteps({ current }) {
  return (
    <ol className="flow">
      {FLOW.map((label, i) => (
        <li key={label} className={i < current ? "past" : i === current ? "now" : ""}>
          {label}
        </li>
      ))}
    </ol>
  );
}

function Checkout() {
  const { cart, total, clearCart } = useCart();
  const { user } = useAuth();
  // stage: details -> payment -> placed (or cancelled)
  const [stage, setStage] = useState("details");
  const [form, setForm] = useState({ name: user?.name || "", phone: "", address: "" });
  const [method, setMethod] = useState("COD");
  const [card, setCard] = useState({ number: "", expiry: "", cvv: "" });
  const [error, setError] = useState("");
  const [placed, setPlaced] = useState(null); // holds the finished order
  const [step, setStep] = useState(0);
  const [sending, setSending] = useState(false);

  // Ask the server for the order status every 3 seconds.
  useEffect(() => {
    if (!placed || step >= STEPS.length - 1) return;
    const timer = setInterval(async () => {
      try {
        const order = await api(`/orders/${placed.id}`);
        setStep(Math.max(0, STEPS.indexOf(order.status)));
      } catch {}
    }, 3000);
    return () => clearInterval(timer);
  }, [placed, step]);

  const handleChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });
  const handleCard = (e) => setCard({ ...card, [e.target.name]: e.target.value });

  // Step 1: delivery details
  const handleDetails = (e) => {
    e.preventDefault();
    if (!form.name || !form.phone || !form.address) {
      setError("Please fill in your name, phone number and address.");
      return;
    }
    if (!/^\d{10}$/.test(form.phone)) {
      setError("Enter a 10-digit phone number.");
      return;
    }
    setError("");
    setStage("payment");
  };

  // Step 2: pay by card or cash, then the order is placed
  const handlePay = async (e) => {
    e.preventDefault();
    if (method === "Card") {
      if (!/^\d{16}$/.test(card.number.replace(/\s/g, ""))) return setError("Enter a 16-digit card number.");
      if (!/^(0[1-9]|1[0-2])\/\d{2}$/.test(card.expiry)) return setError("Enter the expiry date as MM/YY.");
      if (!/^\d{3}$/.test(card.cvv)) return setError("Enter the 3-digit CVV.");
    }

    setError("");
    setSending(true);
    try {
      // Card details are never sent to the server in this demo.
      const order = await api("/orders", {
        method: "POST",
        body: JSON.stringify({
          ...form,
          paymentMethod: method,
          items: cart.map((i) => ({ id: i.id, qty: i.qty })),
        }),
      });
      setPlaced({ id: order.id, amount: order.total, address: order.address, method });
      setStep(0);
      setStage("placed");
      clearCart();
    } catch (err) {
      setError(err.message);
    }
    setSending(false);
  };

  // Order placed: show tracking
  if (stage === "placed" && placed) {
    return (
      <main className="page narrow">
        <FlowSteps current={3} />
        <h1>Order #{placed.id}</h1>
        <p className="notice">
          {placed.method === "Card"
            ? "Payment successful. Your order is placed."
            : `Your order is placed. Pay ₹${placed.amount} in cash on delivery.`}
        </p>
        <p className="muted">Delivering to {placed.address}</p>

        <ol className="tracker">
          {STEPS.map((label, i) => (
            <li key={label} className={i <= step ? "done" : ""}>
              {label}
            </li>
          ))}
        </ol>

        <p className="auth-switch">
          <Link to="/orders">See all my orders</Link>
        </p>
        {step === STEPS.length - 1 && <Link to="/" className="btn">Order again</Link>}
      </main>
    );
  }

  // Order cancelled
  if (stage === "cancelled") {
    return (
      <main className="page narrow">
        <h1>Order cancelled</h1>
        <p className="empty">Cancelled successfully. You were not charged, and your cart is still saved.</p>
        <Link to="/cart" className="btn">Back to cart</Link>
      </main>
    );
  }

  // Only logged-in users can check out
  if (!user) {
    return <Navigate to="/login" state={{ from: "/checkout" }} replace />;
  }

  if (cart.length === 0) {
    return (
      <main className="page">
        <h1>Checkout</h1>
        <p className="empty">Nothing to check out yet.</p>
        <Link to="/" className="btn">Browse restaurants</Link>
      </main>
    );
  }

  const payable = total + DELIVERY_FEE;

  // Step 1 screen: delivery details
  if (stage === "details") {
    return (
      <main className="page narrow">
        <FlowSteps current={2} />
        <h1>Delivery details</h1>

        <form className="panel form" onSubmit={handleDetails}>
          <label>
            Full name
            <input name="name" value={form.name} onChange={handleChange} />
          </label>
          <label>
            Phone number
            <input name="phone" inputMode="numeric" maxLength={10} value={form.phone} onChange={handleChange} />
          </label>
          <label>
            Delivery address
            <textarea name="address" rows={3} value={form.address} onChange={handleChange} />
          </label>

          {error && <p className="error">{error}</p>}

          <button className="btn btn-full" type="submit">Continue to payment</button>
        </form>
      </main>
    );
  }

  // Step 2 screen: payment
  return (
    <main className="page narrow">
      <FlowSteps current={2} />
      <h1>Payment</h1>
      <p className="muted">Amount to pay: ₹{payable} (includes ₹{DELIVERY_FEE} delivery)</p>

      <form className="panel pay-form" onSubmit={handlePay}>
        <div className="pay-options">
          <label className={method === "COD" ? "pay-option selected" : "pay-option"}>
            <input type="radio" name="method" checked={method === "COD"} onChange={() => setMethod("COD")} />
            Cash on delivery
          </label>
          <label className={method === "Card" ? "pay-option selected" : "pay-option"}>
            <input type="radio" name="method" checked={method === "Card"} onChange={() => setMethod("Card")} />
            Credit or debit card
          </label>
        </div>

        {method === "Card" && (
          <div className="form card-fields">
            <label>
              Card number
              <input name="number" inputMode="numeric" maxLength={19} placeholder="1234 5678 9012 3456" value={card.number} onChange={handleCard} />
            </label>
            <label>
              Expiry (MM/YY)
              <input name="expiry" maxLength={5} placeholder="08/29" value={card.expiry} onChange={handleCard} />
            </label>
            <label>
              CVV
              <input name="cvv" type="password" inputMode="numeric" maxLength={3} value={card.cvv} onChange={handleCard} />
            </label>
            <p className="muted small">Demo only. Card details are not saved or sent anywhere.</p>
          </div>
        )}

        {error && <p className="error">{error}</p>}

        <button className="btn btn-full" type="submit" disabled={sending}>
          {sending ? "Placing order..." : method === "Card" ? `Pay ₹${payable}` : `Place order · ₹${payable}`}
        </button>
        <button type="button" className="btn-link" onClick={() => setStage("details")}>
          Back to delivery details
        </button>
        <button type="button" className="btn-link danger" onClick={() => setStage("cancelled")}>
          Cancel order
        </button>
      </form>
    </main>
  );
}

// ---------- Login ----------
function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ email: "", password: "" });
  const [error, setError] = useState("");

  const handleChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.email || !form.password) {
      setError("Enter your email and password.");
      return;
    }
    const message = await login(form);
    if (message) {
      setError(message);
      return;
    }
    navigate(location.state?.from || "/", { replace: true, state: { notice: "Successfully logged in." } });
  };

  return (
    <main className="page narrow">
      <h1>Log in</h1>
      {location.state?.from && (
        <p className="muted">Please log in to continue to checkout.</p>
      )}

      <form className="panel form" onSubmit={handleSubmit}>
        <label>
          Email
          <input name="email" type="email" autoComplete="email" value={form.email} onChange={handleChange} />
        </label>
        <label>
          Password
          <input name="password" type="password" autoComplete="current-password" value={form.password} onChange={handleChange} />
        </label>

        {error && <p className="error">{error}</p>}

        <button className="btn btn-full" type="submit">Log in</button>
        <p className="auth-switch">
          New here? <Link to="/register">Create an account</Link>
        </p>
      </form>
    </main>
  );
}

// ---------- Register ----------
function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: "", email: "", password: "", confirm: "" });
  const [error, setError] = useState("");

  const handleChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return setError("Enter your name.");
    if (!/^\S+@\S+\.\S+$/.test(form.email)) return setError("Enter a valid email address.");
    if (form.password.length < 6) return setError("Password must be at least 6 characters.");
    if (form.password !== form.confirm) return setError("Passwords do not match.");

    const message = await register(form);
    if (message) return setError(message);
    navigate("/", { replace: true, state: { notice: "Successfully registered. Welcome!" } });
  };

  return (
    <main className="page narrow">
      <h1>Create your account</h1>

      <form className="panel form" onSubmit={handleSubmit}>
        <label>
          Full name
          <input name="name" autoComplete="name" value={form.name} onChange={handleChange} />
        </label>
        <label>
          Email
          <input name="email" type="email" autoComplete="email" value={form.email} onChange={handleChange} />
        </label>
        <label>
          Password
          <input name="password" type="password" autoComplete="new-password" value={form.password} onChange={handleChange} />
        </label>
        <label>
          Confirm password
          <input name="confirm" type="password" autoComplete="new-password" value={form.confirm} onChange={handleChange} />
        </label>

        {error && <p className="error">{error}</p>}

        <button className="btn btn-full" type="submit">Sign up</button>
        <p className="auth-switch">
          Already have an account? <Link to="/login">Log in</Link>
        </p>
      </form>
    </main>
  );
}

// ---------- Orders ----------
function Orders() {
  const { user } = useAuth();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user) return;
    api("/orders")
      .then(setOrders)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [user]);

  if (!user) {
    return <Navigate to="/login" state={{ from: "/orders" }} replace />;
  }

  return (
    <main className="page narrow">
      <h1>My orders</h1>

      {loading && <p className="empty">Loading your orders...</p>}
      {error && <p className="error empty">{error}</p>}

      {!loading && !error && orders.length === 0 && (
        <>
          <p className="empty">You have not placed an order yet.</p>
          <Link to="/" className="btn">Browse restaurants</Link>
        </>
      )}

      {orders.map((o) => (
        <div key={o.id} className="panel order-card">
          <div className="order-top">
            <strong>Order #{o.id}</strong>
            <span className={o.status === "Delivered" ? "pill done" : "pill"}>{o.status}</span>
          </div>
          <p className="muted">
            {new Date(o.createdAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
          </p>
          <p className="order-items">
            {o.items.map((i) => `${i.qty} x ${i.name}`).join(", ")}
          </p>
          <p className="muted">{o.paymentMethod === "Card" ? "Paid by card" : "Cash on delivery"}</p>
          <div className="order-bottom">
            <span className="muted">{o.address}</span>
            <strong>₹{o.total}</strong>
          </div>
        </div>
      ))}
    </main>
  );
}

// ---------- Welcome ----------
// First screen: new users register, existing users log in.
function Welcome() {
  const { user } = useAuth();
  if (user) return <Navigate to="/" replace />;

  return (
    <main className="page welcome">
      <h1>Good food, delivered to your door.</h1>
      <p className="muted">Create an account or log in to see the menu.</p>
      <div className="welcome-actions">
        <Link to="/register" className="btn">I am new here</Link>
        <Link to="/login" className="btn btn-outline">I have an account</Link>
      </div>
    </main>
  );
}

// Pages inside this wrapper need a logged-in user.
function RequireLogin({ children }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/welcome" replace />;
  return children;
}

// ---------- App ----------
export default function App() {
  return (
    <AuthProvider>
    <CartProvider>
      <BrowserRouter>
        <Navbar />
        <Routes>
          <Route path="/welcome" element={<Welcome />} />
          <Route path="/" element={<RequireLogin><Home /></RequireLogin>} />
          <Route path="/restaurant/:id" element={<RequireLogin><Restaurant /></RequireLogin>} />
          <Route path="/cart" element={<RequireLogin><Cart /></RequireLogin>} />
          <Route path="/checkout" element={<RequireLogin><Checkout /></RequireLogin>} />
          <Route path="/orders" element={<RequireLogin><Orders /></RequireLogin>} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
        </Routes>
      </BrowserRouter>
    </CartProvider>
    </AuthProvider>
  );
}
