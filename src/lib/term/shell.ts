// 리눅스 같은 셸 (bash 의 작은 부분). 명령은 commands.ts, 파일은 vfs.ts, 명령 줄 읽기는 parse.ts.
// setting(KOK 관리 모드)은 이 셸 밖의 프로그램이라 runSetting 으로 띄운다 (셸에서는 KOK 데이터를 보지도 바꾸지도 않는다)
import { COMMANDS, NOT_INSTALLED } from './commands';
import { BIN_COMMANDS, HOST, KOK_SHEBANG, USR_BIN_COMMANDS } from './files';
import { ParseError, expandWord, parse, patternRegex, type Cmd, type Word } from './parse';
import { C, paint } from './text';
import type { Completion, Program, TermIO } from './types';
import { FS_MESSAGE, FsFail, Vfs, basename, byName, dirname, isDir, isExec, normalize } from './vfs';

export type Ctx = {
  sh: Shell;
  io: TermIO;
  /** 명령 이름 (argv[0]) */
  name: string;
  args: string[];
  stdin: string;
  out: (s: string) => void;
  err: (s: string) => void;
};
export type Builtin = (c: Ctx) => number | Promise<number>;

export type ShellOptions = {
  user: string;
  fs: Vfs;
  history?: string[];
  aliases?: Record<string, string>;
  now?: () => number;
  /** 지난번에 연 때 (처음 인사에 보인다) */
  lastLogin?: number | null;
  /** KOK 관리 모드 열기 */
  runSetting: (io: TermIO, args: string[]) => Promise<number>;
  /** 파일·기록이 바뀌면 (저장) */
  onChange?: () => void;
};

const HISTORY_MAX = 500;
/** 스크립트가 스크립트를 부르는 깊이 */
const DEPTH_MAX = 8;

export class Shell implements Program {
  readonly user: string;
  readonly host = HOST;
  readonly home: string;
  readonly pid = 1024 + Math.floor(Math.random() * 3000);
  readonly startedAt: number;
  readonly fs: Vfs;
  cwd: string;
  env = new Map<string, string>();
  aliases = new Map<string, string>();
  status = 0;
  history: string[];
  now: () => number;
  lastLogin: number | null;
  private runSettingFn: ShellOptions['runSetting'];
  private onChange: () => void;

  constructor(o: ShellOptions) {
    this.user = o.user;
    this.home = `/home/${o.user}`;
    this.fs = o.fs;
    this.now = o.now ?? (() => Date.now());
    this.startedAt = this.now();
    this.cwd = this.home;
    this.history = (o.history ?? []).slice(-HISTORY_MAX);
    this.lastLogin = o.lastLogin ?? null;
    this.runSettingFn = o.runSetting;
    this.onChange = o.onChange ?? (() => {});
    for (const [k, v] of Object.entries(o.aliases ?? {})) this.aliases.set(k, v);
    const env: Array<[string, string]> = [
      ['USER', this.user],
      ['LOGNAME', this.user],
      ['HOME', this.home],
      ['PWD', this.cwd],
      ['SHELL', '/bin/bash'],
      ['PATH', '/usr/local/bin:/usr/bin:/bin'],
      ['LANG', 'ko_KR.UTF-8'],
      ['TERM', 'xterm-256color'],
      ['HOSTNAME', HOST],
      ['EDITOR', 'nano'],
    ];
    for (const [k, v] of env) this.env.set(k, v);
  }

  /** ~ 로 줄인 지금 위치 */
  prettyPath(p = this.cwd): string {
    if (p === this.home) return '~';
    if (p.startsWith(`${this.home}/`)) return `~${p.slice(this.home.length)}`;
    return p;
  }

  title(): string {
    return `${this.user}@${this.host}: ${this.prettyPath()}`;
  }

  prompt(): string {
    return `${paint(C.boldGreen, `${this.user}@${this.host}`)}:${paint(C.boldBlue, this.prettyPath())}$ `;
  }

  /** 처음 인사 (로그인 메시지) */
  motd(): string {
    const lines = [
      `KOK Linux 1.0 (GNU/Linux 6.8.0-kok x86_64)에 오신 것을 환영합니다`,
      '',
      ` * 도움말:     ${paint(C.bold, 'cat help.txt')}`,
      ` * KOK 관리:   ${paint(C.bold, './setting')}`,
      '',
    ];
    if (this.lastLogin) lines.push(`마지막 로그인: ${koDate(new Date(this.lastLogin))}`, '');
    return `${lines.join('\n')}\n`;
  }

  /** 파일·변수·기록이 바뀐 뒤 저장 */
  changed(): void {
    this.onChange();
  }

  /** 터미널을 열 때: ~/.bashrc 를 읽는다 (줄임 명령·변수). 오류는 bash 처럼 보인다 */
  async startup(io: TermIO): Promise<void> {
    let text: string;
    try {
      text = this.fs.readFile(`${this.home}/.bashrc`);
    } catch {
      return;
    }
    for (const raw of text.split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      await this.exec(line, io, 1);
    }
    this.status = 0;
  }

  /** 경로 → 절대 경로 */
  abs(p: string): string {
    return this.fs.abs(this.cwd, p);
  }

  setCwd(abs: string) {
    this.env.set('OLDPWD', this.cwd);
    this.cwd = normalize(abs);
    this.env.set('PWD', this.cwd);
  }

  // ------------------------------------------------------------------ 실행
  async run(line: string, io: TermIO): Promise<void> {
    let input = line;
    // !! : 방금 명령 (bash 처럼 펼친 줄을 한 번 보여 준다)
    if (/!!/.test(input) && !/^\s*#/.test(input)) {
      const last = this.history[this.history.length - 1];
      if (!last) {
        io.print('bash: !!: 사건을 찾을 수 없음\n');
        this.status = 1;
        return;
      }
      input = input.replace(/!!/g, last);
      io.print(`${input}\n`);
    }
    if (input.trim()) {
      if (this.history[this.history.length - 1] !== input) this.history.push(input);
      if (this.history.length > HISTORY_MAX) this.history.splice(0, this.history.length - HISTORY_MAX);
    }
    await this.exec(input, io, 0);
    this.changed();
  }

  /** 줄 하나 실행 (스크립트의 줄도). 마지막 명령의 끝 번호 */
  async exec(line: string, io: TermIO, depth: number): Promise<number> {
    let script;
    try {
      script = parse(line);
    } catch (e) {
      if (e instanceof ParseError) {
        io.print(`bash: ${e.message}\n`);
        this.status = 2;
        return 2;
      }
      throw e;
    }
    let skip: '&&' | '||' | null = null;
    for (const item of script) {
      if (io.signal.aborted) break;
      const run = !(skip === '&&' && this.status !== 0) && !(skip === '||' && this.status === 0);
      if (run) this.status = await this.pipeline(item.pipeline, io, depth);
      skip = item.next === '&&' || item.next === '||' ? item.next : null;
    }
    return this.status;
  }

  private async pipeline(cmds: Cmd[], io: TermIO, depth: number): Promise<number> {
    let stdin = '';
    let status = 0;
    for (let i = 0; i < cmds.length; i++) {
      const last = i === cmds.length - 1;
      const r = await this.command(cmds[i], stdin, io, depth, last);
      stdin = r.out;
      status = r.status;
      if (io.signal.aborted) break;
    }
    return status;
  }

  /** 낱말들 펼치기: 변수·~ 와 파일 이름(*). 맞는 파일이 없으면 글자 그대로 (bash 처럼) */
  expand(words: Word[]): string[] {
    const env = { vars: (n: string) => this.env.get(n), status: this.status, home: this.home, pid: this.pid };
    const out: string[] = [];
    for (const w of words) {
      const { text, pattern } = expandWord(w, env);
      if (pattern === null) {
        out.push(text);
        continue;
      }
      const matches = this.glob(pattern);
      if (matches.length) out.push(...matches);
      else out.push(text);
    }
    return out;
  }

  /** 마지막 칸에만 * ? 가 있는 패턴 (dir/*.txt) */
  glob(pattern: string): string[] {
    const slash = pattern.lastIndexOf('/');
    const dirPart = slash >= 0 ? pattern.slice(0, slash + 1) : '';
    const namePart = slash >= 0 ? pattern.slice(slash + 1) : pattern;
    // 폴더 칸에 * ? 가 있으면 (역슬래시로 감싼 것은 글자) 펼치지 않는다
    if (/(^|[^\\])[*?]/.test(dirPart)) return [];
    const dirAbs = this.abs(dirPart.replace(/\\(.)/g, '$1') || '.');
    let names: string[];
    try {
      names = this.fs.readdir(dirAbs);
    } catch {
      return [];
    }
    const re = patternRegex(namePart);
    const dots = namePart.startsWith('.');
    return names.filter((n) => (dots || !n.startsWith('.')) && re.test(n)).map((n) => `${dirPart.replace(/\\(.)/g, '$1')}${n}`);
  }

  private async command(cmd: Cmd, stdin: string, io: TermIO, depth: number, last: boolean): Promise<{ out: string; status: number }> {
    let args = this.expand(cmd.words);
    // 이름=값 만 있는 낱말은 변수 (앞에 있는 것만)
    while (args.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(args[0])) {
      const eq = args[0].indexOf('=');
      this.env.set(args[0].slice(0, eq), args[0].slice(eq + 1));
      args = args.slice(1);
    }
    // 줄임 명령 (alias): 첫 낱말만, 다섯 번까지
    for (let k = 0; k < 5 && args.length && this.aliases.has(args[0]); k++) {
      const value = this.aliases.get(args[0])!;
      const before = args[0];
      try {
        const sub = parse(value);
        const words = sub[0]?.pipeline[0]?.words ?? [];
        args = [...this.expand(words), ...args.slice(1)];
      } catch {
        break;
      }
      if (args[0] === before) break;
    }

    let out = '';
    let errText = '';
    const redirs = cmd.redirs;
    // < 파일: 입력
    for (const r of redirs) {
      if (r.op !== '<' || !r.target) continue;
      const p = this.expand([r.target])[0] ?? '';
      try {
        stdin = this.readPath(p);
      } catch (e) {
        io.print(`bash: ${p}: ${fsMessage(e)}\n`);
        return { out: '', status: 1 };
      }
    }
    let status = 0;
    if (args.length) {
      const ctx: Ctx = {
        sh: this,
        io,
        name: args[0],
        args: args.slice(1),
        stdin,
        out: (s) => {
          out += s;
        },
        err: (s) => {
          errText += s;
        },
      };
      try {
        status = await this.call(ctx, depth);
      } catch (e) {
        if (e instanceof FsFail) {
          errText += `${args[0]}: ${e.path}: ${e.message}\n`;
          status = 1;
        } else if ((e as Error)?.name === 'AbortError') {
          status = 130;
        } else throw e;
      }
    }
    // > >> 2> 2>> &> 2>&1
    let toFile: { path: string; append: boolean } | null = null;
    let errFile: { path: string; append: boolean } | null = null;
    let errToOut = false;
    for (const r of redirs) {
      if (r.op === '<') continue;
      if (r.op === '2>&1') {
        errToOut = true;
        continue;
      }
      const p = this.expand([r.target!])[0] ?? '';
      if (r.op === '>' || r.op === '>>') toFile = { path: p, append: r.op === '>>' };
      else if (r.op === '2>' || r.op === '2>>') errFile = { path: p, append: r.op === '2>>' };
      else if (r.op === '&>') {
        toFile = { path: p, append: false };
        errToOut = true;
      }
    }
    if (errToOut) {
      out += errText;
      errText = '';
    }
    if (errFile) {
      if (!this.writePath(errFile.path, errText, errFile.append, io)) status = 1;
      errText = '';
    }
    if (errText) io.print(errText);
    if (toFile) {
      if (!this.writePath(toFile.path, out, toFile.append, io)) status = 1;
      return { out: '', status };
    }
    if (last) {
      if (out) io.print(out);
      return { out: '', status };
    }
    return { out, status };
  }

  /** 파일 읽기 (/dev/null 은 빈 글) */
  readPath(p: string): string {
    const abs = this.abs(p);
    if (abs === '/dev/null' || abs === '/dev/zero') return '';
    if (abs === '/proc/uptime') {
      const s = ((this.now() - this.startedAt) / 1000).toFixed(2);
      return `${s} ${s}\n`;
    }
    return this.fs.readFile(abs);
  }

  /** 넘겨주기(>)로 파일에 쓰기. 안 되면 오류를 쓰고 false */
  writePath(p: string, text: string, append: boolean, io: TermIO): boolean {
    const abs = this.abs(p);
    if (abs === '/dev/null') return true;
    try {
      this.fs.writeFile(abs, text, append);
      return true;
    } catch (e) {
      io.print(`bash: ${p}: ${fsMessage(e)}\n`);
      return false;
    }
  }

  /** 명령 찾기: 경로(./x) → 셸 내장·설치된 명령 → 없음 */
  private async call(c: Ctx, depth: number): Promise<number> {
    const name = c.name;
    if (name.includes('/')) return this.runPath(c, depth);
    const fn = COMMANDS[name];
    if (fn) return fn(c);
    // 설치되지 않은 이름 (apt 로 설치하라는 안내까지 리눅스처럼)
    const pkg = NOT_INSTALLED[name];
    if (pkg) {
      c.err(`명령어 '${name}'을(를) 찾을 수 없습니다. 그러나 다음을 통해 설치할 수 있습니다:\nsudo apt install ${pkg}\n`);
      return 127;
    }
    c.err(`${name}: 명령을 찾을 수 없습니다\n`);
    // 지금 폴더에 그 이름의 실행 파일이 있으면 알려 준다 (zsh 처럼)
    if (isExec(this.fs.node(this.abs(name)))) c.err(`  지금 폴더의 파일은 ./${name} 처럼 실행해요\n`);
    return 127;
  }

  /** ./파일 · /경로 실행: KOK setting, #!/bin/sh 스크립트, /bin 의 명령 */
  async runPath(c: Ctx, depth: number): Promise<number> {
    const abs = this.abs(c.name);
    const node = this.fs.node(abs);
    if (!node) {
      c.err(`bash: ${c.name}: ${FS_MESSAGE.ENOENT}\n`);
      return 127;
    }
    if (isDir(node)) {
      c.err(`bash: ${c.name}: ${FS_MESSAGE.EISDIR}\n`);
      return 126;
    }
    if (!isExec(node) || !this.fs.canRead(abs)) {
      c.err(`bash: ${c.name}: ${FS_MESSAGE.EACCES}\n`);
      return 126;
    }
    // /bin/ls 처럼 설치된 명령
    const dir = dirname(abs);
    const base = basename(abs);
    if (
      (dir === '/bin' && (BIN_COMMANDS as readonly string[]).includes(base)) ||
      (dir === '/usr/bin' && (USR_BIN_COMMANDS as readonly string[]).includes(base))
    ) {
      const fn = COMMANDS[base];
      if (fn) return fn({ ...c, name: base });
    }
    return this.runScript(node.data, c, depth, false);
  }

  /** 스크립트 실행. source 면 지금 셸에서 (cd·변수가 남는다), 아니면 하위 셸처럼 (위치·변수를 되돌린다) */
  async runScript(text: string, c: Ctx, depth: number, source: boolean): Promise<number> {
    const first = text.split('\n', 1)[0].trim();
    if (first === KOK_SHEBANG || first.startsWith(`${KOK_SHEBANG} `)) {
      // ./setting 은 관리 모드를 띄우고, ./setting ls 처럼 명령을 붙이면 그 명령만 (출력은 파이프·넘겨주기로 갈 수 있게)
      return this.runSettingFn(c.args.length ? scriptIo(c) : c.io, c.args);
    }
    if (depth >= DEPTH_MAX) {
      c.err(`bash: ${c.name}: 너무 깊이 불렀습니다\n`);
      return 1;
    }
    const saved = source ? null : { cwd: this.cwd, env: new Map(this.env) };
    // 스크립트의 인자: $0 $1 … $9 $# (끝나면 되돌린다)
    const POS = ['0', '#', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
    const before = new Map(POS.map((k) => [k, this.env.get(k)]));
    for (const k of POS) this.env.delete(k);
    c.args.slice(0, 9).forEach((a, i) => this.env.set(String(i + 1), a));
    this.env.set('#', String(c.args.length));
    this.env.set('0', c.name);
    let status = 0;
    // 스크립트의 출력은 이 명령의 출력으로 모은다 (파이프·넘겨주기가 되게)
    const io = scriptIo(c);
    for (const raw of text.split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      if (/^exit(\s|$)/.test(line)) {
        status = Number(line.split(/\s+/)[1] ?? this.status) || 0;
        break;
      }
      status = await this.exec(line, io, depth + 1);
      if (c.io.signal.aborted) break;
    }
    if (saved) {
      this.cwd = saved.cwd;
      this.env = saved.env;
    } else {
      for (const [k, v] of before) {
        if (v === undefined) this.env.delete(k);
        else this.env.set(k, v);
      }
    }
    return status;
  }

  // ------------------------------------------------------------------ 자동 완성
  complete(line: string, cursor: number): Completion | null {
    const before = line.slice(0, cursor);
    const start = wordStart(before);
    const word = before.slice(start).replace(/\\(.)/g, '$1');
    const head = before.slice(0, start);
    const firstWord = /^\s*$/.test(head) || /[|;&]\s*$/.test(head) || /^\s*sudo\s+$/.test(head);
    if (firstWord && !word.includes('/')) {
      const names = [...new Set([...Object.keys(COMMANDS), ...this.aliases.keys()])].filter((n) => n.startsWith(word)).sort();
      return { start, end: cursor, options: names, space: true };
    }
    // 경로 (cd 는 폴더만)
    const onlyDirs = /^\s*cd\s+$/.test(head) || /(^|[|;&]\s*)cd\s+$/.test(head);
    const slash = word.lastIndexOf('/');
    const dirPart = slash >= 0 ? word.slice(0, slash + 1) : '';
    const prefix = slash >= 0 ? word.slice(slash + 1) : word;
    const dirExpanded = dirPart.startsWith('~') ? this.home + dirPart.slice(1) : dirPart;
    let names: string[];
    const dirAbs = this.abs(dirExpanded || '.');
    try {
      names = this.fs.readdir(dirAbs);
    } catch {
      return null;
    }
    const opts = names
      .filter((n) => n.startsWith(prefix) && (prefix.startsWith('.') || !n.startsWith('.')))
      .filter((n) => !onlyDirs || isDir(this.fs.node(`${dirAbs}/${n}`)))
      .sort(byName)
      .map((n) => {
        const d = isDir(this.fs.node(`${dirAbs}/${n}`));
        return `${dirPart}${n.replace(/([\s'"\\$`|&;<>()*?!#])/g, '\\$1')}${d ? '/' : ''}`;
      });
    return { start, end: cursor, options: opts, space: opts.length === 1 && !opts[0].endsWith('/') };
  }
}

/** 커서 앞 글에서 지금 낱말이 시작하는 자리 (빈칸·연산자 뒤, 역슬래시로 감싼 빈칸은 낱말 안) */
export function wordStart(before: string): number {
  let start = 0;
  for (let i = 0; i < before.length; i++) {
    const ch = before[i];
    if (ch === '\\') {
      i++;
      continue;
    }
    if (/[\s|;&<>]/.test(ch)) start = i + 1;
  }
  return start;
}

/** 스크립트 안의 명령 출력은 그 스크립트 명령의 출력으로 */
function scriptIo(c: Ctx): TermIO {
  return {
    ...c.io,
    print: (s) => c.out(s),
    signal: c.io.signal,
  };
}

export function fsMessage(e: unknown): string {
  if (e instanceof FsFail) return e.message;
  return String((e as Error)?.message ?? e);
}

/** 2026년 10월 29일 (목) 23:41:07 */
export function koDate(d: Date): string {
  const days = ['일', '월', '화', '수', '목', '금', '토'];
  const two = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 (${days[d.getDay()]}) ${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
}
