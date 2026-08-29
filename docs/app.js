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
    if (digest) renderDigest(digest);
    else renderEmpty('暂无简报：每天 07:30 自动生成，请稍后再来');
    renderIndex();
    initPushUI();

    $('#btnPrev').addEventListener('click', () => stepDate(-1));
    $('#btnNext').addEventListener('click', () => stepDate(1));
    $('#btnSettings').addEventListener('click', openSettings);
    $('#btnPush').addEventListener('click', handleSubscribe);
    $('#historySelect').addEventListener('change', (e) => {
      if (e.target.value) navigate(e.target.value);
    });
  }

  /* ---------- 渲染 ---------- */

  function isLatest(date) {
    return state.index.length > 0 && state.index[0] === date;
  }

  function renderDigest(digest) {
    state.digest = digest;
    state.currentDate = digest.date;
    $('#dateLabel').textContent = fmtDate(digest.date) + (isLatest(digest.date) ? ' · 最新' : '');
    $('#navTitle').textContent = `${digest.date} 精选`;

    const cards = $('#cards');
    cards.innerHTML = '';
    if (!digest.items || digest.items.length === 0) {
      renderEmpty('该日期暂无可展示内容');
      return;
    }
    for (const it of digest.items) cards.appendChild(renderCard(it));

    const meta = $('#metaInfo');
    let text = '生成于 ' + (digest.generatedAt ? new Date(digest.generatedAt).toLocaleString('zh-CN', { hour12: false }) : '未知');
    if (digest.stats?.candidates) text += ` · 候选 ${digest.stats.candidates} 条`;
    if (digest.degraded) text += ' · 降级模式';
    meta.textContent = text;
    updateNavButtons();
  }

  function renderEmpty(msg) {
    $('#cards').innerHTML = `<div class="empty">${msg || '暂无内容'}</div>`;
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

    const h3 = document.createElement('h3');
    h3.className = 'card-title';
    const a = document.createElement('a');
    a.href = it.source?.url || '#';
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = it.title || '未命名条目';
    h3.appendChild(a);
    body.appendChild(h3);

    const meta = document.createElement('div');
    meta.className = 'card-meta';
    meta.textContent = it.source?.name || '未知来源';
    body.appendChild(meta);

    if (it.summary) {
      const sum = document.createElement('p');
      sum.className = 'card-summary';
      sum.textContent = it.summary;
      body.appendChild(sum);
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

    article.appendChild(body);
    return article;
  }

  function renderIndex() {
    const sel = $('#historySelect');
    if (!state.index.length) {
      sel.hidden = true;
      return;
    }
    sel.innerHTML = '';
    for (const d of state.index) {
      const opt = document.createElement('option');
      opt.value = d;
      opt.textContent = fmtDate(d) + (isLatest(d) ? '（最新）' : '');
      if (d === state.currentDate) opt.selected = true;
      sel.appendChild(opt);
    }
    sel.hidden = false;
  }

  function updateNavButtons() {
    const idx = state.index.indexOf(state.currentDate);
    $('#btnPrev').disabled = idx >= state.index.length - 1;
    $('#btnNext').disabled = idx <= 0;
  }

  async function navigate(date) {
    if (!date) return;
    const digest = await fetchJSON(`digests/${date}.json`, { cache: 'no-cache' }).catch(() => null);
    if (!digest) {
      toast('该日期暂无简报');
      return;
    }
    renderDigest(digest);
    history.replaceState(null, '', `?date=${date}`);
    window.scrollTo({ top: 0, behavior: 'smooth' });
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
      const existing = await ghGet('subscriptions.json').catch(() => null);
      if (existing?.content) {
        let list = [];
        try { list = JSON.parse(atob(existing.content)); } catch { /* ignore */ }
        if (!Array.isArray(list)) list = [];
        const before = list.length;
        list = list.filter((s) => s.endpoint !== sub?.endpoint);
        if (list.length !== before) await ghPut('subscriptions.json', JSON.stringify(list, null, 2) + '\n', existing.sha);
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
    const existing = await ghGet('subscriptions.json').catch(() => null);
    let list = [];
    if (existing?.content) {
      try { list = JSON.parse(atob(existing.content)); } catch { /* ignore */ }
      if (!Array.isArray(list)) list = [];
    }
    list = list.filter((s) => s.endpoint !== subData.endpoint);
    list.push({ endpoint: subData.endpoint, keys: subData.keys, addedAt: new Date().toISOString() });
    await ghPut('subscriptions.json', JSON.stringify(list, null, 2) + '\n', existing?.sha);
  }

  /* ---------- 设置弹窗 ---------- */

  function openSettings() {
    const saved = JSON.parse(localStorage.getItem('db_repo') || 'null');
    $('#setOwner').value = saved?.owner || state.config?.repo?.owner || '';
    $('#setName').value = saved?.name || state.config?.repo?.name || '';
    $('#setPat').value = localStorage.getItem('db_pat') || '';
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
    toast('已保存设置');
  }

  async function testConnection() {
    await saveSettings();
    try {
      const res = await ghGet('subscriptions.json');
      toast(res ? '连接成功，已读取 subscriptions.json' : '连接成功（文件尚不存在，订阅时会自动创建）');
    } catch (err) {
      toast('连接失败：' + (err?.message || '未知错误'));
    }
  }

  /* ---------- 启动 ---------- */

  $('#btnSave')?.addEventListener('click', saveSettings);
  $('#btnTest')?.addEventListener('click', testConnection);
  document.addEventListener('DOMContentLoaded', init);
})();
