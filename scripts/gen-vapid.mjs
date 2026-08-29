// 生成 VAPID 密钥对（纯 node:crypto，无依赖）
// 输出与官方 `npx web-push generate-vapid-keys` 兼容的 base64url 格式。
// 用法：node scripts/gen-vapid.mjs
import { generateVapidKeys } from './lib/vapid.mjs';

const keys = generateVapidKeys();
console.log('==== VAPID 密钥对（请妥善保管私钥）====');
console.log(`publicKey:\n${keys.publicKey}`);
console.log(`privateKey:\n${keys.privateKey}`);
console.log('\n部署指引：');
console.log('1. 把 publicKey 填入 docs/config.json 的 vapid.publicKey 并提交仓库；');
console.log('2. 把 privateKey 添加到 GitHub 仓库 Secret：VAPID_PRIVATE_KEY；');
console.log('3. 再添加 Secret：VAPID_SUBJECT（形如 mailto:you@example.com）。');
console.log('\n若推送时报"密钥格式错误"，请改用官方命令重新生成：npx web-push generate-vapid-keys');
