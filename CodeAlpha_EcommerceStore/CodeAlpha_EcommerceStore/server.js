const express = require('express');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const db = new Database('shop.db');
const SECRET = process.env.JWT_SECRET || 'change-me';

app.use(express.json());
app.use(express.static('public'));

// ---------- Database ----------
db.exec(`
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, name TEXT, email TEXT UNIQUE, password TEXT);
CREATE TABLE IF NOT EXISTS products(id INTEGER PRIMARY KEY, name TEXT, description TEXT, price REAL, emoji TEXT);
CREATE TABLE IF NOT EXISTS orders(id INTEGER PRIMARY KEY, user_id INTEGER, total REAL, address TEXT, created TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS order_items(order_id INTEGER, product_id INTEGER, name TEXT, price REAL, qty INTEGER);
`);

if (db.prepare('SELECT COUNT(*) c FROM products').get().c === 0) {
  const add = db.prepare('INSERT INTO products(name,description,price,emoji) VALUES(?,?,?,?)');
  [
    ['Ceramic Mug', 'Hand-glazed 350ml mug, dishwasher safe.', 12.5, '☕'],
    ['Canvas Backpack', 'Roomy daypack with a padded laptop sleeve.', 45, '🎒'],
    ['Desk Plant', 'Low-maintenance succulent in a clay pot.', 18, '🪴'],
    ['Notebook Set', 'Three dotted-grid notebooks, 120 pages each.', 15, '📓'],
    ['Wireless Headphones', 'Over-ear, 30 hours of battery life.', 79.99, '🎧'],
    ['Water Bottle', 'Insulated steel bottle, keeps drinks cold for 24h.', 22, '🧴'],
    ['Table Lamp', 'Warm LED lamp with a dimmer.', 34, '💡'],
    ['Sunglasses', 'Polarised lenses with UV400 protection.', 29, '🕶️']
  ].forEach(p => add.run(...p));
}

// ---------- Auth helpers ----------
const auth = (req, res, next) => {
  try {
    req.user = jwt.verify((req.headers.authorization || '').replace('Bearer ', ''), SECRET);
    next();
  } catch { res.status(401).json({ error: 'Please log in first' }); }
};
const session = u => ({ token: jwt.sign({ id: u.id, name: u.name }, SECRET, { expiresIn: '7d' }), name: u.name });

app.post('/api/register', (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password || password.length < 6)
    return res.status(400).json({ error: 'Name, email and a password of 6+ characters are required' });
  try {
    const id = db.prepare('INSERT INTO users(name,email,password) VALUES(?,?,?)')
      .run(name, email.toLowerCase(), bcrypt.hashSync(password, 10)).lastInsertRowid;
    res.json(session({ id, name }));
  } catch { res.status(400).json({ error: 'That email is already registered' }); }
});

app.post('/api/login', (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE email=?').get((req.body.email || '').toLowerCase());
  if (!u || !bcrypt.compareSync(req.body.password || '', u.password))
    return res.status(401).json({ error: 'Wrong email or password' });
  res.json(session(u));
});

// ---------- Products ----------
app.get('/api/products', (req, res) => res.json(db.prepare('SELECT * FROM products').all()));
app.get('/api/products/:id', (req, res) => {
  const p = db.prepare('SELECT * FROM products WHERE id=?').get(req.params.id);
  p ? res.json(p) : res.status(404).json({ error: 'Product not found' });
});

// ---------- Orders ----------
app.post('/api/orders', auth, (req, res) => {
  const { items, address } = req.body;
  if (!Array.isArray(items) || !items.length || !address)
    return res.status(400).json({ error: 'Cart and address are required' });
  const getP = db.prepare('SELECT * FROM products WHERE id=?');
  const lines = items.map(i => ({ p: getP.get(i.id), qty: Math.max(1, parseInt(i.qty) || 1) }));
  if (lines.some(l => !l.p)) return res.status(400).json({ error: 'A product in your cart no longer exists' });
  const total = lines.reduce((s, l) => s + l.p.price * l.qty, 0); // price is taken from DB, not the client
  const place = db.transaction(() => {
    const oid = db.prepare('INSERT INTO orders(user_id,total,address) VALUES(?,?,?)').run(req.user.id, total, address).lastInsertRowid;
    const ins = db.prepare('INSERT INTO order_items VALUES(?,?,?,?,?)');
    lines.forEach(l => ins.run(oid, l.p.id, l.p.name, l.p.price, l.qty));
    return oid;
  });
  res.json({ id: place(), total });
});

app.get('/api/orders', auth, (req, res) => {
  const orders = db.prepare('SELECT * FROM orders WHERE user_id=? ORDER BY id DESC').all(req.user.id);
  const items = db.prepare('SELECT * FROM order_items WHERE order_id=?');
  res.json(orders.map(o => ({ ...o, items: items.all(o.id) })));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Shop running at http://localhost:${PORT}`));
