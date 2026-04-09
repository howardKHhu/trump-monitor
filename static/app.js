(() => {
  // ── Locale ───────────────────────────────────────────────────────────────
  const lang = navigator.language.startsWith('ja') ? 'ja' : 'zh-TW';

  const i18n = {
    'zh-TW': {
      title:        'Truth Social 即時監控',
      subtitle:     '川普官方帳號 @realDonaldTrump',
      search:       '搜尋關鍵字...',
      from:         '從', to: '至', clear: '清除',
      loading:      '載入中...', noResults: '找不到符合的貼文',
      noData:       '尚無資料', noToken: '尚未設定 Token，請點右上角 🔑 設定',
      viewOrig:     '原文', openLink: '查看原文',
      live: '即時 (官方API)', idle: '等待中', error: '連線異常', noTokenBadge: '新聞摘要模式',
      sourceApi: '✅ 官方 API 模式（完整貼文）', sourceGnews: '📰 新聞摘要模式（無需登入）',
      updated:      '更新於',
      prevPage:     '← 上一頁', nextPage: '下一頁 →',
      page:         '第 {cur} 頁，共 {total} 筆',
      modalTitle:   '設定 Access Token',
      modalDesc:    'Truth Social 需要登入才能讀取貼文。只需在瀏覽器登入一次，複製 token 貼到下方：',
      modalSteps: [
        '用瀏覽器開啟 <a href="https://truthsocial.com" target="_blank">truthsocial.com</a> 並登入',
        '開啟 DevTools（按 F12）→ 切換到 <strong>Network</strong> 分頁',
        '重新整理頁面，在請求列表中點任意一個 <code>api/v1/</code> 開頭的請求',
        '在右側 <strong>Request Headers</strong> 找到 <code>Authorization</code>',
        '複製 <code>Bearer </code> 後面的那一長串字（token），貼到下方',
      ],
      tokenPlaceholder: '貼上 token（不需要包含 Bearer 前綴）',
      save:         '儲存並立即抓取',
      cancel:       '取消',
      tokenSaved:   'Token 已儲存，正在抓取貼文...',
      tokenError:   'Token 儲存失敗，請重試',
    },
    'ja': {
      title:        'Truth Social リアルタイム監視',
      subtitle:     'トランプ公式アカウント @realDonaldTrump',
      search:       'キーワード検索...', from: '開始', to: '終了', clear: 'クリア',
      loading:      '読み込み中...', noResults: '該当する投稿が見つかりません',
      noData:       'データなし', noToken: 'トークン未設定。右上の 🔑 から設定してください',
      viewOrig:     '原文', openLink: '原文を見る',
      live: 'ライブ (公式API)', idle: '待機中', error: '接続エラー', noTokenBadge: 'ニュース要約モード',
      sourceApi: '✅ 公式APIモード（完全な投稿）', sourceGnews: '📰 ニュース要約モード（ログイン不要）',
      updated:      '更新:',
      prevPage:     '← 前のページ', nextPage: '次のページ →',
      page:         '{cur} ページ目 / 全 {total} 件',
      modalTitle:   'Access Token を設定',
      modalDesc:    'Truth Social はログインが必要です。ブラウザで一度ログインし、トークンを取得して貼り付けてください：',
      modalSteps: [
        'ブラウザで <a href="https://truthsocial.com" target="_blank">truthsocial.com</a> にログイン',
        'F12 キーで DevTools を開き → <strong>Network</strong> タブを選択',
        'ページを更新し、<code>api/v1/</code> から始まるリクエストをクリック',
        '右側の <strong>Request Headers</strong> で <code>Authorization</code> を探す',
        '<code>Bearer </code> の後ろの長い文字列をコピーして下に貼り付け',
      ],
      tokenPlaceholder: 'トークンを貼り付け（Bearer プレフィックス不要）',
      save:         '保存して取得開始',
      cancel:       'キャンセル',
      tokenSaved:   'Token 保存完了。投稿を取得中...',
      tokenError:   'Token の保存に失敗しました',
    },
  };

  const t = (key, vars = {}) => {
    let s = (i18n[lang] || i18n['zh-TW'])[key] || key;
    Object.entries(vars).forEach(([k, v]) => { s = s.replace(`{${k}}`, v); });
    return s;
  };

  // ── DOM refs ─────────────────────────────────────────────────────────────
  const $ = id => document.getElementById(id);
  const siteTitle   = $('site-title'),  siteSub      = $('site-subtitle');
  const statusBadge = $('status-badge'), lastUpdated  = $('last-updated');
  const tokenBtn    = $('token-btn');
  const tokenModal  = $('token-modal');
  const modalTitle  = $('modal-title'), modalDesc    = $('modal-desc');
  const modalSteps  = $('modal-steps'), tokenInput   = $('token-input');
  const modalCancel = $('modal-cancel'), modalSave   = $('modal-save');
  const searchInput = $('search-input');
  const dateFrom    = $('date-from'),   dateTo       = $('date-to');
  const clearBtn    = $('clear-btn'),   container    = $('posts-container');
  const pagination  = $('pagination'),  prevBtn      = $('prev-btn');
  const nextBtn     = $('next-btn'),    pageInfo     = $('page-info');
  const labelFrom   = $('label-from'),  labelTo      = $('label-to');

  // Apply i18n
  document.documentElement.lang = lang;
  if (lang === 'ja') {
    document.title = 'トランプ Truth Social リアルタイム監視｜日本語翻訳';
    document.querySelector('meta[name="description"]')?.setAttribute('content',
      'トランプ大統領の Truth Social 投稿をリアルタイムで監視し、日本語・繁体字中国語に自動翻訳します。キーワードや日付での検索も可能。');
  }
  siteTitle.textContent   = t('title');
  siteSub.textContent     = t('subtitle');
  searchInput.placeholder = t('search');
  clearBtn.textContent    = t('clear');
  labelFrom.textContent   = t('from');
  labelTo.textContent     = t('to');
  prevBtn.textContent     = t('prevPage');
  nextBtn.textContent     = t('nextPage');
  modalSave.textContent   = t('save');
  modalCancel.textContent = t('cancel');
  modalTitle.textContent  = t('modalTitle');
  modalDesc.textContent   = t('modalDesc');
  tokenInput.placeholder  = t('tokenPlaceholder');
  modalSteps.innerHTML    = t('modalSteps').map(s => `<li>${s}</li>`).join('');

  // ── State ────────────────────────────────────────────────────────────────
  let currentOffset = 0, total = 0;
  const PAGE_SIZE   = 20;
  let debounceTimer = null, knownIds = new Set(), isFirstLoad = true;

  // ── Token Modal ──────────────────────────────────────────────────────────
  function openModal() {
    tokenInput.value = '';
    tokenModal.style.display = 'flex';
    setTimeout(() => tokenInput.focus(), 50);
  }
  function closeModal() { tokenModal.style.display = 'none'; }

  tokenBtn.addEventListener('click', openModal);
  modalCancel.addEventListener('click', closeModal);
  tokenModal.addEventListener('click', e => { if (e.target === tokenModal) closeModal(); });

  modalSave.addEventListener('click', async () => {
    let token = tokenInput.value.trim();
    if (!token) return;
    // Strip "Bearer " prefix if pasted with it
    token = token.replace(/^Bearer\s+/i, '');

    modalSave.disabled = true;
    modalSave.textContent = '...';

    try {
      const res = await fetch('/api/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      if (res.ok) {
        closeModal();
        showToast(t('tokenSaved'), 'success');
        setTimeout(() => { currentOffset = 0; loadPosts(); }, 1500);
      } else {
        showToast(t('tokenError'), 'error');
      }
    } catch {
      showToast(t('tokenError'), 'error');
    } finally {
      modalSave.disabled    = false;
      modalSave.textContent = t('save');
    }
  });

  // ── Toast ────────────────────────────────────────────────────────────────
  function showToast(msg, type = 'info') {
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.textContent = msg;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => el.remove(), 300);
    }, 3500);
  }

  // ── Helpers ──────────────────────────────────────────────────────────────
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
    if (s < 60)    return lang === 'ja' ? `${s}秒前`              : `${s} 秒前`;
    if (s < 3600)  return lang === 'ja' ? `${Math.floor(s/60)}分前`   : `${Math.floor(s/60)} 分鐘前`;
    if (s < 86400) return lang === 'ja' ? `${Math.floor(s/3600)}時間前` : `${Math.floor(s/3600)} 小時前`;
    return lang === 'ja' ? `${Math.floor(s/86400)}日前` : `${Math.floor(s/86400)} 天前`;
  }

  // ── Render ───────────────────────────────────────────────────────────────
  function renderSkeletons(n = 4) {
    container.innerHTML = Array.from({length: n}, () => `
      <div class="skeleton">
        <div class="skel-line short"></div>
        <div class="skel-line long"></div>
        <div class="skel-line medium"></div>
      </div>`).join('');
  }

  function renderPosts(posts, appendNew = false) {
    if (!appendNew) container.innerHTML = '';

    if (!posts.length && !appendNew) {
      const hasFilter = searchInput.value || dateFrom.value || dateTo.value;
      container.innerHTML = `<div class="state-msg">
        <span class="icon">${hasFilter ? '🔍' : '📡'}</span>
        ${hasFilter ? t('noResults') : t('noData')}
      </div>`;
      return;
    }

    posts.forEach(post => {
      const isNew = !knownIds.has(post.id) && !isFirstLoad;
      knownIds.add(post.id);

      const card = document.createElement('div');
      card.className = 'post-card' + (isNew ? ' new-post' : '');
      card.dataset.id = post.id;
      card.innerHTML = `
        <div class="post-meta">
          <span class="post-time">${formatTime(post.created_at)}</span>
          <a class="post-link" href="${post.url}" target="_blank" rel="noopener">${t('openLink')} ↗</a>
        </div>
        <div class="post-translated">${post.content_translated}</div>
        <details class="post-original">
          <summary>${t('viewOrig')}</summary>
          <p>${stripHtml(post.content_original)}</p>
        </details>`;

      appendNew ? container.prepend(card) : container.appendChild(card);
    });
  }

  function renderPagination() {
    if (total <= PAGE_SIZE) { pagination.style.display = 'none'; return; }
    pagination.style.display = 'flex';
    const cur = Math.floor(currentOffset / PAGE_SIZE) + 1;
    pageInfo.textContent  = t('page', { cur, total });
    prevBtn.disabled      = currentOffset === 0;
    nextBtn.disabled      = currentOffset + PAGE_SIZE >= total;
  }

  // ── Fetch ────────────────────────────────────────────────────────────────
  async function loadPosts({ silent = false } = {}) {
    if (!silent) renderSkeletons();

    const params = new URLSearchParams({ lang, limit: PAGE_SIZE, offset: currentOffset });
    if (searchInput.value.trim()) params.set('q', searchInput.value.trim());
    if (dateFrom.value)           params.set('date_from', dateFrom.value);
    if (dateTo.value)             params.set('date_to', dateTo.value);

    try {
      const res  = await fetch(`/api/posts?${params}`);
      const data = await res.json();
      total = data.total;

      if (silent) {
        const newPosts = data.posts.filter(p => !knownIds.has(p.id));
        if (newPosts.length) renderPosts(newPosts, true);
      } else {
        data.posts.forEach(p => knownIds.add(p.id));
        renderPosts(data.posts);
      }
      renderPagination();
      isFirstLoad = false;
    } catch {
      if (!silent) container.innerHTML = `<div class="state-msg"><span class="icon">⚠️</span>無法連線至伺服器</div>`;
    }
  }

  // ── Status ───────────────────────────────────────────────────────────────
  async function pollStatus() {
    try {
      const data = await fetch('/api/status').then(r => r.json());

      if (!data.has_token) {
        statusBadge.className   = 'badge badge-no-token';
        statusBadge.textContent = t('noTokenBadge');
        // Still load posts from Google News fallback
      }

      const lf = data.last_fetched;
      if (lf && lf !== 'never') {
        statusBadge.className   = 'badge badge-live';
        statusBadge.textContent = t('live');
        lastUpdated.textContent = `${t('updated')} ${timeAgo(lf)}`;
      } else {
        statusBadge.className   = 'badge badge-loading';
        statusBadge.textContent = t('idle');
      }

      if (!searchInput.value && !dateFrom.value && !dateTo.value && currentOffset === 0) {
        await loadPosts({ silent: true });
      }
    } catch {
      statusBadge.className   = 'badge badge-error';
      statusBadge.textContent = t('error');
    }
  }

  // ── Events ───────────────────────────────────────────────────────────────
  searchInput.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => { currentOffset = 0; loadPosts(); }, 350);
  });

  [dateFrom, dateTo].forEach(el =>
    el.addEventListener('change', () => { currentOffset = 0; loadPosts(); })
  );

  clearBtn.addEventListener('click', () => {
    searchInput.value = dateFrom.value = dateTo.value = '';
    currentOffset = 0;
    loadPosts();
  });

  prevBtn.addEventListener('click', () => {
    if (currentOffset >= PAGE_SIZE) {
      currentOffset -= PAGE_SIZE;
      loadPosts();
      scrollTo({ top: 0, behavior: 'smooth' });
    }
  });

  nextBtn.addEventListener('click', () => {
    if (currentOffset + PAGE_SIZE < total) {
      currentOffset += PAGE_SIZE;
      loadPosts();
      scrollTo({ top: 0, behavior: 'smooth' });
    }
  });

  // ── Init ────────────────────────────────────────────────────────────────
  pollStatus();
  setInterval(pollStatus, 30_000);
})();
