// PWA用アイコン（icon-192.png / icon-512.png）を依存ゼロで生成する。
// 図柄: ダーク背景に道場の鳥居マーク＋緑のアンダーライン（Python道場）。
// 実行方法: build/ ディレクトリで `node make-icons.js`
const zlib = require('zlib');
const fs = require('fs');

// ---- 最小限のPNGエンコーダ（フィルタ0・RGBA） ----
function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8bit RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // フィルタなし
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

// ---- 描画（矩形だけで鳥居を描く） ----
function makeIcon(size) {
  const px = Buffer.alloc(size * size * 4);
  const fill = (x0, y0, x1, y1, r, g, b) => {
    for (let y = Math.round(y0); y < Math.round(y1); y++) {
      for (let x = Math.round(x0); x < Math.round(x1); x++) {
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        const i = (y * size + x) * 4;
        px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = 255;
      }
    }
  };
  const u = size / 100; // 100分率座標
  fill(0, 0, size, size, 15, 17, 23);                 // 背景 #0f1117
  const amber = [232, 163, 61];                       // 鳥居 #e8a33d
  fill(12 * u, 18 * u, 88 * u, 27 * u, ...amber);     // 笠木（上の横梁）
  fill(20 * u, 34 * u, 80 * u, 41 * u, ...amber);     // 貫（下の横梁）
  fill(24 * u, 27 * u, 33 * u, 78 * u, ...amber);     // 左柱
  fill(67 * u, 27 * u, 76 * u, 78 * u, ...amber);     // 右柱
  fill(20 * u, 86 * u, 80 * u, 92 * u, 79, 192, 141); // 緑の下線 #4fc08d（Python緑）
  return encodePng(size, px);
}

for (const size of [192, 512]) {
  fs.writeFileSync(`../docs/icon-${size}.png`, makeIcon(size));
  console.log(`docs/icon-${size}.png を生成しました`);
}
