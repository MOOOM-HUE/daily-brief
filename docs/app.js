/* 每日简报 —— 前端逻辑（纯静态，无构建步骤） */
'use strict';

(() => {
  const $ = (s) => document.querySelector(s);

  const state = {
    config: null,
    digest: null,
    index: [],
    currentDate: null,
    swReg: null,
    subscription: null,
    topicFilter: '',
    favs: [],
    keywords: [],
    weeklyLatest: null,
    weeklyIndex: [],
    weeklyData: null,
    view: 'digest', // digest | favorites | weekly
  };

  /* ---------- 小工具 ---------- */

  const utf8ToBase64 = (str) => {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return btoa(bin);
  };

  const urlBase64ToUint8Array = (base64String) => {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(base64);
    const arr = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
    return arr;
  };

  async function fetchJSON(url, opts) {
    const r = await fetch(url, opts);
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${url}`);
    return r.json();
  }

  function fmtDate(dateStr) {
    const [y, m, d] = String(dateStr).split('-').map(Number);
    if (!y || !m || !d) return dateStr;
    return `${y}年${m}月${d}日`;
  }

  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 3200);
  }

  function repoInfo() {
    const saved = JSON.parse(localStorage.getItem('db_repo') || 'null');
    const owner = (saved?.owner || state.config?.repo?.owner || '').trim();
    const name = (saved?.name || state.config?.repo?.name || '').trim();
    if (!owner || !name || /YOUR_/.test(owner + name)) return null;
    return { owner, name };
  }

  /* ---------- 收藏 & 关键词（本地 + 可选仓库同步） ---------- */

  function loadLocalFavs() {
    try {
      const v = JSON.parse(localStorage.getItem('db_favs') || '[]');
      state.favs = Array.isArray(v) ? v : [];
    } catch {
      state.favs = [];
    }
  }

  function saveLocalFavs() {
    try { localStorage.setItem('db_favs', JSON.stringify(state.favs.slice(0, 50))); } catch { /* ignore */ }
  }

  function favKey(it) {
    return it?.source?.url || it?.url || it?.title || '';
  }

  function isFav(it) {
    const k = favKey(it);
    return k ? state.favs.some((f) => favKey(f) === k) : false;
  }

  function toggleFav(it) {
    const k = favKey(it);
    if (!k) return;
    if (isFav(it)) {
      state.favs = state.favs.filter((f) => favKey(f) !== k);
    } else {
      const snap = {
        key: k,
        url: it.source?.url || it.url || '',
        title: it.title || '',
        topic: it.topic || '',
        date: state.currentDate || it.date || '',
        summary: it.summary || '',
        why: it.why || '',
        divergence: it.divergence || '',
        image: it.image || null,
        source: it.source || null,
        translation: it.translation || null,
        matchedKeywords: it.matchedKeywords || [],
      };
      state.favs = [snap, ...state.favs].slice(0, 50);
    }
    saveLocalFavs();
    syncFavsRepoDebounced();
  }

  let favSyncTimer = null;
  function syncFavsRepoDebounced() {
    clearTimeout(favSyncTimer);
    favSyncTimer = setTimeout(syncFavsRepo, 1200);
  }

  async function syncFavsRepo() {
    if (!repoInfo() || !localStorage.getItem('db_pat')) return;
    try {
      const existing = await ghGet('docs/favorites.json').catch(() => null);
      let repoFavs = [];
      if (existing?.content) {
        try { repoFavs = JSON.parse(atob(existing.content)); } catch { /* ignore */ }
        if (!Array.isArray(repoFavs)) repoFavs = [];
      }
      const byKey = new Map();
      for (const f of [...state.favs, ...repoFavs]) {
        const k = favKey(f);
        if (k && !byKey.has(k)) byKey.set(k, f);
      }
      const merged = [...byKey.values()].slice(0, 50);
      await ghPut('docs/favorites.json', JSON.stringify(merged, null, 2) + '\n', existing?.sha);
      state.favs = merged;
      saveLocalFavs();
    } catch (err) {
      console.warn('收藏同步失败（仅本地保留）', err);
    }
  }

  async function adoptRepoFavs() {
    if (!repoInfo() || !localStorage.getItem('db_pat')) return;
    if (state.favs.length > 0) return;
    try {
      const existing = await ghGet('docs/favorites.json').catch(() => null);
      if (existing?.content) {
        const list = JSON.parse(atob(existing.content));
        if (Array.isArray(list) && list.length) {
          state.favs = list;
          saveLocalFavs();
        }
      }
    } catch { /* ignore */ }
  }

  function loadLocalKeywords() {
    try {
      const v = JSON.parse(localStorage.getItem('db_keywords') || '[]');
      state.keywords = (Array.isArray(v) ? v : []).filter((k) => typeof k === 'string' && k.trim());
    } catch {
      state.keywords = [];
    }
  }

  function parseKeywordsInput(str) {
    return String(str || '')
      .split(/[,，、;\n]/)
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 10);
  }

  async function syncPrefsRepo() {
    if (!repoInfo() || !localStorage.getItem('db_pat')) return;
    try {
      const existing = await ghGet('docs/prefs.json').catch(() => null);
      const content = JSON.stringify({ keywords: state.keywords }, null, 2) + '\n';
      await ghPut('docs/prefs.json', content, existing?.sha);
    } catch (err) {
      console.warn('关键词同步失败（仅本地保留）', err);
    }
  }

  function localKwMatch(it) {
    if (!state.keywords.length) return [];
    const hay = ((it.title || '') + ' ' + (it.summary || '')).toLowerCase();
    return state.keywords.filter((k) => k && hay.includes(k.toLowerCase()));
  }

  function kwList(it) {
    const fromData = Array.isArray(it.matchedKeywords) ? it.matchedKeywords : [];
    const fromLocal = localKwMatch(it);
    const seen = new Set();
    return [...fromData, ...fromLocal].filter((k) => {
      const s = String(k).trim();
      if (!s || seen.has(s)) return false;
      seen.add(s);
      return true;
    }).slice(0, 5);
  }

  /* ---------- 数据加载 ---------- */

  async function loadConfig() {
    state.config = await fetchJSON('config.json', { cache: 'no-cache' }).catch(() => null);
    if (state.config?.site?.name) document.title = state.config.site.name;
  }

  async function loadIndex() {
    state.index = await fetchJSON('digests/index.json', { cache: 'no-cache' }).catch(() => []);
    if (!Array.isArray(state.index)) state.index = [];
  }

  async function init() {
    await loadConfig();

    const latest = await fetchJSON('latest.json', { cache: 'no-cache' }).catch(() => null);
    const params = new URLSearchParams(location.search);
    const want = params.get('date');
    let digest = null;
    if (want && /^\d{4}-\d{2}-\d{2}$/.test(want)) {
      digest = await fetchJSON(`digests/${want}.json`, { cache: 'no-cache' }).catch(() => null);
    }
    if (!digest && latest) digest = latest;

    await loadIndex();
    loadLocalFavs();
    loadLocalKeywords();
    buildTabs();
    await loadWeekly();
    await adoptRepoFavs();

    if (digest) renderDigest(digest);
    else renderEmpty('暂无简报：每天 07:30 自动生成，请稍后再来');
    renderIndex();
    initPushUI();

    $('#btnPrev').addEventListener('click', () => stepDate(-1));
    $('#btnNext').addEventListener('click', () => stepDate(1));
    $('#btnSettings').addEventListener('click', openSettings);
    $('#btnPush').addEventListener('click', handleSubscribe);
    $('#btnFav').addEventListener('click', toggleFavoritesView);
    $('#historySelect').addEventListener('change', (e) => {
      if (e.target.value) navigate(e.target.value);
    });
  }

  /* ---------- 主题筛选 Tab ---------- */

  function buildTabs() {
    const wrap = $('#topicTabs');
    if (!wrap) return;
    const labels = ['全部', ...(state.config?.site?.topicLabels || [])];
    wrap.innerHTML = '';
    for (const label of labels) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'topic-tab' + (label === '全部' ? ' active' : '');
      btn.textContent = label;
      btn.addEventListener('click', () => {
        state.topicFilter = label === '全部' ? '' : label;
        for (const b of wrap.children) b.classList.toggle('active', b === btn);
        renderCurrentView();
      });
      wrap.appendChild(btn);
    }
  }

  /* ---------- 周末特刊 ---------- */

  async function loadWeekly() {
    state.weeklyLatest = await fetchJSON('weekly/latest.json', { cache: 'no-cache' }).catch(() => null);
    state.weeklyIndex = await fetchJSON('weekly/index.json', { cache: 'no-cache' }).catch(() => []);
    if (!Array.isArray(state.weeklyIndex)) state.weeklyIndex = [];
  }

  /* ---------- 渲染 ---------- */

  function isLatest(date) {
    return state.index.length > 0 && state.index[0] === date;
  }

  function renderDigest(digest) {
    state.digest = digest;
    state.currentDate = digest.date;
    state.view = 'digest';
    $('#dateLabel').textContent = fmtDate(digest.date) + (isLatest(digest.date) ? ' · 最新' : '');
    $('#navTitle').textContent = `${digest.date} 精选`;

    renderOverview(digest);
    const cards = $('#cards');
    cards.innerHTML = '';
    const items = digest.items || [];
    const filtered = state.topicFilter ? items.filter((it) => it.topic === state.topicFilter) : items;
    if (!filtered.length) {
      renderEmpty(items.length ? '当前主题暂无内容，试试其他 Tab' : '该日期暂无可展示内容');
      return;
    }
    for (const it of filtered) cards.appendChild(renderCard(it));

    const meta = $('#metaInfo');
    let text = '生成于 ' + (digest.generatedAt ? new Date(digest.generatedAt).toLocaleString('zh-CN', { hour12: false }) : '未知');
    if (digest.stats?.candidates) text += ` · 候选 ${digest.stats.candidates} 条`;
    if (digest.degraded) text += ' · 降级模式';
    meta.textContent = text;
    updateNavButtons();
    renderWeeklySection();
  }

  function renderOverview(digest) {
    const box = $('#overview');
    if (!box) return;
    if (digest.overview) {
      box.innerHTML = `<span class="ov-label">📌 今日速览</span>${escapeHtml(digest.overview)}`;
      box.hidden = false;
    } else {
      box.hidden = true;
    }
  }

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function renderCurrentView() {
    if (state.view === 'favorites') renderFavorites();
    else if (state.view === 'weekly' && state.weeklyData) renderWeeklyView(state.weeklyData);
    else if (state.digest) renderDigest(state.digest);
  }

  function toggleFavoritesView() {
    if (state.view !== 'favorites') {
      renderFavorites();
      return;
    }
    // 从收藏返回之前的视图
    if (state.view === 'favorites') {
      if (state.weeklyData) renderWeeklyView(state.weeklyData);
      else if (state.digest) renderDigest(state.digest);
      else renderFavorites();
    }
  }

  function renderFavorites() {
    state.view = 'favorites';
    $('#overview').hidden = true;
    $('#weekly').hidden = true;
    $('#cards').innerHTML = '';
    $('#dateLabel').textContent = `收藏 ${state.favs.length} 条`;
    $('#navTitle').textContent = '我的收藏';
    const favs = state.topicFilter ? state.favs.filter((f) => f.topic === state.topicFilter) : state.favs;
    if (!favs.length) {
      renderEmpty(state.topicFilter ? '当前主题下没有收藏' : '还没有收藏：点击卡片右上角 ★ 即可收藏');
      return;
    }
    for (const f of favs) $('#cards').appendChild(renderCard(f));
    const meta = $('#metaInfo');
    meta.textContent = '点击 ★ 可取消收藏；配置令牌后会自动同步到 GitHub（跨设备）';
    $('#btnPrev').disabled = true;
    $('#btnNext').disabled = true;
  }

  function renderEmpty(msg) {
    $('#cards').innerHTML = `<div class="empty">${escapeHtml(msg || '暂无内容')}</div>`;
    $('#metaInfo').textContent = '';
  }

  function renderCard(it) {
    const article = document.createElement('article');
    article.className = 'card';

    const topicIdx = state.config?.site?.topicLabels?.indexOf(it.topic) ?? -1;
    const media = document.createElement('div');
    media.className = 'card-media' + (topicIdx >= 0 ? ` topic-${topicIdx}` : '');

    const rank = document.createElement('span');
    rank.className = 'rank';
    rank.textContent = it.rank || '•';
    media.appendChild(rank);

    // 收藏星标（右上角）
    const star = document.createElement('button');
    star.type = 'button';
    star.className = 'star-btn' + (isFav(it) ? ' on' : '');
    star.textContent = isFav(it) ? '★' : '☆';
    star.setAttribute('aria-label', '收藏');
    star.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleFav(it);
      star.classList.toggle('on', isFav(it));
      star.textContent = isFav(it) ? '★' : '☆';
      toast(isFav(it) ? '已收藏' : '已取消收藏');
    });
    media.appendChild(star);

    if (it.topic) {
      const badge = document.createElement('span');
      badge.className = 'topic-badge';
      badge.textContent = it.topic;
      media.appendChild(badge);
    }

    if (it.image?.url) {
      const img = document.createElement('img');
      img.loading = 'lazy';
      img.referrerPolicy = 'no-referrer';
      img.alt = it.image.alt || it.title;
      img.src = it.image.url;
      const proxy = `https://images.weserv.nl/?url=${encodeURIComponent(it.image.url)}`;
      img.addEventListener('error', () => {
        if (img.src !== proxy) img.src = proxy;
        else img.remove();
      });
      media.appendChild(img);
    }
    article.appendChild(media);

    const body = document.createElement('div');
    body.className = 'card-body';

    const parts = {};
    const h3 = document.createElement('h3');
    h3.className = 'card-title';
    const a = document.createElement('a');
    a.href = it.source?.url || '#';
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = it.title || '未命名条目';
    h3.appendChild(a);
    body.appendChild(h3);
    parts.a = a;

    const meta = document.createElement('div');
    meta.className = 'card-meta';
    meta.textContent = it.source?.name || '未知来源';
    body.appendChild(meta);

    // 关注关键词徽标
    const kws = kwList(it);
    if (kws.length) {
      const kwWrap = document.createElement('div');
      kwWrap.className = 'card-kws';
      for (const k of kws) {
        const s = document.createElement('span');
        s.className = 'kw-badge';
        s.textContent = '🎯 ' + k;
        kwWrap.appendChild(s);
      }
      body.appendChild(kwWrap);
    }

    if (it.summary) {
      const sum = document.createElement('p');
      sum.className = 'card-summary';
      sum.textContent = it.summary;
      body.appendChild(sum);
      parts.sum = sum;
    }

    if (it.why && it.why !== '——') {
      const why = document.createElement('div');
      why.className = 'card-why';
      const b = document.createElement('b');
      b.textContent = '为什么值得关注';
      const p = document.createElement('p');
      p.textContent = it.why;
      why.append(b, p);
      body.appendChild(why);
      parts.why = p;
    }

    if (it.divergence) {
      const dv = document.createElement('div');
      dv.className = 'card-divergence';
      const b = document.createElement('b');
      b.textContent = '来源分歧';
      const p = document.createElement('p');
      p.textContent = it.divergence;
      dv.append(b, p);
      body.appendChild(dv);
      parts.div = p;
    }

    if (it.source?.url) {
      const link = document.createElement('a');
      link.className = 'card-link';
      link.href = it.source.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = '阅读原文 ↗';
      body.appendChild(link);
    }

    // AI 翻译：有英文译文的条目显示"AI 翻译"按钮，点击切换为中文
    if (it.translation) {
      const original = {
        title: it.title || '',
        summary: it.summary || '',
        why: it.why || '',
        div: it.divergence || '',
      };
      const t = it.translation;
      const tbtn = document.createElement('button');
      tbtn.type = 'button';
      tbtn.className = 'btn btn-ghost translate-btn';
      tbtn.textContent = 'AI 翻译';
      let shown = false;
      tbtn.addEventListener('click', () => {
        shown = !shown;
        if (parts.a) parts.a.textContent = shown ? (t.title || original.title) : original.title;
        if (parts.sum) parts.sum.textContent = shown ? (t.summary || original.summary) : original.summary;
        if (parts.why) parts.why.textContent = shown ? (t.why || original.why) : original.why;
        if (parts.div) parts.div.textContent = shown ? (t.divergence || original.div) : original.div;
        tbtn.textContent = shown ? '显示原文' : 'AI 翻译';
      });
      body.appendChild(tbtn);
    }

    article.appendChild(body);
    return article;
  }

  function renderIndex() {
    const sel = $('#historySelect');
    const hasDaily = state.index.length > 0;
    const hasWeekly = state.weeklyIndex.length > 0;
    if (!hasDaily && !hasWeekly) {
      sel.hidden = true;
      return;
    }
    sel.innerHTML = '';
    for (const d of state.index) {
      const opt = document.createElement('option');
      opt.value = d;
      opt.textContent = fmtDate(d) + (isLatest(d) ? '（最新）' : '');
      if (d === state.currentDate && state.view !== 'weekly') opt.selected = true;
      sel.appendChild(opt);
    }
    for (const d of state.weeklyIndex) {
      const opt = document.createElement('option');
      opt.value = 'W:' + d;
      opt.textContent = '📖 特刊 ' + fmtDate(d);
      if (d === state.currentDate && state.view === 'weekly') opt.selected = true;
      sel.appendChild(opt);
    }
    sel.hidden = false;
  }

  function updateNavButtons() {
    if (state.view !== 'digest') {
      $('#btnPrev').disabled = true;
      $('#btnNext').disabled = true;
      return;
    }
    const idx = state.index.indexOf(state.currentDate);
    $('#btnPrev').disabled = idx >= state.index.length - 1;
    $('#btnNext').disabled = idx <= 0;
  }

  async function navigate(value) {
    if (!value) return;
    if (String(value).startsWith('W:')) {
      const date = value.slice(2);
      const w = await fetchJSON(`weekly/${date}.json`, { cache: 'no-cache' }).catch(() => null);
      if (!w) {
        toast('该期特刊不存在');
        return;
      }
      renderWeeklyView(w);
      history.replaceState(null, '', `?weekly=${date}`);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    const digest = await fetchJSON(`digests/${date}.json`, { cache: 'no-cache' }).catch(() => null);
    if (!digest) {
      toast('该日期暂无简报');
      return;
    }
    renderDigest(digest);
    history.replaceState(null, '', `?date=${date}`);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ---------- 周末特刊渲染 ---------- */

  function renderWeeklySection() {
    const sec = $('#weekly');
    if (!sec) return;
    const w = state.weeklyLatest;
    if (!w || state.view !== 'digest') {
      sec.hidden = true;
      return;
    }
    const hl = (w.highlights || []).map((h) => `<div class="weekly-hl"><b>${escapeHtml(h.title)}</b><p>${escapeHtml(h.summary)}</p></div>`).join('');
    const ol = (w.outlook || []).map((o) => `<p><b>${escapeHtml(o.title)}</b>：${escapeHtml(o.summary)}</p>`).join('');
    sec.innerHTML = `
      <div class="weekly-head">
        <h2>📖 周末特刊</h2>
        <span class="weekly-date">${fmtDate(w.date)}</span>
      </div>
      <div class="weekly-body">
        <p class="weekly-ov">${escapeHtml(w.overview)}</p>
        <div class="weekly-sec-title">本周要点</div>
        ${hl}
        <div class="weekly-sec-title">趋势分析</div>
        <p class="weekly-trend">${escapeHtml(w.trend)}</p>
        <div class="weekly-sec-title">下周关注</div>
        <div class="weekly-ol">${ol}</div>
      </div>`;
    sec.hidden = false;
  }

  function renderWeeklyView(w) {
    state.view = 'weekly';
    state.weeklyData = w;
    state.currentDate = w.date;
    $('#overview').hidden = true;
    $('#weekly').hidden = true;
    $('#dateLabel').textContent = '周末特刊 · ' + fmtDate(w.date);
    $('#navTitle').textContent = '📖 周末特刊';
    const hl = (w.highlights || []).map((h) => `<div class="weekly-hl"><b>${escapeHtml(h.title)}</b><p>${escapeHtml(h.summary)}</p></div>`).join('');
    const ol = (w.outlook || []).map((o) => `<p><b>${escapeHtml(o.title)}</b>：${escapeHtml(o.summary)}</p>`).join('');
    $('#cards').innerHTML = `
      <div class="card"><div class="card-body">
        <p class="weekly-ov">${escapeHtml(w.overview)}</p>
        <div class="weekly-sec-title">本周要点</div>
        ${hl}
        <div class="weekly-sec-title">趋势分析</div>
        <p class="weekly-trend">${escapeHtml(w.trend)}</p>
        <div class="weekly-sec-title">下周关注</div>
        <div class="weekly-ol">${ol}</div>
        <p class="card-meta" style="margin-top:10px">生成于 ${w.generatedAt ? new Date(w.generatedAt).toLocaleString('zh-CN', { hour12: false }) : '未知'}</p>
      </div></div>`;
    $('#metaInfo').textContent = '';
    updateNavButtons();
  }

  function stepDate(dir) {
    const idx = state.index.indexOf(state.currentDate);
    if (idx < 0) return;
    const next = state.index[idx + dir];
    if (next) navigate(next);
  }

  /* ---------- 推送 ---------- */

  async function initPushUI() {
    const btn = $('#btnPush');
    if (!('serviceWorker' in navigator) || !('Notification' in window) || !('PushManager' in window)) {
      btn.textContent = '浏览器不支持推送';
      btn.disabled = true;
      return;
    }
    try {
      state.swReg = await navigator.serviceWorker.register('sw.js');
    } catch (err) {
      btn.textContent = '推送注册失败';
      console.warn('SW 注册失败', err);
      return;
    }
    state.subscription = await state.swReg.pushManager.getSubscription().catch(() => null);
    updatePushBtn();
  }

  function updatePushBtn() {
    const btn = $('#btnPush');
    if (!btn) return;
    if (state.subscription) {
      btn.textContent = '推送已开启';
      btn.classList.add('on');
    } else {
      btn.textContent = '开启推送';
      btn.classList.remove('on');
    }
  }

  async function handleSubscribe() {
    if (state.subscription) {
      await handleUnsubscribe();
      return;
    }
    if (!state.config?.vapid?.publicKey) {
      toast('站点未配置 VAPID 公钥');
      return;
    }
    if (!repoInfo()) {
      toast('请先在设置中填写仓库与令牌');
      $('#btnSettings').click();
      return;
    }
    let perm = Notification.permission;
    if (perm === 'default') perm = await Notification.requestPermission();
    if (perm !== 'granted') {
      toast('未获得通知权限，请在浏览器设置中允许');
      return;
    }
    try {
      const sub = await state.swReg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(state.config.vapid.publicKey),
      });
      await saveSubscription(sub);
      state.subscription = sub;
      updatePushBtn();
      toast('已开启推送，每天 07:30 自动送达');
    } catch (err) {
      toast('订阅失败：' + (err?.message || '未知错误'));
      console.warn(err);
    }
  }

  async function handleUnsubscribe() {
    const sub = state.subscription;
    try {
      await sub?.unsubscribe();
    } catch { /* ignore */ }
    try {
      const existing = await ghGet('docs/subscriptions.json').catch(() => null);
      if (existing?.content) {
        let list = [];
        try { list = JSON.parse(atob(existing.content)); } catch { /* ignore */ }
        if (!Array.isArray(list)) list = [];
        const before = list.length;
        list = list.filter((s) => s.endpoint !== sub?.endpoint);
        if (list.length !== before) await ghPut('docs/subscriptions.json', JSON.stringify(list, null, 2) + '\n', existing.sha);
      }
    } catch (err) {
      console.warn('退订同步失败', err);
    }
    state.subscription = null;
    updatePushBtn();
    toast('已关闭推送');
  }

  /* ---------- GitHub API（写回订阅） ---------- */

  async function ghGet(path) {
    const repo = repoInfo();
    const token = localStorage.getItem('db_pat');
    if (!repo || !token) throw new Error('缺少仓库/令牌配置');
    const r = await fetch(`https://api.github.com/repos/${repo.owner}/${repo.name}/contents/${path}`, {
      headers: {
        Authorization: `token ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'daily-brief',
      },
    });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`GitHub API ${r.status}: ${(await r.text()).slice(0, 160)}`);
    return r.json();
  }

  async function ghPut(path, content, sha) {
    const repo = repoInfo();
    const token = localStorage.getItem('db_pat');
    if (!repo || !token) throw new Error('缺少仓库/令牌配置');
    const r = await fetch(`https://api.github.com/repos/${repo.owner}/${repo.name}/contents/${path}`, {
      method: 'PUT',
      headers: {
        Authorization: `token ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'User-Agent': 'daily-brief',
      },
      body: JSON.stringify({
        message: 'update subscriptions (daily-brief)',
        content: utf8ToBase64(content),
        ...(sha ? { sha } : {}),
      }),
    });
    if (!r.ok) throw new Error(`GitHub API ${r.status}: ${(await r.text()).slice(0, 160)}`);
    return r.json();
  }

  async function saveSubscription(sub) {
    const subData = sub.toJSON();
    const existing = await ghGet('docs/subscriptions.json').catch(() => null);
    let list = [];
    if (existing?.content) {
      try { list = JSON.parse(atob(existing.content)); } catch { /* ignore */ }
      if (!Array.isArray(list)) list = [];
    }
    list = list.filter((s) => s.endpoint !== subData.endpoint);
    list.push({ endpoint: subData.endpoint, keys: subData.keys, addedAt: new Date().toISOString() });
    await ghPut('docs/subscriptions.json', JSON.stringify(list, null, 2) + '\n', existing?.sha);
  }

  /* ---------- 设置弹窗 ---------- */

  function openSettings() {
    const saved = JSON.parse(localStorage.getItem('db_repo') || 'null');
    $('#setOwner').value = saved?.owner || state.config?.repo?.owner || '';
    $('#setName').value = saved?.name || state.config?.repo?.name || '';
    $('#setPat').value = localStorage.getItem('db_pat') || '';
    $('#setKeywords').value = state.keywords.join(', ');
    $('#pushStatus').textContent = state.subscription
      ? '推送：已开启（' + (state.subscription.endpoint || '').slice(0, 40) + '…）'
      : '推送：未开启';
    $('#settingsDialog').showModal();
  }

  async function saveSettings() {
    const owner = $('#setOwner').value.trim();
    const name = $('#setName').value.trim();
    const pat = $('#setPat').value.trim();
    localStorage.setItem('db_pat', pat);
    localStorage.setItem('db_repo', JSON.stringify({ owner, name }));
    state.keywords = parseKeywordsInput($('#setKeywords').value);
    localStorage.setItem('db_keywords', JSON.stringify(state.keywords));
    syncPrefsRepo();
    toast(state.keywords.length ? `已保存设置（关注关键词 ${state.keywords.length} 个）` : '已保存设置');
    renderCurrentView();
  }

  async function testConnection() {
    await saveSettings();
    try {
      const res = await ghGet('docs/subscriptions.json');
      toast(res ? '连接成功，已读取 docs/subscriptions.json' : '连接成功（文件尚不存在，订阅时会自动创建）');
    } catch (err) {
      toast('连接失败：' + (err?.message || '未知错误'));
    }
  }

  /* ---------- 启动 ---------- */

  $('#btnSave')?.addEventListener('click', saveSettings);
  $('#btnTest')?.addEventListener('click', testConnection);
  document.addEventListener('DOMContentLoaded', init);
})();
