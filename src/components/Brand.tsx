// KOK 브랜드: 앱 아이콘(인디고 그라데이션 위 흰 K 와 라임 점)과 글자 KOK.
// 아이콘 원본은 tools/icons/icon.svg (앱 아이콘 파일은 tools/icons/build.mjs 로 만든다). 여기는 화면에 쓰는 같은 모양이다.
// 테마와 상관없이 늘 같은 색 (브랜드). 서버 화면에서도 쓰게 훅도 'use client' 모듈도 쓰지 않는다 (그라데이션은 CSS 로).
const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ');

export const BRAND = { from: '#8f7dff', to: '#4b33ea', dot: '#c9ff4f' } as const;

/** 앱 아이콘 모양 (둥근 네모). size 는 px */
export function BrandMark({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cx('relative inline-block shrink-0 overflow-hidden', className)}
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.2237,
        background: `radial-gradient(90% 90% at 30% 8%, rgba(255, 255, 255, 0.28), transparent 55%), linear-gradient(135deg, ${BRAND.from}, ${BRAND.to})`,
      }}
    >
      <svg viewBox="0 0 1024 1024" width={size} height={size} className="absolute inset-0">
        <g transform="translate(-44 0)">
          <g fill="none" stroke="#ffffff" strokeWidth={116} strokeLinecap="round" strokeLinejoin="round">
            <path d="M372 300V724" />
            <path d="M648 300L430 512L656 724" />
          </g>
          <circle cx={790} cy={668} r={62} fill={BRAND.dot} />
        </g>
      </svg>
    </span>
  );
}

/** 아이콘 + 글자 KOK (화면 왼쪽 위 메뉴 등). 글자 크기는 className 으로 */
export function Wordmark({ mark = 28, className }: { mark?: number; className?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-2 text-2xl', className)}>
      <BrandMark size={mark} />
      <span className="font-black leading-none tracking-[-0.03em] text-ink">KOK</span>
    </span>
  );
}
