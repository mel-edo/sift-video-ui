const HISTORY_KEY = 'sift_history';

// Helpers

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

// Search history

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

  // use data-index to avoid any quoting issues with special characters in queries
  chips.innerHTML = h.map((q, i) =>
    `<button class="chip" data-index="${i}">${q}</button>`
  ).join('');

  chips.querySelectorAll('.chip').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.index);
      const history = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
      document.getElementById('query').value = history[idx];
      doSearch();
    });
  });

  clearBtn.style.display = 'inline-block';
}


// UI state

function setState(which) {
  ['empty-state', 'error-state', 'idle-state', 'results-section'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.style.display = (id === which) ? 'block' : 'none';
  });
}


// Video player

function jumpTo(videoName, timestamp) {
  const player      = document.getElementById('player');
  const label       = document.getElementById('now-playing-label');
  const placeholder = document.getElementById('player-placeholder');
  const newSrc      = `/videos/${encodeURIComponent(videoName)}`;
  const seekTo      = Math.max(0, timestamp - 0.5);

  placeholder.style.display = 'none';
  player.style.display      = 'block';
  label.textContent = `${videoName}  ·  ${formatTime(timestamp)}`;

  // same video already loaded
  if (player.src && player.src.endsWith(encodeURIComponent(videoName))) {
    player.currentTime = seekTo;
    player.play();
    return;
  }

  // different video
  player.src = newSrc;
  player.load();

  player.addEventListener('loadedmetadata', () => {
    player.currentTime = seekTo;

    player.addEventListener('seeked', () => {
      player.play();
    }, { once: true });

  }, { once: true });
}


// Render results

function renderResults(results, query) {
  const list     = document.getElementById('results-list');
  const count    = document.getElementById('results-count');
  const qLabel   = document.getElementById('results-query');
  const maxScore = Math.max(...results.map(r => r.score), 0.01);

  count.textContent  = `${results.length} result${results.length !== 1 ? 's' : ''}`;
  qLabel.textContent = `"${query}"`;

  // build cards without inline onclick to avoid quoting issues with special characters
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

  // attach click handlers via JS
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


// Search

async function doSearch() {
  const query = document.getElementById('query').value.trim();
  if (!query) return;

  const btn = document.getElementById('search-btn');
  btn.classList.add('loading');
  addToHistory(query);

  try {
    const res = await fetch('/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query })
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


// Init

document.getElementById('query').addEventListener('keydown', e => {
  if (e.key === 'Enter') doSearch();
});

renderHistory();
setState('idle-state');