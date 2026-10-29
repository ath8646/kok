// 홈 위의 터미널 아이콘: 시그니처 테마 '터미널'일 때만 보인다 (skins.css .kok-term-entry). 커서(_)가 깜빡인다
import Link from 'next/link';

export function TerminalEntry() {
  return (
    <Link href="/terminal?from=home" className="kok-term-entry press" aria-label="터미널 열기" title="터미널">
      <svg
        viewBox="0 0 24 24"
        width={20}
        height={20}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M3.5 4.5h17v15h-17zM3.5 8h17M7 11.5l3 2.5-3 2.5" />
        <path className="kok-term-entry-cursor" d="M12.5 16.5H17" />
      </svg>
    </Link>
  );
}
