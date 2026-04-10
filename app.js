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

      // 先顯示原文，之後逐步翻譯
      card.innerHTML = `
        <div class="post-meta">
          <span class="post-time">${formatTime(post.date)}</span>
          <a class="post-link" href="${post.post_url}" target="_blank" rel="noopener">${t('openLink')} ↗</a>
        </div>
        <div class="post-translated" id="trans-${post.document_id}">${text}</div>
        <details class="post-original">
          <summary>${t('viewOrig')}</summary>
          <p>${text}</p>
        </details>`;

      container.appendChild(card);

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

      statusBadge.className   = 'badge badge-live';
      statusBadge.textContent = t('live');
      lastUpdated.textContent = `${t('updated')} ${timeAgo(new Date().toISOString())}`;

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
    currentPage = 1;
    loadPosts();
  });

  prevBtn.addEventListener('click', () => {
    if (currentPage > 1) { currentPage--; loadPosts(); scrollTo({ top: 0, behavior: 'smooth' }); }
  });

  nextBtn.addEventListener('click', () => {
    if (currentPage < totalPages) { currentPage++; loadPosts(); scrollTo({ top: 0, behavior: 'smooth' }); }
  });

  // 每 3 分鐘自動刷新第一頁
  setInterval(() => {
    if (currentPage === 1 && !searchInput.value && !dateFrom.value && !dateTo.value) {
      loadPosts(false);
    }
  }, 3 * 60 * 1000);

  // ── 啟動 ─────────────────────────────────────────────────────────────────
  loadPosts();
})();
