// 터미널 하나: 화면의 줄(스크롤백), 앞에 띄운 프로그램(셸 → setting), 묻기(y/N·암호)·편집기(nano) 상태, 명령 기록·탭 채우기.
// 화면(components/terminal/Terminal.tsx)은 이것을 그리고 키를 넘겨주기만 한다. 화면과 상관없는 코드 (시험 term.test.ts)
import { columns } from './text';
import type { Program, TermIO } from './types';

/** 스크롤백 줄 수 (넘으면 오래된 줄부터 버린다) */
export const MAX_LINES = 1500;

export type TermLine = { id: number; text: string };
export type TermAsk = { prompt: string; secret: boolean };
export type TermEdit = { name: string; text: string; save: (text: string) => string | null };

/** 입력 줄과 커서 (탭 채우기·기록의 결과) */
export type InputState = { input: string; cursor: number };

/** 후보들의 같은 앞부분 */
export function commonPrefix(list: string[]): string {
  if (!list.length) return '';
  let p = list[0];
  for (const s of list.slice(1)) {
    let i = 0;
    while (i < p.length && i < s.length && p[i] === s[i]) i++;
    p = p.slice(0, i);
  }
  // 반쪽 글자(서로게이트)로 끝나지 않게
  return /[\ud800-\udbff]$/.test(p) ? p.slice(0, -1) : p;
}

/** 후보 목록에 보일 이름: 경로의 마지막 칸, 역슬래시 풀기 (폴더는 / 를 남긴다) */
function shownName(opt: string): string {
  const dir = opt.endsWith('/');
  const body = dir ? opt.slice(0, -1) : opt;
  let cut = -1;
  for (let i = 0; i < body.length; i++) {
    if (body[i] === '\\') {
      i++;
      continue;
    }
    if (body[i] === '/') cut = i;
  }
  return `${body.slice(cut + 1).replace(/\\(.)/g, '$1')}${dir ? '/' : ''}`;
}

export class TermSession {
  /** 끝난 줄 (ANSI 색 코드가 든 글). id 는 그리기용 열쇠 */
  lines: TermLine[] = [];
  /** 아직 줄바꿈이 오지 않은 마지막 줄 (입력 줄은 이 뒤에 붙는다: echo -n 처럼) */
  open = '';
  readonly stack: Program[];
  /** 명령이 도는 중 (입력 줄을 보이지 않는다) */
  busy = false;
  /** exit: 화면이 터미널을 닫는다 */
  closed = false;
  ask: TermAsk | null = null;
  edit: TermEdit | null = null;
  /** 한 줄에 들어가는 글자 칸 (화면이 잰다) */
  width = 80;
  /** 바뀔 때마다 오른다 (화면이 다시 그린다) */
  version = 0;
  readonly io: TermIO;
  private nextId = 1;
  private askResolve: ((v: string | null) => void) | null = null;
  private editResolve: (() => void) | null = null;
  private ctrl = new AbortController();
  private listeners = new Set<() => void>();
  private histPos: number | null = null;
  private histDraft = '';
  /** 바로 앞의 탭 (같은 줄에서 두 번 누르면 후보 목록) */
  private lastTab: string | null = null;

  constructor(base: Program) {
    this.stack = [base];
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    this.io = {
      print: (s) => this.write(s),
      clear: () => this.clearScreen(),
      ask: (prompt, o) =>
        new Promise<string | null>((resolve) => {
          this.ask = { prompt, secret: !!o?.secret };
          this.askResolve = resolve;
          this.emit();
        }),
      push: (p) => {
        this.stack.push(p);
        this.histPos = null;
        this.emit();
      },
      pop: () => {
        if (this.stack.length > 1) this.stack.pop();
        this.histPos = null;
        this.emit();
      },
      close: () => {
        this.closed = true;
        this.emit();
      },
      edit: (name, text, save) =>
        new Promise<void>((resolve) => {
          this.edit = { name, text, save };
          this.editResolve = resolve;
          this.emit();
        }),
      cols: () => this.width,
      // 지금 명령의 멈춤 신호 (명령마다 새로)
      get signal() {
        return self.ctrl.signal;
      },
    };
  }

  // ------------------------------------------------------------------ 화면이 듣기
  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  getVersion = (): number => this.version;

  private emit() {
    this.version++;
    for (const fn of this.listeners) fn();
  }

  /** 한 줄에 들어가는 글자 칸 (화면이 잴 때마다) */
  setWidth(cols: number): void {
    this.width = Math.max(20, Math.floor(cols));
  }

  get top(): Program {
    return this.stack[this.stack.length - 1];
  }

  /** 입력 줄 앞에 보일 글 (묻는 중이면 그 물음, 명령이 도는 중이면 없음) */
  prompt(): string | null {
    if (this.closed || this.edit) return null;
    if (this.ask) return this.ask.prompt;
    if (this.busy) return null;
    return this.top.prompt();
  }

  /** 창 위 띠의 이름 */
  title(): string {
    return this.top.title();
  }

  // ------------------------------------------------------------------ 글 쓰기
  write(text: string): void {
    if (!text) return;
    const parts = text.replace(/\r\n?/g, '\n').split('\n');
    this.open += parts[0];
    for (let i = 1; i < parts.length; i++) {
      this.lines.push({ id: this.nextId++, text: this.open });
      this.open = parts[i];
    }
    if (this.lines.length > MAX_LINES) this.lines.splice(0, this.lines.length - MAX_LINES);
    this.emit();
  }

  clearScreen(): void {
    this.lines = [];
    this.open = '';
    this.emit();
  }

  /** 지금까지의 화면 글 (시험·복사용, ANSI 그대로) */
  text(): string {
    return [...this.lines.map((l) => l.text), this.open].join('\n');
  }

  // ------------------------------------------------------------------ 입력
  /** Enter: 묻는 중이면 답, 아니면 지금 프로그램에서 실행 */
  async enter(input: string): Promise<void> {
    this.lastTab = null;
    if (this.ask) {
      const a = this.ask;
      const resolve = this.askResolve;
      this.ask = null;
      this.askResolve = null;
      this.write(`${a.prompt}${a.secret ? '' : input}\n`);
      resolve?.(input);
      return;
    }
    if (this.busy || this.closed || this.edit) return;
    const p = this.top;
    this.histPos = null;
    this.write(`${p.prompt()}${input}\n`);
    await this.runIn(p, input);
  }

  private async runIn(p: Program, line: string): Promise<void> {
    this.busy = true;
    this.ctrl = new AbortController();
    this.emit();
    try {
      await p.run(line, this.io);
    } catch (e) {
      this.write(`${p === this.stack[0] ? 'bash' : 'setting'}: ${(e as Error)?.message ?? String(e)}\n`);
    } finally {
      this.busy = false;
      this.emit();
    }
  }

  /** Ctrl+C: 묻는 중이면 그만두기, 명령이 도는 중이면 멈추기, 아니면 지금 줄을 버리고 새 줄 */
  interrupt(input: string): void {
    this.lastTab = null;
    if (this.ask) {
      const a = this.ask;
      const resolve = this.askResolve;
      this.ask = null;
      this.askResolve = null;
      this.write(`${a.prompt}${a.secret ? '' : input}^C\n`);
      this.ctrl.abort();
      resolve?.(null);
      return;
    }
    if (this.closed || this.edit) return;
    if (this.busy) {
      this.write('^C\n');
      this.ctrl.abort();
      return;
    }
    this.histPos = null;
    this.write(`${this.top.prompt()}${input}^C\n`);
  }

  /** Ctrl+D (빈 줄에서): 셸이면 로그아웃, setting 이면 나가기 (exit 와 같다, 기록에는 남기지 않는다) */
  async eof(): Promise<void> {
    if (this.ask) {
      this.interrupt('');
      return;
    }
    if (this.busy || this.closed || this.edit) return;
    const p = this.top;
    this.histPos = null;
    this.write(`${p.prompt()}\n`);
    const before = p.history.length;
    await this.runIn(p, 'exit');
    if (p.history.length > before && p.history[p.history.length - 1] === 'exit') p.history.pop();
  }

  /** nano 를 닫는다 (저장은 편집기가 edit.save 로 이미 했다) */
  finishEdit(): void {
    const resolve = this.editResolve;
    this.edit = null;
    this.editResolve = null;
    this.emit();
    resolve?.();
  }

  // ------------------------------------------------------------------ 기록 (↑ ↓)
  historyUp(current: string): string | null {
    if (this.ask || this.busy || this.edit) return null;
    const h = this.top.history;
    if (!h.length) return null;
    if (this.histPos === null) {
      this.histDraft = current;
      this.histPos = h.length;
    }
    if (this.histPos <= 0) return null;
    this.histPos--;
    return h[this.histPos];
  }

  historyDown(): string | null {
    if (this.ask || this.busy || this.edit || this.histPos === null) return null;
    const h = this.top.history;
    this.histPos++;
    if (this.histPos >= h.length) {
      this.histPos = null;
      return this.histDraft;
    }
    return h[this.histPos];
  }

  /** 줄을 직접 고치면 기록 보기를 끝낸다 */
  edited(): void {
    this.histPos = null;
    this.lastTab = null;
  }

  // ------------------------------------------------------------------ 탭
  /** 탭: 하나면 채우고, 여럿이면 같은 앞부분까지, 더 채울 것이 없으면 두 번째 탭에 후보 목록 (bash 처럼). 바꿀 것이 없으면 null */
  complete(input: string, cursor: number): InputState | null {
    if (this.ask || this.busy || this.edit || this.closed) return null;
    const c = this.top.complete(input, cursor);
    if (!c || !c.options.length) {
      this.lastTab = null;
      return null;
    }
    const before = input.slice(0, c.start);
    const after = input.slice(c.end);
    const typed = input.slice(c.start, c.end);
    if (c.options.length === 1) {
      const opt = c.options[0];
      const add = c.space && !after.startsWith(' ') ? ' ' : '';
      this.lastTab = null;
      return { input: before + opt + add + after, cursor: before.length + opt.length + add.length };
    }
    const common = commonPrefix(c.options);
    if (common.length > typed.length) {
      this.lastTab = null;
      return { input: before + common + after, cursor: before.length + common.length };
    }
    const key = `${input}\u0000${cursor}`;
    if (this.lastTab === key) {
      this.write(`${this.top.prompt()}${input}\n${columns(c.options.map(shownName), this.width)}\n`);
      return { input, cursor };
    }
    this.lastTab = key;
    return null;
  }
}
