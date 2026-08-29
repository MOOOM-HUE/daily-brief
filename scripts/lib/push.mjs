// Web Push 发送（基于 web-push 包）与失效订阅清理
// web-push 采用懒加载：仅在真正发送时动态 import，保证离线自测/试运行无需安装依赖。

let configured = false;
let webpush = null;

async function getWebPush() {
  if (!webpush) {
    const mod = await import('web-push');
    webpush = mod.default || mod;
  }
  return webpush;
}

function setupVapid({ publicKey, privateKey, subject }) {
  if (publicKey && privateKey && subject && webpush) {
    webpush.setVapidDetails(subject, publicKey, privateKey);
    configured = true;
    return true;
  }
  configured = false;
  return false;
}

/**
 * 向所有订阅发送一条通知。
 * @param {Array} subscriptions [{endpoint, keys:{p256dh, auth}}]
 * @param {object} payload 会被 JSON 序列化后发给 Service Worker
 * @param {object} vapid {publicKey, privateKey, subject}
 * @returns {{sent:number, failed:number, pruned:string[], note?:string}}
 */
export async function sendDigestNotification(subscriptions, payload, vapid) {
  if (!Array.isArray(subscriptions) || subscriptions.length === 0) {
    return { sent: 0, failed: 0, pruned: [], note: 'no-subscriptions' };
  }
  if (!vapid?.publicKey || !vapid?.privateKey || !vapid?.subject) {
    return { sent: 0, failed: 0, pruned: [], note: 'missing-vapid-config' };
  }
  const wp = await getWebPush();
  if (!setupVapid(vapid)) {
    return { sent: 0, failed: 0, pruned: [], note: 'missing-vapid-config' };
  }
  const results = { sent: 0, failed: 0, pruned: [] };
  for (const sub of subscriptions) {
    if (!sub || !sub.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) {
      results.pruned.push(sub?.endpoint || 'malformed');
      continue;
    }
    try {
      await wp.sendNotification(sub, JSON.stringify(payload), {
        TTL: 24 * 3600,
        urgency: 'high',
      });
      results.sent++;
    } catch (err) {
      const sc = err?.statusCode;
      if (sc === 404 || sc === 410) {
        results.pruned.push(sub.endpoint);
      } else {
        results.failed++;
        console.warn(`[push] 发送失败 (${sc || err.message}): ${String(sub.endpoint).slice(0, 70)}…`);
      }
    }
  }
  return results;
}
