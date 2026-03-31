const HISTORY_KEY    = 'sift_history';
let   activeVideoId  = null; 
let healthInterval = null;

const state = {
  activeVideoId: null,
  isSearching: false,
  results: []
};

// ── Toasts ──────────────────────────────────────────
function showToast(msg, type = 'success') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = msg;
  container.appendChild(toast);
  
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// ── Helpers ───────────────────────────────────────────

function removeUploadItemWithAnimation(itemEl) {
  // Lock the height before animating so it doesn't instantly snap
  itemEl.style.height = `${itemEl.offsetHeight}px`;
  itemEl.style.overflow = 'hidden';
  itemEl.style.boxSizing = 'border-box';
  
  // Force browser reflow to register the explicit height
  itemEl.offsetHeight; 
  
  // Apply CSS transitions dynamically
  itemEl.style.transition = 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)';
  itemEl.style.opacity = '0';
  itemEl.style.transform = 'translateY(10px) scale(0.98)';
  
  // Wait a tiny bit, then collapse the spatial footprint
  setTimeout(() => {
    itemEl.style.height = '0';
    itemEl.style.marginTop = '0';
    itemEl.style.marginBottom = '0';
    itemEl.style.paddingTop = '0';
    itemEl.style.paddingBottom = '0';
    itemEl.style.borderWidth = '0';
  }, 50);

  // Remove from DOM completely after animation finishes
  setTimeout(() => itemEl.remove(), 450);
}

function formatTime(s) {
  const h   = Math.floor(s / 3600);
  const m   = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  if (h > 0) return [h, m, sec].map(n => String(n).padStart(2, '0')).join(':');
  return [m, sec].map(n => String(n).padStart(2, '0')).join(':');
}

function formatDuration(sec) {
  sec = Math.floor(sec);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function badgeClass(type) {
  if (type === 'audio+visual') return 'badge-audiovisual';
  if (type === 'visual')       return 'badge-visual';
  return 'badge-audio';
}

function createDownloadItem(initialText) {
  const list = document.getElementById('upload-list');
  const item = document.createElement('div');
  item.className = 'upload-item';

  // FIX 1: Prevent XSS by building HTML without user input, then setting textContent
  item.innerHTML = `
    <img class="upload-thumb" src="" style="display: none;" />
    <div class="upload-meta">
      <div style="display: flex; justify-content: space-between; align-items: baseline; gap: 8px;">
        <span class="upload-name"></span>
        <span class="upload-duration"></span>
      </div>
      <span class="upload-status uploading">downloading...</span>
    </div>
  `;
  
  item.querySelector('.upload-name').textContent = initialText;
  list.prepend(item);

  return {
    item,
    status: item.querySelector('.upload-status'),
    nameEl: item.querySelector('.upload-name'),
    durationEl: item.querySelector('.upload-duration'),
    thumbEl: item.querySelector('.upload-thumb')
  };
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
  const h = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
  
  // Define our two distinct history locations
  const locations = [
    {
      // The Home Page (Idle State)
      chips: document.getElementById('idle-history-chips'),
      clearBtn: document.getElementById('idle-clear-history'),
      title: document.getElementById('idle-history-title'),
      displayStyle: 'block' // How the title shows up
    },
    {
      // The Video Player (Theatre Panel)
      chips: document.getElementById('theatre-history-chips'),
      clearBtn: document.getElementById('theatre-clear-history'),
      title: document.getElementById('theatre-history-row'),
      displayStyle: 'flex' // The theatre row uses flexbox
    }
  ];

  // Generate the HTML for the chips once
  const chipsHtml = h.map((q, i) => 
    `<button class="chip" data-index="${i}">${q}</button>`
  ).join('');

  // Loop through both locations and update them
  locations.forEach(loc => {
    if (!loc.chips) return; // Skip if the HTML isn't found

    if (h.length === 0) {
      // Hide everything if history is empty
      loc.chips.innerHTML = '';
      if (loc.clearBtn) loc.clearBtn.style.display = 'none';
      if (loc.title) loc.title.style.display = 'none';
    } else {
      // Show everything and insert the chips
      loc.chips.innerHTML = chipsHtml;
      if (loc.clearBtn) loc.clearBtn.style.display = 'inline-block';
      if (loc.title) loc.title.style.display = loc.displayStyle;

      // Make the new chips clickable in this specific location
      loc.chips.querySelectorAll('.chip').forEach(btn => {
        btn.addEventListener('click', () => {
          const idx = parseInt(btn.dataset.index);
          const history = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
          document.getElementById('query').value = history[idx];
          doSearch();
        });
      });
    }
  });
}

// ── UI state ──────────────────────────────────────────
function setState(which) {
  ['empty-state', 'error-state', 'idle-state', 'results-section'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.style.display = (id === which) ? 'block' : 'none';
  });
}

function renderSkeletons() {
  const list = document.getElementById('results-list');
  list.innerHTML = Array(4).fill(`
    <div class="result-card skeleton">
      <div class="skel-line skel-title"></div>
      <div class="skel-line"></div>
      <div class="skel-line skel-text short"></div>
    </div>
  `).join('');
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

  // FIX 1: Prevent XSS in titles. We encode it, but we also ensure text rendering is safe
  wrap.innerHTML = videos.map(v => {
    // Sanitize the display name for HTML embedding
    const safeName = document.createElement('div');
    safeName.textContent = v.video_name;
    
    return `
    <div class="vlist-item ${activeVideoId === String(v.video_id) ? 'active' : ''}" 
         data-id="${v.video_id}" data-name="${encodeURIComponent(v.video_name)}">
      <div class="vlist-info">
        <div class="vlist-name">${safeName.innerHTML}</div>
        <div class="vlist-meta">
          <span>${v.audio_segments} segments</span>
          <span>·</span>
          <span>${v.visual_frames} frames</span>
        </div>
      </div>
      <button class="delete-btn" data-delete title="Delete video">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"></path>
        </svg>
      </button>
    </div>
  `}).join('');
}

// FIX 2: Event delegation for Library List 
document.getElementById('video-list-wrap').addEventListener('click', async (e) => {
  const item = e.target.closest('.vlist-item');
  const deleteBtn = e.target.closest('[data-delete]');
  
  if (!item) return;

  const id   = item.dataset.id;
  const name = decodeURIComponent(item.dataset.name);

  // Handle Delete
  if (deleteBtn) {
    e.stopPropagation();
    if (!confirm(`Delete ${name}?`)) return;

    try {
      const res = await fetch(`/videos/${encodeURIComponent(name)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();

      item.style.opacity = "0";
      setTimeout(() => item.remove(), 200);

      // FIX 3: Cleanup if we deleted the currently active filter
      if (activeVideoId === id) {
        activeVideoId = null;
        document.getElementById('filter-pill').style.display = 'none';
      }
    } catch {
      showToast("Delete failed", "error");
    }
    return; // Stop execution here for delete
  }

  // Handle Select/Deselect
  const wrap = document.getElementById('video-list-wrap');
  if (activeVideoId === id) {
    activeVideoId = null;
    item.classList.remove('active');
    document.getElementById('filter-pill').style.display = 'none';
  } else {
    activeVideoId = id;
    wrap.querySelectorAll('.vlist-item').forEach(el => el.classList.remove('active'));
    item.classList.add('active');

    const pill = document.getElementById('filter-pill');
    pill.style.display   = 'flex';
    pill.querySelector('.pill-name').textContent = name;

    showPanel('search');
    const currentQuery = document.getElementById('query').value.trim();
    if (currentQuery) doSearch();
  }
});


// ── Video player ──────────────────────────────────────
function jumpTo(videoName, timestamp) {
  const shell = document.getElementById('app-shell');
  if (!shell.classList.contains('theatre')) {
    shell.classList.add('theatre');
  }

  const playerWrapper = document.getElementById('video-wrapper');
  const player      = document.getElementById('player');
  const label       = document.getElementById('now-playing-label');
  const placeholder = document.getElementById('player-placeholder');
  
  const seekTo = Math.max(0, timestamp - 0.5);
  const newSrc = `/videos/${encodeURIComponent(videoName)}`; 

  placeholder.style.opacity = '0';
  setTimeout(() => {
    placeholder.style.display = 'none';
    playerWrapper.style.display = 'block'; 
    playerWrapper.style.opacity = '0';
    setTimeout(() => { playerWrapper.style.opacity = '1'; }, 20);
  }, 300);
  
  label.textContent = `${videoName}  ·  ${formatTime(timestamp)}`;

  if (player.src && player.src.endsWith(encodeURIComponent(videoName))) {
    player.currentTime = seekTo;
    player.play().catch(e => console.warn("Playback prevented:", e));
    return;
  }

  player.src = newSrc;
  player.load();

  player.addEventListener('loadedmetadata', () => {
    player.currentTime = seekTo;
    player.addEventListener('seeked', () => {
      player.play().catch(e => console.warn("Playback prevented:", e));
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

  const regex = new RegExp(`(${query})`, 'gi');

  list.innerHTML = results.map((r, i) => {
    const pct          = Math.min(100, Math.round((r.score / maxScore) * 100));
    const scoreDisplay = r.score.toFixed(2);
    const isVisual     = r.match_type === 'visual';
    const contextClass = isVisual ? 'card-context visual-frame' : 'card-context';

    const highlightedContext = r.match_context.replace(regex, '<span class="highlight">$1</span>');
    const contextText = isVisual ? '[ visual frame ]' : `"${highlightedContext}"`;

    // FIX 1: Sanitize video name in HTML construction
    const safeName = document.createElement('span');
    safeName.textContent = r.video_name;

    return `
      <div class="result-card" style="animation-delay:${i * 0.04}s"
           data-video="${encodeURIComponent(r.video_name)}"
           data-timestamp="${r.timestamp}">
        <div class="card-top">
          <span class="card-filename">${safeName.innerHTML}</span>
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
            </svg> jump
          </button>
        </div>
      </div>`;
  }).join('');
}

// FIX 2: Event delegation for Search Results
document.getElementById('results-list').addEventListener('click', (e) => {
  const card = e.target.closest('.result-card');
  if (!card) return;

  const videoName = decodeURIComponent(card.dataset.video);
  const timestamp = parseFloat(card.dataset.timestamp);
  
  // Triggers whether they click the jump button or the card itself
  jumpTo(videoName, timestamp);
});

// ── Search ────────────────────────────────────────────
async function doSearch() {
  const query = document.getElementById('query').value.trim();
  if (!query) return;

  state.isSearching = true;
  showPanel('search');
  setState('results-section');
  renderSkeletons();

  const btn = document.getElementById('search-btn');
  btn.classList.add('loading');
  addToHistory(query);

  try {
    const body = { query };
    if (activeVideoId) body.video_id = activeVideoId;
    
    const matchType = document.querySelector('input[name="match_type"]:checked').value;
    if (matchType !== 'all') body.match_type = matchType;

    const res = await fetch('/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    state.results = data.results || [];

    if (state.results.length === 0) {
      document.getElementById('empty-query').textContent = `"${query}"`;
      setState('empty-state');
    } else {
      renderResults(state.results, query);
    }
  } catch (e) {
    console.error('Search error:', e);
    setState('error-state');
  } finally {
    btn.classList.remove('loading');
    state.isSearching = false;
  }
}

// ── Upload ────────────────────────────────────────────
function showPanel(name) {
  ['search-panel', 'library-panel', 'upload-panel'].forEach(id => {
    document.getElementById(id).style.display = 'none';
  });
  document.getElementById(`${name}-panel`).style.display = 'flex';

  document.querySelectorAll('header nav a').forEach(a => a.classList.remove('active'));
  document.querySelector(`[data-panel="${name}"]`).classList.add('active');

  if (name === 'library') loadVideoList();
}

function setupUpload() {
  const zone  = document.getElementById('drop-zone');
  const input = document.getElementById('file-input');

  document.getElementById('yt-url').addEventListener('keydown', e => {
    if (e.key === 'Enter') downloadFromUrl();
  });
  
  document.getElementById('download-btn').addEventListener('click', downloadFromUrl);

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
    
    // FIX 1: Prevent XSS 
    item.innerHTML = `
      <span class="upload-name"></span>
      <span class="upload-status uploading">uploading...</span>
    `;
    item.querySelector('.upload-name').textContent = file.name;
    list.prepend(item);

    const status = item.querySelector('.upload-status');

    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch('/upload', { method: 'POST', body: formData });

      if (res.ok) {
        status.textContent = 'uploaded - indexing soon';
        status.className   = 'upload-status done';
        setTimeout(() => removeUploadItemWithAnimation(item), 4000);
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

async function downloadFromUrl() {
    const urlInput = document.getElementById("yt-url");
    const btn      = document.getElementById("download-btn");
    const label    = btn.querySelector(".btn-label");

    // FIX 1: The Guard. If the button is already loading, completely ignore the click/enter key.
    if (btn.classList.contains("loading")) return;

    const url = urlInput.value.trim();
    if (!url) return;

    btn.classList.add("loading");
    const entry = createDownloadItem("Connecting…");

    const progressWrap = document.createElement("div");
    progressWrap.style.cssText = `width: 100%; height: 3px; background: var(--border); border-radius: 2px; overflow: hidden; margin-top: 2px;`;
    const progressBar = document.createElement("div");
    progressBar.style.cssText = `height: 100%; width: 0%; background: var(--accent); border-radius: 2px; transition: width 0.4s ease;`;
    progressWrap.appendChild(progressBar);
    entry.item.querySelector(".upload-meta").appendChild(progressWrap);

    try {
        const res = await fetch("/download/progress", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url })
        });

        if (!res.ok) throw new Error(await res.text());

        urlInput.value = "";
        label.textContent = "Download";
        btn.classList.remove("loading");

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";

        while (true) {
            const { value, done } = await reader.read();
            if (done) break;

            buf += decoder.decode(value, { stream: true });
            const lines = buf.split("\n");
            buf = lines.pop();

            for (const line of lines) {
                if (!line.startsWith("data:")) continue;
                let evt;
                try { evt = JSON.parse(line.slice(5).trim()); }
                catch { continue; }

                switch (evt.stage) {
                    case "meta":
                        entry.nameEl.textContent = "Fetching info…";
                        entry.status.textContent = "…";
                        entry.status.className = "upload-status uploading";
                        break;
                    case "meta_done":
                        entry.nameEl.textContent = evt.title;
                        if (evt.duration)  entry.durationEl.textContent = formatDuration(evt.duration);
                        if (evt.thumbnail) {
                          entry.thumbEl.src = evt.thumbnail;
                          entry.thumbEl.style.display = 'block';
                        }
                        break;
                    case "downloading":
                        entry.status.textContent = evt.pct != null ? `downloading ${evt.pct.toFixed(1)}%` : "downloading…";
                        if (evt.pct != null) {
                            progressBar.style.width = `${evt.pct}%`;
                            progressBar.style.background = evt.pct >= 100 ? "var(--green)" : "var(--accent)";
                        }
                        break;
                    case "download_done":
                        progressBar.style.width = "100%";
                        progressBar.style.background = "var(--green)";
                        entry.status.textContent = "processing…";
                        break;
                    case "indexing":
                        entry.status.textContent = "indexing...";
                        progressBar.style.width = "100%";
                        progressBar.style.background = "var(--amber)";
                        break;
                    case "done":
                        progressBar.style.width = "100%";
                        progressBar.style.background = "var(--green)";
                        entry.status.textContent = `indexed - ${evt.audio} segments · ${evt.visual} frames`;
                        entry.status.className = "upload-status done";
                        if(document.getElementById('library-panel').style.display === 'flex') {
                          loadVideoList(); 
                        }
                        
                        // FIX 2: Trigger the removal animation after a 4-second delay
                        setTimeout(() => {
                          removeUploadItemWithAnimation(entry.item);
                        }, 4000);
                        break;
                    case "error":
                        entry.status.textContent = `failed: ${evt.msg}`;
                        entry.status.className = "upload-status failed";
                        progressBar.style.background = "var(--red)";
                        
                        // Optional: Also remove errors after a slightly longer delay (e.g., 8s)
                        setTimeout(() => removeUploadItemWithAnimation(entry.item), 8000);
                        break;
                }
            }
        }
    } catch (err) {
        console.error(err);
        entry.status.textContent = "failed";
        entry.status.className = "upload-status failed";
        label.textContent = "Download";
        btn.classList.remove("loading");
        
        // Remove standard fetch errors after 8 seconds too
        setTimeout(() => removeUploadItemWithAnimation(entry.item), 8000);
    }
}

// ── Init ──────────────────────────────────────────────
document.getElementById('query').addEventListener('keydown', e => {
  if (e.key === 'Enter') doSearch();
});
document.getElementById('search-btn').addEventListener('click', doSearch);

['search', 'library', 'upload'].forEach(name => {
  document.querySelector(`[data-panel="${name}"]`).addEventListener('click', e => {
    e.preventDefault();
    showPanel(name);
  });
});

document.getElementById('filter-pill').querySelector('.pill-clear').addEventListener('click', () => {
  activeVideoId = null;
  document.getElementById('filter-pill').style.display = 'none';
  document.querySelectorAll('.vlist-item').forEach(el => el.classList.remove('active'));
});

const queryInput = document.getElementById('query');
const clearSearchBtn = document.getElementById('clear-search-btn');

// Show/hide the 'X' button as the user types
queryInput.addEventListener('input', () => {
  clearSearchBtn.style.display = queryInput.value.length > 0 ? 'flex' : 'none';
});

// Clear input, hide the 'X', and refocus the bar
clearSearchBtn.addEventListener('click', () => {
  queryInput.value = '';
  clearSearchBtn.style.display = 'none';
  queryInput.focus();
});

document.querySelectorAll('.logo-text, .logo-mark').forEach(el => {

  el.addEventListener('click', () => {
    const shell         = document.getElementById('app-shell');
    const playerWrapper = document.getElementById('video-wrapper');
    const player        = document.getElementById('player');
    const sidebar       = document.querySelector('.sidebar');
    const theatrePanel  = document.querySelector('.theatre-panel');

    playerWrapper.style.opacity = '0';
    sidebar.style.opacity       = '0';
    theatrePanel.style.opacity  = '0';

    setTimeout(() => {
      player.pause();
      player.removeAttribute('src');
      player.src = '';
      playerWrapper.style.display = 'none';
      playerWrapper.style.opacity = '1';

      document.getElementById('player-placeholder').style.display = 'flex';
      document.getElementById('now-playing-label').textContent    = '';
      document.getElementById('query').value = '';

      activeVideoId = null;
      document.querySelector('input[name="match_type"][value="all"]').checked = true;
      document.getElementById('filter-pill').style.display = 'none';
      document.querySelectorAll('.vlist-item').forEach(el => el.classList.remove('active'));
      document.getElementById('clear-search-btn').style.display = 'none';

      setState('idle-state');
      showPanel('search');

      shell.classList.remove('theatre');
      theatrePanel.style.opacity = '1';

      const idle = document.getElementById('idle-state');
      idle.style.opacity = '0';

      setTimeout(() => {
        sidebar.style.opacity = '1';
        idle.style.opacity    = '1';
      }, 20);

    }, 350); 
  });
});

document.querySelectorAll('input[name="match_type"]').forEach(radio => {
  radio.addEventListener('change', () => {
    if (document.getElementById('query').value.trim()) {
      doSearch();
    }
  });
});

function setupPlayerControls() {
  const player = document.getElementById('player');
  const btn = document.getElementById('play-pause-btn');
  const seek = document.getElementById('seek-bar');
  const timeDisplay = document.getElementById('time-display');
  const wrapper = document.getElementById('video-wrapper');
  const muteBtn = document.getElementById('mute-btn');
  const volOnIcon = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>';
  const volOffIcon = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/></svg>';

  const playIcon = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
  const pauseIcon = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>';

  function togglePlay() {
    if (player.paused) player.play().catch(() => {});
    else player.pause();
  }

  function toggleMute() {
    player.muted = !player.muted;
    muteBtn.innerHTML = player.muted ? volOffIcon : volOnIcon;
  }

  btn.addEventListener('click', togglePlay);
  player.addEventListener('click', togglePlay);
  muteBtn.addEventListener('click', toggleMute);

  document.addEventListener('keydown', (e) => {
    if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA') return;
    if (wrapper.style.display === 'none' || !player.src) return;

    switch(e.key) {
      case ' ': 
      case 'k': 
        e.preventDefault(); 
        togglePlay();
        break;
      case 'm':
      case 'M':
        e.preventDefault();
        toggleMute();
        break;
      case 'ArrowRight':
        e.preventDefault();
        player.currentTime = Math.min(player.duration, player.currentTime + 5);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        player.currentTime = Math.max(0, player.currentTime - 5);
        break;
      case 'f':
        e.preventDefault();
        if (!document.fullscreenElement) {
          wrapper.requestFullscreen().catch(() => {});
        } else {
          document.exitFullscreen();
        }
        break;
    }
  });

  player.addEventListener('play', () => btn.innerHTML = pauseIcon);
  player.addEventListener('pause', () => btn.innerHTML = playIcon);

  player.addEventListener('timeupdate', () => {
    if (!player.duration) return;
    const percent = (player.currentTime / player.duration) * 100 || 0;
    seek.value = percent;
    // Add this line to update the CSS variable:
    seek.style.setProperty('--progress', `${percent}%`);
    timeDisplay.textContent = `${formatDuration(player.currentTime)} / ${formatDuration(player.duration || 0)}`;
  });

  seek.addEventListener('input', () => {
    if (!player.duration) return;
    const percent = seek.value;
    const time = (percent / 100) * player.duration;
    player.currentTime = time;
    // Add this line so it updates instantly while dragging:
    seek.style.setProperty('--progress', `${percent}%`);
  });
}

setupUpload();
setupPlayerControls();
renderHistory();
setState('idle-state');