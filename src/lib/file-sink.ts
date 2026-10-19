// 화면 위에 열린 창(채팅 등)이 파일을 받겠다고 하면, 끌어다 놓기·붙여 넣기한 파일을 자료 넣기 대신 그 창에 준다.
// 가장 나중에 연 창이 먼저 받는다 (QuickAdd 가 이것부터 본다)
type Sink = (files: File[]) => void;

const sinks: Sink[] = [];

/** 파일 받기 시작 → 그만 받는 함수 */
export function pushFileSink(sink: Sink): () => void {
  sinks.push(sink);
  return () => {
    const i = sinks.lastIndexOf(sink);
    if (i >= 0) sinks.splice(i, 1);
  };
}

/** 지금 파일을 받을 창 (없으면 null) */
export function topFileSink(): Sink | null {
  return sinks.length ? sinks[sinks.length - 1] : null;
}
