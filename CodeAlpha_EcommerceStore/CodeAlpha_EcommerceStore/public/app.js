const app = document.getElementById('app');
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => '$' + Number(n).toFixed(2);
let cart = JSON.parse(localStorage.cart || '[]');
let user = JSON.parse(localStorage.user || 'null');
const saveCart = () => { localStorage.cart = JSON.stringify(cart); drawNav(); };

async function api(url, method = 'GET', body) {
  const res = await fetch('/api' + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(user ? { Authorization: 'Bearer ' + user.token } : {}) },
    body: body && JSON.stringify(body)
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Something went wrong');
  return data;
}

function drawNav() {
  const count = cart.reduce((s, i) => s + i.qty, 0);
  document.getElementById('nav').innerHTML =
    `<a href="#/">Shop</a><a href="#/cart">Cart (${count})</a>` +
    (user ? `<a href="#/orders">My orders</a><button id="out">Log out (${esc(user.name)})</button>`
          : `<a href="#/login">Log in</a><a href="#/register">Sign up</a>`);
  const out = document.getElementById('out');
  if (out) out.onclick = () => { user = null; localStorage.removeItem('user'); drawNav(); location.hash = '#/'; };
}

function addToCart(p) {
  const found = cart.find(i => i.id === p.id);
  found ? found.qty++ : cart.push({ id: p.id, name: p.name, price: p.price, emoji: p.emoji, qty: 1 });
  saveCart();
}

// ---------- Pages ----------
async function home() {
  const products = await api('/products');
  app.innerHTML = '<h1>Products</h1><div class="grid">' + products.map(p => `
    <div class="card">
      <a class="emoji" href="#/product/${p.id}">${p.emoji}</a>
      <h3>${esc(p.name)}</h3><div class="price">${money(p.price)}</div>
      <p><button class="btn" data-id="${p.id}">Add to cart</button></p>
    </div>`).join('') + '</div>';
  app.querySelectorAll('button[data-id]').forEach(b =>
    b.onclick = () => { addToCart(products.find(p => p.id == b.dataset.id)); b.textContent = 'Added ✓'; });
}

async function product(id) {
  const p = await api('/products/' + id);
  app.innerHTML = `<div class="detail"><div class="emoji">${p.emoji}</div><div>
    <h1>${esc(p.name)}</h1><p>${esc(p.description)}</p><p class="price">${money(p.price)}</p>
    <button class="btn" id="add">Add to cart</button> <a href="#/">Back to shop</a></div></div>`;
  document.getElementById('add').onclick = e => { addToCart(p); e.target.textContent = 'Added ✓'; };
}

function cartPage() {
  if (!cart.length) { app.innerHTML = '<h1>Your cart</h1><p class="muted">Your cart is empty. <a href="#/">Browse products</a></p>'; return; }
  const total = cart.reduce((s, i) => s + i.price * i.qty, 0);
  app.innerHTML = '<h1>Your cart</h1>' + cart.map(i => `
    <div class="row"><span>${i.emoji} ${esc(i.name)}</span>
      <span class="qty"><button data-d="-1" data-id="${i.id}">−</button> ${i.qty} <button data-d="1" data-id="${i.id}">+</button></span>
      <span>${money(i.price * i.qty)}</span></div>`).join('') + `
    <h2>Total: ${money(total)}</h2>
    <label>Delivery address</label><textarea id="addr" rows="2"></textarea>
    <p class="msg" id="msg"></p><button class="btn" id="order">Place order</button>`;
  app.querySelectorAll('.qty button').forEach(b => b.onclick = () => {
    const item = cart.find(i => i.id == b.dataset.id);
    item.qty += +b.dataset.d;
    if (item.qty < 1) cart = cart.filter(i => i !== item);
    saveCart(); cartPage();
  });
  document.getElementById('order').onclick = async () => {
    if (!user) { location.hash = '#/login'; return; }
    try {
      await api('/orders', 'POST', { items: cart.map(i => ({ id: i.id, qty: i.qty })), address: document.getElementById('addr').value });
      cart = []; saveCart(); location.hash = '#/orders';
    } catch (e) { document.getElementById('msg').textContent = e.message; }
  };
}

function authPage(mode) {
  const reg = mode === 'register';
  app.innerHTML = `<div class="narrow"><h1>${reg ? 'Create account' : 'Log in'}</h1>
    ${reg ? '<label>Name</label><input id="name">' : ''}
    <label>Email</label><input id="email" type="email">
    <label>Password</label><input id="pw" type="password">
    <p class="msg" id="msg"></p><button class="btn" id="go">${reg ? 'Sign up' : 'Log in'}</button></div>`;
  document.getElementById('go').onclick = async () => {
    try {
      const body = { email: email.value, password: pw.value };
      if (reg) body.name = name.value;
      user = await api(reg ? '/register' : '/login', 'POST', body);
      localStorage.user = JSON.stringify(user); drawNav(); location.hash = '#/';
    } catch (e) { document.getElementById('msg').textContent = e.message; }
  };
}

async function orders() {
  if (!user) { location.hash = '#/login'; return; }
  const list = await api('/orders');
  app.innerHTML = '<h1>My orders</h1>' + (list.length ? list.map(o => `
    <div class="card" style="margin-bottom:12px"><b>Order #${o.id}</b> <span class="muted">${esc(o.created)}</span>
      ${o.items.map(i => `<div class="row"><span>${esc(i.name)} × ${i.qty}</span><span>${money(i.price * i.qty)}</span></div>`).join('')}
      <p><b>Total: ${money(o.total)}</b><br><span class="muted">Ships to: ${esc(o.address)}</span></p></div>`).join('')
    : '<p class="muted">No orders yet. <a href="#/">Start shopping</a></p>');
}

// ---------- Router ----------
async function route() {
  const [page, id] = location.hash.replace('#/', '').split('/');
  try {
    if (page === 'product') await product(id);
    else if (page === 'cart') cartPage();
    else if (page === 'login') authPage('login');
    else if (page === 'register') authPage('register');
    else if (page === 'orders') await orders();
    else await home();
  } catch (e) { app.innerHTML = `<p class="msg">${esc(e.message)}</p>`; }
}
window.addEventListener('hashchange', route);
drawNav(); route();
