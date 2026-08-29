// 离线自测入口：node scripts/dry-run.mjs
// 等价于 node scripts/digest.mjs --dry-run（真实抓取 + LLM，不推送、不提交）
import { runDigest } from './digest.mjs';

const summary = await runDigest({ offline: false, dryRun: true });
console.log('\n试运行完成。请检查 docs/digests/ 与 docs/latest.json 的内容质量。');
process.exit(summary.selected > 0 ? 0 : 1);
