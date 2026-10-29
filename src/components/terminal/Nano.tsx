'use client';
// 터미널의 nano 편집기 (작은 부분): ^O 쓰기, ^X 나가기(고쳤으면 저장할지 묻기), ^K 줄 잘라내기, ^U 붙여넣기, ^C 위치, ^G 도움말.
// 쓰기는 edit.save 가 바로 파일에 한다 (lib/term/commands.ts 의 nano). 글 칸은 한글 입력이 깨지지 않게 제어하지 않는 textarea
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { TermEdit } from '@/lib/term/session';

type Prompt = { kind: 'write' } | { kind: 'exit' };

/** nano 의 단축키 (아래 두 줄): 누를 수도 있다 (폰) */
const KEYS: Array<{ key: string; label: string; act: Act }> = [
  { key: '^G', label: '도움말', act: 'help' },
  { key: '^O', label: '쓰기', act: 'write' },
  { key: '^K', label: '잘라내기', act: 'cut' },
  { key: '^X', label: '나가기', act: 'exit' },
  { key: '^C', label: '위치', act: 'where' },
  { key: '^U', label: '붙여넣기', act: 'paste' },
];
type Act = 'help' | 'write' | 'cut' | 'exit' | 'where' | 'paste';

const lineCount = (t: string) => (t ? t.split('\n').length - (t.endsWith('\n') ? 1 : 0) : 0);

export function Nano({
  edit,
  onDone,
  ctrlArmed,
  disarmCtrl,
}: {
  edit: TermEdit;
  onDone: () => void;
  /** 폰의 CTRL 단추를 눌러 둔 상태: 다음 글자를 ^글자로 */
  ctrlArmed: boolean;
  disarmCtrl: () => void;
}) {
  const area = useRef<HTMLTextAreaElement>(null);
  const [modified, setModified] = useState(false);
  const [status, setStatus] = useState(() => (edit.text ? `[ ${lineCount(edit.text)}줄 읽음 ]` : '[ 새 파일 ]'));
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const cut = useRef<string>('');
  const promptBtn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(0, 0);
  }, []);

  useEffect(() => {
    if (prompt) promptBtn.current?.focus();
    else area.current?.focus();
  }, [prompt]);

  const write = (): boolean => {
    // nano 처럼 파일 끝은 줄바꿈으로
    const raw = area.current?.value ?? '';
    const text = raw && !raw.endsWith('\n') ? `${raw}\n` : raw;
    const err = edit.save(text);
    if (err) {
      setStatus(`[ ${edit.name} 쓰기 오류: ${err} ]`);
      return false;
    }
    setModified(false);
    setStatus(`[ ${lineCount(text)}줄 씀 ]`);
    return true;
  };

  const act = (a: Act) => {
    const el = area.current;
    if (!el) return;
    if (a === 'help') {
      setStatus('[ ^O 쓰기 · ^X 나가기 · ^K 줄 잘라내기 · ^U 붙여넣기 · ^C 위치 ]');
    } else if (a === 'write') {
      setStatus('');
      setPrompt({ kind: 'write' });
    } else if (a === 'exit') {
      if (modified) {
        setStatus('');
        setPrompt({ kind: 'exit' });
      } else onDone();
    } else if (a === 'where') {
      const v = el.value;
      const pos = el.selectionStart;
      const before = v.slice(0, pos);
      const line = before.split('\n').length;
      const lines = Math.max(1, v.split('\n').length);
      const col = pos - before.lastIndexOf('\n');
      const lineLen = (v.split('\n')[line - 1] ?? '').length + 1;
      const pct = (a2: number, b2: number) => Math.round((a2 / Math.max(1, b2)) * 100);
      setStatus(`[ ${line}/${lines}줄 (${pct(line, lines)}%), ${col}/${lineLen}칸 (${pct(col, lineLen)}%), ${pos}/${v.length}글자 (${pct(pos, v.length)}%) ]`);
    } else if (a === 'cut') {
      // 커서가 있는 줄을 통째로 잘라 둔다 (^U 로 붙인다)
      const v = el.value;
      const pos = el.selectionStart;
      const start = v.lastIndexOf('\n', pos - 1) + 1;
      let end = v.indexOf('\n', pos);
      end = end < 0 ? v.length : end + 1;
      if (start === end) return;
      cut.current = v.slice(start, end);
      el.setRangeText('', start, end, 'start');
      setModified(true);
      setStatus('');
    } else if (a === 'paste') {
      if (!cut.current) return;
      const pos = el.selectionStart;
      const v = el.value;
      const start = v.lastIndexOf('\n', pos - 1) + 1;
      el.setRangeText(cut.current, start, start, 'end');
      setModified(true);
      setStatus('');
    }
  };

  const ctrlKey = (k: string): Act | null => ({ g: 'help', o: 'write', x: 'exit', c: 'where', k: 'cut', u: 'paste' })[k] as Act | null;

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.ctrlKey && !e.altKey && !e.metaKey) {
      const a = ctrlKey(e.key.toLowerCase());
      // ^C 는 고른 글이 있으면 그냥 복사
      if (!a || (a === 'where' && e.currentTarget.selectionStart !== e.currentTarget.selectionEnd)) return;
      e.preventDefault();
      act(a);
    }
  };

  // 폰의 CTRL 단추: 다음에 친 글자를 단축키로
  const onBeforeInput = (e: { data: string | null; preventDefault: () => void }) => {
    if (!ctrlArmed || !e.data) return;
    const a = ctrlKey(e.data.toLowerCase());
    e.preventDefault();
    disarmCtrl();
    if (a) act(a);
  };

  const answer = (k: 'y' | 'n' | 'cancel' | 'ok') => {
    const p = prompt;
    setPrompt(null);
    if (!p || k === 'cancel') {
      setStatus('[ 취소함 ]');
      return;
    }
    if (p.kind === 'write') {
      write();
      return;
    }
    if (k === 'n') onDone();
    else if (write()) onDone();
  };

  const onPromptKey = (e: KeyboardEvent) => {
    const k = e.key.toLowerCase();
    if (e.key === 'Escape' || (e.ctrlKey && k === 'c')) {
      e.preventDefault();
      answer('cancel');
    } else if (prompt?.kind === 'exit' && (k === 'y' || k === 'n')) {
      e.preventDefault();
      answer(k);
    } else if (prompt?.kind === 'write' && e.key === 'Enter') {
      e.preventDefault();
      answer('ok');
    }
  };

  return (
    <div className="kok-nano" role="dialog" aria-label={`nano 편집기: ${edit.name}`}>
      <div className="kok-nano-head">
        <span>GNU nano 7.2</span>
        <span className="kok-nano-file">{edit.name}</span>
        <span>{modified ? '수정됨' : ''}</span>
      </div>
      <textarea
        ref={area}
        className="kok-nano-area"
        defaultValue={edit.text}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        aria-label={`${edit.name} 내용`}
        onInput={() => {
          setModified(true);
          if (status) setStatus('');
        }}
        onKeyDown={onKeyDown}
        onBeforeInput={onBeforeInput}
      />
      {prompt ? (
        <div className="kok-nano-prompt" onKeyDown={onPromptKey}>
          {prompt.kind === 'write' ? (
            <>
              <span className="kok-nano-inv">쓸 파일 이름: {edit.name}</span>
              <div className="kok-nano-choices">
                <button ref={promptBtn} type="button" onClick={() => answer('ok')}>
                  <b>Enter</b> 쓰기
                </button>
                <button type="button" onClick={() => answer('cancel')}>
                  <b>^C</b> 취소
                </button>
              </div>
            </>
          ) : (
            <>
              <span className="kok-nano-inv">수정한 버퍼를 저장할까요?</span>
              <div className="kok-nano-choices">
                <button ref={promptBtn} type="button" onClick={() => answer('y')}>
                  <b>Y</b> 예
                </button>
                <button type="button" onClick={() => answer('n')}>
                  <b>N</b> 아니요
                </button>
                <button type="button" onClick={() => answer('cancel')}>
                  <b>^C</b> 취소
                </button>
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="kok-nano-status" role="status">
          {status ? <span className="kok-nano-inv">{status}</span> : null}
        </div>
      )}
      <div className="kok-nano-keys">
        {KEYS.map((k) => (
          <button
            key={k.key}
            type="button"
            // 누를 때 글 칸의 커서를 잃지 않게
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => act(k.act)}
          >
            <b>{k.key}</b> {k.label}
          </button>
        ))}
      </div>
    </div>
  );
}
