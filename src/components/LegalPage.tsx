import Link from 'next/link';
import type { ReactNode } from 'react';

export function LegalPage({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    <main className="mx-auto grid max-w-2xl gap-6 px-5 pb-16 pt-[calc(24px+env(safe-area-inset-top))]">
      <Link href="/" className="font-display text-3xl text-accent">
        콕
      </Link>
      <header>
        <h1 className="font-display text-3xl">{title}</h1>
        <p className="mt-1 text-sm text-muted">시행일: {updated}</p>
      </header>
      <article className="legal grid gap-5 text-[15px] leading-relaxed">{children}</article>
      <footer className="flex flex-wrap gap-4 border-t border-line pt-4 text-sm text-muted">
        <Link href="/terms">이용약관</Link>
        <Link href="/privacy">개인정보처리방침</Link>
        <Link href="/ai-guide">AI 사용 안내</Link>
      </footer>
    </main>
  );
}

export function Sec({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-2">
      <h2 className="font-display text-xl">{title}</h2>
      {children}
    </section>
  );
}
