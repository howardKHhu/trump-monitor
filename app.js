(() => {
  // ── 語言設定 ──────────────────────────────────────────────────────────────
  const lang = navigator.language.startsWith('ja') ? 'ja' : 'zh-TW';

  const i18n = {
    'zh-TW': {
      title: 'Truth Social 即時監控', subtitle: '川普官方帳號 @realDonaldTrump',
      search: '搜尋關鍵字...', from: '從', to: '至', clear: '清除',
      loading: '載入中...', noResults: '找不到符合的貼文', noData: '尚無資料',
      viewOrig: '英文原文', openLink: '查看原文', live: '即時',
      error: '載入失敗', translating: '翻譯中...',
      updated: '更新於', prevPage: '← 上一頁', nextPage: '下一頁 →',
      page: '第 {cur} 頁', totalPosts: '共 {n} 筆貼文',
    },
    'ja': {
      title: 'Truth Social リアルタイム監視', subtitle: 'トランプ公式アカウント @realDonaldTrump',
      search: 'キーワード検索...', from: '開始', to: '終了', clear: 'クリア',
      loading: '読み込み中...', noResults: '投稿が見つかりません', noData: 'データなし',
      viewOrig: '英語原文', openLink: '原文を見る', live: 'ライブ',
      error: '読み込み失敗', translating: '翻訳中...',
      updated: '更新:', prevPage: '← 前', nextPage: '次 →',
      page: '{cur} ページ目', totalPosts: '全 {n} 件',
    },
  };
  const t = (k, v = {}) => {
    let s = (i18n[lang] || i18n['zh-TW'])[k] || k;
    Object.entries(v).forEach(([a, b]) => { s = s.replace(`{${a}}`, b); });
    return s;
  };

  // ── TACO ─────────────────────────────────────────────────────────────────
  const TACO_KEYWORDS = [
    'tariff','tariffs','sanction','sanctions','ban','banned',
    'will be','must','deadline','ultimatum','warning',
    'tax','taxes','impose','imposed','threat','threatens',
    '100%','200%','terminate','cut off','trade war',
  ];
  const TACO_NS = 'trump_taco_v1';
  const AUTO_CANDIDATE_DAYS = 7;
  const RETREAT_KEYWORDS = [
    'deal', 'agreement', 'exemption', 'delay', 'paused', 'pause',
    'postpone', 'postponed', 'extension', 'waiver', 'relief',
    'suspended', 'suspend', 'exception', 'backs down', 'backing down',
    'walked back', 'reversal', 'great relationship', 'negotiations',
    'no longer', 'not going', 'decided not',
  ];

  function isTacoCandidate(text) {
    const lower = text.toLowerCase();
    return TACO_KEYWORDS.some(kw => lower.includes(kw));
  }

  function getTacoData() {
    try {
      const d = JSON.parse(localStorage.getItem(TACO_NS) || '{}');
      return {
        candidates: d.candidates || {},
        confirmed:  d.confirmed  || {},
        alerted:    d.alerted    || {},
      };
    } catch { return { candidates: {}, confirmed: {}, alerted: {} }; }
  }

  function saveTacoData(data) {
    try { localStorage.setItem(TACO_NS, JSON.stringify(data)); } catch {}
  }

  // 方案一：超過 AUTO_CANDIDATE_DAYS 天未處理的威脅貼文 → 自動候選
  function checkAutoCandidate(post, text) {
    if (!isTacoCandidate(text)) return;
    const data = getTacoData();
    const postId = post.document_id;
    if (data.candidates[postId] || data.confirmed[postId]) return;
    const daysSince = (Date.now() - new Date(post.date)) / 86400000;
    if (daysSince >= AUTO_CANDIDATE_DAYS) {
      data.candidates[postId] = {
        text: text.slice(0, 50),
        markedAt: new Date().toISOString(),
        auto: true,
      };
      saveTacoData(data);
      updateScoreboard();
    }
  }

  // 方案二：新貼文含退縮關鍵字 → 提示使用者確認相關候選
  function checkRetreatSignals(posts) {
    const data = getTacoData();
    if (Object.keys(data.candidates).length === 0) return;

    const newAlerts = posts.filter(post => {
      if (data.alerted[post.document_id]) return false;
      const lower = (post.text || '').toLowerCase();
      return RETREAT_KEYWORDS.some(kw => lower.includes(kw));
    });

    if (!newAlerts.length) return;

    newAlerts.forEach(post => { data.alerted[post.document_id] = true; });
    saveTacoData(data);
    showRetreatBanner(newAlerts.length);
  }

  function showRetreatBanner(count) {
    const banner = document.getElementById('retreat-banner');
    if (!banner) return;
    document.getElementById('retreat-banner-count').textContent = count;
    banner.style.display = 'flex';
    // 展開計分板方便使用者查看
    const body = document.getElementById('taco-sb-body');
    const arrow = document.getElementById('taco-sb-arrow');
    if (body && body.style.display === 'none') {
      body.style.display = 'block';
      if (arrow) arrow.textContent = '▼';
    }
  }

  // ── API ───────────────────────────────────────────────────────────────────
  const FACTBASE_API  = 'https://rollcall.com/wp-json/factbase/v1/twitter';
  const TRANSLATE_API = 'https://api.mymemory.translated.net/get';
  const CACHE_NS      = 'trump_trans_v1';
  const TARGET_LANG   = lang === 'ja' ? 'ja' : 'zh-TW';
  const MM_LANG       = lang === 'ja' ? 'en|ja' : 'en|zh-TW';

  // ── DOM ───────────────────────────────────────────────────────────────────
  const $ = id => document.getElementById(id);
  const statusBadge = $('status-badge'), lastUpdated = $('last-updated');
  const searchInput = $('search-input'), dateFrom = $('date-from'), dateTo = $('date-to');
  const clearBtn    = $('clear-btn'),   container  = $('posts-container');
  const pagination  = $('pagination'),  prevBtn    = $('prev-btn');
  const nextBtn     = $('next-btn'),    pageInfo   = $('page-info');

  // Apply i18n
  document.documentElement.lang = lang;
  if (lang === 'ja') document.title = 'トランプ Truth Social リアルタイム監視｜日本語翻訳';
  $('site-title').textContent   = t('title');
  $('site-subtitle').textContent = t('subtitle');
  searchInput.placeholder = t('search');
  clearBtn.textContent    = t('clear');
  $('label-from').textContent = t('from');
  $('label-to').textContent   = t('to');
  prevBtn.textContent = t('prevPage');
  nextBtn.textContent = t('nextPage');

  // ── 翻譯快取（localStorage）──────────────────────────────────────────────
  function cacheGet(id) {
    try { return JSON.parse(localStorage.getItem(`${CACHE_NS}:${id}`) || 'null'); } catch { return null; }
  }
  function cacheSet(id, val) {
    try { localStorage.setItem(`${CACHE_NS}:${id}`, JSON.stringify(val)); } catch {}
  }

  // ── 翻譯 ─────────────────────────────────────────────────────────────────
  const GT_API = 'https://translate.googleapis.com/translate_a/single';
  const GT_LANG = lang === 'ja' ? 'ja' : 'zh-TW';

  // Google Translate 非官方 API（fallback）
  async function translateGoogle(text) {
    const url = `${GT_API}?client=gtx&sl=en&tl=${GT_LANG}&dt=t&q=${encodeURIComponent(text.slice(0, 500))}`;
    const res  = await fetch(url);
    const data = await res.json();
    // 回應格式：[ [ ["translated","original",...], ... ], ... ]
    return data[0].map(seg => seg[0]).join('');
  }

  // MyMemory API（primary）
  async function translateMyMemory(text) {
    const url = `${TRANSLATE_API}?q=${encodeURIComponent(text.slice(0, 500))}&langpair=${MM_LANG}`;
    const res  = await fetch(url);
    const data = await res.json();
    const result = data?.responseData?.translatedText || '';
    // MyMemory 額度用盡時回傳警告訊息
    if (!result || result.toUpperCase().includes('MYMEMORY WARNING')) throw new Error('quota');
    return result;
  }

  // 翻譯 fallback 鏈：MyMemory → Google Translate → 原文
  async function translateWithFallback(text) {
    try {
      return await translateMyMemory(text);
    } catch {
      try {
        return await translateGoogle(text);
      } catch {
        return text;
      }
    }
  }

  // 翻譯佇列：一次一篇，避免超出速率限制
  const translateQueue = [];
  let isTranslating = false;

  async function processQueue() {
    if (isTranslating || !translateQueue.length) return;
    isTranslating = true;
    while (translateQueue.length) {
      const { text, id, onDone } = translateQueue.shift();
      const cached = cacheGet(id);
      if (cached) { onDone(cached); continue; }
      try {
        const translated = await translateWithFallback(text);
        cacheSet(id, translated);
        onDone(translated);
      } catch {
        onDone(text);
      }
      await new Promise(r => setTimeout(r, 150)); // 避免打太快
    }
    isTranslating = false;
  }

  function enqueueTranslation(text, id, onDone) {
    const cached = cacheGet(id);
    if (cached) { onDone(cached); return; }
    translateQueue.push({ text, id, onDone });
    processQueue();
  }

  // ── 狀態 ─────────────────────────────────────────────────────────────────
  let currentPage  = 1;
  let totalPages   = 1;
  let totalHits    = 0;
  let debounceTimer = null;
  let lastLoadTime  = null;

  // ── 工具 ─────────────────────────────────────────────────────────────────
  function stripHtml(html) {
    const d = document.createElement('div');
    d.innerHTML = html;
    return d.textContent || '';
  }

  function formatTime(iso) {
    return new Date(iso).toLocaleString(lang === 'ja' ? 'ja-JP' : 'zh-TW', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    });
  }

  function timeAgo(iso) {
    const s = Math.floor((Date.now() - new Date(iso)) / 1000);
    if (s < 60)    return lang === 'ja' ? `${s}秒前`               : `${s} 秒前`;
    if (s < 3600)  return lang === 'ja' ? `${Math.floor(s/60)}分前`   : `${Math.floor(s/60)} 分鐘前`;
    if (s < 86400) return lang === 'ja' ? `${Math.floor(s/3600)}時間前` : `${Math.floor(s/3600)} 小時前`;
    return lang === 'ja' ? `${Math.floor(s/86400)}日前` : `${Math.floor(s/86400)} 天前`;
  }

  // ── Skeleton ─────────────────────────────────────────────────────────────
  function renderSkeletons(n = 5) {
    container.innerHTML = Array.from({length: n}, () => `
      <div class="skeleton">
        <div class="skel-line short"></div>
        <div class="skel-line long"></div>
        <div class="skel-line medium"></div>
        <div class="skel-line long"></div>
      </div>`).join('');
  }

  // ── 渲染貼文 ──────────────────────────────────────────────────────────────
  function renderPosts(posts) {
    container.innerHTML = '';

    if (!posts.length) {
      container.innerHTML = `<div class="state-msg">
        <span class="icon">${searchInput.value || dateFrom.value || dateTo.value ? '🔍' : '📡'}</span>
        ${searchInput.value || dateFrom.value || dateTo.value ? t('noResults') : t('noData')}
      </div>`;
      return;
    }

    posts.forEach(post => {
      const text = post.text || stripHtml(post.social?.post_html || '');
      const card = document.createElement('div');
      card.className = 'post-card';
      card.dataset.id = post.document_id;

      const isTaco = isTacoCandidate(text);

      // 先顯示原文，之後逐步翻譯
      card.innerHTML = `
        <div class="post-meta">
          <span class="post-time">${formatTime(post.date)}</span>
          ${isTaco ? `<span class="taco-indicator" title="⚠️ TACO 候選：偵測到強硬措辭">🌮</span>` : ''}
          <a class="post-link" href="${post.post_url}" target="_blank" rel="noopener">${t('openLink')} ↗</a>
        </div>
        <div class="post-translated" id="trans-${post.document_id}">${text}</div>
        <details class="post-original">
          <summary>${t('viewOrig')}</summary>
          <p>${text}</p>
        </details>
        <div class="taco-actions" id="taco-actions-${post.document_id}"></div>`;

      container.appendChild(card);
      renderTacoActions(post.document_id, text);
      checkAutoCandidate(post, text);

      // 非同步翻譯，完成後更新 DOM
      const transEl = document.getElementById(`trans-${post.document_id}`);
      if (transEl) {
        transEl.style.opacity = '0.5';
        enqueueTranslation(text, `${TARGET_LANG}:${post.document_id}`, translated => {
          transEl.textContent = translated;
          transEl.style.opacity = '1';
        });
      }
    });
  }

  // ── TACO 操作 ─────────────────────────────────────────────────────────────
  function renderTacoActions(postId, rawText) {
    const el = document.getElementById(`taco-actions-${postId}`);
    if (!el) return;
    const data = getTacoData();
    const isConfirmed = !!data.confirmed[postId];
    const isCandidate = !!data.candidates[postId];
    const isAuto = isCandidate && !!data.candidates[postId].auto;
    const safe = rawText.slice(0, 50).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

    if (isConfirmed) {
      el.innerHTML = `<span class="taco-status confirmed">✅ 已確認 TACO</span>`;
    } else {
      const candidateLabel = isCandidate
        ? (isAuto ? '🤖 自動候選' : '已標記候選')
        : '標記候選';
      el.innerHTML = `
        <button class="taco-btn${isCandidate ? ' active' : ''}${isAuto ? ' auto' : ''}" onclick="tacoMarkCandidate('${postId}','${safe}')">
          🌮 ${candidateLabel}
        </button>
        <button class="taco-btn confirm" onclick="tacoConfirm('${postId}','${safe}')">
          ✅ 確認 TACO
        </button>`;
    }
  }

  function updateScoreboard() {
    const data = getTacoData();
    const cCount = Object.keys(data.candidates).length;
    const fCount = Object.keys(data.confirmed).length;
    const total = cCount + fCount;
    const rate = total > 0 ? ((fCount / total) * 100).toFixed(1) + '%' : '-';
    const elC = document.getElementById('sb-candidates');
    const elF = document.getElementById('sb-confirmed');
    const elR = document.getElementById('sb-rate');
    if (elC) elC.textContent = cCount;
    if (elF) elF.textContent = fCount;
    if (elR) elR.textContent = rate;
  }

  window.tacoMarkCandidate = function(postId, text) {
    const data = getTacoData();
    if (data.confirmed[postId]) return;
    if (data.candidates[postId]) {
      delete data.candidates[postId];
    } else {
      data.candidates[postId] = { text, markedAt: new Date().toISOString() };
    }
    saveTacoData(data);
    renderTacoActions(postId, text);
    updateScoreboard();
  };

  window.tacoConfirm = function(postId, text) {
    const data = getTacoData();
    delete data.candidates[postId];
    data.confirmed[postId] = { text, confirmedAt: new Date().toISOString() };
    saveTacoData(data);
    renderTacoActions(postId, text);
    updateScoreboard();
  };

  // ── 分頁 ─────────────────────────────────────────────────────────────────
  function renderPagination() {
    if (totalPages <= 1) { pagination.style.display = 'none'; return; }
    pagination.style.display = 'flex';
    pageInfo.textContent     = `${t('page', { cur: currentPage })} / ${t('totalPosts', { n: totalHits.toLocaleString() })}`;
    prevBtn.disabled         = currentPage <= 1;
    nextBtn.disabled         = currentPage >= totalPages;
  }

  // ── 抓取 ─────────────────────────────────────────────────────────────────
  async function loadPosts(showSkeleton = true) {
    if (showSkeleton) renderSkeletons();
    statusBadge.className   = 'badge badge-loading';
    statusBadge.textContent = t('loading');

    const params = new URLSearchParams({
      page:       currentPage,
      sort:       'date',
      sort_order: 'desc',
      page_size:  20,
    });
    if (searchInput.value.trim()) params.set('q', searchInput.value.trim());

    try {
      const res  = await fetch(`${FACTBASE_API}?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      let posts = data.data || [];

      // 客戶端日期過濾（Factbase API 不支援日期篩選）
      if (dateFrom.value) {
        posts = posts.filter(p => p.date >= dateFrom.value);
      }
      if (dateTo.value) {
        posts = posts.filter(p => p.date <= dateTo.value + 'T23:59:59');
      }

      // 只保留 Truth Social 貼文
      posts = posts.filter(p => !p.platform || p.platform.toLowerCase().includes('truth'));

      totalHits  = data.meta?.total_hits || 0;
      totalPages = data.meta?.page_count || 1;

      renderPosts(posts);
      renderPagination();

      // 方案二：只在第一頁、無搜尋條件時偵測退縮訊號
      if (currentPage === 1 && !searchInput.value.trim()) {
        checkRetreatSignals(posts);
      }

      statusBadge.className   = 'badge badge-live';
      statusBadge.textContent = t('live');
      lastLoadTime = new Date();
      lastUpdated.textContent = `${t('updated')} ${timeAgo(lastLoadTime.toISOString())}`;

    } catch (e) {
      container.innerHTML = `<div class="state-msg"><span class="icon">⚠️</span>${t('error')}<br><small>${e.message}</small></div>`;
      statusBadge.className   = 'badge badge-error';
      statusBadge.textContent = t('error');
    }
  }

  // ── 事件 ─────────────────────────────────────────────────────────────────
  searchInput.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => { currentPage = 1; loadPosts(); }, 400);
  });

  [dateFrom, dateTo].forEach(el =>
    el.addEventListener('change', () => { currentPage = 1; loadPosts(); })
  );

  clearBtn.addEventListener('click', () => {
    searchInput.value = dateFrom.value = dateTo.value = '';
    document.querySelectorAll('.shortcut-btn').forEach(b => b.classList.remove('active'));
    currentPage = 1;
    loadPosts();
  });

  // 計分板收合
  document.getElementById('taco-sb-toggle').addEventListener('click', () => {
    const body = document.getElementById('taco-sb-body');
    const arrow = document.getElementById('taco-sb-arrow');
    const open = body.style.display !== 'none';
    body.style.display = open ? 'none' : 'block';
    arrow.textContent = open ? '▶' : '▼';
  });

  // 查看清單
  let currentList = null;
  function showTacoList(type) {
    const panel = document.getElementById('taco-list-panel');
    if (currentList === type) {
      panel.style.display = 'none';
      currentList = null;
      return;
    }
    currentList = type;
    const data = getTacoData();
    const entries = Object.entries(data[type]);
    if (!entries.length) {
      panel.innerHTML = `<p class="taco-list-empty">尚無資料</p>`;
    } else {
      panel.innerHTML = entries.map(([id, item]) => {
        const dateStr = new Date(item.markedAt || item.confirmedAt).toLocaleString('zh-TW');
        return `<div class="taco-list-item">
          <span class="taco-list-text">${item.text}</span>
          <span class="taco-list-date">${dateStr}</span>
        </div>`;
      }).join('');
    }
    panel.style.display = 'block';
  }

  document.getElementById('sb-show-candidates').addEventListener('click', () => showTacoList('candidates'));
  document.getElementById('sb-show-confirmed').addEventListener('click', () => showTacoList('confirmed'));

  // 啟動時更新計分板
  updateScoreboard();

  document.querySelectorAll('.shortcut-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const q = btn.dataset.query;
      const isActive = btn.classList.contains('active');
      document.querySelectorAll('.shortcut-btn').forEach(b => b.classList.remove('active'));
      if (isActive) {
        searchInput.value = '';
      } else {
        btn.classList.add('active');
        searchInput.value = q;
      }
      currentPage = 1;
      loadPosts();
    });
  });

  prevBtn.addEventListener('click', () => {
    if (currentPage > 1) { currentPage--; loadPosts(); scrollTo({ top: 0, behavior: 'smooth' }); }
  });

  nextBtn.addEventListener('click', () => {
    if (currentPage < totalPages) { currentPage++; loadPosts(); scrollTo({ top: 0, behavior: 'smooth' }); }
  });

  // 每秒更新「更新於 X 秒前」顯示
  setInterval(() => {
    if (lastLoadTime) {
      lastUpdated.textContent = `${t('updated')} ${timeAgo(lastLoadTime.toISOString())}`;
    }
  }, 1000);

  // 每 3 分鐘自動刷新第一頁
  setInterval(() => {
    if (currentPage === 1 && !searchInput.value && !dateFrom.value && !dateTo.value) {
      loadPosts(false);
    }
  }, 3 * 60 * 1000);

  // ── 主題切換 ──────────────────────────────────────────────────────────────
  const themeToggle = $('theme-toggle');
  function applyTheme(theme) {
    if (theme === 'light') {
      document.documentElement.setAttribute('data-theme', 'light');
      themeToggle.textContent = '☀️';
      themeToggle.title = '切換暗色模式';
    } else {
      document.documentElement.removeAttribute('data-theme');
      themeToggle.textContent = '🌙';
      themeToggle.title = '切換亮色模式';
    }
  }

  // 初始化：讀取已儲存的偏好
  applyTheme(localStorage.getItem('trump_theme') || 'dark');

  themeToggle.addEventListener('click', () => {
    const isDark = !document.documentElement.hasAttribute('data-theme');
    const next = isDark ? 'light' : 'dark';
    localStorage.setItem('trump_theme', next);
    applyTheme(next);
  });

  // ── 啟動 ─────────────────────────────────────────────────────────────────
  loadPosts();
})();
