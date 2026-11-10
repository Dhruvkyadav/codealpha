const express = require('express');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const db = new Database('social.db');
const SECRET = process.env.JWT_SECRET || 'change-me';

app.use(express.json());
app.use(express.static('public'));

// ---------- Database ----------
db.exec(`
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, username TEXT UNIQUE, password TEXT, bio TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS posts(id INTEGER PRIMARY KEY, user_id INTEGER, text TEXT, created TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS comments(id INTEGER PRIMARY KEY, post_id INTEGER, user_id INTEGER, text TEXT, created TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS likes(post_id INTEGER, user_id INTEGER, PRIMARY KEY(post_id, user_id));
CREATE TABLE IF NOT EXISTS follows(follower_id INTEGER, following_id INTEGER, PRIMARY KEY(follower_id, following_id));
`);

// ---------- Auth ----------
const readUser = req => { try { return jwt.verify((req.headers.authorization || '').replace('Bearer ', ''), SECRET); } catch { return null; } };
const optional = (req, res, next) => { req.user = readUser(req) || { id: 0 }; next(); };
const auth = (req, res, next) => { req.user = readUser(req); req.user ? next() : res.status(401).json({ error: 'Please log in first' }); };
const session = u => ({ token: jwt.sign({ id: u.id, username: u.username }, SECRET, { expiresIn: '7d' }), id: u.id, username: u.username });

app.post('/api/register', (req, res) => {
  const { username, password } = req.body;
  if (!/^\w{3,20}$/.test(username || '') || (password || '').length < 6)
    return res.status(400).json({ error: 'Username: 3-20 letters/numbers. Password: 6+ characters.' });
  try {
    const id = db.prepare('INSERT INTO users(username,password) VALUES(?,?)').run(username, bcrypt.hashSync(password, 10)).lastInsertRowid;
    res.json(session({ id, username }));
  } catch { res.status(400).json({ error: 'That username is taken' }); }
});

app.post('/api/login', (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE username=?').get(req.body.username || '');
  if (!u || !bcrypt.compareSync(req.body.password || '', u.password)) return res.status(401).json({ error: 'Wrong username or password' });
  res.json(session(u));
});

// ---------- Posts ----------
const POSTS = `SELECT p.id, p.text, p.created, u.username,
  (SELECT COUNT(*) FROM likes WHERE post_id=p.id) likes,
  (SELECT COUNT(*) FROM likes WHERE post_id=p.id AND user_id=@me) liked,
  (SELECT COUNT(*) FROM comments WHERE post_id=p.id) comments
  FROM posts p JOIN users u ON u.id=p.user_id`;

app.get('/api/posts', optional, (req, res) => {
  const me = req.user.id;
  let sql = POSTS, where = '';
  if (req.query.user) where = ' WHERE u.username=@name';
  else if (req.query.following) where = ' WHERE p.user_id=@me OR p.user_id IN (SELECT following_id FROM follows WHERE follower_id=@me)';
  res.json(db.prepare(sql + where + ' ORDER BY p.id DESC LIMIT 100').all({ me, name: req.query.user || '' }).map(r => (r.liked = !!r.liked, r)));
});

app.post('/api/posts', auth, (req, res) => {
  const text = (req.body.text || '').trim();
  if (!text || text.length > 280) return res.status(400).json({ error: 'Posts must be 1-280 characters' });
  db.prepare('INSERT INTO posts(user_id,text) VALUES(?,?)').run(req.user.id, text);
  res.json({ ok: true });
});

app.post('/api/posts/:id/like', auth, (req, res) => {
  const args = [req.params.id, req.user.id];
  const del = db.prepare('DELETE FROM likes WHERE post_id=? AND user_id=?').run(...args);
  if (!del.changes) db.prepare('INSERT INTO likes VALUES(?,?)').run(...args);   // toggle
  res.json({ liked: !del.changes });
});

// ---------- Comments ----------
app.get('/api/posts/:id/comments', (req, res) =>
  res.json(db.prepare('SELECT c.id,c.text,c.created,u.username FROM comments c JOIN users u ON u.id=c.user_id WHERE post_id=? ORDER BY c.id').all(req.params.id)));

app.post('/api/posts/:id/comments', auth, (req, res) => {
  const text = (req.body.text || '').trim();
  if (!text || text.length > 280) return res.status(400).json({ error: 'Comments must be 1-280 characters' });
  db.prepare('INSERT INTO comments(post_id,user_id,text) VALUES(?,?,?)').run(req.params.id, req.user.id, text);
  res.json({ ok: true });
});

// ---------- Profiles & follows ----------
app.get('/api/users/:name', optional, (req, res) => {
  const u = db.prepare('SELECT id,username,bio FROM users WHERE username=?').get(req.params.name);
  if (!u) return res.status(404).json({ error: 'User not found' });
  const count = (col, other) => db.prepare(`SELECT COUNT(*) c FROM follows WHERE ${col}=?`).get(u.id).c;
  res.json({ ...u,
    followers: count('following_id'), following: count('follower_id'),
    isFollowing: !!db.prepare('SELECT 1 FROM follows WHERE follower_id=? AND following_id=?').get(req.user.id, u.id) });
});

app.put('/api/me', auth, (req, res) => {
  db.prepare('UPDATE users SET bio=? WHERE id=?').run((req.body.bio || '').slice(0, 160), req.user.id);
  res.json({ ok: true });
});

app.post('/api/users/:name/follow', auth, (req, res) => {
  const u = db.prepare('SELECT id FROM users WHERE username=?').get(req.params.name);
  if (!u) return res.status(404).json({ error: 'User not found' });
  if (u.id === req.user.id) return res.status(400).json({ error: "You can't follow yourself" });
  const args = [req.user.id, u.id];
  const del = db.prepare('DELETE FROM follows WHERE follower_id=? AND following_id=?').run(...args);
  if (!del.changes) db.prepare('INSERT INTO follows VALUES(?,?)').run(...args);  // toggle
  res.json({ following: !del.changes });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Social app running at http://localhost:${PORT}`));
