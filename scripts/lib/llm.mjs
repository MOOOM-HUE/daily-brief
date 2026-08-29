// DeepSeek API 客户端（OpenAI 兼容）+ 每日 5 条精选逻辑
// 关键安全措施：LLM 返回的 sourceUrl 必须能匹配到候选列表中的真实条目，
// 防止模型编造链接；无法匹配的条目会被丢弃并回退补齐。

import { TOPICS } from './feeds.mjs';

const API_URL = 'https://api.deepseek.com/chat/completions';
const MAX_CANDIDATES_IN_PROMPT = 100;

export async function deepseekChat({ apiKey, model = 'deepseek-chat', messages, temperature = 0.3, maxTokens = 4000 }) {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages,
      temperature,
      max_tokens: maxTokens,
      response_format: { type: 'json_object' },
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`DeepSeek HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error('DeepSeek 返回空内容');
  return content;
}

export function extractJson(content) {
  const s = String(content).trim();
  try {
    const parsed = JSON.parse(s);
    if (parsed) return parsed;
  } catch {
    /* continue */
  }
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) {
    try {
      return JSON.parse(fence[1].trim());
    } catch {
      /* continue */
    }
  }
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first >= 0 && last > first) {
    try {
      return JSON.parse(s.slice(first, last + 1));
    } catch {
      /* continue */
    }
  }
  return null;
}

function truncate(s, n) {
  s = String(s ?? '');
  return s.length > n ? s.slice(0, n) + '…' : s;
}

// 判断文本是否以英文为主（用于决定是否需要 AI 翻译）
export function isMostlyEnglish(text) {
  const s = String(text || '');
  if (!s) return false;
  let cjk = 0;
  let latin = 0;
  for (const ch of s) {
    const code = ch.codePointAt(0);
    if (code >= 0x4e00 && code <= 0x9fff) cjk++;
    else if (/[A-Za-z]/.test(ch)) latin++;
  }
  if (latin + cjk === 0) return false;
  return cjk / (latin + cjk) < 0.15 && latin > 20;
}

function buildPrompt({ candidates, historyTitles, yesterdayLabel, topicLabels, keywords }) {
  const kwLine = keywords && keywords.length
    ? ['', '7. 读者关注关键词：' + keywords.join('、') + '。若某条与该关键词直接相关（标题或内容明显涉及），在该条的 matchedKeywords 数组中列出命中的关键词；不相关的条目省略该字段。'].join('')
    : '';
  const system = [
    '你是资深科技新闻主编，为一位个人读者每日精选"昨天"最重要的 5 条新闻。',
    `读者关注的主题：${topicLabels.join('、')}。`,
    '读者偏好：行业趋势与机会、深度分析与观点，而非简单产品发布流水账。',
    '要求来源可靠（一手来源或高质量媒体优先）。',
    '',
    '选稿优先级（由高到低）：',
    '  ① 行业趋势/机会类（融资、并购、政策、重大战略、生态格局变化）；',
    '  ② 重大技术突破或标志性发布（新模型/新品首秀、芯片、关键产品）；',
    '  ③ 有争议、能引发讨论或对读者职业/选择有影响的话题；',
    '  ④ 最后才考虑普通产品评测与使用技巧——这类尽量不选，除非极有代表性。',
    '',
    '严格规则：',
    '1. 只保留"昨天"（' + yesterdayLabel + '，北京时间）发布或当天有新进展的新闻；更早且无新进展的不要选。',
    '2. 恰好输出 5 条，按重要性降序排列；主题可分布，也可集中于热点。',
    '3. 若多个来源对同一事件的事实或解读存在分歧，在 divergence 字段用 1-2 句说明分歧点。',
    '4. 避免与"近期已报道"清单中主题重复、且没有新进展的内容。',
    '5. sourceName 与 sourceUrl 必须来自候选列表（不要编造链接）。',
    kwLine,
    '6. 只输出一个 JSON 对象：{"overview":"...","items":[{"title","summary","why","divergence","sourceName","sourceUrl","topic","matchedKeywords"?}]}。',
    '   overview 为今日总览：用 1-2 句话概括这 5 条精选的总主题与看点（≤60 字）；',
    '   title 为简洁标题（≤30 字）；summary 为 2-4 句中文摘要（含关键事实与数据）；',
    '   why 为"为什么值得关注/潜在影响"，**每条都必须写、且具体**——说明为什么现在值得关注、对行业/读者有何影响（2-3 句，不要写"影响深远"这类空话，也不要写"——"）；',
    '   topic 必须属于：' + topicLabels.join(' / ') + '。',
    '   除该 JSON 对象外不要输出任何其他文字。',
  ].join('\n');

  const user = [
    `【昨天】${yesterdayLabel}`,
    '',
    `【近期已报道（避免重复，除非有新进展）】${historyTitles.length ? historyTitles.join('；') : '（无）'}`,
    '',
    `【候选新闻 ${candidates.length} 条，每条格式：序号. 标题 | 来源 | 时间 | 摘要】`,
    ...candidates.map((c, i) => {
      const t = c.publishedAt ? new Date(c.publishedAt).toISOString().slice(0, 16).replace('T', ' ') : '时间未知';
      return `${i + 1}. ${truncate(c.title, 120)} | ${c.sourceName} | ${t} | ${truncate(c.snippet, 150)}`;
    }),
    '',
    '请选择 5 条最重要的输出。',
  ].join('\n');

  return { system, user };
}

function normTitle(t) {
  return String(t).toLowerCase().replace(/[\s\W_]+/g, '');
}

// 兜底"为什么值得关注"文案（LLM 未给时的替代，避免出现"——"）
function fallbackWhy(topic) {
  return `这是${topic || '科技'}领域值得关注的新进展，可能影响行业格局与后续机会，建议留意后续发展。`;
}

// 用标题相似度把 LLM 输出匹配回真实候选（避免编造链接/来源）
function matchItemToCandidate(llmItem, candidates) {
  const target = normTitle(llmItem.title || '');
  let best = null;
  let bestScore = -1;
  for (const c of candidates) {
    const t = normTitle(c.title);
    if (!t) continue;
    let score = 0;
    if (t === target) score = 1;
    else if (target && (t.includes(target) || target.includes(t))) score = 0.85;
    else {
      const common = [...new Set(target.split(''))].filter((ch) => t.includes(ch)).length;
      const denom = Math.max(target.length, t.length, 1);
      score = common / denom;
    }
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return bestScore >= 0.6 ? best : null;
}

export async function selectTop5({ apiKey, model, candidates, historyTitles, yesterdayLabel, topicLabels = TOPICS, keywords = [] }) {
  const trimmed = candidates.slice(0, MAX_CANDIDATES_IN_PROMPT);
  const { system, user } = buildPrompt({ candidates: trimmed, historyTitles, yesterdayLabel, topicLabels, keywords });

  const mkMessages = () => [{ role: 'system', content: system }, { role: 'user', content: user }];

  let content;
  try {
    content = await deepseekChat({ apiKey, model, messages: mkMessages(), temperature: 0.3 });
  } catch (err) {
    // 首次失败：降低温度重试一次
    console.warn(`[llm] 首次调用失败，重试：${err.message}`);
    content = await deepseekChat({ apiKey, model, messages: mkMessages(), temperature: 0.1 });
  }

  let data = extractJson(content);
  if (!data?.items || !Array.isArray(data.items)) {
    console.warn('[llm] 输出不是合法 JSON，追加纠错提示重试一次');
    const corrected = await deepseekChat({
      apiKey,
      model,
      messages: [
        ...mkMessages(),
        { role: 'assistant', content },
        { role: 'user', content: '你上一次的输出不是合法 JSON。请只输出合法 JSON 对象 {"items":[...]}，不要任何其他文字。' },
      ],
      temperature: 0.1,
    });
    data = extractJson(corrected);
  }
  if (!data?.items || !Array.isArray(data.items)) {
    throw new Error('LLM 两次尝试均未返回合法 JSON items');
  }

  // 匹配回真实候选
  const used = new Set();
  const items = [];
  for (const raw of data.items.slice(0, 8)) {
    const c = matchItemToCandidate(raw, candidates);
    if (!c || used.has(c.url)) continue;
    used.add(c.url);
    items.push({
      rank: items.length + 1,
      topic: topicLabels.includes(raw.topic) ? raw.topic : c.topic,
      title: (raw.title || c.title).trim().slice(0, 80),
      summary: (raw.summary || c.snippet || '').trim(),
      why: (raw.why || '').trim() || fallbackWhy(raw.topic || c.topic),
      divergence: (raw.divergence || '').trim() || '',
      source: { name: (raw.sourceName || c.sourceName || '').trim(), url: c.url },
      image: { url: c.image || '', alt: c.title || '' },
      matchedKeywords: Array.isArray(raw.matchedKeywords)
        ? raw.matchedKeywords.filter((k) => typeof k === 'string' && k.trim()).slice(0, 5)
        : [],
    });
    if (items.length >= 5) break;
  }

  // 若不足 5 条，用候选里最新且未被选中的条目补齐（降级但保证有内容）
  if (items.length < 5) {
    for (const c of candidates) {
      if (used.has(c.url)) continue;
      if (items.length >= 5) break;
      used.add(c.url);
      items.push({
        rank: items.length + 1,
        topic: c.topic,
        title: c.title,
        summary: c.snippet || '',
        why: fallbackWhy(c.topic),
        divergence: '',
        source: { name: c.sourceName, url: c.url },
        image: { url: c.image || '', alt: c.title || '' },
      });
    }
  }

  return {
    items,
    degraded: items.length < 5,
    overview: String(data.overview || '').trim(),
  };
}

/**
 * 把英文条目翻译成简体中文（批量一次调用）。
 * @param {Array} items 待翻译的条目 [{title, summary, why, divergence, source}]
 * @returns {Promise<Array|null>} 与 items 一一对应的翻译对象或 null；失败抛错
 */
export async function translateItems({ apiKey, model, items }) {
  if (!Array.isArray(items) || items.length === 0) return [];
  const system = [
    '你是资深中文科技编辑。请把下面英文新闻条目逐条翻译成简体中文。',
    '要求：术语译法通用、语气客观流畅、保留事实与数据、不要增删信息；只输出一个 JSON 对象。',
  ].join('');
  const input = items.map((it, i) => ({
    index: i,
    title: it.title,
    summary: it.summary,
    why: it.why,
    divergence: it.divergence || '',
    sourceName: it.source?.name || '',
  }));
  const user =
    JSON.stringify({ items: input }) +
    '\n请在 "translations" 数组中，为每条输出 {"index","title","summary","why","divergence"}，内容均用简体中文。';

  const content = await deepseekChat({
    apiKey,
    model,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    temperature: 0.2,
    maxTokens: 5000,
  });
  const data = extractJson(content);
  const arr = data?.translations;
  if (!Array.isArray(arr)) throw new Error('翻译返回格式错误');
  const byIndex = new Map(arr.filter((t) => typeof t?.index === 'number').map((t) => [t.index, t]));
  return items.map((it, i) => {
    const t = byIndex.get(i);
    if (!t) return null;
    return {
      title: String(t.title || it.title).trim(),
      summary: String(t.summary || it.summary || '').trim(),
      why: String(t.why || it.why || '').trim(),
      divergence: String(t.divergence || '').trim(),
    };
  });
}

/**
 * 周末深度特刊：对近 7 天候选生成周报（本周回顾 + 趋势 + 下周关注）。
 * @param {object} opts {apiKey, model, candidates, topics, weekLabel}
 * @returns {Promise<{overview:string, highlights:Array, trend:string, outlook:Array}>}
 */
export async function weeklyReview({ apiKey, model, candidates, topics = TOPICS, weekLabel = '' }) {
  const system = [
    '你是资深科技新闻主编，为个人读者撰写"周末深度特刊"。',
    `覆盖主题：${topics.join('、')}；内容偏重行业趋势与机会、深度分析与观点。`,
    '请基于近 7 天的候选新闻，用简体中文输出一份周报。',
    '',
    '输出一个 JSON 对象：',
    '{"overview":"一句话总结本周（≤40 字）",',
    ' "highlights":[{"title":"要点标题","summary":"2-3 句，含关键事实与分析"}×3-5],',
    ' "trend":"1-2 段深度趋势分析（全局视角、机遇与隐忧）",',
    ' "outlook":[{"title":"下周关注点","summary":"1-2 句说明为什么"}×2-3]}',
    '要求：highlights 覆盖本周最重要的事件并给观点；trend 要有洞察而非罗列；不要编造候选列表之外的事实。',
    '除该 JSON 对象外不要输出任何其他文字。',
  ].join('\n');

  const top = candidates.slice(0, 160).map((c, i) => {
    const t = c.publishedAt ? new Date(c.publishedAt).toISOString().slice(0, 16).replace('T', ' ') : '时间未知';
    return `${i + 1}. ${truncate(c.title, 120)} | ${c.sourceName} | ${t} | ${truncate(c.snippet, 140)}`;
  });
  const user = [
    weekLabel ? `【本周】${weekLabel}（近 7 天）` : '【本周】近 7 天',
    '',
    `【候选新闻 ${candidates.length} 条（截取前 ${top.length} 条）】`,
    ...top,
    '',
    '请输出周末深度特刊的 JSON。',
  ].join('\n');

  const messages = [{ role: 'system', content: system }, { role: 'user', content: user }];
  const mk = () => messages;
  let content;
  try {
    content = await deepseekChat({ apiKey, model, messages: mk(), temperature: 0.5, maxTokens: 5000 });
  } catch (err) {
    console.warn(`[llm] 周报首次调用失败，重试：${err.message}`);
    content = await deepseekChat({ apiKey, model, messages: mk(), temperature: 0.2, maxTokens: 5000 });
  }
  let data = extractJson(content);
  if (!data?.highlights || !Array.isArray(data.highlights)) {
    const corrected = await deepseekChat({
      apiKey,
      model,
      messages: [...mk(), { role: 'assistant', content }, { role: 'user', content: '请只输出合法 JSON：{"overview","highlights":[...],"trend","outlook":[...]}。' }],
      temperature: 0.2,
      maxTokens: 5000,
    });
    data = extractJson(corrected);
  }
  if (!data?.highlights || !Array.isArray(data.highlights)) {
    throw new Error('周报两次尝试均未返回合法 JSON');
  }
  const clean = (s) => String(s || '').trim();
  const highlights = (data.highlights || []).slice(0, 5).map((h, i) => ({
    rank: i + 1,
    title: clean(h.title).slice(0, 60) || '要点',
    summary: clean(h.summary),
  }));
  const outlook = (data.outlook || []).slice(0, 3).map((h) => ({
    title: clean(h.title).slice(0, 60),
    summary: clean(h.summary),
  }));
  return {
    overview: clean(data.overview),
    highlights,
    trend: clean(data.trend),
    outlook,
  };
}

// 完全无 LLM 时的降级选择：按时间倒序取前 5 条候选
export function fallbackSelect(candidates) {
  const items = candidates.slice(0, 5).map((c, i) => ({
    rank: i + 1,
    topic: c.topic,
    title: c.title,
    summary: c.snippet || '',
    why: '——',
    divergence: '',
    source: { name: c.sourceName, url: c.url },
    image: { url: c.image || '', alt: c.title || '' },
  }));
  return { items, degraded: true, reason: 'LLM 不可用，按最新候选降级选择' };
}
