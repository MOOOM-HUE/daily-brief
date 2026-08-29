// 新闻源注册表 + RSS/Atom/Bing News 抓取与解析（全部免费、无需 API Key）
// 单个源失败自动跳过并记录，不影响整体流程。源清单可按需增删。

export const TOPICS = ['AI / Agent / 大模型', '科技产品与硬件', '大学 / 专业 / 就业'];
export const TOPIC_KEYS = ['ai', 'hardware', 'education'];

// 精选 RSS 源（topic 用下标指向 TOPICS；type 必须与源实际格式一致：rss / atom）
// 实测可用性：2026-08（机器之心/36氪 的 RSS 已失效、RSSHub 公共实例 403，故未收录）
export const CURATED_FEEDS = [
  // —— AI / Agent / 大模型 ——
  { id: 'infoq-cn', name: 'InfoQ 中文', topic: 0, url: 'https://www.infoq.cn/feed', type: 'rss' },
  { id: 'theverge-ai', name: 'The Verge AI', topic: 0, url: 'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml', type: 'atom' },
  { id: 'techcrunch-ai', name: 'TechCrunch AI', topic: 0, url: 'https://techcrunch.com/category/artificial-intelligence/feed/', type: 'rss' },
  { id: 'venturebeat-ai', name: 'VentureBeat AI', topic: 0, url: 'https://venturebeat.com/category/ai/feed/', type: 'rss' },
  // —— 科技产品与硬件 ——
  { id: 'theverge', name: 'The Verge', topic: 1, url: 'https://www.theverge.com/rss/index.xml', type: 'atom' },
  { id: 'engadget', name: 'Engadget', topic: 1, url: 'https://www.engadget.com/rss.xml', type: 'rss' },
  { id: 'ifanr', name: '爱范儿', topic: 1, url: 'https://www.ifanr.com/feed', type: 'rss' },
  { id: 'sspai', name: '少数派', topic: 1, url: 'https://sspai.com/feed', type: 'rss' },
];

// Bing News RSS 查询（免费、无需 Key；qft=interval="7" 表示近 7 天）
export const BING_QUERIES = [
  { q: 'AI Agent', topic: 0 },
  { q: '大模型', topic: 0 },
  { q: 'OpenAI', topic: 0 },
  { q: '人工智能 行业', topic: 0 },
  { q: 'NVIDIA chip launch', topic: 1 },
  { q: '芯片 发布', topic: 1 },
  { q: '苹果 新品', topic: 1 },
  { q: '笔记本电脑 新品', topic: 1 },
  { q: '高考 专业 就业', topic: 2 },
  { q: '就业形势', topic: 2 },
  { q: '校招 秋招', topic: 2 },
  { q: '考研 分数线', topic: 2 },
];

const MAX_ITEMS_PER_FEED = 15; // 精选源每源取前 N 条
const MAX_ITEMS_PER_BING = 10; // Bing 每个查询取前 N 条

// ---------------- 抓取 ----------------

async function fetchXml(url) {
  const withUa = async (ua) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000);
    try {
      const res = await fetch(url, {
        signal: ctrl.signal,
        redirect: 'follow',
        headers: ua ? { 'User-Agent': ua } : {},
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      if (!text || text.length < 50) throw new Error('空响应');
      return text;
    } finally {
      clearTimeout(timer);
    }
  };
  try {
    return await withUa('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36');
  } catch (err) {
    // 个别服务器拒绝自定义 UA，退化为无 UA 重试一次
    return await withUa(null);
  }
}

// ---------------- 轻量 XML/RSS/Atom 解析 ----------------

function stripCdata(s) {
  return String(s).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
}

function decodeEntities(s) {
  return String(s)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => (n > 0x10ffff ? '' : String.fromCodePoint(Number(n))))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)));
}

function extractTag(block, tag) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
  const m = block.match(re);
  if (!m) return '';
  return decodeEntities(stripCdata(m[1]).trim());
}

function extractAttr(block, tag, attr) {
  const re = new RegExp(`<${tag}[^>]*\\b${attr}\\s*=\\s*(["'])(.*?)\\1`, 'i');
  const m = block.match(re);
  if (!m) return '';
  return decodeEntities(stripCdata(m[2]).trim());
}

function stripHtml(s) {
  return decodeEntities(String(s))
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function firstImgSrc(s) {
  const m = String(s).match(/<img[^>]+src=["']([^"']+)["']/i);
  return m ? decodeEntities(m[1]) : '';
}

function parseDateStr(s) {
  if (!s) return null;
  const t = Date.parse(s.trim());
  return Number.isFinite(t) ? t : null;
}

function resolveUrl(link, baseUrl) {
  if (!link) return '';
  try {
    return new URL(link, baseUrl).href;
  } catch {
    return link;
  }
}

export function parseRss(xml, baseUrl = '') {
  const items = [];
  const re = /<item[\s>][\s\S]*?<\/item>/gi;
  let m;
  while ((m = re.exec(xml)) && items.length < 60) {
    const block = m[0];
    const title = extractTag(block, 'title');
    let link = extractAttr(block, 'link', 'href') || extractTag(block, 'link');
    if (!link) continue;
    link = resolveUrl(link.trim(), baseUrl);
    const pubDate = parseDateStr(extractTag(block, 'pubDate') || extractTag(block, 'date'));
    const description = extractTag(block, 'description');
    const creator = extractTag(block, 'dc:creator') || extractTag(block, 'creator');
    const media =
      extractAttr(block, 'content', 'url') ||
      extractAttr(block, 'thumbnail', 'url') ||
      extractAttr(block, 'enclosure', 'url') ||
      firstImgSrc(description);
    items.push({
      title,
      link,
      pubDate,
      description,
      creator,
      media,
    });
  }
  return items;
}

export function parseAtom(xml, baseUrl = '') {
  const items = [];
  const re = /<entry[\s>][\s\S]*?<\/entry>/gi;
  let m;
  while ((m = re.exec(xml)) && items.length < 60) {
    const block = m[0];
    const title = extractTag(block, 'title');
    const link = extractAttr(block, 'link', 'href');
    if (!title || !link) continue;
    const published = parseDateStr(extractTag(block, 'published') || extractTag(block, 'updated'));
    const summary = extractTag(block, 'summary') || extractTag(block, 'content');
    const media = extractAttr(block, 'content', 'url') || firstImgSrc(summary);
    items.push({
      title,
      link: resolveUrl(link.trim(), baseUrl),
      pubDate: published,
      description: summary,
      creator: '',
      media,
    });
  }
  return items;
}

// Bing News 的链接是跳转地址，真实文章 URL 藏在 url 参数里
export function unbinge(link) {
  try {
    const u = new URL(link);
    if (/bing\.com/i.test(u.hostname) && u.searchParams.has('url')) {
      return u.searchParams.get('url');
    }
  } catch {
    /* ignore */
  }
  return link;
}

export function parseFeedXml(xml, type, baseUrl = '') {
  return type === 'atom' ? parseAtom(xml, baseUrl) : parseRss(xml, baseUrl);
}

// ---------------- 候选条目收集 ----------------

export async function collectCandidates({ offline = false, limit = 120 } = {}) {
  if (offline) return { candidates: [], errors: [] };

  const jobs = [];
  for (const f of CURATED_FEEDS) {
    jobs.push({ kind: 'feed', ...f });
  }
  for (const b of BING_QUERIES) {
    jobs.push({
      kind: 'bing',
      id: `bing-${b.topic}-${b.q}`,
      name: `Bing:${b.q}`,
      topic: b.topic,
      url: `https://www.bing.com/news/search?q=${encodeURIComponent(b.q)}&format=rss&qft=interval%3d%227%22`,
      type: 'rss',
    });
  }

  const errors = [];
  const seenUrls = new Set();
  const candidates = [];
  const maxConcurrent = 6;

  const worker = async (job) => {
    try {
      const xml = await fetchXml(job.url);
      const items = parseFeedXml(xml, job.type, job.url);
      const cap = job.kind === 'bing' ? MAX_ITEMS_PER_BING : MAX_ITEMS_PER_FEED;
      for (const it of items.slice(0, cap)) {
        let link = it.link;
        if (job.kind === 'bing') link = unbinge(link);
        if (!link || !/^https?:\/\//i.test(link)) continue;
        const norm = normalizeUrl(link);
        if (!norm || seenUrls.has(norm)) continue;
        seenUrls.add(norm);
        const title = it.title?.trim();
        if (!title || title.length < 6) continue;
        candidates.push({
          title,
          url: link,
          snippet: stripHtml(it.description).slice(0, 300),
          publishedAt: it.pubDate,
          sourceName: job.name,
          topic: TOPICS[job.topic],
          image: it.media || '',
        });
      }
    } catch (err) {
      errors.push(`${job.id}: ${err.message}`);
    }
  };

  let idx = 0;
  async function pump() {
    const running = [];
    while (idx < jobs.length) {
      const slot = jobs[idx++];
      const p = worker(slot).finally(() => {});
      running.push(p);
      if (running.length >= maxConcurrent) {
        await Promise.race(running);
        for (let i = running.length - 1; i >= 0; i--) {
          if (running[i].done) running.splice(i, 1);
        }
      }
    }
    await Promise.all(running);
  }
  await pump();

  // 按时间倒序（有时间的优先），整体截断到 limit
  candidates.sort((a, b) => {
    const da = a.publishedAt ?? 0;
    const db = b.publishedAt ?? 0;
    return db - da;
  });
  return { candidates: candidates.slice(0, limit), errors };
}

// ---------------- 去重辅助 ----------------

export function normalizeUrl(url) {
  try {
    const u = new URL(url);
    for (const p of [...u.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|ref|from|source|spm|from=)/i.test(p) && p !== 'id') u.searchParams.delete(p);
    }
    if (u.search === '?') u.search = '';
    return `${u.hostname.replace(/^www\./, '')}${u.pathname}${u.search}`.toLowerCase();
  } catch {
    return '';
  }
}

export function titleKey(title) {
  return String(title).toLowerCase().replace(/[\s\W_]+/g, '');
}

export function itemKey({ url, title }) {
  const n = normalizeUrl(url);
  if (n) return `u:${n}`;
  const t = titleKey(title);
  return t ? `t:${t}` : '';
}
