const HISTORY_KEY    = 'sift_history';
let   activeVideoId  = null; // currently selected video filter


// ── Helpers ───────────────────────────────────────────

function formatTime(s) {
  const h   = Math.floor(s / 3600);
  const m   = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  if (h > 0) return [h, m, sec].map(n => String(n).padStart(2, '0')).join(':');
  return [m, sec].map(n => String(n).padStart(2, '0')).join(':');
}

function badgeClass(type) {
  if (type === 'audio+visual') return 'badge-audiovisual';
  if (type === 'visual')       return 'badge-visual';
  return 'badge-audio';
}


// ── Search history ────────────────────────────────────

function addToHistory(q) {
  let h = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
  h = [q, ...h.filter(x => x !== q)].slice(0, 8);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(h));
  renderHistory();
}

function clearHistory() {
  localStorage.removeItem(HISTORY_KEY);
  renderHistory();
}

function renderHistory() {
  const h        = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
  const chips    = document.getElementById('history-chips');
  const clearBtn = document.getElementById('clear-history');

  if (h.length === 0) {
    chips.innerHTML = '';
    clearBtn.style.display = 'none';
    return;
  }

  chips.innerHTML = h.map((q, i) =>
    `<button class="chip" data-index="${i}">${q}</button>`
  ).join('');

  chips.querySelectorAll('.chip').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx     = parseInt(btn.dataset.index);
      const history = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
      document.getElementById('query').value = history[idx];
      doSearch();
    });
  });

  clearBtn.style.display = 'inline-block';
}


// ── UI state ──────────────────────────────────────────

function setState(which) {
  ['empty-state', 'error-state', 'idle-state', 'results-section'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.style.display = (id === which) ? 'block' : 'none';
  });
}


// ── Indexed videos list ───────────────────────────────

async function loadVideoList() {
  try {
    const res  = await fetch('/videos/list');
    const data = await res.json();
    renderVideoList(data.videos || []);
  } catch (e) {
    document.getElementById('video-list-wrap').innerHTML =
      '<p class="vlist-empty">Could not load indexed videos.</p>';
  }
}

function renderVideoList(videos) {
  const wrap = document.getElementById('video-list-wrap');

  if (videos.length === 0) {
    wrap.innerHTML = '<p class="vlist-empty">No videos indexed yet.</p>';
    return;
  }

  wrap.innerHTML = videos.map(v => `
    <div class="vlist-item" data-id="${v.video_id}" data-name="${encodeURIComponent(v.video_name)}">
      <div class="vlist-name">${v.video_name}</div>
      <div class="vlist-meta">
        <span>${v.audio_segments} segments</span>
        <span>·</span>
        <span>${v.visual_frames} frames</span>
      </div>
    </div>
  `).join('');

  wrap.querySelectorAll('.vlist-item').forEach(item => {
    item.addEventListener('click', () => {
      const id   = item.dataset.id;
      const name = decodeURIComponent(item.dataset.name);

      if (activeVideoId === id) {
        // deselect — search all videos
        activeVideoId = null;
        item.classList.remove('active');
        document.getElementById('filter-pill').style.display = 'none';
      } else {
        // select — filter to this video
        activeVideoId = id;
        wrap.querySelectorAll('.vlist-item').forEach(el => el.classList.remove('active'));
        item.classList.add('active');

        const pill = document.getElementById('filter-pill');
        pill.style.display   = 'flex';
        pill.querySelector('.pill-name').textContent = name;

        // switch to search panel so user can see the filter is active
        showPanel('search');

        const currentQuery = document.getElementById('query').value.trim();
        if (currentQuery) doSearch();
      }
    });
  });
}


// ── Video player ──────────────────────────────────────

function jumpTo(videoName, timestamp) {
  const shell = document.getElementById('app-shell');
  if (!shell.classList.contains('theatre')) {
    shell.classList.add('theatre');
  }

  const player      = document.getElementById('player');
  const label       = document.getElementById('now-playing-label');
  const placeholder = document.getElementById('player-placeholder');
  const newSrc      = `/videos/${encodeURIComponent(videoName)}`;
  const seekTo      = Math.max(0, timestamp - 0.5);

  placeholder.style.opacity = '0';
  setTimeout(() => {
    placeholder.style.display = 'none';
    placeholder.style.opacity = '1';
    player.style.display = 'block';
    player.style.opacity = '0';
    setTimeout(() => { player.style.opacity = '1'; }, 20);
  }, 300);
  label.textContent = `${videoName}  ·  ${formatTime(timestamp)}`;

  if (player.src && player.src.endsWith(encodeURIComponent(videoName))) {
    player.currentTime = seekTo;
    player.play();
    return;
  }

  player.src = newSrc;
  player.load();

  player.addEventListener('loadedmetadata', () => {
    player.currentTime = seekTo;
    player.addEventListener('seeked', () => {
      player.play();
    }, { once: true });
  }, { once: true });
}


// ── Render results ────────────────────────────────────

function renderResults(results, query) {
  const list     = document.getElementById('results-list');
  const count    = document.getElementById('results-count');
  const qLabel   = document.getElementById('results-query');
  const maxScore = Math.max(...results.map(r => r.score), 0.01);

  count.textContent  = `${results.length} result${results.length !== 1 ? 's' : ''}`;
  qLabel.textContent = `"${query}"`;

  list.innerHTML = results.map((r, i) => {
    const pct          = Math.min(100, Math.round((r.score / maxScore) * 100));
    const scoreDisplay = r.score.toFixed(2);
    const isVisual     = r.match_type === 'visual';
    const contextClass = isVisual ? 'card-context visual-frame' : 'card-context';
    const contextText  = isVisual ? '[ visual frame ]' : `"${r.match_context}"`;

    return `
      <div class="result-card" style="animation-delay:${i * 0.04}s"
           data-video="${encodeURIComponent(r.video_name)}"
           data-timestamp="${r.timestamp}">
        <div class="card-top">
          <span class="card-filename">${r.video_name}</span>
          <span class="card-ts">${formatTime(r.timestamp)}</span>
          <span class="badge ${badgeClass(r.match_type)}">${r.match_type}</span>
        </div>
        <p class="${contextClass}">${contextText}</p>
        <div class="card-bottom">
          <div class="score-bar-wrap">
            <div class="score-bar" style="width:${pct}%"></div>
          </div>
          <span class="score-label">${scoreDisplay}</span>
          <button class="jump-btn" data-jump>
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
              <polygon points="2,1 11,6 2,11" fill="currentColor"/>
            </svg>
            jump
          </button>
        </div>
      </div>`;
  }).join('');

  list.querySelectorAll('.result-card').forEach(card => {
    const videoName = decodeURIComponent(card.dataset.video);
    const timestamp = parseFloat(card.dataset.timestamp);
    card.addEventListener('click', () => jumpTo(videoName, timestamp));
    card.querySelector('[data-jump]').addEventListener('click', e => {
      e.stopPropagation();
      jumpTo(videoName, timestamp);
    });
  });
}


// ── Search ────────────────────────────────────────────

async function doSearch() {
  const query = document.getElementById('query').value.trim();
  if (!query) return;

  const btn = document.getElementById('search-btn');
  btn.classList.add('loading');
  addToHistory(query);

  try {
    const body = { query };
    if (activeVideoId) body.video_id = activeVideoId;

    const res = await fetch('/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();

    if (!data.results || data.results.length === 0) {
      document.getElementById('empty-query').textContent = `"${query}"`;
      setState('empty-state');
    } else {
      renderResults(data.results, query);
      setState('results-section');
    }

  } catch (e) {
    console.error('Search error:', e);
    setState('error-state');
  } finally {
    btn.classList.remove('loading');
  }
}


// ── Upload ────────────────────────────────────────────

function showPanel(name) {
  ['search-panel', 'library-panel', 'upload-panel'].forEach(id => {
    document.getElementById(id).style.display = 'none';
  });
  document.getElementById(`${name}-panel`).style.display = 'flex';

  // hide search bar on non-search panels
  document.getElementById('header-search').style.visibility =
    name === 'search' ? 'visible' : 'hidden';

  document.querySelectorAll('header nav a').forEach(a => a.classList.remove('active'));
  document.querySelector(`[data-panel="${name}"]`).classList.add('active');

  // load video list when library is opened
  if (name === 'library') loadVideoList();
}

function setupUpload() {
  const zone  = document.getElementById('drop-zone');
  const input = document.getElementById('file-input');

  zone.addEventListener('click', () => input.click());

  zone.addEventListener('dragover', e => {
    e.preventDefault();
    zone.classList.add('drag-over');
  });

  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));

  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    const files = Array.from(e.dataTransfer.files).filter(isVideoFile);
    if (files.length) uploadFiles(files);
  });

  input.addEventListener('change', () => {
    const files = Array.from(input.files).filter(isVideoFile);
    if (files.length) uploadFiles(files);
    input.value = '';
  });
}

function isVideoFile(f) {
  return /\.(mp4|webm|mkv|mov|avi|ogv)$/i.test(f.name);
}

async function uploadFiles(files) {
  const list = document.getElementById('upload-list');

  for (const file of files) {
    const item = document.createElement('div');
    item.className = 'upload-item';
    item.innerHTML = `
      <span class="upload-name">${file.name}</span>
      <span class="upload-status uploading">uploading...</span>
    `;
    list.prepend(item);

    const status = item.querySelector('.upload-status');

    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch('/upload', { method: 'POST', body: formData });

      if (res.ok) {
        status.textContent = 'uploaded — indexing soon';
        status.className   = 'upload-status done';
        loadVideoList(); // refresh the video list
      } else {
        status.textContent = 'failed';
        status.className   = 'upload-status failed';
      }
    } catch (e) {
      status.textContent = 'failed';
      status.className   = 'upload-status failed';
    }
  }
}


// ── Init ──────────────────────────────────────────────

document.getElementById('query').addEventListener('keydown', e => {
  if (e.key === 'Enter') doSearch();
});

['search', 'library', 'upload'].forEach(name => {
  document.querySelector(`[data-panel="${name}"]`).addEventListener('click', e => {
    e.preventDefault();
    showPanel(name);
  });
});

// clear filter pill
document.getElementById('filter-pill').querySelector('.pill-clear').addEventListener('click', () => {
  activeVideoId = null;
  document.getElementById('filter-pill').style.display = 'none';
  document.querySelectorAll('.vlist-item').forEach(el => el.classList.remove('active'));
});

document.querySelector('.logo-text').addEventListener('click', () => {
  const shell       = document.getElementById('app-shell');
  const player      = document.getElementById('player');
  const sidebar     = document.querySelector('.sidebar');
  const theatrePanel = document.querySelector('.theatre-panel');

  // step 1 — fade everything out
  player.style.opacity       = '0';
  sidebar.style.opacity      = '0';
  theatrePanel.style.opacity = '0';

  setTimeout(() => {
    // step 2 — reset state while invisible
    player.pause();
    player.src = '';
    player.style.display = 'none';
    player.style.opacity = '1';

    document.getElementById('player-placeholder').style.display = 'flex';
    document.getElementById('now-playing-label').textContent    = '';

    document.getElementById('query').value = '';

    activeVideoId = null;
    document.getElementById('filter-pill').style.display = 'none';
    document.querySelectorAll('.vlist-item').forEach(el => el.classList.remove('active'));

    setState('idle-state');
    showPanel('search');

    // remove theatre class while invisible so layout snaps without being seen
    shell.classList.remove('theatre');
    theatrePanel.style.opacity = '1';

    // step 3 — fade everything back in
    const idle = document.getElementById('idle-state');
    idle.style.opacity = '0';

    setTimeout(() => {
      sidebar.style.opacity = '1';
      idle.style.opacity    = '1';
    }, 20);

  }, 350); // wait for fade out to complete
});

setupUpload();
renderHistory();
setState('idle-state');