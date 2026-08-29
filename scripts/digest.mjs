// 每日简报主流水线
//   node scripts/digest.mjs              —— 完整运行（抓取→LLM→写文件→推送→git 提交，供 GitHub Actions 使用）
//   node scripts/digest.mjs --offline    —— 离线自测：使用内置样例数据，不联网、不推送、不提交
//   node scripts/digest.mjs --dry-run    —— 本机试运行：真实抓取与 LLM，但不推送、不提交（需要 DEEPSEEK_API_KEY）
//   node scripts/digest.mjs --date 2026-01-04  —— 指定目标日期（默认取"昨天"，北京时间）
//
// 环境变量：DEEPSEEK_API_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT（GitHub Secrets 注入）
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson, writeJson } from './lib/json.mjs';
import { collectCandidates, itemKey, TOPICS } from './lib/feeds.mjs';
import { selectTop5, fallbackSelect, isMostlyEnglish, translateItems } from './lib/llm.mjs';
import { sendDigestNotification } from './lib/push.mjs';
import { commitAndPush } from './lib/git.mjs';
import { SAMPLE_CANDIDATES, SAMPLE_HISTORY } from './sample-data.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SITE_DIR = path.join(ROOT, 'docs');

// ---------------- 北京时间日期 ----------------
const HOUR8 = 8 * 3600 * 1000;

function pad(n) {
  return String(n).padStart(2, '0');
}

function isoDate(d) {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function beijingToday() {
  return isoDate(new Date(Date.now() + HOUR8));
}

export function previousDay(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d) - 86400 * 1000);
  return isoDate(dt);
}

function daysBefore(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d) - n * 86400 * 1000);
  return isoDate(dt);
}

function beijingLabel(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return `${y}年${m}月${d}日`;
}

// ---------------- og:image 解析 ----------------
async function fetchOgImage(url) {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    let res;
    try {
      res = await fetch(url, { redirect: 'follow', signal: ctrl.signal });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) return '';
    const html = await res.text();
    if (html.length > 2_000_000) return '';
    const m = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
    if (!m) return '';
    const img = m[1].trim();
    if (!/^https?:\/\//i.test(img)) return '';
    return img;
  } catch {
    return '';
  }
}

// ---------------- 主流程 ----------------
export async function runDigest({
  offline = false,
  dryRun = false,
  dateOverride = null,
  siteDir = SITE_DIR,
} = {}) {
  const t0 = Date.now();
  const targetDate = dateOverride || previousDay(beijingToday());
  const label = beijingLabel(targetDate);

  console.log(`[digest] 目标日期：${label}（${targetDate}） offline=${offline} dryRun=${dryRun}`);

  // 1. 加载仓库现有状态
  const digestsDir = path.join(siteDir, 'digests');
  const config = readJson(path.join(siteDir, 'config.json'), {});
  const history = readJson(path.join(siteDir, 'history.json'), null);
  const subscriptions = readJson(path.join(siteDir, 'subscriptions.json'), []);
  const existingIndex = readJson(path.join(digestsDir, 'index.json'), []);
  // 离线自测：无历史文件时注入样例历史，验证去重路径
  const historyEntries = offline && !history ? { entries: SAMPLE_HISTORY } : (history || { entries: [] });

  // 2. 收集候选
  let candidates;
  let feedErrors = [];
  if (offline) {
    candidates = SAMPLE_CANDIDATES;
  } else {
    const collected = await collectCandidates({ offline: false });
    candidates = collected.candidates;
    feedErrors = collected.errors;
  }
  console.log(`[digest] 候选 ${candidates.length} 条${feedErrors.length ? `（${feedErrors.length} 个源失败）` : ''}`);
  if (feedErrors.length) {
    console.warn('[digest] 失败源：\n - ' + feedErrors.join('\n - '));
  }

  // 3. 硬去重（历史）
  const historyKeys = new Set(historyEntries.entries.map((e) => e.key).filter(Boolean));
  const fresh = candidates.filter((c) => !historyKeys.has(itemKey(c)));
  console.log(`[digest] 去重后剩余 ${fresh.length} 条（历史 ${historyKeys.size} 条）`);

  // 4. LLM 精选
  const historyTitles = historyEntries.entries.slice(-40).map((e) => e.title).filter(Boolean);
  // 用户关注关键词（docs/prefs.json，由 PWA 设置页写入）
  const prefs = readJson(path.join(siteDir, 'prefs.json'), {});
  const keywords = (Array.isArray(prefs.keywords) ? prefs.keywords : []).filter((k) => typeof k === 'string' && k.trim()).slice(0, 10);
  let selection;
  let modelUsed = 'fallback';
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (offline) {
    modelUsed = 'offline-sample';
    // 离线模式：直接取样例中未命中的前 5 条（模拟 LLM 结果）
    selection = {
      items: fresh.slice(0, 5).map((c, i) => ({
        rank: i + 1,
        topic: c.topic,
        title: c.title,
        summary: c.snippet || '',
        why: '（离线自测：模拟 LLM 输出）',
        divergence: '',
        source: { name: c.sourceName, url: c.url },
        image: { url: c.image || '', alt: c.title || '' },
        matchedKeywords: [],
      })),
      degraded: false,
      overview: '今日精选 ' + TOPICS.join('、') + ' 5 条',
    };
  } else if (apiKey) {
    modelUsed = process.env.LLM_MODEL || 'deepseek-chat';
    selection = await selectTop5({
      apiKey,
      model: modelUsed,
      candidates: fresh,
      historyTitles,
      yesterdayLabel: label,
      topicLabels: TOPICS,
      keywords,
    });
  } else {
    selection = fallbackSelect(fresh);
  }
  if (keywords.length) console.log(`[digest] 关注关键词 ${keywords.length} 个：${keywords.join('、')}`);
  console.log(`[digest] 精选 ${selection.items.length} 条${selection.degraded ? '（降级）' : ''}`);

  // 5. 图片：LLM 没给到图片的条目尝试抓 og:image
  if (!offline) {
    for (const it of selection.items) {
      if (!it.image?.url) {
        const og = await fetchOgImage(it.source?.url);
        if (og) it.image = { url: og, alt: it.title };
      }
    }
  }

  // 5.5 AI 翻译：英文条目用 DeepSeek 译成中文（存进 translation，前端"AI 翻译"按钮显示）
  if (!offline && apiKey) {
    const enItems = selection.items.filter((it) => isMostlyEnglish(it.title + ' ' + (it.summary || '')));
    if (enItems.length) {
      try {
        const trans = await translateItems({ apiKey, model: modelUsed, items: enItems });
        let k = 0;
        for (const it of selection.items) {
          if (isMostlyEnglish(it.title + ' ' + (it.summary || ''))) {
            if (trans[k]) it.translation = trans[k];
            k++;
          }
        }
        console.log(`[digest] 已 AI 翻译 ${enItems.length} 条英文条目`);
      } catch (err) {
        console.warn(`[digest] AI 翻译失败，跳过：${err.message}`);
      }
    }
  }

  // 6. 组装 digest 并写文件
  const digest = {
    date: targetDate,
    generatedAt: new Date().toISOString(),
    model: modelUsed,
    degraded: selection.degraded || selection.items.length < 5,
    overview: (selection.overview || '').trim() || `今日${TOPICS.join('、')}精选 ${selection.items.length} 条`,
    stats: {
      candidates: candidates.length,
      afterDedup: fresh.length,
      feedErrors: feedErrors.length,
      selected: selection.items.length,
      durationMs: Date.now() - t0,
    },
    items: selection.items,
  };

  const digestFile = path.join(digestsDir, `${targetDate}.json`);
  writeJson(digestFile, digest);
  writeJson(path.join(siteDir, 'latest.json'), digest);

  const newIndex = Array.from(new Set([targetDate, ...existingIndex])).sort().reverse().slice(0, 30);
  writeJson(path.join(digestsDir, 'index.json'), newIndex);

  // 7. 更新历史（去重库，保留最近 30 天）
  const todayBeijing = beijingToday();
  const cutoffDate = daysBefore(todayBeijing, 30);
  const newEntries = (selection.items || []).map((it) => ({
    key: itemKey({ url: it.source?.url, title: it.title }),
    title: it.title,
    topic: it.topic,
    date: targetDate,
  })).filter((e) => e.key);
  const merged = [...newEntries, ...(historyEntries.entries || [])];
  const byKey = new Map();
  for (const e of merged) {
    if (!byKey.has(e.key)) byKey.set(e.key, e);
  }
  const pruned = [...byKey.values()].filter((e) => !e.date || e.date >= cutoffDate).slice(0, 500);
  writeJson(path.join(siteDir, 'history.json'), { entries: pruned, updatedAt: new Date().toISOString() });

  // 8. 推送（离线/试运行跳过；订阅里还有无效端点时清理）
  let pushResult = { sent: 0, note: 'skipped' };
  if (!offline && !dryRun) {
    const vapid = {
      publicKey: config.vapid?.publicKey,
      privateKey: process.env.VAPID_PRIVATE_KEY,
      subject: process.env.VAPID_SUBJECT,
    };
    const payload = {
      title: `每日简报 · ${label}`,
      body: `${selection.items.length} 条精选已生成（AI/科技/教育与就业），点按查看`,
      url: `./?date=${targetDate}`,
      tag: 'daily-brief',
      date: targetDate,
    };
    pushResult = await sendDigestNotification(subscriptions, payload, vapid);
    if (pushResult.pruned?.length) {
      const keep = subscriptions.filter((s) => !pushResult.pruned.includes(s.endpoint));
      writeJson(path.join(siteDir, 'subscriptions.json'), keep);
      console.log(`[push] 清理失效订阅 ${pushResult.pruned.length} 条`);
    }
  }

  // 9. git 提交（离线/试运行跳过）
  let gitResult = 'skipped';
  if (!offline && !dryRun) {
    gitResult = await commitAndPush(`简报 ${label}（${selection.items.length} 条）`);
  }

  const summary = {
    date: targetDate,
    generatedAt: digest.generatedAt,
    candidates: candidates.length,
    afterDedup: fresh.length,
    selected: selection.items.length,
    degraded: digest.degraded,
    push: pushResult,
    git: gitResult,
    feedErrors: feedErrors.slice(0, 8),
    durationMs: Date.now() - t0,
  };
  console.log('[digest] 完成：' + JSON.stringify(summary, null, 2));
  return summary;
}

// ---------------- CLI 入口 ----------------
const args = process.argv.slice(2);
const isCli = args.includes('--cli') || process.argv[1]?.endsWith('digest.mjs') || process.argv[1]?.endsWith('digest');
if (isCli) {
  const offline = args.includes('--offline');
  const dryRun = args.includes('--dry-run');
  const dateIdx = args.indexOf('--date');
  const dateOverride = dateIdx >= 0 ? args[dateIdx + 1] : null;
  try {
    const summary = await runDigest({ offline, dryRun, dateOverride });
    process.exit(summary.selected > 0 ? 0 : 1);
  } catch (err) {
    console.error('[digest] 失败：', err);
    process.exit(1);
  }
}
