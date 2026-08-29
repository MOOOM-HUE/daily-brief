// VAPID 密钥对生成（纯 node:crypto，无需任何依赖）
// 输出格式与官方 `npx web-push generate-vapid-keys` 保持一致：
//   publicKey  = base64url(EC P-256 非压缩公钥点, 65 字节)
//   privateKey = base64url(EC P-256 原始私钥标量, 32 字节)
import crypto from 'node:crypto';

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function generateVapidKeys() {
  const curve = crypto.createECDH('prime256v1');
  curve.generateKeys();
  return {
    publicKey: b64url(curve.getPublicKey()),
    privateKey: b64url(curve.getPrivateKey()),
  };
}

// 供主流水线读取（若 site/config.json 已配置公钥，则无需重新生成）
export function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = Buffer.from(base64, 'base64');
  return new Uint8Array(raw);
}
