/* ============================================================
   STATE
   ============================================================ */
const state = {
  tracks: [],
  currentIndex: -1,
  theme: 'dark',
  wordElementsMap: [],
  activeLineIndex: -1,
  wordCursor: 0,
  autoScrollLocked: true,
  searchQuery: '',
  artistFilterMode: false,
  shuffle: false,
  repeat: 'off',          // 'off' | 'all' | 'one'
  shuffleOrder: [],
};

/* ============================================================
   INDEXEDDB
   ============================================================ */
const DB_NAME = 'MySpotifyDB';
const DB_VERSION = 1;
const STORE_TRACKS = 'tracks';
const LS_THEME = 'myspotify_theme';
let db = null;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const database = e.target.result;
      if (!database.objectStoreNames.contains(STORE_TRACKS)) {
        database.createObjectStore(STORE_TRACKS, { keyPath: 'id' });
      }
    };
    req.onsuccess = (e) => { db = e.target.result; resolve(db); };
    req.onerror = (e) => reject(e.target.error);
  });
}

function dbGetAll() {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_TRACKS, 'readonly');
    const store = tx.objectStore(STORE_TRACKS);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = (e) => reject(e.target.error);
  });
}

function dbPut(track) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_TRACKS, 'readwrite');
    const store = tx.objectStore(STORE_TRACKS);
    const req = store.put(track);
    req.onsuccess = () => resolve();
    req.onerror = (e) => reject(e.target.error);
  });
}

function dbDelete(id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_TRACKS, 'readwrite');
    const store = tx.objectStore(STORE_TRACKS);
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = (e) => reject(e.target.error);
  });
}

function dbUpdateOrder(orderedTracks) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_TRACKS, 'readwrite');
    const store = tx.objectStore(STORE_TRACKS);
    let pending = orderedTracks.length;
    if (pending === 0) return resolve();

    orderedTracks.forEach((t, idx) => {
      const getReq = store.get(t.id);
      getReq.onsuccess = () => {
        const row = getReq.result;
        if (row) {
          row.order = idx;
          store.put(row);
        }
        pending--;
        if (pending === 0) resolve();
      };
      getReq.onerror = (e) => reject(e.target.error);
    });

    tx.onerror = (e) => reject(e.target.error);
  });
}

/* ============================================================
   DOM
   ============================================================ */
const folderInput = document.getElementById('folder-input');
const uploadBtn = document.getElementById('upload-btn');
const uploadOverlay = document.getElementById('upload-overlay');
const uploadStatus = document.getElementById('upload-status');
const toast = document.getElementById('toast');
const heroCover = document.getElementById('hero-cover');
const heroTitle = document.getElementById('hero-title');
const heroArtist = document.getElementById('hero-artist');
const btnSettings = document.getElementById('btn-settings');
const settingsPanel = document.getElementById('settings-panel');
const settingsOverlay = document.getElementById('settings-overlay');
const settingsCloseBtn = document.getElementById('settings-close-btn');
const navSearch = document.getElementById('nav-search');
const navLibrary = document.getElementById('nav-library');
const libraryList = document.getElementById('library-list');
const trackCountEl = document.getElementById('track-count');
const libraryTitle = document.getElementById('library-title');
const libraryClearSearch = document.getElementById('library-clear-search');
const appHeader = document.getElementById('app-header');

// Search
const searchView = document.getElementById('search-view');
const searchInput = document.getElementById('search-input');
const searchClearBtn = document.getElementById('search-clear');
const searchResults = document.getElementById('search-results');
const artistFilterBtn = document.getElementById('artist-filter-btn');

// Mini Player
const miniPlayer = document.getElementById('mini-player');
const miniCover = document.getElementById('mini-cover');
const miniTitle = document.getElementById('mini-title');
const miniArtist = document.getElementById('mini-artist');
const miniProgressBar = document.getElementById('mini-progress-bar');
const miniProgressFill = document.getElementById('mini-player-progress-fill');
const miniTimeCurrent = document.getElementById('mini-time-current');
const miniTimeTotal = document.getElementById('mini-time-total');
const miniBtnPlay = document.getElementById('mini-btn-play');
const miniBtnPrev = document.getElementById('mini-btn-prev');
const miniBtnNext = document.getElementById('mini-btn-next');
const miniIconPlay = document.getElementById('mini-icon-play');
const miniIconPause = document.getElementById('mini-icon-pause');

// Full Player
const fullPlayer = document.getElementById('full-player');
const fullPlayerClose = document.getElementById('full-player-close');
const fullPlayerCoverImg = document.getElementById('full-player-cover-img');
const fullPlayerTitle = document.getElementById('full-player-title');
const fullPlayerArtist = document.getElementById('full-player-artist');
const fullProgressBar = document.getElementById('full-progress-bar');
const fullProgressFill = document.getElementById('full-progress-fill');
const fullTimeCurrent = document.getElementById('full-time-current');
const fullTimeTotal = document.getElementById('full-time-total');
const fullBtnPlay = document.getElementById('full-btn-play');
const fullBtnPrev = document.getElementById('full-btn-prev');
const fullBtnNext = document.getElementById('full-btn-next');
const fullIconPlay = document.getElementById('full-icon-play');
const fullIconPause = document.getElementById('full-icon-pause');
const fullLyricsContainer = document.getElementById('full-lyrics-container');
const fullBtnShuffle = document.getElementById('full-btn-shuffle');
const fullBtnRepeat = document.getElementById('full-btn-repeat');
const fullIconRepeat = document.getElementById('full-icon-repeat');
const fullIconRepeatOne = document.getElementById('full-icon-repeat-one');

/* ============================================================
   AUDIO
   ============================================================ */
const audio = new Audio();
audio.preload = 'metadata';
let currentAudioUrl = null;

let miniDragging = false;
let fullDragging = false;
let wasPlayingBeforeDrag = false;

/* ============================================================
   HELPERS
   ============================================================ */
function parseFolderName(name) {
  const parts = name.split(' - ');
  if (parts.length >= 2) {
    return { title: parts[0].trim(), artist: parts.slice(1).join(' - ').trim() };
  }
  return { title: name.trim(), artist: 'Άγνωστος' };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function splitArtists(artistString) {
  if (!artistString) return [];
  return artistString
    .split(',')
    .map(a => a.trim())
    .filter(a => a.length > 0);
}

function matchesQuery(track, q) {
  if (state.artistFilterMode) {
    return splitArtists(track.artist).some(a => a.toLowerCase().includes(q));
  }
  return track.title.toLowerCase().includes(q) || track.artist.toLowerCase().includes(q);
}

function showToast(msg, isError = false) {
  toast.textContent = msg;
  toast.style.background = isError ? '#e74c3c' : '#1DB954';
  toast.style.color = isError ? '#fff' : '#000';
  toast.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toast.classList.remove('show'), 2500);
}

function formatTime(seconds) {
  if (!isFinite(seconds) || isNaN(seconds)) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/* ============================================================
   SETTINGS
   ============================================================ */
function openSettings() {
  settingsPanel.classList.add('show');
  settingsOverlay.classList.add('show');
}

function closeSettings() {
  settingsPanel.classList.remove('show');
  settingsOverlay.classList.remove('show');
}

btnSettings.addEventListener('click', openSettings);
settingsCloseBtn.addEventListener('click', closeSettings);
settingsOverlay.addEventListener('click', closeSettings);

/* ============================================================
   THEME
   ============================================================ */
function applyTheme(theme) {
  state.theme = theme;
  if (theme === 'light') document.body.classList.add('light-theme');
  else document.body.classList.remove('light-theme');
  document.querySelectorAll('.theme-option').forEach(opt => {
    opt.classList.toggle('active', opt.dataset.theme === theme);
  });
  localStorage.setItem(LS_THEME, theme);
}

document.querySelectorAll('.theme-option').forEach(opt => {
  opt.addEventListener('click', () => {
    applyTheme(opt.dataset.theme);
    showToast(opt.dataset.theme === 'light' ? '☀️ Ανοιχτό θέμα' : '🌙 Σκούρο θέμα');
  });
});

/* ============================================================
   UPLOAD
   ============================================================ */
uploadBtn.addEventListener('click', () => folderInput.click());

folderInput.addEventListener('change', async (e) => {
  const files = Array.from(e.target.files);
  if (!files.length) return;

  uploadOverlay.classList.remove('hidden');
  uploadStatus.textContent = `Βρέθηκαν ${files.length} αρχεία. Ανάλυση...`;

  const groups = {};
  for (const file of files) {
    const path = file.webkitRelativePath || file.name;
    const parts = path.split('/');
    if (parts.length < 2) continue;
    const folderPath = parts.slice(0, -1).join('/');
    const folderName = parts[parts.length - 2];
    if (!groups[folderPath]) groups[folderPath] = { folder: folderName, files: [] };
    groups[folderPath].files.push(file);
  }

  const validGroups = Object.values(groups).filter(g =>
    g.files.some(f => f.name.toLowerCase().endsWith('.mp3'))
  );

  const existingIds = new Set(state.tracks.map(t => t.id));
  let added = 0;
  let skipped = 0;

  const rows = await dbGetAll();
  let maxOrder = rows.reduce((m, r) => Math.max(m, r.order || 0), 0);

  for (let i = 0; i < validGroups.length; i++) {
    const g = validGroups[i];
    uploadStatus.textContent = `Ανάλυση: ${g.folder} (${i+1}/${validGroups.length})`;

    const mp3 = g.files.find(f => f.name.toLowerCase().endsWith('.mp3'));
    const img = g.files.find(f => /\.(png|jpg|jpeg|webp)$/i.test(f.name));
    const lyricsHtml = g.files.find(f => f.name.toLowerCase() === 'lyrics_player.html');

    if (!mp3) continue;

    const id = g.folder;
    if (existingIds.has(id)) { skipped++; continue; }

    const meta = parseFolderName(g.folder);
    const track = {
      id,
      title: meta.title,
      artist: meta.artist,
      folder: g.folder,
      audioBlob: mp3,
      coverBlob: img || null,
      coverType: img ? (img.type || 'image/png') : '',
      lyricsData: null,
      addedAt: Date.now(),
      order: ++maxOrder,
    };

    if (lyricsHtml) {
      try {
        const text = await lyricsHtml.text();
        track.lyricsData = extractWordLyrics(text);
      } catch (err) {
        console.warn('Lyrics parse error:', err);
      }
    }

    try {
      await dbPut(track);
      added++;
    } catch (err) {
      console.error('DB put error:', err);
    }
  }

  await loadFromDB();
  uploadOverlay.classList.add('hidden');
  folderInput.value = '';

  if (added > 0 && skipped > 0) showToast(`Προστέθηκαν ${added} νέα, αγνοήθηκαν ${skipped}`);
  else if (added > 0) showToast(`Προστέθηκαν ${added} νέα τραγούδια`);
  else if (skipped > 0) showToast(`Όλα τα ${skipped} τραγούδια υπάρχουν ήδη`);
  else showToast('Δεν βρέθηκαν τραγούδια', true);
});

function extractWordLyrics(htmlText) {
  const marker = 'const wordLyricsData';
  const idx = htmlText.indexOf(marker);
  if (idx === -1) return null;
  const startBracket = htmlText.indexOf('[', idx);
  if (startBracket === -1) return null;

  let depth = 0;
  let endBracket = -1;
  for (let i = startBracket; i < htmlText.length; i++) {
    const ch = htmlText[i];
    if (ch === '[') depth++;
    else if (ch === ']') {
      depth--;
      if (depth === 0) { endBracket = i; break; }
    }
  }
  if (endBracket === -1) return null;

  const arrText = htmlText.slice(startBracket, endBracket + 1);
  try {
    const fn = new Function(`return ${arrText};`);
    return fn();
  } catch (err) {
    return null;
  }
}

/* ============================================================
   LOAD FROM DB
   ============================================================ */
async function loadFromDB() {
  try {
    const rows = await dbGetAll();
    rows.sort((a, b) => {
      const oa = a.order != null ? a.order : (a.addedAt || 0);
      const ob = b.order != null ? b.order : (b.addedAt || 0);
      return oa - ob;
    });

    state.tracks = rows.map((r, i) => ({
      id: r.id,
      title: r.title,
      artist: r.artist,
      folder: r.folder,
      lyricsData: r.lyricsData,
      order: r.order != null ? r.order : i,
      addedAt: r.addedAt,
      audioBlob: r.audioBlob || null,
      coverBlob: r.coverBlob || null,
      coverUrl: r.coverBlob ? URL.createObjectURL(r.coverBlob) : null,
      coverType: r.coverBlob ? (r.coverBlob.type || 'image/png') : '',
    }));

    state.shuffleOrder = [];
    console.log(`✅ Φορτώθηκαν ${state.tracks.length} τραγούδια από τη βάση`);
    renderLibrary();
  } catch (err) {
    console.error('Load DB error:', err);
  }
}

/* ============================================================
   LIBRARY RENDER
   ============================================================ */
function renderLibrary() {
  const query = (state.searchQuery || '').toLowerCase().trim();
  const filtered = state.tracks
    .map((t, i) => ({ t, i }))
    .filter(({ t }) => !query || matchesQuery(t, query));

  if (query) {
    libraryTitle.textContent = state.artistFilterMode ? '🎤 Αποτελέσματα Καλλιτέχνη' : '🔍 Αποτελέσματα';
  } else {
    libraryTitle.textContent = '📚 Library';
  }
  libraryClearSearch.classList.toggle('hidden', !query);

  if (!state.tracks.length) {
    libraryList.innerHTML = `
      <div class="text-center text-sm py-16 px-6" style="color: var(--text-muted);">
        Δεν υπάρχουν τραγούδια.<br>Πάτα <b style="color: #1DB954;">Upload</b> για να προσθέσεις.
      </div>
    `;
    trackCountEl.textContent = '0 tracks';
    return;
  }

  trackCountEl.textContent = `${filtered.length}${state.tracks.length !== filtered.length ? '/' + state.tracks.length : ''} track${state.tracks.length !== 1 ? 's' : ''}`;

  if (!filtered.length) {
    libraryList.innerHTML = `
      <div class="text-center text-sm py-16 px-6" style="color: var(--text-muted);">
        🔍 Δεν βρέθηκαν αποτελέσματα
      </div>
    `;
    return;
  }

  libraryList.innerHTML = '';
  filtered.forEach(({ t, i }) => {
    const isPlaying = i === state.currentIndex;
    const div = document.createElement('div');
    div.className = `track-item ${isPlaying ? 'playing' : ''}`;
    div.dataset.index = i;
    div.dataset.id = t.id;
    div.innerHTML = `
      <div class="drag-handle" title="Σύρε για αλλαγή σειράς">
        <svg width="14" height="14" fill="currentColor" viewBox="0 0 24 24">
          <circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/>
          <circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/>
          <circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/>
        </svg>
      </div>
      <div class="track-item-cover">
        ${t.coverUrl ? `<img src="${t.coverUrl}" alt="">` : `♪`}
      </div>
      <div class="track-item-info">
        <div class="track-item-title">${escapeHtml(t.title)}</div>
        <div class="track-item-artist">${escapeHtml(t.artist)}</div>
      </div>
      <button class="delete-track" aria-label="Διαγραφή τραγουδιού" title="Διαγραφή">
        <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/>
        </svg>
      </button>
    `;
    div.querySelector('.delete-track').addEventListener('click', (e) => {
      e.stopPropagation();
      deleteTrack(t.id, t.title);
    });
    div.addEventListener('click', (e) => {
      if (e.target.closest('.drag-handle') || e.target.closest('.delete-track')) return;
      if (i === state.currentIndex) {
        togglePlay();
      } else {
        playTrack(i);
      }
    });
    libraryList.appendChild(div);
  });
}

/* ============================================================
   ΔΙΑΓΡΑΦΗ ΤΡΑΓΟΥΔΙΟΥ
   ============================================================ */
const HERO_PLACEHOLDER = heroCover.src;

function resetPlayerAfterDelete() {
  audio.pause();
  if (currentAudioUrl) {
    URL.revokeObjectURL(currentAudioUrl);
    currentAudioUrl = null;
  }
  audio.removeAttribute('src');
  try { audio.load(); } catch (_) {}

  state.currentIndex = -1;
  state.activeLineIndex = -1;
  state.wordElementsMap = [];

  closeFullPlayer();
  miniPlayer.classList.remove('show');

  heroTitle.textContent = '—';
  heroArtist.textContent = 'Επίλεξε ένα τραγούδι';
  heroCover.src = HERO_PLACEHOLDER;

  miniProgressFill.style.width = '0%';
  fullProgressFill.style.width = '0%';
  miniTimeCurrent.textContent = '0:00';
  miniTimeTotal.textContent = '0:00';
  fullTimeCurrent.textContent = '0:00';
  fullTimeTotal.textContent = '0:00';

  resetLyrics();

  if ('mediaSession' in navigator) {
    navigator.mediaSession.playbackState = 'none';
    navigator.mediaSession.metadata = null;
  }
  updatePlayPauseIcons();
}

async function deleteTrack(id, title) {
  if (!confirm(`Να διαγραφεί το τραγούδι «${title}»;`)) return;

  const idx = state.tracks.findIndex(t => t.id === id);
  if (idx < 0) return;

  try {
    await dbDelete(id);
  } catch (err) {
    console.error('Delete error:', err);
    showToast('Σφάλμα διαγραφής', true);
    return;
  }

  const removed = state.tracks[idx];
  const wasCurrent = idx === state.currentIndex;
  const currentId = state.currentIndex >= 0 ? state.tracks[state.currentIndex]?.id : null;

  state.tracks.splice(idx, 1);
  state.shuffleOrder = [];
  artworkCache.delete(id);

  if (wasCurrent) {
    resetPlayerAfterDelete();
  } else if (currentId != null) {
    state.currentIndex = state.tracks.findIndex(t => t.id === currentId);
  }

  if (removed.coverUrl) URL.revokeObjectURL(removed.coverUrl);

  renderLibrary();
  if (searchView.classList.contains('show')) renderSearchResults();
  showToast('Το τραγούδι διαγράφηκε');
}

/* ============================================================
   PLAY TRACK
   ============================================================ */
function playTrack(index) {
  if (index < 0 || index >= state.tracks.length) return;
  state.currentIndex = index;
  const t = state.tracks[index];

  if (!t.audioBlob) {
    showToast('Το τραγούδι δεν έχει ήχο', true);
    return;
  }

  if (currentAudioUrl) {
    URL.revokeObjectURL(currentAudioUrl);
    currentAudioUrl = null;
  }

  currentAudioUrl = URL.createObjectURL(t.audioBlob);
  audio.src = currentAudioUrl;
  audio.play().catch(err => {
    console.warn('Play error:', err);
    dbg(`play() rejected: ${err.name} - ${err.message}`);
  });

  updatePlayerUI();
  renderLibrary();
  renderLyrics(t);
  resetLyricsScroll();
}

function togglePlay() {
  if (state.currentIndex === -1) return;
  if (audio.paused) {
    resumePlayback();
  } else {
    audio.pause();
  }
}

function playPrevious() {
  if (state.currentIndex === -1) return;
  if (audio.currentTime > 3) {
    audio.currentTime = 0;
    return;
  }
  let prev = state.currentIndex - 1;
  if (prev < 0) prev = state.tracks.length - 1;
  playTrack(prev);
}

function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Επιστρέφει τον επόμενο δείκτη ή -1 αν η αναπαραγωγή πρέπει να σταματήσει
function computeNextIndex(isAuto) {
  const n = state.tracks.length;
  if (!n) return -1;

  if (state.shuffle) {
    if (!state.shuffleOrder.length) state.shuffleOrder = shuffleArray(state.tracks.map((_, i) => i));
    const pos = state.shuffleOrder.indexOf(state.currentIndex);
    if (isAuto && pos === state.shuffleOrder.length - 1 && state.repeat !== 'all') return -1;
    return state.shuffleOrder[(pos + 1) % state.shuffleOrder.length];
  }

  const next = state.currentIndex + 1;
  if (next >= n) return state.repeat === 'all' ? 0 : -1;
  return next;
}

function playNext() {
  if (state.currentIndex === -1) return;
  const next = computeNextIndex(false);
  if (next === -1) {
    audio.pause();
    return;
  }
  playTrack(next);
}

function updatePlayerUI() {
  const t = state.tracks[state.currentIndex];
  if (!t) return;

  // Hero
  heroTitle.textContent = t.title;
  heroArtist.textContent = t.artist;
  heroCover.src = t.coverUrl || heroCover.src;

  // Mini Player
  miniTitle.textContent = t.title;
  miniArtist.textContent = t.artist;
  if (t.coverUrl) {
    miniCover.innerHTML = `<img src="${t.coverUrl}" alt="">`;
  } else {
    miniCover.innerHTML = '♪';
  }

  // Full Player
  fullPlayerTitle.textContent = t.title;
  fullPlayerArtist.textContent = t.artist;
  if (t.coverUrl) {
    fullPlayerCoverImg.src = t.coverUrl;
  } else {
    fullPlayerCoverImg.src = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22400%22 height=%22400%22%3E%3Crect width=%22400%22 height=%22400%22 fill=%22%23282828%22/%3E%3Ctext x=%2250%25%22 y=%2250%25%22 font-size=%22160%22 text-anchor=%22middle%22 dy=%22.3em%22 fill=%22%23555%22%3E♪%3C/text%3E%3C/svg%3E';
  }

  miniPlayer.classList.add('show');

  updateMediaSession();
}

function updatePlayPauseIcons() {
  const paused = audio.paused;
  if (paused) {
    miniIconPlay.classList.remove('hidden');
    miniIconPause.classList.add('hidden');
    fullIconPlay.classList.remove('hidden');
    fullIconPause.classList.add('hidden');
  } else {
    miniIconPlay.classList.add('hidden');
    miniIconPause.classList.remove('hidden');
    fullIconPlay.classList.add('hidden');
    fullIconPause.classList.remove('hidden');
  }
}

/* ============================================================
   AUDIO EVENTS
   ============================================================ */
audio.addEventListener('play', () => {
  updatePlayPauseIcons();
  renderLibrary();
});

audio.addEventListener('pause', () => {
  updatePlayPauseIcons();
  renderLibrary();
});

audio.addEventListener('loadedmetadata', () => {
  miniTimeTotal.textContent = formatTime(audio.duration);
  miniTimeCurrent.textContent = '0:00';
  fullTimeTotal.textContent = formatTime(audio.duration);
  fullTimeCurrent.textContent = '0:00';
});

audio.addEventListener('timeupdate', () => {
  if (!audio.duration || !isFinite(audio.duration)) return;

  if (!miniDragging) {
    const pctMini = (audio.currentTime / audio.duration) * 100;
    miniProgressFill.style.width = pctMini + '%';
    miniTimeCurrent.textContent = formatTime(audio.currentTime);
  }

  if (!fullDragging) {
    const pctFull = (audio.currentTime / audio.duration) * 100;
    fullProgressFill.style.width = pctFull + '%';
    fullTimeCurrent.textContent = formatTime(audio.currentTime);
  }
});

audio.addEventListener('ended', () => {
  if (state.repeat === 'one') {
    audio.currentTime = 0;
    audio.play().catch(() => {});
    return;
  }
  const next = computeNextIndex(true);
  if (next === -1) {
    audio.pause();
    return;
  }
  playTrack(next);
});

/* ============================================================
   DEBUG LOG (Ρυθμίσεις → Διάγνωση ήχου)
   ============================================================ */
const DEBUG_KEY = 'myspotify_debug_log';
let debugLines = [];
try { debugLines = JSON.parse(localStorage.getItem(DEBUG_KEY) || '[]'); } catch (_) { debugLines = []; }

function dbg(msg) {
  const d = new Date();
  const ts = d.toTimeString().slice(0, 8) + '.' + String(d.getMilliseconds()).padStart(3, '0');
  debugLines.push(`${ts} ${msg}`);
  if (debugLines.length > 400) debugLines = debugLines.slice(-400);
  try { localStorage.setItem(DEBUG_KEY, JSON.stringify(debugLines)); } catch (_) {}
}

function audioInfo() {
  const sess = navigator.audioSession ? navigator.audioSession.state : 'n/a';
  return `[paused=${audio.paused} t=${(audio.currentTime || 0).toFixed(1)} ready=${audio.readyState} net=${audio.networkState} err=${audio.error ? audio.error.code : 0} session=${sess} vis=${document.visibilityState}]`;
}

['play', 'playing', 'pause', 'waiting', 'stalled', 'error', 'ended', 'emptied', 'abort', 'loadstart'].forEach((ev) => {
  audio.addEventListener(ev, () => dbg(`audio:${ev} ${audioInfo()}`));
});

document.addEventListener('visibilitychange', () => dbg(`visibility=${document.visibilityState} ${audioInfo()}`));
window.addEventListener('pagehide', (e) => dbg(`pagehide persisted=${e.persisted}`));
window.addEventListener('pageshow', (e) => dbg(`pageshow persisted=${e.persisted} ${audioInfo()}`));
document.addEventListener('freeze', () => dbg('page freeze'));
document.addEventListener('resume', () => dbg('page resume'));

if (navigator.audioSession) {
  navigator.audioSession.addEventListener('statechange', () => {
    dbg(`audioSession state=${navigator.audioSession.state}`);
  });
}

// Κάθε 5" καταγράφει κατάσταση: τα κενά στο log δείχνουν πότε "πάγωσε" η σελίδα
setInterval(() => dbg(`tick ${audioInfo()}`), 5000);

dbg(`--- εκκίνηση εφαρμογής --- ${navigator.userAgent}`);

const debugOverlay = document.getElementById('debug-overlay');
const debugLogEl = document.getElementById('debug-log');

document.getElementById('debug-show-btn').addEventListener('click', () => {
  debugLogEl.textContent = debugLines.join('\n');
  debugOverlay.classList.add('show');
  debugLogEl.scrollTop = debugLogEl.scrollHeight;
});
document.getElementById('debug-close-btn').addEventListener('click', () => {
  debugOverlay.classList.remove('show');
});
document.getElementById('debug-clear-btn').addEventListener('click', () => {
  debugLines = [];
  try { localStorage.removeItem(DEBUG_KEY); } catch (_) {}
  showToast('Το log καθαρίστηκε');
});
document.getElementById('debug-copy-btn').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(debugLines.join('\n'));
    showToast('Αντιγράφηκε');
  } catch (_) {
    showToast('Η αντιγραφή απέτυχε', true);
  }
});

/* ============================================================
   MEDIA SESSION (οθόνη κλειδώματος / Control Center)
   ============================================================ */
// true  = μπορείς να τραβάς τη μπάρα προόδου από την οθόνη κλειδώματος
// false = χωρίς αυτό (αυξάνει τις πιθανότητες να εμφανιστούν τα κουμπιά previous / next αντί για ±10")
const LOCKSCREEN_SEEK = false;

const artworkCache = new Map();

// Φτιάχνει τετράγωνο 512x512 εξώφυλλο (data URL) που διαβάζεται σίγουρα από το iOS
function buildArtwork(track) {
  if (artworkCache.has(track.id)) return Promise.resolve(artworkCache.get(track.id));
  return new Promise((resolve) => {
    if (!track.coverUrl) return resolve(null);
    const img = new Image();
    img.onload = () => {
      try {
        const size = 512;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        const side = Math.min(img.naturalWidth, img.naturalHeight);
        const sx = (img.naturalWidth - side) / 2;
        const sy = (img.naturalHeight - side) / 2;
        ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
        const url = canvas.toDataURL('image/jpeg', 0.9);
        artworkCache.set(track.id, url);
        resolve(url);
      } catch (err) {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = track.coverUrl;
  });
}

async function updateMediaSession() {
  if (!('mediaSession' in navigator) || typeof MediaMetadata === 'undefined') return;
  const t = state.tracks[state.currentIndex];
  if (!t) return;
  const trackId = t.id;

  const art = await buildArtwork(t);
  // Αν στο μεταξύ άλλαξε τραγούδι, μην γράψεις παλιά στοιχεία
  if (state.tracks[state.currentIndex]?.id !== trackId) return;

  const fallback = new URL('apple-touch-icon.png', location.href).href;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: t.title,
    artist: t.artist,
    album: 'My Spotify',
    artwork: [{
      src: art || fallback,
      sizes: '512x512',
      type: art ? 'image/jpeg' : 'image/png',
    }],
  });
  // Το iOS διαβάζει τα κουμπιά όταν υπάρχει ενεργή συνεδρία ήχου, οπότε τα δηλώνουμε ξανά εδώ
  setupMediaSessionHandlers();
  updateMediaSessionPosition();
}

function updateMediaSessionPosition() {
  if (!('mediaSession' in navigator) || !navigator.mediaSession.setPositionState) return;
  if (!audio.duration || !isFinite(audio.duration)) return;
  try {
    navigator.mediaSession.setPositionState({
      duration: audio.duration,
      playbackRate: audio.playbackRate || 1,
      position: Math.min(Math.max(audio.currentTime, 0), audio.duration),
    });
  } catch (_) {}
}

function setupMediaSessionHandlers() {
  if (!('mediaSession' in navigator)) return;
  const ms = navigator.mediaSession;
  const set = (action, handler) => {
    try { ms.setActionHandler(action, handler); } catch (_) {}
  };

  // Το play/pause της οθόνης κλειδώματος το χειρίζεται το iOS απευθείας στο audio,
  // χωρίς να περνά από JavaScript (η σελίδα μπορεί να είναι "παγωμένη" στο παρασκήνιο).
  set('play', null);
  set('pause', null);
  set('previoustrack', () => { dbg(`action previoustrack ${audioInfo()}`); playPrevious(); });
  set('nexttrack', () => { dbg(`action nexttrack ${audioInfo()}`); playNext(); });
  // Αφαιρούμε τα "skip 10 δευτερολέπτων" ώστε να εμφανιστούν τα previous / next
  set('seekbackward', null);
  set('seekforward', null);
  if (LOCKSCREEN_SEEK) {
    set('seekto', (details) => {
      if (details.seekTime == null || !audio.duration) return;
      audio.currentTime = details.seekTime;
      updateMediaSessionPosition();
    });
  } else {
    set('seekto', null);
  }
}

setupMediaSessionHandlers();

// iOS 16.4+: δηλώνουμε ότι είναι αναπαραγωγή μουσικής (συνεχίζει με κλειδωμένη οθόνη / σε σίγαση)
if (navigator.audioSession) {
  try { navigator.audioSession.type = 'playback'; } catch (_) {}
}

// Το playbackState το διαχειρίζεται μόνο του το iOS από το audio element
audio.addEventListener('play', updateMediaSessionPosition);
audio.addEventListener('pause', updateMediaSessionPosition);
audio.addEventListener('loadedmetadata', updateMediaSessionPosition);
audio.addEventListener('seeked', updateMediaSessionPosition);
audio.addEventListener('ratechange', updateMediaSessionPosition);

/* ------------------------------------------------------------
   Ανάκαμψη αναπαραγωγής: το iOS μπορεί να "πετάξει" την πηγή ήχου όσο η εφαρμογή
   είναι σε pause στο παρασκήνιο. Τότε φορτώνουμε ξανά το τραγούδι στην ίδια θέση.
   ------------------------------------------------------------ */
let lastKnown = { id: null, time: 0 };

audio.addEventListener('timeupdate', () => {
  const t = state.tracks[state.currentIndex];
  if (t && audio.currentTime > 0) lastKnown = { id: t.id, time: audio.currentTime };
});

function reloadCurrentSource(shouldPlay) {
  const t = state.tracks[state.currentIndex];
  if (!t || !t.audioBlob) return;

  const pos = (lastKnown.id === t.id) ? lastKnown.time : 0;
  if (currentAudioUrl) URL.revokeObjectURL(currentAudioUrl);
  currentAudioUrl = URL.createObjectURL(t.audioBlob);
  audio.src = currentAudioUrl;

  audio.addEventListener('loadedmetadata', () => {
    try { audio.currentTime = pos; } catch (_) {}
    if (shouldPlay) audio.play().catch(err => console.warn('Play error:', err));
    updatePlayPauseIcons();
    updateMediaSessionPosition();
  }, { once: true });

  audio.load();
}

async function resumePlayback() {
  if (state.currentIndex === -1) return;

  // Αν η πηγή χάθηκε, φόρτωσέ την ξανά
  if (!audio.currentSrc || audio.error) {
    reloadCurrentSource(true);
    return;
  }
  try {
    await audio.play();
  } catch (err) {
    console.warn('Play error, reloading source:', err);
    reloadCurrentSource(true);
  }
}

// Όταν επιστρέφεις στην εφαρμογή: συγχρόνισε τα κουμπιά και φτιάξε την πηγή αν χάθηκε
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (state.currentIndex === -1) return;
  if (!audio.currentSrc || audio.error) reloadCurrentSource(false);
  updatePlayPauseIcons();
  updateMediaSessionPosition();
});

/* ============================================================
   ANIMATION LOOP — Word-by-word lyrics με fill animation
   ============================================================ */
let lastScrollLine = -1;
let loopLastTime = -1;
let loopLastMap = null;

function animationLoop() {
  // Αν ο Full Player είναι κλειστός δεν χρειάζεται να ενημερώνουμε στίχους (εξοικονόμηση μπαταρίας).
  // Όταν ανοίξει, ένα πέρασμα τα φέρνει όλα στη σωστή κατάσταση.
  if (!fullPlayer.classList.contains('show')) {
    requestAnimationFrame(animationLoop);
    return;
  }

  const currentTime = audio.currentTime;

  // Σε pause, αν δεν άλλαξε τίποτα (χρόνος, στίχοι), δεν κάνουμε δουλειά
  if (audio.paused && currentTime === loopLastTime && state.wordElementsMap === loopLastMap) {
    requestAnimationFrame(animationLoop);
    return;
  }
  loopLastTime = currentTime;
  loopLastMap = state.wordElementsMap;

  if (state.wordElementsMap.length) {
    let currentLine = -1;
    const FILL_DURATION = 0.18;

    // state: 0 = muted (γκρι), 1 = in-progress, 2 = completed (λευκό)
    // Ελέγχουμε ΟΛΕΣ τις λέξεις, ώστε μετά από seek (μπρος ή πίσω) να φωτίζονται σωστά
    for (let i = 0; i < state.wordElementsMap.length; i++) {
      const item = state.wordElementsMap[i];
      const { element, start, end, lineIndex } = item;

      if (currentTime >= end) {
        if (item.state !== 2) {
          setWordCompleted(element);
          item.state = 2;
        }
        if (currentTime >= start) currentLine = lineIndex;
      } else if (currentTime < start) {
        if (item.state !== 0) {
          setWordMuted(element);
          item.state = 0;
        }
      } else {
        const progressFraction = (currentTime - start) / FILL_DURATION;
        const pct = Math.round(Math.min(Math.max(progressFraction * 100, 0), 100));
        if (item.state !== 1 || item.pct !== pct) {
          setWordInProgress(element, pct);
          item.state = 1;
          item.pct = pct;
        }
        currentLine = lineIndex;
      }
    }

    // Edge cases στην αρχή/τέλος
    if (currentTime < state.wordElementsMap[0].start) {
      currentLine = 0;
    }
    const lastWord = state.wordElementsMap[state.wordElementsMap.length - 1];
    if (currentTime > lastWord.end) {
      currentLine = lastWord.lineIndex;
    }

    if (currentLine !== -1 && currentLine !== state.activeLineIndex) {
      state.activeLineIndex = currentLine;

      fullLyricsContainer.querySelectorAll('.lyric-line.active-line')
        .forEach(l => l.classList.remove('active-line'));

      const el = document.getElementById(`line-${currentLine}`);
      if (el) {
        el.classList.add('active-line');

        if (state.autoScrollLocked && lastScrollLine !== currentLine) {
          scrollFullLyricsToLine(currentLine);
          lastScrollLine = currentLine;
        }
      }
    }
  }

  requestAnimationFrame(animationLoop);
}

/* ============================================================
   MINI PLAYER EVENTS
   ============================================================ */
miniBtnPlay.addEventListener('click', (e) => {
  e.stopPropagation();
  togglePlay();
});

miniBtnPrev.addEventListener('click', (e) => {
  e.stopPropagation();
  playPrevious();
});

miniBtnNext.addEventListener('click', (e) => {
  e.stopPropagation();
  playNext();
});

// Open Full Player on mini player tap (εξαιρούνται κουμπιά + progress bar)
miniPlayer.addEventListener('click', (e) => {
  if (e.target.closest('.mini-player-btn')) return;
  if (e.target.closest('#mini-progress-bar')) return;
  openFullPlayer();
});

/* ============================================================
   FULL PLAYER
   ============================================================ */
function openFullPlayer() {
  fullPlayer.classList.add('show');
  // Αναγκάζουμε πλήρη επανασυγχρονισμό των στίχων στο επόμενο frame
  loopLastTime = -1;
  lastScrollLine = -1;
  state.activeLineIndex = -1;
  // Ξεκλείδωσε το sync + κεντράρισε την ενεργή γραμμή
  state.autoScrollLocked = true;
  setTimeout(() => {
    if (state.activeLineIndex >= 0) {
      scrollFullLyricsToLine(state.activeLineIndex);
      lastScrollLine = state.activeLineIndex;
    }
  }, 400);
}

function closeFullPlayer() {
  fullPlayer.classList.remove('show');
  fullPlayer.classList.remove('lyrics-fullscreen'); // Reset fullscreen mode
}

fullPlayerClose.addEventListener('click', closeFullPlayer);

/* ============================================================
   SWIPE DOWN για ελαχιστοποίηση του Full Player
   ============================================================ */
let fpDrag = null;

fullPlayer.addEventListener('touchstart', (e) => {
  if (!fullPlayer.classList.contains('show')) return;
  if (e.touches.length !== 1) return;
  if (e.target.closest('#full-progress-bar')) return;   // εκεί γίνεται seek

  const inLyrics = !!e.target.closest('#full-lyrics-container');
  const t = e.touches[0];
  fpDrag = {
    startX: t.clientX,
    startY: t.clientY,
    startTime: Date.now(),
    active: false,
    dy: 0,
    // Στους στίχους, το swipe-down κλείνει τον player μόνο αν είμαστε στην κορυφή τους
    blocked: inLyrics && fullLyricsContainer.scrollTop > 0,
  };
}, { passive: true });

fullPlayer.addEventListener('touchmove', (e) => {
  if (!fpDrag) return;
  const t = e.touches[0];
  const dx = t.clientX - fpDrag.startX;
  const dy = t.clientY - fpDrag.startY;

  if (!fpDrag.active) {
    if (fpDrag.blocked) { fpDrag = null; return; }
    if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
    if (dy > 0 && dy > Math.abs(dx) * 1.2) {
      fpDrag.active = true;
      fullPlayer.style.transition = 'none';
    } else {
      fpDrag = null;       // οριζόντιο ή προς τα πάνω: το αγνοούμε
      return;
    }
  }

  e.preventDefault();
  fpDrag.dy = Math.max(0, dy);
  fullPlayer.style.transform = `translateY(${fpDrag.dy}px)`;
}, { passive: false });

function endFullPlayerSwipe() {
  if (!fpDrag) return;
  const d = fpDrag;
  fpDrag = null;
  if (!d.active) return;

  const elapsed = Math.max(Date.now() - d.startTime, 1);
  const velocity = d.dy / elapsed;   // px/ms

  // Επιστροφή στο CSS transition: ή κλείνει ή επιστρέφει στη θέση του
  fullPlayer.style.transition = '';
  fullPlayer.style.transform = '';
  if (d.dy > 140 || (velocity > 0.6 && d.dy > 40)) {
    closeFullPlayer();
  }
}

fullPlayer.addEventListener('touchend', endFullPlayerSwipe);
fullPlayer.addEventListener('touchcancel', endFullPlayerSwipe);

fullBtnPlay.addEventListener('click', togglePlay);
fullBtnPrev.addEventListener('click', playPrevious);
fullBtnNext.addEventListener('click', playNext);

fullBtnShuffle.addEventListener('click', () => {
  state.shuffle = !state.shuffle;
  state.shuffleOrder = state.shuffle ? shuffleArray(state.tracks.map((_, i) => i)) : [];
  fullBtnShuffle.classList.toggle('active', state.shuffle);
  showToast(state.shuffle ? '🔀 Τυχαία σειρά: Ενεργή' : '🔀 Τυχαία σειρά: Ανενεργή');
});

fullBtnRepeat.addEventListener('click', () => {
  const modes = ['off', 'all', 'one'];
  state.repeat = modes[(modes.indexOf(state.repeat) + 1) % modes.length];

  fullBtnRepeat.classList.toggle('active', state.repeat !== 'off');
  fullIconRepeat.classList.toggle('hidden', state.repeat === 'one');
  fullIconRepeatOne.classList.toggle('hidden', state.repeat !== 'one');

  if (state.repeat === 'all') showToast('🔁 Επανάληψη: Όλα');
  else if (state.repeat === 'one') showToast('🔂 Επανάληψη: Ένα');
  else showToast('➡️ Επανάληψη: Ανενεργή');
});

/* ============================================================
   PROGRESS BAR DRAG - MINI
   ============================================================ */
function getSeekPositionFromBar(barEl, clientX) {
  const rect = barEl.getBoundingClientRect();
  let pct = (clientX - rect.left) / rect.width;
  pct = Math.max(0, Math.min(1, pct));
  return pct;
}

function startMiniDrag(clientX) {
  if (!audio.duration || !isFinite(audio.duration)) return;
  miniDragging = true;
  wasPlayingBeforeDrag = !audio.paused;
  if (wasPlayingBeforeDrag) audio.pause();
  miniProgressBar.classList.add('dragging');
  updateMiniDragVisual(clientX);
}

function updateMiniDragVisual(clientX) {
  const pct = getSeekPositionFromBar(miniProgressBar, clientX);
  miniProgressFill.style.width = (pct * 100) + '%';
  miniTimeCurrent.textContent = formatTime(pct * audio.duration);
}

function endMiniDrag(clientX) {
  if (!miniDragging) return;
  const pct = getSeekPositionFromBar(miniProgressBar, clientX);
  audio.currentTime = pct * audio.duration;
  miniDragging = false;
  miniProgressBar.classList.remove('dragging');
  state.wordCursor = 0;
  state.wordElementsMap.forEach(it => { it.state = undefined; });
  if (wasPlayingBeforeDrag) audio.play().catch(() => {});
}

miniProgressBar.addEventListener('mousedown', (e) => {
  e.stopPropagation();
  startMiniDrag(e.clientX);
});
document.addEventListener('mousemove', (e) => {
  if (miniDragging) { e.preventDefault(); updateMiniDragVisual(e.clientX); }
});
document.addEventListener('mouseup', (e) => {
  if (miniDragging) endMiniDrag(e.clientX);
});

miniProgressBar.addEventListener('touchstart', (e) => {
  e.stopPropagation();
  startMiniDrag(e.touches[0].clientX);
}, { passive: true });
miniProgressBar.addEventListener('touchmove', (e) => {
  if (!miniDragging) return;
  e.stopPropagation();
  updateMiniDragVisual(e.touches[0].clientX);
}, { passive: true });
miniProgressBar.addEventListener('touchend', (e) => {
  if (!miniDragging) return;
  e.stopPropagation();
  endMiniDrag(e.changedTouches[0].clientX);
}, { passive: true });

/* ============================================================
   PROGRESS BAR DRAG - FULL
   ============================================================ */
function startFullDrag(clientX) {
  if (!audio.duration || !isFinite(audio.duration)) return;
  fullDragging = true;
  wasPlayingBeforeDrag = !audio.paused;
  if (wasPlayingBeforeDrag) audio.pause();
  fullProgressBar.classList.add('dragging');
  updateFullDragVisual(clientX);
}

function updateFullDragVisual(clientX) {
  const pct = getSeekPositionFromBar(fullProgressBar, clientX);
  fullProgressFill.style.width = (pct * 100) + '%';
  fullTimeCurrent.textContent = formatTime(pct * audio.duration);
}

function endFullDrag(clientX) {
  if (!fullDragging) return;
  const pct = getSeekPositionFromBar(fullProgressBar, clientX);
  audio.currentTime = pct * audio.duration;
  fullDragging = false;
  fullProgressBar.classList.remove('dragging');
  state.wordCursor = 0;
  state.wordElementsMap.forEach(it => { it.state = undefined; });
  if (wasPlayingBeforeDrag) audio.play().catch(() => {});
}

fullProgressBar.addEventListener('mousedown', (e) => {
  e.stopPropagation();
  startFullDrag(e.clientX);
});
document.addEventListener('mousemove', (e) => {
  if (fullDragging) { e.preventDefault(); updateFullDragVisual(e.clientX); }
});
document.addEventListener('mouseup', (e) => {
  if (fullDragging) endFullDrag(e.clientX);
});

fullProgressBar.addEventListener('touchstart', (e) => {
  e.stopPropagation();
  startFullDrag(e.touches[0].clientX);
}, { passive: true });
fullProgressBar.addEventListener('touchmove', (e) => {
  if (!fullDragging) return;
  e.stopPropagation();
  updateFullDragVisual(e.touches[0].clientX);
}, { passive: true });
fullProgressBar.addEventListener('touchend', (e) => {
  if (!fullDragging) return;
  e.stopPropagation();
  endFullDrag(e.changedTouches[0].clientX);
}, { passive: true });

/* ============================================================
   LYRICS RENDER
   ============================================================ */
function resetLyrics() {
  fullLyricsContainer.innerHTML = '<div class="full-lyrics-empty">🎵 Οι στίχοι θα εμφανιστούν εδώ</div>';
  state.wordElementsMap = [];
  state.activeLineIndex = -1;
  state.wordCursor = 0;
}

function resetLyricsScroll() {
  fullLyricsContainer.scrollTop = 0;
  state.activeLineIndex = -1;
  state.wordCursor = 0;
  lastScrollLine = -1;
  // Reset word states
  state.wordElementsMap.forEach(it => { it.state = undefined; });
}

function renderLyrics(track) {
  state.wordElementsMap = [];
  state.activeLineIndex = -1;
  state.wordCursor = 0;
  fullLyricsContainer.innerHTML = '';

  if (!track.lyricsData || !track.lyricsData.length) {
    fullLyricsContainer.innerHTML = '<div class="full-lyrics-empty">📝 Δεν υπάρχουν στίχοι για αυτό το τραγούδι</div>';
    return;
  }

  track.lyricsData.forEach((lineData, lIndex) => {
    const lineDiv = document.createElement('div');
    lineDiv.classList.add('lyric-line');
    lineDiv.id = `line-${lIndex}`;

    lineData.forEach((wData, wIndex) => {
      const span = document.createElement('span');
      span.classList.add('lyric-word');
      span.textContent = wData.word;
      span.dataset.lineIndex = lIndex;
      span.dataset.wordIndex = wIndex;
      span.style.color = 'var(--text-muted)';

      span.addEventListener('click', () => {
        audio.currentTime = wData.start;
        if (audio.paused) audio.play();

        document.querySelectorAll('.lyric-line.active-line').forEach(el => {
          el.classList.remove('active-line');
        });
        lineDiv.classList.add('active-line');

        markAllWordsBeforeAsCompleted(lIndex, wIndex);

        const idx = state.wordElementsMap.findIndex(
          it => it.lineIndex === lIndex && it.wordIndex === wIndex
        );
        state.wordCursor = idx >= 0 ? idx : 0;
        state.activeLineIndex = lIndex;
        lastScrollLine = lIndex;

        setTimeout(() => {
          scrollFullLyricsToLine(lIndex);
        }, 50);
      });

      lineDiv.appendChild(span);
      state.wordElementsMap.push({
        element: span,
        lineIndex: lIndex,
        wordIndex: wIndex,
        lineElement: lineDiv,
        start: wData.start,
        end: wData.end,
      });
    });

    fullLyricsContainer.appendChild(lineDiv);
  });
}

function scrollFullLyricsToLine(lineIndex, smooth = true) {
  const el = document.getElementById(`line-${lineIndex}`);
  if (!el) return;
  const containerHeight = fullLyricsContainer.clientHeight;
  const elTop = el.offsetTop;
  const elHeight = el.offsetHeight;
  // ✅ Offset: 30% από την κορυφή (πιο ψηλά από το κέντρο)
  const targetScroll = Math.max(0, elTop - (containerHeight * 0.3) + (elHeight / 2));
  fullLyricsContainer.scrollTo({ top: targetScroll, behavior: smooth ? 'smooth' : 'instant' });
}

function setWordCompleted(element) {
  element.style.background = 'none';
  element.style.webkitBackgroundClip = 'unset';
  element.style.backgroundClip = 'unset';
  element.style.webkitTextFillColor = 'var(--text-primary)';
  element.style.color = 'var(--text-primary)';
  element.style.filter = 'none';
}

function setWordMuted(element) {
  element.style.background = 'none';
  element.style.webkitBackgroundClip = 'unset';
  element.style.backgroundClip = 'unset';
  element.style.webkitTextFillColor = 'var(--text-muted)';
  element.style.color = 'var(--text-muted)';
  element.style.filter = 'none';
}

function setWordInProgress(element, pct) {
  const progressPct = Math.min(Math.max(pct, 0), 100);
  element.style.background = `linear-gradient(to right, var(--text-primary) 0%, var(--text-primary) ${progressPct}%, var(--text-muted) ${progressPct}%, var(--text-muted) 100%)`;
  element.style.webkitBackgroundClip = 'text';
  element.style.backgroundClip = 'text';
  element.style.webkitTextFillColor = 'transparent';
  element.style.color = 'transparent';
  element.style.filter = 'none';
}

function markAllWordsBeforeAsCompleted(targetLineIndex, targetWordIndex) {
  if (!state.wordElementsMap || !state.wordElementsMap.length) return;
  for (let i = 0; i < state.wordElementsMap.length; i++) {
    const item = state.wordElementsMap[i];
    const { element, lineIndex, wordIndex } = item;
    if (lineIndex < targetLineIndex || (lineIndex === targetLineIndex && wordIndex < targetWordIndex)) {
      setWordCompleted(element);
      item.state = 2;
    }
  }
}

/* ============================================================
   DRAG & DROP ΑΛΛΑΓΗ ΣΕΙΡΑΣ (Library)
   ============================================================ */
let reorder = null;

libraryList.addEventListener('contextmenu', (e) => {
  if (e.target.closest('.drag-handle')) e.preventDefault();
});

libraryList.addEventListener('pointerdown', (e) => {
  const handle = e.target.closest('.drag-handle');
  if (!handle || reorder) return;
  const item = handle.closest('.track-item');
  if (!item) return;

  e.preventDefault();
  try { handle.setPointerCapture(e.pointerId); } catch (_) {}

  const rect = item.getBoundingClientRect();
  reorder = {
    item,
    handle,
    pointerId: e.pointerId,
    grabOffsetY: e.clientY - rect.top,
    lastY: e.clientY,
    startOrder: [...libraryList.children].map(el => el.dataset.id).join('|'),
    raf: 0,
  };
  item.classList.add('dragging');
  document.body.classList.add('reordering');
  reorder.raf = requestAnimationFrame(reorderTick);
});

libraryList.addEventListener('pointermove', (e) => {
  if (!reorder || e.pointerId !== reorder.pointerId) return;
  reorder.lastY = e.clientY;
});

libraryList.addEventListener('pointerup', (e) => {
  if (reorder && e.pointerId === reorder.pointerId) finishReorder();
});
libraryList.addEventListener('pointercancel', (e) => {
  if (reorder && e.pointerId === reorder.pointerId) finishReorder();
});

function reorderTick() {
  if (!reorder) return;
  const { item } = reorder;

  // Αν η λίστα ξανα-φτιάχτηκε στη μέση του drag (π.χ. άλλαξε τραγούδι), ακύρωση
  if (!libraryList.contains(item)) {
    document.body.classList.remove('reordering');
    reorder = null;
    return;
  }

  const y = reorder.lastY;

  // Auto-scroll όταν το δάχτυλο πλησιάζει στις άκρες
  const topEdge = appHeader.getBoundingClientRect().bottom + 50;
  const bottomEdge = window.innerHeight - 170;
  if (y < topEdge) {
    window.scrollBy(0, -Math.min(16, (topEdge - y) / 4 + 2));
  } else if (y > bottomEdge) {
    window.scrollBy(0, Math.min(16, (y - bottomEdge) / 4 + 2));
  }

  // Βρες πού πρέπει να μπει το στοιχείο με βάση τη θέση του δαχτύλου
  item.style.transform = '';
  const siblings = [...libraryList.children].filter(el => el !== item);
  let before = null;
  for (const sib of siblings) {
    const r = sib.getBoundingClientRect();
    if (y < r.top + r.height / 2) { before = sib; break; }
  }

  if (before !== item.nextElementSibling) {
    // FLIP animation για τα υπόλοιπα στοιχεία
    const firstTops = new Map(siblings.map(el => [el, el.getBoundingClientRect().top]));
    libraryList.insertBefore(item, before);
    siblings.forEach(el => {
      const delta = firstTops.get(el) - el.getBoundingClientRect().top;
      if (!delta) return;
      el.style.transition = 'none';
      el.style.transform = `translateY(${delta}px)`;
      void el.offsetHeight;
      el.style.transition = 'transform 0.18s ease';
      el.style.transform = '';
      setTimeout(() => { el.style.transition = ''; }, 200);
    });
  }

  // Το στοιχείο ακολουθεί το δάχτυλο
  const base = item.getBoundingClientRect();
  item.style.transform = `translateY(${y - reorder.grabOffsetY - base.top}px)`;

  reorder.raf = requestAnimationFrame(reorderTick);
}

async function finishReorder() {
  if (!reorder) return;
  const { item, handle, pointerId, startOrder, raf } = reorder;
  cancelAnimationFrame(raf);
  reorder = null;
  try { handle.releasePointerCapture(pointerId); } catch (_) {}
  document.body.classList.remove('reordering');

  if (!libraryList.contains(item)) return;

  // Μικρό animation "προσγείωσης" στη θέση του
  item.style.transition = 'transform 0.15s ease';
  item.style.transform = '';
  item.classList.remove('dragging');
  setTimeout(() => { item.style.transition = ''; }, 170);

  const ids = [...libraryList.children].map(el => el.dataset.id);
  if (ids.join('|') === startOrder) return;   // δεν άλλαξε τίποτα

  await commitNewOrder(
    item.dataset.id,
    item.nextElementSibling ? item.nextElementSibling.dataset.id : null,
    item.previousElementSibling ? item.previousElementSibling.dataset.id : null
  );
}

async function commitNewOrder(movedId, nextId, prevId) {
  const arr = state.tracks.slice();
  const from = arr.findIndex(t => t.id === movedId);
  if (from < 0) return;
  const [moved] = arr.splice(from, 1);

  // Λειτουργεί και όταν η λίστα είναι φιλτραρισμένη (αναζήτηση)
  let insertAt = from;
  if (nextId != null) {
    const ni = arr.findIndex(t => t.id === nextId);
    if (ni >= 0) insertAt = ni;
  } else if (prevId != null) {
    const pi = arr.findIndex(t => t.id === prevId);
    if (pi >= 0) insertAt = pi + 1;
  }
  arr.splice(insertAt, 0, moved);

  const playingId = state.tracks[state.currentIndex]?.id;
  state.tracks = arr;
  if (playingId != null) state.currentIndex = arr.findIndex(t => t.id === playingId);
  state.shuffleOrder = [];

  renderLibrary();   // ανανέωση ώστε οι δείκτες των κλικ να είναι σωστοί

  try {
    await dbUpdateOrder(arr);
    showToast('Η σειρά αποθηκεύτηκε');
  } catch (err) {
    console.error('Order save error:', err);
    showToast('Σφάλμα αποθήκευσης σειράς', true);
  }
}

/* ============================================================
   SEARCH
   ============================================================ */
function renderSearchResults() {
  const raw = state.searchQuery || '';
  const q = raw.toLowerCase().trim();
  searchResults.innerHTML = '';

  if (!q) {
    searchResults.innerHTML = '<div class="search-empty">🔍 Ψάξε τραγούδι ή καλλιτέχνη</div>';
    return;
  }

  const matches = state.tracks.filter(t => matchesQuery(t, q));

  if (!matches.length) {
    searchResults.innerHTML = `<div class="search-empty">Δεν βρέθηκαν αποτελέσματα για "<b>${escapeHtml(raw.trim())}</b>"</div>`;
    return;
  }

  // Λειτουργία καλλιτέχνη: ομαδοποίηση ανά καλλιτέχνη
  if (state.artistFilterMode) {
    const byArtist = {};
    matches.forEach(t => {
      splitArtists(t.artist).forEach(artist => {
        if (artist.toLowerCase().includes(q)) {
          if (!byArtist[artist]) byArtist[artist] = [];
          byArtist[artist].push(t);
        }
      });
    });

    Object.keys(byArtist).forEach(artist => {
      const titleEl = document.createElement('div');
      titleEl.className = 'search-section-title';
      titleEl.textContent = `🎤 ${artist} • ${byArtist[artist].length} τραγούδι${byArtist[artist].length !== 1 ? 'α' : ''}`;
      searchResults.appendChild(titleEl);
      byArtist[artist].forEach(t => searchResults.appendChild(makeSearchResult(t, 'Τραγούδι')));
    });
    return;
  }

  // Κανονική αναζήτηση: καλλιτέχνες + τραγούδια
  const artistSet = new Set();
  matches.forEach(t => {
    splitArtists(t.artist).forEach(a => {
      if (a.toLowerCase().includes(q)) artistSet.add(a);
    });
  });
  const uniqueArtists = [...artistSet].slice(0, 3);

  if (uniqueArtists.length && q.length >= 2) {
    const artistTitle = document.createElement('div');
    artistTitle.className = 'search-section-title';
    artistTitle.textContent = '🎤 Καλλιτέχνες';
    searchResults.appendChild(artistTitle);

    uniqueArtists.forEach(artist => {
      const div = document.createElement('div');
      div.className = 'search-result';
      div.innerHTML = `
        <div class="no-cover artist-avatar">${escapeHtml(artist.charAt(0).toUpperCase())}</div>
        <div class="info">
          <div class="title">${escapeHtml(artist)}</div>
          <div class="type">Καλλιτέχνης</div>
        </div>
      `;
      div.addEventListener('click', () => {
        state.artistFilterMode = true;
        syncArtistFilterBtn();
        searchInput.value = artist;
        state.searchQuery = artist;
        updateSearchClearBtn();
        renderLibrary();
        renderSearchResults();
        closeSearchView();
      });
      searchResults.appendChild(div);
    });
  }

  const songTitle = document.createElement('div');
  songTitle.className = 'search-section-title';
  songTitle.textContent = '🎵 Τραγούδια';
  searchResults.appendChild(songTitle);

  matches.slice(0, 10).forEach(t => searchResults.appendChild(makeSearchResult(t, 'Τραγούδι')));
}

function makeSearchResult(track, type) {
  const div = document.createElement('div');
  div.className = 'search-result';
  div.innerHTML = `
    ${track.coverUrl
      ? `<img src="${track.coverUrl}" alt="">`
      : `<div class="no-cover">♪</div>`}
    <div class="info">
      <div class="title">${escapeHtml(track.title)}</div>
      <div class="artist">${escapeHtml(track.artist)}</div>
      <div class="type">${type}</div>
    </div>
  `;
  div.addEventListener('click', () => {
    const idx = state.tracks.findIndex(t => t.id === track.id);
    if (idx >= 0) playTrack(idx);
    closeSearchView();
  });
  return div;
}

function updateSearchClearBtn() {
  searchClearBtn.classList.toggle('hidden', !searchInput.value);
}

function syncArtistFilterBtn() {
  artistFilterBtn.classList.toggle('active', state.artistFilterMode);
  searchInput.placeholder = state.artistFilterMode
    ? 'Αναζήτηση καλλιτέχνη...'
    : 'Αναζήτηση τραγουδιού ή καλλιτέχνη...';
}

function openSearchView() {
  // Ακριβώς κάτω από το header
  searchView.style.top = appHeader.getBoundingClientRect().bottom + 'px';
  searchView.classList.add('show');
  navSearch.classList.add('active');
  navLibrary.classList.remove('active');
  renderSearchResults();
  searchInput.focus({ preventScroll: true });   // μέσα στο tap, ώστε να ανοίξει το πληκτρολόγιο στο iOS
}

function closeSearchView() {
  searchInput.blur();
  searchView.classList.remove('show');
  navLibrary.classList.add('active');
  navSearch.classList.remove('active');
}

function clearSearch() {
  searchInput.value = '';
  state.searchQuery = '';
  updateSearchClearBtn();
  renderLibrary();
  renderSearchResults();
}

searchInput.addEventListener('input', (e) => {
  state.searchQuery = e.target.value;
  updateSearchClearBtn();
  renderLibrary();
  renderSearchResults();
});

searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') searchInput.blur();   // κλείνει το πληκτρολόγιο
});

searchClearBtn.addEventListener('click', () => {
  clearSearch();
  searchInput.focus({ preventScroll: true });
});

libraryClearSearch.addEventListener('click', clearSearch);

artistFilterBtn.addEventListener('click', () => {
  state.artistFilterMode = !state.artistFilterMode;
  syncArtistFilterBtn();
  renderLibrary();
  renderSearchResults();
  showToast(state.artistFilterMode ? '🎤 Λειτουργία Καλλιτέχνη' : '🎵 Κανονική αναζήτηση');
});

/* ============================================================
   BOTTOM NAV
   ============================================================ */
navSearch.addEventListener('click', () => {
  if (searchView.classList.contains('show')) {
    searchInput.focus({ preventScroll: true });
  } else {
    openSearchView();
  }
});

navLibrary.addEventListener('click', () => {
  closeSearchView();
  showToast('📚 Library');
});

/* ============================================================
   LYRICS FULLSCREEN TOGGLE
   ============================================================ */
const fullLyricsFullscreenBtn = document.getElementById('full-lyrics-fullscreen-btn');

function toggleLyricsFullscreen() {
  const isFullscreen = fullPlayer.classList.toggle('lyrics-fullscreen');
  fullLyricsFullscreenBtn.title = isFullscreen ? 'Έξοδος από fullscreen' : 'Fullscreen στίχοι';

  // Το layout άλλαξε (είτε μπήκαμε είτε βγήκαμε): ξανακεντράρισμα της ενεργής γραμμής
  const recenter = () => {
    if (state.activeLineIndex >= 0) {
      scrollFullLyricsToLine(state.activeLineIndex, false);
      lastScrollLine = state.activeLineIndex;
    }
  };
  requestAnimationFrame(recenter);
  setTimeout(recenter, 120);
}

fullLyricsFullscreenBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  toggleLyricsFullscreen();
});
/* ============================================================
   INIT
   ============================================================ */
(async function init() {
  const savedTheme = localStorage.getItem(LS_THEME);
  applyTheme(savedTheme === 'light' ? 'light' : 'dark');

  try {
    await openDB();
    await loadFromDB();
  } catch (err) {
    console.error('DB init error:', err);
    showToast('Σφάλμα βάσης δεδομένων', true);
  }

  // Ξεκίνα το animation loop
  requestAnimationFrame(animationLoop);
})();
