// 周末深度特刊流水线
//   node scripts/weekly.mjs              —— 完整运行（供 GitHub Actions weekly.yml 使用）
//   node scripts/weekly.mjs --dry-run    —— 本机试运行（真实抓取与 LLM，不推送不提交）
//   node scripts/weekly.mjs --date 2026-01-05 —— 指定日期（默认当天，北京时间）
//
// 环境变量：DEEPSEEK_API_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson, writeJson } from './lib/json.mjs';
import { collectCandidates, TOPICS } from './lib/feeds.mjs';
import { weeklyReview } from './lib/llm.mjs';
import { sendDigestNotification } from './lib/push.mjs';
import { commitAndPush } from './lib/git.mjs';
import { beijingToday } from './digest.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const WEEKLY_DIR = path.join(ROOT, 'docs', 'weekly');

function daysAgo(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d) - n * 86400 * 1000);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

function fmtDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return `${y}年${m}月${d}日`;
}

function fallbackWeekly(candidates) {
  const top = candidates.slice(0, 5);
  const more = candidates.slice(5, 7);
  return {
    overview: '本周 AI/科技/教育动态精选',
    highlights: top.map((c, i) => ({ rank: i + 1, title: c.title, summary: c.snippet || '' })),
    trend: '（降级模式：AI 摘要暂不可用，以下为本周部分候选条目。）',
    outlook: more.map((c) => ({ title: c.title, summary: c.snippet || '' })),
  };
}

export async function runWeekly({ dryRun = false, dateOverride = null } = {}) {
  const t0 = Date.now();
  const targetDate = dateOverride || beijingToday();
  const weekStart = daysAgo(targetDate, 6);
  const label = `${fmtDate(weekStart)} 至 ${fmtDate(targetDate)}`;
  console.log(`[weekly] 特刊日期：${targetDate}（${label}） dryRun=${dryRun}`);

  const config = readJson(path.join(ROOT, 'docs', 'config.json'), {});
  const subscriptions = readJson(path.join(ROOT, 'docs', 'subscriptions.json'), []);
  const existingIndex = readJson(path.join(WEEKLY_DIR, 'index.json'), []);

  // 1. 抓候选（近 7 天，取前 200）
  const { candidates, errors } = await collectCandidates({ offline: false, limit: 200 });
  console.log(`[weekly] 候选 ${candidates.length} 条${errors.length ? `（${errors.length} 个源失败）` : ''}`);
  if (errors.length) console.warn('[weekly] 失败源：\n - ' + errors.join('\n - '));

  // 2. 周报生成
  let review;
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (apiKey) {
    try {
      review = await weeklyReview({ apiKey, model: process.env.LLM_MODEL || 'deepseek-chat', candidates, topics: TOPICS, weekLabel: label });
    } catch (err) {
      console.warn(`[weekly] 周报生成失败，降级：${err.message}`);
      review = fallbackWeekly(candidates);
    }
  } else {
    console.warn('[weekly] 无 DEEPSEEK_API_KEY，降级');
    review = fallbackWeekly(candidates);
  }

  // 3. 组装并写文件
  const weekly = {
    date: targetDate,
    weekStart,
    weekEnd: targetDate,
    generatedAt: new Date().toISOString(),
    model: apiKey ? process.env.LLM_MODEL || 'deepseek-chat' : 'fallback',
    degraded: !apiKey,
    overview: review.overview,
    highlights: review.highlights,
    trend: review.trend,
    outlook: review.outlook,
  };

  writeJson(path.join(WEEKLY_DIR, `${targetDate}.json`), weekly);
  writeJson(path.join(WEEKLY_DIR, 'latest.json'), weekly);
  const newIndex = Array.from(new Set([targetDate, ...existingIndex])).sort().reverse().slice(0, 12);
  writeJson(path.join(WEEKLY_DIR, 'index.json'), newIndex);

  // 4. 推送
  let pushResult = { sent: 0, note: 'skipped' };
  if (!dryRun) {
    pushResult = await sendDigestNotification(subscriptions, {
      title: `周末特刊 · ${fmtDate(targetDate)}`,
      body: `本周热点回顾 + 趋势分析已发布（${review.highlights.length} 个要点）`,
      url: './?weekly=' + targetDate,
      tag: 'daily-brief-weekly',
      date: targetDate,
    }, {
      publicKey: config.vapid?.publicKey,
      privateKey: process.env.VAPID_PRIVATE_KEY,
      subject: process.env.VAPID_SUBJECT,
    });
  }

  // 5. 提交
  let gitResult = 'skipped';
  if (!dryRun) {
    gitResult = await commitAndPush(`周末特刊 ${targetDate}（${review.highlights.length} 个要点）`);
  }

  const summary = { date: targetDate, highlights: review.highlights.length, degraded: weekly.degraded, push: pushResult, git: gitResult, durationMs: Date.now() - t0 };
  console.log('[weekly] 完成：' + JSON.stringify(summary, null, 2));
  return summary;
}

// CLI 入口
const args = process.argv.slice(2);
const isCli = process.argv[1]?.endsWith('weekly.mjs');
if (isCli) {
  const dryRun = args.includes('--dry-run');
  const dateIdx = args.indexOf('--date');
  const dateOverride = dateIdx >= 0 ? args[dateIdx + 1] : null;
  try {
    const s = await runWeekly({ dryRun, dateOverride });
    process.exit(s.highlights > 0 ? 0 : 1);
  } catch (err) {
    console.error('[weekly] 失败：', err);
    process.exit(1);
  }
}
