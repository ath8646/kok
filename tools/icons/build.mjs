// KOK 앱 아이콘 만들기: node tools/icons/build.mjs
// 인디고 그라데이션 위에 흰 K 와 콕 찍은 라임 점. 화면 속 같은 모양은 src/components/Brand.tsx (색을 바꾸면 둘 다).
// - tools/icons/icon.svg: 원본 (네모 꽉 채움, 1024)
// - public/icons/icon.svg·icon-192·icon-512: 둥근 네모 (모서리는 투명)
// - public/icons/maskable-512·apple-touch-icon: 꽉 채움 (OS 가 모양을 깎는다. 글자는 가운데 안전 영역 안)
// - src/app/favicon.ico: 16·32·48 둥근 네모
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = fileURLToPath(new URL('../..', import.meta.url));
const BRAND = { from: '#8f7dff', to: '#4b33ea', dot: '#c9ff4f' };

/** 아이콘 SVG. rounded: 둥근 네모(모서리 투명), shadow: 글자 그림자 (작은 크기에서는 뭉개져서 뺀다) */
function iconSvg({ size = 1024, rounded = false, shadow = true } = {}) {
  const r = rounded ? ' rx="229" ry="229"' : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${BRAND.from}"/>
      <stop offset="1" stop-color="${BRAND.to}"/>
    </linearGradient>
    <radialGradient id="hi" cx="0.3" cy="0.08" r="0.9">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.28"/>
      <stop offset="0.55" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
    <filter id="sh" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="18" stdDeviation="22" flood-color="#000000" flood-opacity="0.22"/>
    </filter>
  </defs>
  <rect width="1024" height="1024"${r} fill="url(#bg)"/>
  <rect width="1024" height="1024"${r} fill="url(#hi)"/>
  <g${shadow ? ' filter="url(#sh)"' : ''} transform="translate(-44 0)">
    <g fill="none" stroke="#ffffff" stroke-width="116" stroke-linecap="round" stroke-linejoin="round">
      <path d="M372 300V724"/>
      <path d="M648 300L430 512L656 724"/>
    </g>
    <circle cx="790" cy="668" r="62" fill="${BRAND.dot}"/>
  </g>
</svg>
`;
}

const png = (svg) => sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();

/** PNG 여러 장을 .ico 하나로 */
function ico(images) {
  const head = Buffer.alloc(6);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(images.length, 4);
  const dir = Buffer.alloc(16 * images.length);
  let offset = 6 + dir.length;
  images.forEach(({ size, buf }, i) => {
    const o = i * 16;
    dir.writeUInt8(size >= 256 ? 0 : size, o);
    dir.writeUInt8(size >= 256 ? 0 : size, o + 1);
    dir.writeUInt16LE(1, o + 4);
    dir.writeUInt16LE(32, o + 6);
    dir.writeUInt32LE(buf.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += buf.length;
  });
  return Buffer.concat([head, dir, ...images.map((x) => x.buf)]);
}

writeFileSync(`${root}/tools/icons/icon.svg`, iconSvg());
writeFileSync(`${root}/public/icons/icon.svg`, iconSvg({ size: 512, rounded: true }));
writeFileSync(`${root}/public/icons/icon-192.png`, await png(iconSvg({ size: 192, rounded: true })));
writeFileSync(`${root}/public/icons/icon-512.png`, await png(iconSvg({ size: 512, rounded: true })));
writeFileSync(`${root}/public/icons/maskable-512.png`, await png(iconSvg({ size: 512 })));
writeFileSync(`${root}/public/icons/apple-touch-icon.png`, await png(iconSvg({ size: 180 })));
const fav = [];
for (const size of [16, 32, 48]) fav.push({ size, buf: await png(iconSvg({ size, rounded: true, shadow: false })) });
writeFileSync(`${root}/src/app/favicon.ico`, ico(fav));
console.log('아이콘을 만들었어요');
