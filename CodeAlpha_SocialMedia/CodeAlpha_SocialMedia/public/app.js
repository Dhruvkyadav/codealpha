const app = document.getElementById('app');
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let user = JSON.parse(localStorage.user || 'null');

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
  document.getElementById('nav').innerHTML = user
    ? `<a href="#/">Home</a><a href="#/u/${user.username}">Profile</a><button id="out">Log out</button>`
    : `<a href="#/login">Log in</a><a href="#/register">Sign up</a>`;
  const out = document.getElementById('out');
  if (out) out.onclick = () => { user = null; localStorage.removeItem('user'); drawNav(); location.hash = '#/login'; };
}

// ---------- Posts list (shared by feed and profile) ----------
function postHTML(p) {
  return `<div class="card" data-id="${p.id}">
    <a class="user" href="#/u/${esc(p.username)}">@${esc(p.username)}</a> <span class="muted">${esc(p.created)}</span>
    <p>${esc(p.text)}</p>
    <div class="actions">
      <button class="like ${p.liked ? 'on' : ''}">${p.liked ? '♥' : '♡'} ${p.likes}</button>
      <button class="cmt">💬 ${p.comments}</button>
    </div><div class="thread"></div></div>`;
}

function wirePosts(refresh) {
  app.querySelectorAll('.card[data-id]').forEach(card => {
    const id = card.dataset.id;
    card.querySelector('.like').onclick = async () => {
      if (!user) { location.hash = '#/login'; return; }
      await api(`/posts/${id}/like`, 'POST'); refresh();
    };
    card.querySelector('.cmt').onclick = async () => {
      const box = card.querySelector('.thread');
      if (box.innerHTML) { box.innerHTML = ''; return; }
      const list = await api(`/posts/${id}/comments`);
      box.innerHTML = list.map(c => `<div class="comment"><b>@${esc(c.username)}</b> ${esc(c.text)}</div>`).join('') +
        (user ? '<input placeholder="Write a comment..."><button class="btn">Reply</button>' : '<p class="muted">Log in to comment.</p>');
      const btn = box.querySelector('button');
      if (btn) btn.onclick = async () => {
        await api(`/posts/${id}/comments`, 'POST', { text: box.querySelector('input').value });
        refresh(); 
      };
    };
  });
}

// ---------- Pages ----------
async function feed(onlyFollowing = false) {
  const posts = await api('/posts' + (onlyFollowing ? '?following=1' : ''));
  app.innerHTML = (user ? `<div class="card"><textarea id="text" rows="2" maxlength="280" placeholder="What's happening?"></textarea>
      <p class="msg" id="msg"></p><button class="btn" id="post">Post</button></div>` : '<p class="muted">Log in to post, like and follow.</p>') +
    `<div class="tabs"><button class="btn ${onlyFollowing ? 'alt' : ''}" id="all">Everyone</button>
     ${user ? `<button class="btn ${onlyFollowing ? '' : 'alt'}" id="fol">Following</button>` : ''}</div>` +
    (posts.length ? posts.map(postHTML).join('') : '<p class="muted">Nothing here yet. Write the first post or follow someone.</p>');
  document.getElementById('all').onclick = () => feed(false);
  if (user) {
    document.getElementById('fol').onclick = () => feed(true);
    document.getElementById('post').onclick = async () => {
      try { await api('/posts', 'POST', { text: text.value }); feed(onlyFollowing); }
      catch (e) { document.getElementById('msg').textContent = e.message; }
    };
  }
  wirePosts(() => feed(onlyFollowing));
}

async function profile(name) {
  const [u, posts] = await Promise.all([api('/users/' + name), api('/posts?user=' + encodeURIComponent(name))]);
  const mine = user && user.username === u.username;
  app.innerHTML = `<div class="card"><h2 style="margin:0">@${esc(u.username)}</h2>
    <p>${esc(u.bio) || '<span class="muted">No bio yet.</span>'}</p>
    <div class="stats"><span><b>${u.followers}</b> followers</span><span><b>${u.following}</b> following</span><span><b>${posts.length}</b> posts</span></div>
    ${mine ? '<input id="bio" maxlength="160" placeholder="Update your bio"><button class="btn" id="saveBio">Save bio</button>'
           : user ? `<button class="btn ${u.isFollowing ? 'alt' : ''}" id="follow">${u.isFollowing ? 'Unfollow' : 'Follow'}</button>` : ''}
    </div>` + posts.map(postHTML).join('');
  if (mine) document.getElementById('saveBio').onclick = async () => { await api('/me', 'PUT', { bio: bio.value }); profile(name); };
  else if (user) document.getElementById('follow').onclick = async () => { await api(`/users/${name}/follow`, 'POST'); profile(name); };
  wirePosts(() => profile(name));
}

function authPage(mode) {
  const reg = mode === 'register';
  app.innerHTML = `<div class="card narrow"><h2>${reg ? 'Create account' : 'Log in'}</h2>
    <label>Username</label><input id="un"><label>Password</label><input id="pw" type="password">
    <p class="msg" id="msg"></p><button class="btn" id="go">${reg ? 'Sign up' : 'Log in'}</button></div>`;
  document.getElementById('go').onclick = async () => {
    try {
      user = await api(reg ? '/register' : '/login', 'POST', { username: un.value, password: pw.value });
      localStorage.user = JSON.stringify(user); drawNav(); location.hash = '#/';
    } catch (e) { document.getElementById('msg').textContent = e.message; }
  };
}

// ---------- Router ----------
async function route() {
  const [page, id] = location.hash.replace('#/', '').split('/');
  try {
    if (page === 'u') await profile(id);
    else if (page === 'login') authPage('login');
    else if (page === 'register') authPage('register');
    else await feed();
  } catch (e) { app.innerHTML = `<p class="msg">${esc(e.message)}</p>`; }
}
window.addEventListener('hashchange', route);
drawNav(); route();
