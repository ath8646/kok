import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="mx-auto grid min-h-dvh max-w-md place-items-center px-6 text-center">
      <div className="grid gap-3">
        <p className="font-display text-5xl text-accent">콕</p>
        <h1 className="font-display text-2xl">찾는 화면이 없어요</h1>
        <Link href="/home" className="font-semibold text-accent underline">
          홈으로 가기
        </Link>
      </div>
    </main>
  );
}
