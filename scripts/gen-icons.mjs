// 生成 PWA 图标（纯 node:zlib 手写 PNG 编码器，无任何依赖）
// 用法：node scripts/gen-icons.mjs
// 产出：docs/icons/icon-192.png、icon-512.png、docs/apple-touch-icon.png(180)
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(__dirname, '..', 'docs', 'icons');

// ---------- 最小 PNG 编码器 ----------
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// ---------- 绘制：深色渐变底 + 简报卡片图形 ----------
function hex(h) {
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}

const lerp = (a, b, t) => Math.round(a + (b - a) * t);

function draw(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const top = hex('#0f172a');
  const bottom = hex('#1e293b');
  const cardBg = hex('#1b2740');
  const bar1 = hex('#f97316');
  const bar2 = hex('#22d3ee');
  const bar3 = hex('#94a3b8');

  const cardX0 = size * 0.14;
  const cardX1 = size * 0.86;
  const cardY0 = size * 0.44;
  const cardY1 = size * 0.88;

  for (let y = 0; y < size; y++) {
    const t = y / size;
    const [r, g, b] = [lerp(top[0], bottom[0], t), lerp(top[1], bottom[1], t), lerp(top[2], bottom[2], t)];
    for (let x = 0; x < size; x++) {
      let cr = r, cg = g, cb = b, ca = 255;
      // 顶部圆点（橙色"太阳"）
      const dx = x - size * 0.3;
      const dy = y - size * 0.24;
      const rr = size * 0.07;
      if (dx * dx + dy * dy <= rr * rr) {
        cr = bar1[0]; cg = bar1[1]; cb = bar1[2];
      }
      // 简报卡片
      if (x >= cardX0 && x <= cardX1 && y >= cardY0 && y <= cardY1) {
        cr = cardBg[0]; cg = cardBg[1]; cb = cardBg[2];
        // 三行"文字"条
        const rows = [
          { x0: cardX0 + size * 0.06, w: size * 0.5, color: bar1 },
          { x0: cardX0 + size * 0.06, w: size * 0.36, color: bar2 },
          { x0: cardX0 + size * 0.06, w: size * 0.24, color: bar3 },
        ];
        const barH = (cardY1 - cardY0) * 0.13;
        const gap = (cardY1 - cardY0) * 0.07;
        rows.forEach((row, i) => {
          const by0 = cardY0 + gap + i * (barH + gap);
          const by1 = by0 + barH;
          if (y >= by0 && y <= by1 && x >= row.x0 && x <= row.x0 + row.w) {
            cr = row.color[0]; cg = row.color[1]; cb = row.color[2];
          }
        });
      }
      const off = (y * size + x) * 4;
      rgba[off] = cr; rgba[off + 1] = cg; rgba[off + 2] = cb; rgba[off + 3] = ca;
    }
  }
  return rgba;
}

if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const targets = [
  [192, 'icon-192.png'],
  [512, 'icon-512.png'],
  [180, 'apple-touch-icon.png'],
];

for (const [size, name] of targets) {
  const rgba = draw(size);
  const png = encodePng(size, size, rgba);
  const file = path.join(outDir, name);
  fs.writeFileSync(file, png);
  console.log(`生成 ${file}（${png.length} 字节）`);
}
