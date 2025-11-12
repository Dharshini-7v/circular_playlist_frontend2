const API = window.location.origin; // use current origin so any port works

async function api(path, opts = {}) {
  const res = await fetch(API + path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// remember-me helpers
function getRememberedUser() {
  try { return localStorage.getItem('rememberUser'); } catch { return null; }
}
function setRememberedUser(u) {
  try { localStorage.setItem('rememberUser', u || ''); } catch {}
}
function clearRememberedUser() {
  try { localStorage.removeItem('rememberUser'); } catch {}
}

function el(tag, attrs = {}, children = []) {
  const e = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => (e[k] = v));
  children.forEach((c) => e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c));
  return e;
}

let favIds = new Set();

function liSong(s, withFav = true) {
  const text = `${s.id}: ${s.title} - ${s.artist}`;
  if (!withFav) return el('li', {}, [text]);
  const btn = el('button', { className: 'favBtn', title: 'Toggle Favorite' }, [ favIds.has(s.id) ? '★' : '☆' ]);
  btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (favIds.has(s.id)) {
      await api(`/favorites/${s.id}`, { method: 'DELETE' });
      favIds.delete(s.id);
    } else {
      await api('/favorites', { method: 'POST', body: JSON.stringify({ song_id: s.id }) });
      favIds.add(s.id);
    }
    btn.textContent = favIds.has(s.id) ? '★' : '☆';
    await refreshFavoritesOnly();
  });
  return el('li', {}, [ text, ' ', btn ]);
}

function setPlayer(song, shouldPlay = false) {
  const player = document.getElementById('player');
  if (!player) return;
  if (song && song.audio_url) {
    if (player.src !== song.audio_url) {
      player.src = song.audio_url;
    }
    if (shouldPlay) {
      player.play().catch(() => {});
    }
  } else {
    player.removeAttribute('src');
    try { player.pause(); } catch {}
  }
}

async function refresh() {
  // Check auth first
  const me = await api('/me');
  const remembered = getRememberedUser();
  const loginScreen = document.getElementById('loginScreen');
  const appHeader = document.getElementById('appHeader');
  const appRoot = document.getElementById('appRoot');
  const loginBtn = document.getElementById('loginBtn');

  if (!me.user) {
    // show login, hide app, stop audio
    loginScreen.classList.remove('hidden');
    appHeader.classList.add('hidden');
    appRoot.classList.add('hidden');
    loginBtn.textContent = 'Login';
    // prefill username if remembered but DO NOT auto-login
    const u = remembered || '';
    const input = document.getElementById('loginScreenUsername');
    if (input && u && input.value !== u) input.value = u;
    const player = document.getElementById('player');
    if (player) { try { player.pause(); } catch {} player.removeAttribute('src'); }
    return; // do not fetch app data when logged out
  }

  // logged in: show app
  loginScreen.classList.add('hidden');
  appHeader.classList.remove('hidden');
  appRoot.classList.remove('hidden');
  loginBtn.textContent = `Logout (${me.user})`;

  const [songs, queue, history, play, fav] = await Promise.all([
    api('/songs'),
    api('/queue'),
    api('/history'),
    api('/play'),
    api('/favorites'),
  ]);
  favIds = new Set(fav.map(x => x.id));
  const songsEl = document.getElementById('songs');
  const queueEl = document.getElementById('queue');
  const historyEl = document.getElementById('history');

  songsEl.innerHTML = '';
  queueEl.innerHTML = '';
  historyEl.innerHTML = '';

  songs.forEach((s) => songsEl.appendChild(liSong(s, true)));
  queue.forEach((s) => queueEl.appendChild(liSong(s)));
  history.forEach((s) => historyEl.appendChild(liSong(s)));

  document.getElementById('nowPlaying').textContent = play.song ? `${play.song.title} - ${play.song.artist}` : 'None';
  // Do not auto-play on refresh/login; only update the source silently
  setPlayer(play.song, false);

  // secondary views
  renderFavoritesList(fav);
  renderQueueOnly(queue);
  renderHistoryOnly(history);
}

async function refreshFavoritesOnly() {
  const fav = await api('/favorites');
  favIds = new Set(fav.map(x => x.id));
  renderFavoritesList(fav);
}

function renderFavoritesList(fav) {
  const favEl = document.getElementById('favorites');
  if (!favEl) return;
  favEl.innerHTML = '';
  fav.forEach(s => favEl.appendChild(liSong(s, true)));
}

function renderQueueOnly(queue) {
  const elq = document.getElementById('queueOnly');
  if (!elq) return;
  elq.innerHTML = '';
  queue.forEach(s => elq.appendChild(liSong(s, false)));
}

function renderHistoryOnly(history) {
  const elh = document.getElementById('historyOnly');
  if (!elh) return;
  elh.innerHTML = '';
  history.forEach(s => elh.appendChild(liSong(s, false)));
}

async function init() {
  // login screen form
  document.getElementById('loginScreenForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('loginScreenUsername').value.trim();
    const remember = document.getElementById('rememberMe').checked;
    if (!username) return;
    await api('/login', { method: 'POST', body: JSON.stringify({ username }) });
    if (remember) { setRememberedUser(username); } else { clearRememberedUser(); }
    await refresh();
  });

  document.getElementById('addForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = document.getElementById('title').value.trim();
    const artist = document.getElementById('artist').value.trim();
    const duration = parseInt(document.getElementById('duration').value || '0', 10);
    const audio_url = document.getElementById('audioUrl').value.trim() || null;
    if (!title || !artist) return;
    await api('/songs', { method: 'POST', body: JSON.stringify({ title, artist, duration_sec: duration, audio_url }) });
    e.target.reset();
    await refresh();
  });

  document.getElementById('removeBtn').addEventListener('click', async () => {
    const id = parseInt(document.getElementById('removeId').value, 10);
    if (!id) return;
    await api(`/songs/${id}`, { method: 'DELETE' });
    await refresh();
  });

  document.getElementById('enqueueBtn').addEventListener('click', async () => {
    const id = parseInt(document.getElementById('enqueueId').value, 10);
    if (!id) return;
    await api('/enqueue', { method: 'POST', body: JSON.stringify({ song_id: id }) });
    await refresh();
  });

  document.getElementById('playBtn').addEventListener('click', async () => {
    const res = await api('/play');
    if (res && res.song) setPlayer(res.song, true);
    await refresh();
  });

  document.getElementById('nextBtn').addEventListener('click', async () => {
    const res = await api('/next', { method: 'POST' });
    if (res && res.song) setPlayer(res.song, true);
    await refresh();
  });

  document.getElementById('prevBtn').addEventListener('click', async () => {
    const res = await api('/previous', { method: 'POST' });
    if (res && res.song) setPlayer(res.song, true);
    await refresh();
  });

  document.getElementById('applyImpl').addEventListener('click', async () => {
    const v = document.getElementById('implSelect').value;
    await api('/impl', { method: 'POST', body: JSON.stringify({ impl: v }) });
    await refresh();
  });

  document.getElementById('seedBtn').addEventListener('click', async () => {
    await api('/seed_fast', { method: 'POST' });
    await refresh();
  });

  // nav/view switching
  function showView(name) {
    ['home','favorites','queue','history'].forEach(v => {
      document.getElementById(`view-${v}`).classList.toggle('hidden', v !== name);
    });
    document.querySelectorAll('.topnav .nav').forEach(b => b.classList.toggle('active', b.dataset.view === name));
  }
  document.querySelectorAll('.topnav .nav[data-view]').forEach(btn => btn.addEventListener('click', () => showView(btn.dataset.view)));

  // header login/logout
  document.getElementById('loginBtn').addEventListener('click', async () => {
    const me = await api('/me');
    if (me.user) {
      await api('/logout', { method: 'POST' });
      clearRememberedUser();
      // Immediately show login screen to avoid flicker
      const loginScreen = document.getElementById('loginScreen');
      const appHeader = document.getElementById('appHeader');
      const appRoot = document.getElementById('appRoot');
      loginScreen.classList.remove('hidden');
      appHeader.classList.add('hidden');
      appRoot.classList.add('hidden');
      // Focus username and scroll to top
      document.getElementById('loginScreenUsername').focus();
      window.scrollTo({ top: 0, behavior: 'instant' });
      // stop audio immediately
      const player = document.getElementById('player');
      if (player) { try { player.pause(); } catch {} player.removeAttribute('src'); }
      await refresh();
    } else {
      // focus login screen username
      document.getElementById('loginScreenUsername').focus();
    }
  });

  await refresh();
}

window.addEventListener('DOMContentLoaded', init);
