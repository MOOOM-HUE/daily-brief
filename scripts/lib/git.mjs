// git 自动提交/推送（带 pull --rebase 冲突重试）
import { execFileSync } from 'node:child_process';

function run(args, opts = {}) {
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
  return execFileSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env,
    ...opts,
  });
}

export function gitStatus() {
  try {
    return run(['status', '--porcelain']).trim();
  } catch {
    return '';
  }
}

export function hasChanges() {
  return gitStatus().length > 0;
}

export function currentBranch() {
  try {
    return run(['rev-parse', '--abbrev-ref', 'HEAD']).trim() || 'main';
  } catch {
    return 'main';
  }
}

export function ensureIdentity() {
  try {
    run(['config', 'user.email']);
  } catch {
    run(['config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com']);
  }
  try {
    run(['config', 'user.name']);
  } catch {
    run(['config', 'user.name', 'github-actions[bot]']);
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * 提交并推送所有变更；与远端冲突时 pull --rebase 重试。
 * @returns {Promise<'pushed'|'no-changes'|'skipped'>}
 */
export async function commitAndPush(message, { retries = 3 } = {}) {
  ensureIdentity();
  run(['add', '-A']);
  if (!hasChanges()) return 'no-changes';
  run(['commit', '-m', message]);
  const branch = currentBranch();
  let attempt = 0;
  for (;;) {
    try {
      run(['pull', '--rebase', '--autostash', 'origin', branch]);
      run(['push', 'origin', branch]);
      return 'pushed';
    } catch (err) {
      attempt++;
      if (attempt > retries) {
        console.warn(`[git] 推送重试 ${retries} 次后仍失败：${err.message}`);
        run(['push', 'origin', branch]);
        return 'pushed-with-retry';
      }
      await sleep(2000 * attempt);
    }
  }
}
