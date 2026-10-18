export const metadata = { title: '인터넷 연결 없음' };

export default function OfflinePage() {
  return (
    <main className="mx-auto grid min-h-dvh max-w-md place-items-center px-6 text-center">
      <div>
        <p className="font-display text-4xl text-accent">콕</p>
        <h1 className="mt-4 font-display text-2xl">인터넷이 끊겼어요</h1>
        <p className="mt-2 text-muted">연결되면 다시 열어 주세요. 오프라인 복습은 다음 버전에서 열려요.</p>
      </div>
    </main>
  );
}
