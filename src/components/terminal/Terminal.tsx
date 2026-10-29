'use client';
// 터미널 창 (시그니처 테마 '터미널'의 숨은 화면): 리눅스 셸처럼 쓰고, ~/setting 을 실행하면 KOK 자료·복습 데이터를 명령어로 관리한다.
// 셸·파일·setting 은 lib/term (화면과 상관없는 코드), 이 파일은 그리기와 키만. 파일·명령 기록은 이 기기에만 (localStorage)
import { useRouter } from 'next/navigation';
import {
  Fragment,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ClipboardEvent,
  type CSSProperties,
  type KeyboardEvent,
} from 'react';
import { gridParts, parseAnsi, type AnsiStyle } from '@/lib/term/ansi';
import { bootTerminal, readSaved, type Booted } from '@/lib/term/boot';
import { userName } from '@/lib/term/files';
import { loadSkinFont } from '@/lib/theme';
import type { MeResponse } from '@/lib/types';
import { cx } from '@/components/ui';
import { makeKokApi } from './kok-api';
import { Nano } from './Nano';

/** 이 기기에 남기는 이름 (계정마다) */
const storeKey = (userId: string) => `kok:term:v1:${userId}`;

function readStore(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeStore(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // 저장할 수 없으면 이번에만 (사생활 보호 모드 등)
  }
}

// ------------------------------------------------------------------ ANSI 색 → 테마 색 (skins.css 의 --t-0 … --t-7)
function styleOf(st: AnsiStyle): CSSProperties | undefined {
  const fg = st.fg !== null ? `var(--t-${st.fg % 8})` : st.dim ? 'var(--muted)' : null;
  const bg = st.bg !== null ? `var(--t-${st.bg % 8})` : null;
  const s: CSSProperties = {};
  if (st.inverse) {
    s.background = fg ?? 'var(--term-fg)';
    s.color = bg ?? 'var(--term-bg)';
  } else {
    if (fg) s.color = fg;
    if (bg) {
      s.background = bg;
      // 바탕을 칠한 칸의 글자는 터미널 바탕색 (neofetch 색 칸 등)
      if (!fg) s.color = 'var(--term-bg)';
    }
  }
  if (st.bold) s.fontWeight = 700;
  if (st.italic) s.fontStyle = 'italic';
  if (st.underline) s.textDecoration = 'underline';
  return Object.keys(s).length ? s : undefined;
}

/** 글자 칸 맞추기: 칸에 딱 맞지 않는 기호(·★─ 등)는 그 칸 수의 상자 가운데에 (ls·tree·표의 열이 어긋나지 않게) */
const GridText = memo(function GridText({ text }: { text: string }) {
  const parts = useMemo(() => gridParts(text), [text]);
  return (
    <>
      {parts.map((p, i) =>
        p.cells ? (
          <span key={i} className={p.cells === 2 ? 'kok-term-g2' : 'kok-term-g1'}>
            {p.text}
          </span>
        ) : (
          <Fragment key={i}>{p.text}</Fragment>
        ),
      )}
    </>
  );
});

const AnsiText = memo(function AnsiText({ text }: { text: string }) {
  const spans = useMemo(() => parseAnsi(text), [text]);
  return (
    <>
      {spans.map((s, i) => {
        const st = styleOf(s.style);
        return st ? (
          <span key={i} style={st}>
            <GridText text={s.text} />
          </span>
        ) : (
          <GridText key={i} text={s.text} />
        );
      })}
    </>
  );
});

const Line = memo(function Line({ text }: { text: string }) {
  return <div className="kok-term-line">{text ? <AnsiText text={text} /> : null}</div>;
});

/** 입력 줄의 글과 커서 (커서 밑 글자는 커서 안에: 한글은 두 칸짜리 커서) */
function Echo({ value, cursor, hidden, focused, tick }: { value: string; cursor: number; hidden: boolean; focused: boolean; tick: number }) {
  const shownValue = hidden ? '' : value;
  const at = Math.min(hidden ? 0 : cursor, shownValue.length);
  const rest = shownValue.slice(at);
  const ch = rest ? String.fromCodePoint(rest.codePointAt(0)!) : ' ';
  const box = gridParts(ch)[0]?.cells ?? 0;
  return (
    <>
      <GridText text={shownValue.slice(0, at)} />
      {/* 칠 때마다 커서가 다시 켜진 채로 깜빡이기 시작한다 (key) */}
      <span key={tick} className={cx('kok-term-cursor', !focused && 'is-idle', box === 1 && 'kok-term-g1', box === 2 && 'kok-term-g2')} data-ch={ch}>
        {ch}
      </span>
      <GridText text={rest.slice(rest ? ch.length : 0)} />
    </>
  );
}

// ------------------------------------------------------------------ 폰: 키보드가 열려도 창이 보이는 곳에 (visualViewport)
function useViewport(): { height: number; top: number } | null {
  const [vp, setVp] = useState<{ height: number; top: number } | null>(null);
  useEffect(() => {
    const v = window.visualViewport;
    if (!v) return;
    const update = () => setVp({ height: Math.round(v.height), top: Math.round(v.offsetTop) });
    update();
    v.addEventListener('resize', update);
    v.addEventListener('scroll', update);
    return () => {
      v.removeEventListener('resize', update);
      v.removeEventListener('scroll', update);
    };
  }, []);
  return vp;
}

/** 폰 키보드 위의 단추 줄 (Termux 처럼): TAB, CTRL(다음 글자와 함께), 화살표, 자주 쓰는 기호 */
const EXTRA_KEYS = ['Tab', 'Ctrl', '←', '↑', '↓', '→', '-', '/', '|', '~', '*', '>'] as const;
type ExtraKey = (typeof EXTRA_KEYS)[number];
const EXTRA_NAME: Partial<Record<ExtraKey, string>> = {
  '←': '왼쪽',
  '↑': '이전 명령',
  '↓': '다음 명령',
  '→': '오른쪽',
  Tab: '탭: 이름 채우기',
  Ctrl: '컨트롤',
};

/**
 * 터미널 하나와 저장: 화면 밖의 물건이라 React 상태가 아닌 이 안에서 바뀐다 (계정의 최신 정보·저장 타이머).
 * 파일·기록이 바뀌면 0.4초 뒤에, 떠날 때는 바로 저장한다
 */
class TermHost {
  readonly booted: Booted;
  private key: string;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private me: MeResponse;
  private refreshMe: () => Promise<void>;

  constructor(me: MeResponse, refreshMe: () => Promise<void>) {
    this.me = me;
    this.refreshMe = refreshMe;
    this.key = storeKey(me.userId);
    this.booted = bootTerminal({
      user: userName(me.nickname),
      saved: readSaved(readStore(this.key)),
      // setting 을 처음 실행할 때 만든다 (그때의 계정 정보로)
      api: () => makeKokApi(this.me, this.refreshMe),
      onChange: () => this.schedule(),
    });
  }

  /** 화면이 받은 최신 계정 정보 (설정을 바꾼 뒤 등) */
  update(me: MeResponse, refreshMe: () => Promise<void>) {
    this.me = me;
    this.refreshMe = refreshMe;
  }

  private schedule() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 400);
  }

  flush() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    writeStore(this.key, JSON.stringify(this.booted.snapshot()));
  }
}

export function Terminal({ me, refreshMe }: { me: MeResponse; refreshMe: () => Promise<void> }) {
  const router = useRouter();
  // 터미널 하나 (처음 그릴 때 만든다: 저장해 둔 파일·기록으로)
  const [host] = useState(() => new TermHost(me, refreshMe));
  useEffect(() => {
    host.update(me, refreshMe);
  }, [host, me, refreshMe]);
  const booted = host.booted;
  const session = booted.session;
  const version = useSyncExternalStore(session.subscribe, session.getVersion, session.getVersion);
  const flush = useCallback(() => host.flush(), [host]);

  const screenRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const stick = useRef(true);
  const [input, setInput] = useState('');
  const [cursor, setCursor] = useState(0);
  const [tick, setTick] = useState(0);
  const [focused, setFocused] = useState(false);
  const [maxed, setMaxed] = useState(false);
  const [ctrl, setCtrl] = useState(false);
  const ctrlRef = useRef(false);
  const armCtrl = (on: boolean) => {
    ctrlRef.current = on;
    setCtrl(on);
  };
  const vp = useViewport();

  // 처음: 글꼴, 인사와 ~/.bashrc (한 번만)
  const started = useRef(false);
  useEffect(() => {
    loadSkinFont('terminal');
    if (started.current) return;
    started.current = true;
    void booted.start();
  }, [booted]);

  // 떠날 때·화면을 숨길 때 저장
  useEffect(() => {
    const onHide = () => flush();
    window.addEventListener('pagehide', onHide);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('pagehide', onHide);
      document.removeEventListener('visibilitychange', onHide);
      flush();
    };
  }, [flush]);

  const leave = useCallback(() => {
    flush();
    // 홈의 터미널 아이콘으로 들어왔으면 뒤로 (보던 홈이 그대로), 주소로 바로 들어왔으면 홈으로
    if (new URLSearchParams(window.location.search).get('from') === 'home') router.back();
    else router.replace('/home');
  }, [flush, router]);

  // exit: 'logout' 을 잠깐 보이고 창을 닫는다
  const closed = session.closed;
  useEffect(() => {
    if (!closed) return;
    const t = setTimeout(leave, 160);
    return () => clearTimeout(t);
  }, [closed, leave]);

  // 브라우저 탭 이름도 터미널 창 제목처럼 (나가면 되돌린다)
  const windowTitle = session.title();
  useEffect(() => {
    const before = document.title;
    document.title = windowTitle;
    return () => {
      document.title = before;
    };
  }, [windowTitle]);

  // 한 줄에 들어가는 글자 칸 (ls 의 열, 표)
  useEffect(() => {
    const screen = screenRef.current;
    const m = measureRef.current;
    if (!screen || !m) return;
    const measure = () => {
      const cw = m.getBoundingClientRect().width / 10;
      const style = getComputedStyle(screen);
      const inner = screen.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      if (cw > 0) session.setWidth(inner / cw);
      // 폰 키보드가 열려 창이 줄어도 입력 줄이 보이게
      if (stick.current) screen.scrollTop = screen.scrollHeight;
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(screen);
    void document.fonts?.ready.then(measure);
    return () => ro.disconnect();
  }, [session]);

  // 새 글이 오면 맨 아래로 (위로 올려 보고 있으면 그대로)
  useLayoutEffect(() => {
    const el = screenRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [version, input]);

  const focusInput = useCallback(() => {
    // 글을 고르는 중이면 (복사하려고) 그대로 둔다
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed && sel.toString()) return;
    inputRef.current?.focus({ preventScroll: true });
  }, []);

  // 처음 열 때 입력 칸에 (컴퓨터: 바로 칠 수 있게. 폰은 누르면 키보드가 뜬다)
  useEffect(() => {
    if (window.matchMedia('(pointer: fine)').matches) inputRef.current?.focus({ preventScroll: true });
  }, []);
  // nano 를 닫으면 다시 입력 칸으로
  const editing = session.edit;
  useEffect(() => {
    if (!editing) inputRef.current?.focus({ preventScroll: true });
  }, [editing]);

  const sync = () => {
    const el = inputRef.current;
    if (!el) return;
    setInput(el.value);
    setCursor(el.selectionStart ?? el.value.length);
    setTick((t) => t + 1);
  };
  const setLine = (v: string, c = v.length) => {
    const el = inputRef.current;
    if (!el) return;
    el.value = v;
    el.setSelectionRange(c, c);
    setInput(v);
    setCursor(c);
    setTick((t) => t + 1);
  };

  const submit = () => {
    const el = inputRef.current;
    if (!el) return;
    // 명령이 도는 동안 친 글은 남겨 둔다 (끝나면 이어서 칠 수 있게)
    if (session.busy && !session.ask) return;
    const v = el.value;
    setLine('');
    stick.current = true;
    void session.enter(v);
  };

  /** CTRL 과 글자 하나 (키보드의 Ctrl, 폰의 CTRL 단추) */
  const ctrlKey = (k: string): boolean => {
    const el = inputRef.current;
    if (!el) return false;
    const v = el.value;
    const pos = el.selectionStart ?? v.length;
    switch (k) {
      case 'c':
        session.interrupt(session.ask?.secret ? '' : v);
        setLine('');
        stick.current = true;
        return true;
      case 'd':
        if (!v) void session.eof();
        else setLine(v.slice(0, pos) + v.slice(pos + 1), pos);
        return true;
      case 'l':
        session.clearScreen();
        return true;
      case 'a':
        setLine(v, 0);
        return true;
      case 'e':
        setLine(v, v.length);
        return true;
      case 'u':
        setLine(v.slice(pos), 0);
        session.edited();
        return true;
      case 'k':
        setLine(v.slice(0, pos), pos);
        session.edited();
        return true;
      case 'w': {
        const before = v.slice(0, pos).replace(/\S+\s*$/, '');
        setLine(before + v.slice(pos), before.length);
        session.edited();
        return true;
      }
      default:
        return false;
    }
  };

  const tab = () => {
    const el = inputRef.current;
    if (!el) return;
    const r = session.complete(el.value, el.selectionStart ?? el.value.length);
    if (r) setLine(r.input, r.cursor);
  };
  const history = (up: boolean) => {
    const el = inputRef.current;
    if (!el) return;
    const v = up ? session.historyUp(el.value) : session.historyDown();
    if (v !== null) setLine(v);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      submit();
    } else if (e.key === 'Tab') {
      e.preventDefault();
      tab();
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      history(e.key === 'ArrowUp');
    } else if (e.ctrlKey && !e.altKey && !e.metaKey && e.key.length === 1) {
      const k = e.key.toLowerCase();
      // Ctrl+C: 고른 글이 있으면 그냥 복사
      if (k === 'c' && window.getSelection()?.toString()) return;
      if (ctrlKey(k)) e.preventDefault();
    }
  };

  // 폰의 CTRL 단추를 눌러 둔 뒤 친 글자
  const onBeforeInput = (e: { data: string | null; preventDefault: () => void }) => {
    if (!ctrlRef.current || !e.data) return;
    e.preventDefault();
    armCtrl(false);
    ctrlKey(e.data.toLowerCase());
  };

  /** nano 가 열려 있을 때의 키 줄: 탭·기호는 글 칸에 넣고, 화살표는 커서를 옮긴다 */
  const nanoKey = (k: ExtraKey) => {
    const ta = document.querySelector<HTMLTextAreaElement>('.kok-nano-area');
    if (!ta) return;
    ta.focus({ preventScroll: true });
    const v = ta.value;
    const pos = ta.selectionStart;
    if (k === '←' || k === '→') {
      const p = Math.max(0, Math.min(v.length, pos + (k === '←' ? -1 : 1)));
      ta.setSelectionRange(p, p);
    } else if (k === '↑' || k === '↓') {
      // 윗줄·아랫줄의 같은 칸으로 (줄이 짧으면 그 줄 끝)
      const start = v.lastIndexOf('\n', pos - 1) + 1;
      const col = pos - start;
      let p = pos;
      if (k === '↑' && start > 0) {
        const prev = v.lastIndexOf('\n', start - 2) + 1;
        p = Math.min(prev + col, start - 1);
      } else if (k === '↓') {
        const end = v.indexOf('\n', pos);
        if (end >= 0) {
          const nextEnd = v.indexOf('\n', end + 1);
          p = Math.min(end + 1 + col, nextEnd < 0 ? v.length : nextEnd);
        }
      }
      ta.setSelectionRange(p, p);
    } else {
      ta.setRangeText(k === 'Tab' ? '\t' : k, ta.selectionStart, ta.selectionEnd, 'end');
      // nano 가 '수정됨'을 알게 (React 는 input 이벤트로 듣는다)
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    }
  };

  // 여러 줄을 붙여 넣으면 한 줄씩 실행 (터미널처럼)
  const pasted = useRef<string[]>([]);
  const draining = useRef(false);
  const drain = async () => {
    if (draining.current) return;
    draining.current = true;
    while (pasted.current.length) {
      // 앞 명령이 끝날 때까지 (묻는 중이면 그 답으로)
      while (session.busy && !session.ask) await new Promise((r) => setTimeout(r, 30));
      if (session.closed) break;
      const next = pasted.current.shift()!;
      stick.current = true;
      await session.enter(next);
    }
    draining.current = false;
  };
  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData('text');
    if (!/[\r\n]/.test(text)) return;
    e.preventDefault();
    const el = e.currentTarget;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? start;
    const all = el.value.slice(0, start) + text + el.value.slice(end);
    const lines = all.split(/\r?\n/);
    const last = lines.pop() ?? '';
    setLine(last);
    pasted.current.push(...lines);
    void drain();
  };

  const extra = (k: ExtraKey) => {
    const el = inputRef.current;
    if (k === 'Ctrl') {
      armCtrl(!ctrlRef.current);
      return;
    }
    if (session.edit) {
      nanoKey(k);
      return;
    }
    if (!el) return;
    el.focus({ preventScroll: true });
    if (k === 'Tab') tab();
    else if (k === '↑' || k === '↓') history(k === '↑');
    else if (k === '←' || k === '→') {
      const pos = el.selectionStart ?? el.value.length;
      setLine(el.value, Math.max(0, Math.min(el.value.length, pos + (k === '←' ? -1 : 1))));
    } else {
      const start = el.selectionStart ?? el.value.length;
      const end = el.selectionEnd ?? start;
      el.setRangeText(k, start, end, 'end');
      session.edited();
      sync();
    }
  };

  const prompt = session.prompt();
  const ask = session.ask;
  const title = session.title();
  const toggleMax = () => {
    setMaxed((m) => !m);
    inputRef.current?.focus({ preventScroll: true });
  };

  return (
    <div
      className={cx('kok-term', maxed && 'is-max')}
      // 폰에서 키보드가 열리면 보이는 곳(visualViewport)만 쓴다
      style={vp ? ({ '--vv-h': `${vp.height}px`, '--vv-top': `${vp.top}px` } as CSSProperties) : undefined}
    >
      <section className="kok-term-win" aria-label="터미널">
        <header className="kok-term-bar" onDoubleClick={toggleMax}>
          <span className="kok-term-bar-side" aria-hidden="true" />
          <h1 className="kok-term-title">{title}</h1>
          <div className="kok-term-btns">
            <button type="button" className="kok-term-btn kok-term-desk" aria-label="최소화" onClick={leave}>
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M4 8.5h8" />
              </svg>
            </button>
            <button
              type="button"
              className="kok-term-btn kok-term-desk"
              aria-label={maxed ? '창 크기 되돌리기' : '최대화'}
              aria-pressed={maxed}
              onClick={toggleMax}
            >
              <svg viewBox="0 0 16 16" aria-hidden="true">
                {maxed ? <path d="M5.5 4.5h6v6M4.5 6.5h5v5h-5z" /> : <path d="M4.5 4.5h7v7h-7z" />}
              </svg>
            </button>
            <button type="button" className="kok-term-btn is-close" aria-label="터미널 닫기" onClick={leave}>
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M5 5l6 6M11 5l-6 6" />
              </svg>
            </button>
          </div>
        </header>

        <div className="kok-term-body">
          <div
            ref={screenRef}
            className="kok-term-screen"
            onScroll={(e) => {
              const el = e.currentTarget;
              stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 32;
            }}
            onClick={focusInput}
          >
            <div role="log" aria-label="터미널 출력">
              {session.lines.map((l) => (
                <Line key={l.id} text={l.text} />
              ))}
            </div>
            <div className="kok-term-line kok-term-live">
              <AnsiText text={session.open} />
              {prompt !== null ? (
                <>
                  <AnsiText text={prompt} />
                  <Echo value={input} cursor={cursor} hidden={!!ask?.secret} focused={focused} tick={tick} />
                </>
              ) : !closed && !editing ? (
                // 명령이 도는 동안: 출력 끝의 커서
                <span className={cx('kok-term-cursor', !focused && 'is-idle')} data-ch=" ">
                  {' '}
                </span>
              ) : null}
              {/* 폰 키보드의 Enter 가 keydown 으로 오지 않을 때도 (한 칸짜리 form 의 제출) */}
              <form
                className="contents"
                onSubmit={(e) => {
                  e.preventDefault();
                  submit();
                }}
              >
                <input
                  ref={inputRef}
                  className="kok-term-input"
                  type="text"
                  aria-label={ask ? ask.prompt.trim() : '명령 입력'}
                  autoComplete="off"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  enterKeyHint="enter"
                  disabled={closed}
                  onKeyDown={onKeyDown}
                  onBeforeInput={onBeforeInput}
                  onInput={() => {
                    session.edited();
                    sync();
                  }}
                  onSelect={sync}
                  onPaste={onPaste}
                  onFocus={() => setFocused(true)}
                  onBlur={() => setFocused(false)}
                />
              </form>
            </div>
            {/* 글자 칸 너비 재기 */}
            <span ref={measureRef} className="kok-term-measure" aria-hidden="true">
              0000000000
            </span>
          </div>
          {editing ? <Nano edit={editing} onDone={() => session.finishEdit()} ctrlArmed={ctrl} disarmCtrl={() => armCtrl(false)} /> : null}
        </div>

        <div className="kok-term-keys" role="toolbar" aria-label="터미널 키">
          {EXTRA_KEYS.map((k) => (
            <button
              key={k}
              type="button"
              className={cx('kok-term-key', k === 'Ctrl' && ctrl && 'is-on')}
              aria-pressed={k === 'Ctrl' ? ctrl : undefined}
              aria-label={EXTRA_NAME[k] ?? k}
              // 누를 때 입력 칸의 커서(키보드)를 잃지 않게
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => extra(k)}
            >
              {k === 'Ctrl' ? 'CTRL' : k === 'Tab' ? 'TAB' : k}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
