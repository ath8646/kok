// 셸의 명령들 (리눅스 coreutils·bash 내장 명령을 작게). 오류 글은 한국어 우분투와 같은 말로
import { BIN_COMMANDS, HOST, KERNEL, OS_NAME, USR_BIN_COMMANDS } from './files';
import type { Builtin, Ctx } from './shell';
import { C, byteLength, cells, columns, human, padEnd, padStart, paint } from './text';
import { FS_MAX_BYTES, FS_MESSAGE, FsFail, basename, dirname, isDir, isExec, isFile, normalize, sizeOf, type VNode } from './vfs';

// ------------------------------------------------------------------ 도우미
type Opts = { has: (f: string) => boolean; val: (f: string) => string | undefined; rest: string[]; bad: string | null };

/** 짧은 옵션 (-al), 값이 있는 옵션 (-n 5, -n5), 긴 옵션 (--help, --color=never). -- 뒤는 모두 인자 */
function opts(args: string[], valued = '', longs: string[] = []): Opts {
  const flags = new Set<string>();
  const vals = new Map<string, string>();
  const rest: string[] = [];
  let bad: string | null = null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--') {
      rest.push(...args.slice(i + 1));
      break;
    }
    if (a.startsWith('--') && a.length > 2) {
      const [name, v] = a.slice(2).split('=', 2);
      if (!longs.includes(name)) bad ??= a;
      flags.add(`--${name}`);
      if (v !== undefined) vals.set(`--${name}`, v);
      continue;
    }
    if (a.startsWith('-') && a.length > 1 && !/^-\d/.test(a)) {
      for (let k = 1; k < a.length; k++) {
        const f = a[k];
        if (valued.includes(f)) {
          const v = a.slice(k + 1) || args[++i];
          if (v !== undefined) vals.set(f, v);
          break;
        }
        flags.add(f);
      }
      continue;
    }
    rest.push(a);
  }
  return { has: (f) => flags.has(f), val: (f) => vals.get(f), rest, bad };
}

const err = (c: Ctx, msg: string) => c.err(`${c.name}: ${msg}\n`);
const fsMsg = (e: unknown) => (e instanceof FsFail ? e.message : String((e as Error)?.message ?? e));

/** 파일이나 입력 (파일이 없으면 stdin). 읽지 못한 파일은 오류를 쓰고 건너뛴다 */
function inputs(c: Ctx, files: string[]): Array<{ name: string; text: string }> {
  if (!files.length) return [{ name: '-', text: c.stdin }];
  const out: Array<{ name: string; text: string }> = [];
  for (const f of files) {
    if (f === '-') {
      out.push({ name: '-', text: c.stdin });
      continue;
    }
    try {
      out.push({ name: f, text: c.sh.readPath(f) });
    } catch (e) {
      err(c, `${f}: ${fsMsg(e)}`);
    }
  }
  return out;
}

/** 글을 줄로 (끝의 줄바꿈 하나는 빈 줄로 세지 않는다) */
function lines(text: string): string[] {
  if (!text) return [];
  const ls = text.split('\n');
  if (ls[ls.length - 1] === '') ls.pop();
  return ls;
}

const two = (n: number) => String(n).padStart(2, '0');

/** ls -l 의 날짜: 10월 29 23:41 (올해가 아니면 연도) */
function lsDate(t: number, now: number): string {
  const d = new Date(t);
  const sameYear = new Date(now).getFullYear() === d.getFullYear();
  return `${padStart(`${d.getMonth() + 1}월`, 3)} ${padStart(String(d.getDate()), 2)} ${sameYear ? `${two(d.getHours())}:${two(d.getMinutes())}` : ` ${d.getFullYear()}`}`;
}

function modeString(n: VNode): string {
  const m = n.mode;
  const r = (bits: number) => `${bits & 4 ? 'r' : '-'}${bits & 2 ? 'w' : '-'}${bits & 1 ? 'x' : '-'}`;
  return `${isDir(n) ? 'd' : '-'}${r((m >> 6) & 7)}${r((m >> 3) & 7)}${r(m & 7)}`;
}

function owner(c: Ctx, abs: string): string {
  return c.sh.fs.canWrite(abs) ? c.sh.user : 'root';
}

/** 이름에 색 (폴더 파랑, 실행 파일 초록) */
function colorName(name: string, n: VNode | null, color: boolean): string {
  if (!color || !n) return name;
  if (isDir(n)) return paint(C.boldBlue, name);
  if (isExec(n)) return paint(C.boldGreen, name);
  return name;
}

/** ls 처럼 빈칸 있는 이름은 따옴표로 */
function lsQuote(name: string): string {
  return /[\s'"\\$`|&;<>()*?!#]/.test(name) ? `'${name.replace(/'/g, `'\\''`)}'` : name;
}

// ------------------------------------------------------------------ 파일·폴더
const ls: Builtin = (c) => {
  const o = opts(c.args, '', ['color', 'all', 'help']);
  if (o.has('--help')) {
    c.out(
      '사용법: ls [옵션]... [파일]...\n  -a  점(.)으로 시작하는 것도\n  -l  자세히\n  -h  크기를 읽기 쉽게 (-l 과)\n  -1  한 줄에 하나\n  -R  아래 폴더까지\n  -F  폴더는 / , 실행 파일은 * 를 붙이기\n',
    );
    return 0;
  }
  const all = o.has('a') || o.has('--all');
  const almost = o.has('A');
  const long = o.has('l');
  const one = o.has('1');
  const classify = o.has('F');
  const color = o.val('--color') !== 'never';
  const recursive = o.has('R');
  const now = c.sh.now();
  const targets = o.rest.length ? o.rest : ['.'];
  let status = 0;
  const files: string[] = [];
  const dirs: string[] = [];
  for (const t of targets) {
    const abs = c.sh.abs(t);
    const n = c.sh.fs.node(abs);
    if (!n) {
      err(c, `'${t}'에 접근할 수 없음: ${FS_MESSAGE.ENOENT}`);
      status = 2;
    } else if (!c.sh.fs.canRead(abs)) {
      err(c, `'${t}' 디렉터리를 열 수 없음: ${FS_MESSAGE.EACCES}`);
      status = 2;
    } else if (isDir(n) && !o.has('d')) dirs.push(t);
    else files.push(t);
  }
  const entryLine = (name: string, abs: string, n: VNode): string => {
    const shown = `${colorName(lsQuote(name), n, color)}${classify ? (isDir(n) ? '/' : isExec(n) ? '*' : '') : ''}`;
    if (!long) return shown;
    const size = isDir(n) ? 4096 : byteLength(n.data);
    const sz = o.has('h') ? human(size) : String(size);
    const who = owner(c, abs);
    return `${modeString(n)} ${isDir(n) ? 2 : 1} ${padEnd(who, 7)} ${padEnd(who, 7)} ${padStart(sz, 5)} ${lsDate(n.mtime, now)} ${shown}`;
  };
  const print = (entries: Array<{ name: string; abs: string; n: VNode }>) => {
    if (long) {
      const blocks = entries.reduce((a, e) => a + (isDir(e.n) ? 4 : Math.ceil(byteLength((e.n as { data: string }).data) / 4096) * 4), 0);
      c.out(`합계 ${blocks}\n`);
      for (const e of entries) c.out(`${entryLine(e.name, e.abs, e.n)}\n`);
    } else if (entries.length) {
      const names = entries.map((e) => entryLine(e.name, e.abs, e.n));
      c.out(`${one ? names.join('\n') : columns(names, c.io.cols())}\n`);
    }
  };
  if (files.length) {
    print(files.map((f) => ({ name: f, abs: c.sh.abs(f), n: c.sh.fs.node(c.sh.abs(f))! })));
  }
  const listDir = (label: string, abs: string, header: boolean) => {
    if (header) c.out(`${label}:\n`);
    const names = c.sh.fs.readdir(abs).filter((n) => all || almost || !n.startsWith('.'));
    const entries = names.map((name) => ({ name, abs: normalize(`${abs}/${name}`), n: c.sh.fs.node(`${abs}/${name}`)! }));
    if (all) entries.unshift({ name: '.', abs, n: c.sh.fs.node(abs)! }, { name: '..', abs: dirname(abs), n: c.sh.fs.node(dirname(abs))! });
    print(entries);
    if (recursive) {
      for (const e of entries) {
        if (e.name === '.' || e.name === '..' || !isDir(e.n)) continue;
        c.out('\n');
        listDir(`${label === '.' ? '.' : label}/${e.name}`, e.abs, true);
      }
    }
  };
  dirs.forEach((d, i) => {
    if (files.length || i > 0) c.out('\n');
    listDir(d, c.sh.abs(d), targets.length > 1 || recursive);
  });
  return status;
};

const cd: Builtin = (c) => {
  let target = c.args[0];
  if (c.args.length > 1) {
    c.err('bash: cd: 인자가 너무 많음\n');
    return 1;
  }
  if (!target || target === '~') target = c.sh.home;
  else if (target === '-') {
    target = c.sh.env.get('OLDPWD') ?? c.sh.cwd;
    c.out(`${target}\n`);
  }
  const abs = c.sh.abs(target);
  const n = c.sh.fs.node(abs);
  if (!n) {
    c.err(`bash: cd: ${c.args[0]}: ${FS_MESSAGE.ENOENT}\n`);
    return 1;
  }
  if (!isDir(n)) {
    c.err(`bash: cd: ${c.args[0]}: ${FS_MESSAGE.ENOTDIR}\n`);
    return 1;
  }
  if (!c.sh.fs.canRead(abs)) {
    c.err(`bash: cd: ${c.args[0]}: ${FS_MESSAGE.EACCES}\n`);
    return 1;
  }
  c.sh.setCwd(abs);
  return 0;
};

const pwd: Builtin = (c) => {
  c.out(`${c.sh.cwd}\n`);
  return 0;
};

const cat: Builtin = (c) => {
  const o = opts(c.args);
  let status = 0;
  let n = 0;
  for (const f of o.rest.length ? o.rest : ['-']) {
    let text: string;
    if (f === '-') text = c.stdin;
    else {
      const abs = c.sh.abs(f);
      if (isDir(c.sh.fs.node(abs))) {
        err(c, `${f}: ${FS_MESSAGE.EISDIR}`);
        status = 1;
        continue;
      }
      try {
        text = c.sh.readPath(f);
      } catch (e) {
        err(c, `${f}: ${fsMsg(e)}`);
        status = 1;
        continue;
      }
    }
    if (o.has('n')) {
      const ls = text.split('\n');
      const endsNl = text.endsWith('\n');
      if (endsNl) ls.pop();
      c.out(`${ls.map((l) => `${padStart(String(++n), 6)}\t${l}`).join('\n')}${endsNl || !text ? '\n' : ''}`);
    } else c.out(text);
  }
  return status;
};

const headTail =
  (tail: boolean): Builtin =>
  (c) => {
    const args = c.args.map((a) => (/^-\d+$/.test(a) ? `-n${a.slice(1)}` : a));
    const o = opts(args, 'n');
    const count = Math.max(0, Number(o.val('n') ?? 10) || 0);
    const ins = inputs(c, o.rest);
    ins.forEach((f, i) => {
      if (ins.length > 1) c.out(`${i ? '\n' : ''}==> ${f.name} <==\n`);
      const ls = lines(f.text);
      const pick = tail ? ls.slice(Math.max(0, ls.length - count)) : ls.slice(0, count);
      if (pick.length) c.out(`${pick.join('\n')}\n`);
    });
    return 0;
  };

const wc: Builtin = (c) => {
  const o = opts(c.args);
  const want = { l: o.has('l'), w: o.has('w'), c: o.has('c') || o.has('m') };
  if (!want.l && !want.w && !want.c) want.l = want.w = want.c = true;
  const ins = inputs(c, o.rest);
  const tot = { l: 0, w: 0, c: 0 };
  const row = (l: number, w: number, ch: number, name: string) => {
    const parts = [want.l ? l : null, want.w ? w : null, want.c ? ch : null].filter((x) => x !== null).map((x) => padStart(String(x), 7));
    c.out(`${parts.join(' ')}${name !== '-' ? ` ${name}` : ''}\n`);
  };
  for (const f of ins) {
    const l = (f.text.match(/\n/g) ?? []).length;
    const w = f.text.split(/\s+/).filter(Boolean).length;
    const ch = byteLength(f.text);
    tot.l += l;
    tot.w += w;
    tot.c += ch;
    row(l, w, ch, f.name);
  }
  if (ins.length > 1) row(tot.l, tot.w, tot.c, '합계');
  return 0;
};

const touch: Builtin = (c) => {
  const o = opts(c.args);
  if (!o.rest.length) {
    err(c, '파일 operand가 빠짐');
    return 1;
  }
  let status = 0;
  for (const f of o.rest) {
    try {
      c.sh.fs.touch(c.sh.abs(f));
    } catch (e) {
      err(c, `'${f}'를 touch 할 수 없음: ${fsMsg(e)}`);
      status = 1;
    }
  }
  return status;
};

const mkdir: Builtin = (c) => {
  const o = opts(c.args);
  if (!o.rest.length) {
    err(c, 'operand가 빠짐');
    return 1;
  }
  let status = 0;
  for (const d of o.rest) {
    try {
      c.sh.fs.mkdir(c.sh.abs(d), o.has('p'));
    } catch (e) {
      err(c, `'${d}' 디렉터리를 만들 수 없습니다: ${fsMsg(e)}`);
      status = 1;
    }
  }
  return status;
};

const rmdir: Builtin = (c) => {
  let status = 0;
  for (const d of opts(c.args).rest) {
    try {
      c.sh.fs.rmdir(c.sh.abs(d));
    } catch (e) {
      err(c, `'${d}' 삭제 실패: ${fsMsg(e)}`);
      status = 1;
    }
  }
  return status;
};

const rm: Builtin = async (c) => {
  const o = opts(c.args, '', ['no-preserve-root', 'help', 'recursive', 'force']);
  const recursive = o.has('r') || o.has('R') || o.has('--recursive');
  const force = o.has('f') || o.has('--force');
  if (!o.rest.length) {
    if (force) return 0;
    err(c, 'operand가 빠짐');
    return 1;
  }
  let status = 0;
  for (const t of o.rest) {
    const abs = c.sh.abs(t);
    if (abs === '/' && recursive) {
      err(c, `'/'에서 재귀적으로 작업하는 것은 위험합니다\nrm: 이 안전장치를 무시하려면 --no-preserve-root 를 쓰세요`);
      status = 1;
      continue;
    }
    const n = c.sh.fs.node(abs);
    if (!n) {
      if (!force) {
        err(c, `'${t}'를 지울 수 없음: ${FS_MESSAGE.ENOENT}`);
        status = 1;
      }
      continue;
    }
    if (isDir(n) && !recursive) {
      err(c, `'${t}'를 지울 수 없음: ${FS_MESSAGE.EISDIR}`);
      status = 1;
      continue;
    }
    if (o.has('i')) {
      const kind = isDir(n) ? '디렉터리' : n.data ? '일반 파일' : '일반 빈 파일';
      const a = await c.io.ask(`rm: ${kind} '${t}'를 제거할까요? `);
      if (!a || !/^y/i.test(a.trim())) continue;
    }
    try {
      c.sh.fs.remove(abs, recursive);
      if (o.has('v')) c.out(`'${t}' 삭제함\n`);
    } catch (e) {
      err(c, `'${t}'를 지울 수 없음: ${fsMsg(e)}`);
      status = 1;
    }
  }
  return status;
};

const cpMv =
  (move: boolean): Builtin =>
  (c) => {
    const o = opts(c.args);
    const recursive = o.has('r') || o.has('R') || o.has('a');
    if (o.rest.length < 2) {
      err(c, o.rest.length ? `'${o.rest[0]}' 다음에 대상 파일 operand가 빠짐` : '파일 operand가 빠짐');
      return 1;
    }
    const srcs = o.rest.slice(0, -1);
    const dst = o.rest[o.rest.length - 1];
    const dstAbs = c.sh.abs(dst);
    if (srcs.length > 1 && !isDir(c.sh.fs.node(dstAbs))) {
      err(c, `대상 '${dst}'는 디렉터리가 아닙니다`);
      return 1;
    }
    let status = 0;
    for (const s of srcs) {
      const abs = c.sh.abs(s);
      const n = c.sh.fs.node(abs);
      if (!n) {
        err(c, `'${s}'를 stat 할 수 없음: ${FS_MESSAGE.ENOENT}`);
        status = 1;
        continue;
      }
      if (!move && isDir(n) && !recursive) {
        err(c, `-r 지정되지 않음; '${s}' 디렉터리 생략`);
        status = 1;
        continue;
      }
      try {
        if (move) c.sh.fs.move(abs, dstAbs);
        else c.sh.fs.copy(abs, dstAbs, recursive);
        if (o.has('v')) c.out(`'${s}' -> '${dst}'\n`);
      } catch (e) {
        err(c, `'${s}'${move ? '를 옮길 수 없음' : '를 복사할 수 없음'}: ${fsMsg(e)}`);
        status = 1;
      }
    }
    return status;
  };

const chmod: Builtin = (c) => {
  const [mode, ...files] = c.args;
  if (!mode || !files.length) {
    err(c, mode ? `'${mode}' 다음에 operand가 빠짐` : 'operand가 빠짐');
    return 1;
  }
  let status = 0;
  for (const f of files) {
    const abs = c.sh.abs(f);
    const n = c.sh.fs.node(abs);
    if (!n) {
      err(c, `'${f}'에 접근할 수 없음: ${FS_MESSAGE.ENOENT}`);
      status = 1;
      continue;
    }
    let next: number | null = null;
    if (/^[0-7]{3,4}$/.test(mode)) next = parseInt(mode, 8);
    else {
      const m = /^([ugoa]*)([+-=])([rwx]+)$/.exec(mode);
      if (m) {
        const who = m[1] || 'a';
        let bits = 0;
        for (const p of m[3]) bits |= p === 'r' ? 4 : p === 'w' ? 2 : 1;
        let mask = 0;
        if (who.includes('u') || who.includes('a')) mask |= bits << 6;
        if (who.includes('g') || who.includes('a')) mask |= bits << 3;
        if (who.includes('o') || who.includes('a')) mask |= bits;
        next = m[2] === '+' ? n.mode | mask : m[2] === '-' ? n.mode & ~mask : (n.mode & ~(who === 'a' ? 0o777 : mask)) | mask;
      }
    }
    if (next === null) {
      err(c, `잘못된 모드: '${mode}'`);
      return 1;
    }
    try {
      c.sh.fs.chmod(abs, next);
    } catch (e) {
      err(c, `'${f}'의 권한을 바꿀 수 없음: ${fsMsg(e)}`);
      status = 1;
    }
  }
  return status;
};

function fullDate(t: number): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}.000000000 +0900`;
}

const stat: Builtin = (c) => {
  let status = 0;
  for (const f of opts(c.args).rest) {
    const abs = c.sh.abs(f);
    const n = c.sh.fs.node(abs);
    if (!n) {
      err(c, `'${f}'를 stat 할 수 없음: ${FS_MESSAGE.ENOENT}`);
      status = 1;
      continue;
    }
    const size = isDir(n) ? 4096 : byteLength(n.data);
    const who = owner(c, abs);
    const uid = who === 'root' ? 0 : 1000;
    c.out(
      `  파일: ${f}\n  크기: ${padEnd(String(size), 10)}\t블록: ${padEnd(String(Math.ceil(size / 512)), 10)} IO 블록: 4096   ${isDir(n) ? '디렉터리' : size ? '일반 파일' : '일반 빈 파일'}\n` +
        `접근: (${(n.mode & 0o777).toString(8).padStart(4, '0')}/${modeString(n)})  UID: (${padStart(String(uid), 5)}/${padStart(who, 8)})   GID: (${padStart(String(uid), 5)}/${padStart(who, 8)})\n` +
        `수정: ${fullDate(n.mtime)}\n`,
    );
  }
  return status;
};

const fileCmd: Builtin = (c) => {
  for (const f of opts(c.args).rest) {
    const n = c.sh.fs.node(c.sh.abs(f));
    let kind: string;
    if (!n) kind = `cannot open '${f}' (${FS_MESSAGE.ENOENT})`;
    else if (isDir(n)) kind = 'directory';
    else if (n.data.startsWith('\u007fELF')) kind = 'ELF 64-bit LSB pie executable, x86-64, dynamically linked';
    else if (n.data.startsWith('#!/usr/bin/kok')) kind = 'KOK setting script, UTF-8 Unicode text executable';
    else if (n.data.startsWith('#!')) kind = `${n.data.slice(2).split('\n')[0].trim()} script, ASCII text executable`;
    else if (!n.data) kind = 'empty';
    else kind = /[^\x00-\x7f]/.test(n.data) ? 'UTF-8 Unicode text' : 'ASCII text';
    c.out(`${f}: ${kind}\n`);
  }
  return 0;
};

const du: Builtin = (c) => {
  const o = opts(c.args);
  const fmt = (b: number) => (o.has('h') ? human(Math.max(4096, b)) : String(Math.ceil(Math.max(4096, b) / 1024)));
  for (const t of o.rest.length ? o.rest : ['.']) {
    const abs = c.sh.abs(t);
    const n = c.sh.fs.node(abs);
    if (!n) {
      err(c, `'${t}'에 접근할 수 없음: ${FS_MESSAGE.ENOENT}`);
      continue;
    }
    const walk = (node: VNode, label: string) => {
      if (isDir(node) && !o.has('s')) for (const [k, v] of Object.entries(node.kids)) if (isDir(v)) walk(v, `${label}/${k}`);
      c.out(`${fmt(sizeOf(node))}\t${label}\n`);
    };
    walk(n, t);
  }
  return 0;
};

const df: Builtin = (c) => {
  const o = opts(c.args);
  const used = c.sh.fs.usedBytes();
  const f = (b: number) => (o.has('h') ? human(b) : String(Math.ceil(b / 1024)));
  const pct = `${Math.ceil((used / FS_MAX_BYTES) * 100)}%`;
  c.out(
    `${padEnd('파일 시스템', 14)}${padStart(o.has('h') ? '크기' : '1K-블록', 8)}${padStart('사용', 7)}${padStart('가용', 7)}${padStart('사용%', 6)} 마운트위치\n` +
      `${padEnd('kokfs', 14)}${padStart(f(FS_MAX_BYTES), 8)}${padStart(f(used), 7)}${padStart(f(FS_MAX_BYTES - used), 7)}${padStart(pct, 6)} /\n`,
  );
  return 0;
};

// ------------------------------------------------------------------ 글
/** echo -e · printf 의 역슬래시 글자 */
function unescape(s: string): string {
  return s.replace(/\\(e|033|x1b|n|t|r|\\|a|0)/gi, (_, k: string) => {
    const key = k.toLowerCase();
    if (key === 'e' || key === '033' || key === 'x1b') return '\x1b';
    if (key === 'n') return '\n';
    if (key === 't') return '\t';
    if (key === 'r') return '';
    if (key === '\\') return '\\';
    return '';
  });
}

const echo: Builtin = (c) => {
  let args = c.args;
  let newline = true;
  let esc = false;
  while (args.length && /^-[neE]+$/.test(args[0])) {
    if (args[0].includes('n')) newline = false;
    if (args[0].includes('e')) esc = true;
    if (args[0].includes('E')) esc = false;
    args = args.slice(1);
  }
  const text = args.join(' ');
  c.out(`${esc ? unescape(text) : text}${newline ? '\n' : ''}`);
  return 0;
};

const printf: Builtin = (c) => {
  const [fmt, ...rest] = c.args;
  if (fmt === undefined) {
    c.err('printf: 사용법: printf [-v var] format [arguments]\n');
    return 2;
  }
  let args = rest;
  let out = '';
  do {
    let used = 0;
    out += unescape(fmt).replace(/%([-0]?\d*)([sdf%])/g, (_, width: string, k: string) => {
      if (k === '%') return '%';
      const v = args[used++] ?? '';
      let s = k === 'd' ? String(Math.trunc(Number(v) || 0)) : k === 'f' ? (Number(v) || 0).toFixed(6) : v;
      const w = Number(width.replace(/^[-0]/, '')) || 0;
      if (w) s = width.startsWith('-') ? padEnd(s, w) : width.startsWith('0') ? s.padStart(w, '0') : padStart(s, w);
      return s;
    });
    args = args.slice(Math.max(1, used));
    if (!used) break;
  } while (args.length);
  c.out(out);
  return 0;
};

const grep: Builtin = (c) => {
  const o = opts(c.args, 'e', ['color', 'help']);
  const pattern = o.val('e') ?? o.rest[0];
  const files = o.val('e') !== undefined ? o.rest : o.rest.slice(1);
  if (pattern === undefined) {
    c.err('사용법: grep [옵션]... 패턴 [파일]...\n');
    return 2;
  }
  let re: RegExp;
  const flags = o.has('i') ? 'giu' : 'gu';
  const src = o.has('F') ? pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : pattern;
  try {
    re = new RegExp(o.has('w') ? `\\b(?:${src})\\b` : src, flags);
  } catch {
    re = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
  }
  // -r: 폴더 아래 모든 파일
  const targets: Array<{ name: string; text: string }> = [];
  if (o.has('r') || o.has('R')) {
    const walk = (abs: string, label: string) => {
      const n = c.sh.fs.node(abs);
      if (isDir(n)) for (const k of Object.keys(n.kids).sort()) walk(`${abs}/${k}`, `${label}/${k}`);
      else if (isFile(n) && !n.data.startsWith('\u007fELF')) targets.push({ name: label.replace(/^\.\//, ''), text: n.data });
    };
    for (const f of files.length ? files : ['.']) walk(c.sh.abs(f), f);
  } else targets.push(...inputs(c, files));
  const showName = !o.has('h') && (o.has('H') || targets.length > 1 || o.has('r') || o.has('R'));
  let found = false;
  for (const t of targets) {
    let count = 0;
    lines(t.text).forEach((line, i) => {
      re.lastIndex = 0;
      const hit = re.test(line);
      if (hit === o.has('v')) return;
      count++;
      found = true;
      if (o.has('c') || o.has('l') || o.has('q')) return;
      re.lastIndex = 0;
      const shown = o.has('v') ? line : line.replace(re, (m) => paint(C.boldRed, m));
      c.out(
        `${showName ? `${paint(C.magenta, t.name)}${paint(C.cyan, ':')}` : ''}${o.has('n') ? `${paint(C.green, String(i + 1))}${paint(C.cyan, ':')}` : ''}${shown}\n`,
      );
    });
    if (o.has('c')) c.out(`${showName ? `${t.name}:` : ''}${count}\n`);
    if (o.has('l') && count) c.out(`${t.name}\n`);
  }
  return found ? 0 : 1;
};

const sort: Builtin = (c) => {
  const o = opts(c.args);
  let ls = inputs(c, o.rest).flatMap((f) => lines(f.text));
  if (o.has('n')) ls.sort((a, b) => (parseFloat(a) || 0) - (parseFloat(b) || 0) || (a < b ? -1 : a > b ? 1 : 0));
  else ls.sort((a, b) => (o.has('f') ? a.toLowerCase().localeCompare(b.toLowerCase(), 'ko') : a.localeCompare(b, 'ko')));
  if (o.has('r')) ls.reverse();
  if (o.has('u')) ls = ls.filter((l, i) => i === 0 || l !== ls[i - 1]);
  if (ls.length) c.out(`${ls.join('\n')}\n`);
  return 0;
};

const uniq: Builtin = (c) => {
  const o = opts(c.args);
  const ls = inputs(c, o.rest.slice(0, 1)).flatMap((f) => lines(f.text));
  const groups: Array<{ line: string; n: number }> = [];
  for (const l of ls) {
    const g = groups[groups.length - 1];
    if (g && g.line === l) g.n++;
    else groups.push({ line: l, n: 1 });
  }
  const shown = groups.filter((g) => (o.has('d') ? g.n > 1 : o.has('u') ? g.n === 1 : true));
  if (shown.length) c.out(`${shown.map((g) => (o.has('c') ? `${padStart(String(g.n), 7)} ${g.line}` : g.line)).join('\n')}\n`);
  return 0;
};

const find: Builtin = (c) => {
  const roots: string[] = [];
  let i = 0;
  while (i < c.args.length && !c.args[i].startsWith('-')) roots.push(c.args[i++]);
  let name: RegExp | null = null;
  let type: string | null = null;
  let maxDepth = Infinity;
  for (; i < c.args.length; i++) {
    const a = c.args[i];
    const v = c.args[i + 1];
    if ((a === '-name' || a === '-iname') && v !== undefined) {
      name = new RegExp(
        `^${v
          .replace(/[.+^${}()|[\]\\]/g, '\\$&')
          .replace(/\*/g, '.*')
          .replace(/\?/g, '.')}$`,
        a === '-iname' ? 'iu' : 'u',
      );
      i++;
    } else if (a === '-type' && v !== undefined) {
      type = v;
      i++;
    } else if (a === '-maxdepth' && v !== undefined) {
      maxDepth = Number(v) || 0;
      i++;
    } else {
      err(c, `알 수 없는 술어 \`${a}'`);
      return 1;
    }
  }
  let status = 0;
  for (const root of roots.length ? roots : ['.']) {
    const abs = c.sh.abs(root);
    const n = c.sh.fs.node(abs);
    if (!n) {
      err(c, `'${root}': ${FS_MESSAGE.ENOENT}`);
      status = 1;
      continue;
    }
    const walk = (node: VNode, label: string, depth: number) => {
      const base = label === root ? basename(abs) : label.slice(label.lastIndexOf('/') + 1);
      const okType = !type || (type === 'd' ? isDir(node) : type === 'f' ? isFile(node) : true);
      if (okType && (!name || name.test(base))) c.out(`${label}\n`);
      if (isDir(node) && depth < maxDepth && c.sh.fs.canRead(c.sh.abs(label))) {
        for (const k of Object.keys(node.kids).sort()) walk(node.kids[k], `${label === '/' ? '' : label}/${k}`, depth + 1);
      }
    };
    walk(n, root, 0);
  }
  return status;
};

const tree: Builtin = (c) => {
  const o = opts(c.args, 'L');
  const maxDepth = o.val('L') !== undefined ? Math.max(1, Number(o.val('L')) || 1) : Infinity;
  const root = o.rest[0] ?? '.';
  const abs = c.sh.abs(root);
  const n = c.sh.fs.node(abs);
  if (!isDir(n)) {
    c.out(`${root}  [error opening dir]\n\n0 directories, 0 files\n`);
    return 2;
  }
  let dirs = 0;
  let files = 0;
  const out: string[] = [paint(C.boldBlue, root)];
  const walk = (d: typeof n, prefix: string, at: string, depth: number) => {
    const names = Object.keys(d.kids)
      .filter((k) => o.has('a') || !k.startsWith('.'))
      .sort((a, b) => a.localeCompare(b, 'ko'));
    names.forEach((k, idx) => {
      const last = idx === names.length - 1;
      const kid = d.kids[k];
      out.push(`${prefix}${last ? '└── ' : '├── '}${colorName(k, kid, true)}`);
      if (isDir(kid)) {
        dirs++;
        if (depth < maxDepth && c.sh.fs.canRead(`${at}/${k}`)) walk(kid, `${prefix}${last ? '    ' : '│   '}`, `${at}/${k}`, depth + 1);
      } else files++;
    });
  };
  walk(n, '', abs, 1);
  c.out(`${out.join('\n')}\n\n디렉터리 ${dirs}개, 파일 ${files}개\n`);
  return 0;
};

const pathPart =
  (fn: (p: string) => string): Builtin =>
  (c) => {
    if (!c.args.length) {
      err(c, 'operand가 빠짐');
      return 1;
    }
    for (const a of c.args) c.out(`${fn(a)}\n`);
    return 0;
  };

const nano: Builtin = async (c) => {
  const f = c.args.find((a) => !a.startsWith('-') && !a.startsWith('+'));
  if (!f) {
    c.err('nano: 파일 이름을 적어 주세요 (예: nano memo.txt)\n');
    return 1;
  }
  const abs = c.sh.abs(f);
  const n = c.sh.fs.node(abs);
  if (isDir(n)) {
    c.err(`nano: ${f}: ${FS_MESSAGE.EISDIR}\n`);
    return 1;
  }
  // Ctrl+O 로 쓸 때마다 바로 파일에 (나가기 전에도)
  await c.io.edit(f, isFile(n) ? n.data : '', (text) => {
    try {
      c.sh.fs.writeFile(abs, text);
      c.sh.changed();
      return null;
    } catch (e) {
      return fsMsg(e);
    }
  });
  return 0;
};

// ------------------------------------------------------------------ 시스템
const whoami: Builtin = (c) => {
  c.out(`${c.sh.user}\n`);
  return 0;
};

const id: Builtin = (c) => {
  const u = c.sh.user;
  c.out(`uid=1000(${u}) gid=1000(${u}) 그룹들=1000(${u}),24(cdrom),46(plugdev)\n`);
  return 0;
};

const hostname: Builtin = (c) => {
  c.out(`${HOST}\n`);
  return 0;
};

const uname: Builtin = (c) => {
  const o = opts(c.args);
  const parts = {
    s: 'Linux',
    n: HOST,
    r: KERNEL,
    v: '#1 SMP PREEMPT_DYNAMIC',
    m: 'x86_64',
    o: 'GNU/Linux',
  };
  if (o.has('a')) c.out(`${parts.s} ${parts.n} ${parts.r} ${parts.v} ${parts.m} ${parts.m} ${parts.m} ${parts.o}\n`);
  else {
    const keys = (['s', 'n', 'r', 'v', 'm', 'o'] as const).filter((k) => o.has(k));
    c.out(`${(keys.length ? keys : ['s' as const]).map((k) => parts[k]).join(' ')}\n`);
  }
  return 0;
};

const DAYS = ['일', '월', '화', '수', '목', '금', '토'];
const DAY_NAMES = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];

/** date +형식 (%Y %m %d %H %M %S %A %a %B %b %j %s %F %T %D %Z %p %e) */
export function formatDate(fmt: string, d: Date): string {
  return fmt.replace(/%([a-zA-Z%])/g, (_, k: string) => {
    switch (k) {
      case 'Y':
        return String(d.getFullYear());
      case 'y':
        return two(d.getFullYear() % 100);
      case 'm':
        return two(d.getMonth() + 1);
      case 'd':
        return two(d.getDate());
      case 'e':
        return padStart(String(d.getDate()), 2);
      case 'H':
        return two(d.getHours());
      case 'I':
        return two(d.getHours() % 12 || 12);
      case 'M':
        return two(d.getMinutes());
      case 'S':
        return two(d.getSeconds());
      case 'p':
        return d.getHours() < 12 ? '오전' : '오후';
      case 'A':
        return DAY_NAMES[d.getDay()];
      case 'a':
        return DAYS[d.getDay()];
      case 'B':
      case 'b':
        return `${d.getMonth() + 1}월`;
      case 'j':
        return String(Math.floor((d.getTime() - new Date(d.getFullYear(), 0, 0).getTime()) / 86_400_000)).padStart(3, '0');
      case 's':
        return String(Math.floor(d.getTime() / 1000));
      case 'F':
        return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
      case 'T':
        return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
      case 'D':
        return `${two(d.getMonth() + 1)}/${two(d.getDate())}/${two(d.getFullYear() % 100)}`;
      case 'Z':
        return 'KST';
      case '%':
        return '%';
      default:
        return `%${k}`;
    }
  });
}

const date: Builtin = (c) => {
  const d = new Date(c.sh.now());
  const fmt = c.args.find((a) => a.startsWith('+'));
  c.out(`${fmt ? formatDate(fmt.slice(1), d) : formatDate('%Y. %m. %d. (%a) %H:%M:%S %Z', d)}\n`);
  return 0;
};

const cal: Builtin = (c) => {
  const now = new Date(c.sh.now());
  const nums = c.args.filter((a) => /^\d+$/.test(a)).map(Number);
  const month = nums.length >= 2 ? nums[0] - 1 : now.getMonth();
  const year = nums.length >= 2 ? nums[1] : nums.length === 1 ? nums[0] : now.getFullYear();
  if (month < 0 || month > 11 || year < 1 || year > 9999) {
    err(c, '날짜가 올바르지 않아요');
    return 1;
  }
  const title = `${month + 1}월 ${year}`;
  const width = 20;
  const lead = Math.max(0, Math.floor((width - cells(title)) / 2));
  const out = [`${' '.repeat(lead)}${title}`, DAYS.join(' ')];
  const first = new Date(year, month, 1).getDay();
  const days = new Date(year, month + 1, 0).getDate();
  let row = '   '.repeat(first);
  for (let d = 1; d <= days; d++) {
    const today = d === now.getDate() && month === now.getMonth() && year === now.getFullYear();
    const cell = padStart(String(d), 2);
    row += today ? `\x1b[7m${cell}\x1b[0m` : cell;
    if ((first + d) % 7 === 0) {
      out.push(row);
      row = '';
    } else row += ' ';
  }
  if (row.trim()) out.push(row.replace(/\s+$/, ''));
  c.out(`${out.join('\n')}\n`);
  return 0;
};

function upFor(ms: number): string {
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h}:${two(m % 60)}`;
}

const uptime: Builtin = (c) => {
  const d = new Date(c.sh.now());
  c.out(` ${formatDate('%T', d)} up ${upFor(c.sh.now() - c.sh.startedAt)},  1 user,  load average: 0.08, 0.03, 0.01\n`);
  return 0;
};

const free: Builtin = (c) => {
  const o = opts(c.args);
  const f = (mb: number) => (o.has('h') ? (mb ? `${mb >= 1024 ? `${(mb / 1024).toFixed(1)}Gi` : `${mb}Mi`}` : '0B') : String(mb * 1024));
  const head = `${padEnd('', 14)}${['total', 'used', 'free', 'shared', 'buff/cache', 'available'].map((h) => padStart(h, 12)).join('')}`;
  const mem = `${padEnd('메모리:', 14)}${[4000, 812, 2800, 12, 388, 3188].map((v) => padStart(f(v), 12)).join('')}`;
  const swap = `${padEnd('스왑:', 14)}${[2047, 0, 2047].map((v) => padStart(f(v), 12)).join('')}`;
  c.out(`${head}\n${mem}\n${swap}\n`);
  return 0;
};

const ps: Builtin = (c) => {
  const pid = c.sh.pid;
  if (c.args.some((a) => /a|u|x|-e|-f/.test(a))) {
    c.out(
      'USER         PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND\n' +
        'root           1  0.0  0.1 167280 11504 ?        Ss   09:00   0:01 /sbin/init\n' +
        `${padEnd(c.sh.user, 8)}${padStart(String(pid), 8)}  0.0  0.1  11264  5376 pts/0    Ss   09:00   0:00 -bash\n` +
        `${padEnd(c.sh.user, 8)}${padStart(String(pid + 33), 8)}  0.0  0.0  13084  3968 pts/0    R+   09:00   0:00 ps ${c.args.join(' ')}\n`,
    );
    return 0;
  }
  c.out(`    PID TTY          TIME CMD\n${padStart(String(pid), 7)} pts/0    00:00:00 bash\n${padStart(String(pid + 33), 7)} pts/0    00:00:00 ps\n`);
  return 0;
};

const top: Builtin = (c) => {
  const d = new Date(c.sh.now());
  c.out(
    `top - ${formatDate('%T', d)} up ${upFor(c.sh.now() - c.sh.startedAt)},  1 user,  load average: 0.08, 0.03, 0.01\n` +
      'Tasks:   3 total,   1 running,   2 sleeping,   0 stopped,   0 zombie\n' +
      '%Cpu(s):  1.2 us,  0.4 sy,  0.0 ni, 98.3 id,  0.0 wa,  0.0 hi,  0.1 si,  0.0 st\n' +
      'MiB Mem :   4000.0 total,   2800.0 free,    812.0 used,    388.0 buff/cache\n\n' +
      paint(C.bold, '    PID USER      PR  NI    VIRT    RES    SHR S  %CPU  %MEM     TIME+ COMMAND') +
      '\n' +
      `      1 root      20   0  167280  11504   8160 S   0.0   0.3   0:01.02 init\n` +
      `${padStart(String(c.sh.pid), 7)} ${padEnd(c.sh.user, 9)} 20   0   11264   5376   3328 S   0.0   0.1   0:00.04 bash\n` +
      `${padStart(String(c.sh.pid + 40), 7)} ${padEnd(c.sh.user, 9)} 20   0   12536   4224   3328 R   0.3   0.1   0:00.01 top\n` +
      paint(C.gray, '(한 번만 보여 줘요. 끝내려면 q 대신 그냥 다음 명령을 쓰세요)') +
      '\n',
  );
  return 0;
};

const kill: Builtin = (c) => {
  const pids = c.args.filter((a) => /^\d+$/.test(a));
  if (!pids.length) {
    c.err('kill: 사용법: kill [-s 시그널 | -n 시그널번호 | -시그널] pid\n');
    return 2;
  }
  for (const p of pids) {
    if (Number(p) === c.sh.pid) {
      c.io.close();
      return 0;
    }
    if (p === '1') {
      c.err(`bash: kill: (1) - 명령을 허용하지 않음\n`);
      continue;
    }
    c.err(`bash: kill: (${p}) - 그런 프로세스가 없음\n`);
  }
  return 1;
};

const env: Builtin = (c) => {
  c.out(
    `${[...c.sh.env.entries()]
      .filter(([k]) => /^[A-Za-z_]/.test(k))
      .map(([k, v]) => `${k}=${v}`)
      .join('\n')}\n`,
  );
  return 0;
};

const printenv: Builtin = (c) => {
  if (!c.args.length) return env(c);
  let status = 0;
  for (const k of c.args) {
    const v = c.sh.env.get(k);
    if (v === undefined) status = 1;
    else c.out(`${v}\n`);
  }
  return status;
};

const exportCmd: Builtin = (c) => {
  if (!c.args.length || c.args[0] === '-p') {
    c.out(
      `${[...c.sh.env.entries()]
        .filter(([k]) => /^[A-Za-z_]/.test(k))
        .map(([k, v]) => `declare -x ${k}="${v}"`)
        .join('\n')}\n`,
    );
    return 0;
  }
  for (const a of c.args) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)(?:=([\s\S]*))?$/.exec(a);
    if (!m) {
      c.err(`bash: export: \`${a}': 올바른 식별자가 아님\n`);
      return 1;
    }
    if (m[2] !== undefined) c.sh.env.set(m[1], m[2]);
    else if (!c.sh.env.has(m[1])) c.sh.env.set(m[1], '');
  }
  return 0;
};

const unset: Builtin = (c) => {
  for (const a of c.args) c.sh.env.delete(a);
  return 0;
};

const alias: Builtin = (c) => {
  if (!c.args.length) {
    const list = [...c.sh.aliases.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
    c.out(list.map(([k, v]) => `alias ${k}='${v}'\n`).join(''));
    return 0;
  }
  let status = 0;
  for (const a of c.args) {
    const eq = a.indexOf('=');
    if (eq < 0) {
      const v = c.sh.aliases.get(a);
      if (v === undefined) {
        c.err(`bash: alias: ${a}: 찾을 수 없음\n`);
        status = 1;
      } else c.out(`alias ${a}='${v}'\n`);
      continue;
    }
    c.sh.aliases.set(a.slice(0, eq), a.slice(eq + 1));
  }
  return status;
};

const unalias: Builtin = (c) => {
  if (c.args[0] === '-a') {
    c.sh.aliases.clear();
    return 0;
  }
  let status = 0;
  for (const a of c.args) {
    if (!c.sh.aliases.delete(a)) {
      c.err(`bash: unalias: ${a}: 찾을 수 없음\n`);
      status = 1;
    }
  }
  return status;
};

const history: Builtin = (c) => {
  if (c.args[0] === '-c') {
    c.sh.history.length = 0;
    return 0;
  }
  const n = Number(c.args[0]) || c.sh.history.length;
  const start = Math.max(0, c.sh.history.length - n);
  c.out(
    c.sh.history
      .slice(start)
      .map((h, i) => `${padStart(String(start + i + 1), 5)}  ${h}\n`)
      .join(''),
  );
  return 0;
};

const SHELL_BUILTINS = new Set([
  'cd',
  'echo',
  'export',
  'unset',
  'alias',
  'unalias',
  'history',
  'exit',
  'logout',
  'type',
  'help',
  'source',
  '.',
  'pwd',
  'true',
  'false',
  'printf',
  'kill',
]);

function whereIs(name: string): string | null {
  if ((BIN_COMMANDS as readonly string[]).includes(name)) return `/bin/${name}`;
  if ((USR_BIN_COMMANDS as readonly string[]).includes(name)) return `/usr/bin/${name}`;
  return null;
}

const which: Builtin = (c) => {
  let status = 0;
  for (const a of c.args) {
    const p = whereIs(a);
    if (p) c.out(`${p}\n`);
    else status = 1;
  }
  return status;
};

const type: Builtin = (c) => {
  let status = 0;
  for (const a of c.args) {
    const al = c.sh.aliases.get(a);
    if (al !== undefined) c.out(`${a} 은(는) \`${al}' 의 별칭임\n`);
    else if (SHELL_BUILTINS.has(a)) c.out(`${a} 은(는) 셸 내장임\n`);
    else if (whereIs(a)) c.out(`${a} 은(는) ${whereIs(a)} 임\n`);
    else {
      c.err(`bash: type: ${a}: 찾을 수 없음\n`);
      status = 1;
    }
  }
  return status;
};

/** man 에 보일 한 줄 설명 */
const MAN: Record<string, string> = {
  ls: 'ls - 디렉터리 내용 보기\n\n  ls [-a] [-l] [-h] [-1] [-R] [-F] [파일]...',
  cd: 'cd - 작업 디렉터리 바꾸기 (셸 내장)\n\n  cd [디렉터리]   cd ~  cd -  cd ..',
  cat: 'cat - 파일을 이어 붙여 보여 주기\n\n  cat [-n] [파일]...',
  echo: 'echo - 글 한 줄 쓰기\n\n  echo [-n] [-e] [글]...   (-e: \\n \\t \\e[31m 같은 역슬래시 글자)',
  grep: 'grep - 패턴에 맞는 줄 찾기\n\n  grep [-i] [-n] [-v] [-c] [-r] [-w] [-F] 패턴 [파일]...',
  find: 'find - 파일 찾기\n\n  find [경로]... [-name 패턴] [-iname 패턴] [-type f|d] [-maxdepth N]',
  rm: 'rm - 파일·디렉터리 지우기\n\n  rm [-r] [-f] [-i] [-v] 파일...',
  cp: 'cp - 복사\n\n  cp [-r] 원본... 대상',
  mv: 'mv - 옮기기·이름 바꾸기\n\n  mv 원본... 대상',
  mkdir: 'mkdir - 디렉터리 만들기\n\n  mkdir [-p] 디렉터리...',
  chmod: 'chmod - 파일 권한 바꾸기\n\n  chmod 755 파일, chmod +x 파일, chmod u-w 파일',
  nano: 'nano - 쉬운 글 편집기\n\n  nano 파일   (Ctrl+O 저장, Ctrl+X 나가기)',
  head: 'head - 파일 앞부분\n\n  head [-n 줄수] [파일]...',
  tail: 'tail - 파일 뒷부분\n\n  tail [-n 줄수] [파일]...',
  wc: 'wc - 줄·낱말·바이트 세기\n\n  wc [-l] [-w] [-c] [파일]...',
  sort: 'sort - 줄 정렬\n\n  sort [-r] [-n] [-u] [-f] [파일]...',
  uniq: 'uniq - 이어진 같은 줄 하나로\n\n  uniq [-c] [-d] [-u] [파일]',
  date: 'date - 날짜·시각\n\n  date [+형식]   (예: date +%Y-%m-%d)',
  cal: 'cal - 달력\n\n  cal [달 년도]',
  tree: 'tree - 디렉터리를 나무 모양으로\n\n  tree [-a] [-L 깊이] [디렉터리]',
  history: 'history - 쓴 명령 목록 (셸 내장)\n\n  history [-c] [개수]',
  alias: "alias - 줄임 명령 (셸 내장)\n\n  alias 이름='명령'",
  kok: 'kok - KOK 관리 모드\n\n  kok setting   (~/setting 과 같아요. 설명은 cat ~/help.txt)',
  setting: 'setting - KOK 관리 모드 (~/setting)\n\n  ./setting   설명은 cat ~/help.txt 의 2장',
};

const man: Builtin = (c) => {
  const what = c.args[0];
  if (!what) {
    c.err("어떤 매뉴얼 페이지를 원하십니까?\n예를 들어, `man man'을 입력해 보십시오.\n");
    return 1;
  }
  if (what === 'man') {
    c.out(`${paint(C.bold, 'MAN(1)')}\n\n  man - 명령 설명서\n\n  man 명령   (예: man ls)\n`);
    return 0;
  }
  const page = MAN[what];
  if (!page) {
    if (COMMANDS[what]) {
      c.out(`${paint(C.bold, `${what.toUpperCase()}(1)`)}\n\n  ${what} - 쓰는 법은 ${what} --help 나 cat ~/help.txt 를 보세요\n`);
      return 0;
    }
    c.err(`${what}에 대한 매뉴얼 항목이 없습니다\n`);
    return 16;
  }
  c.out(`${paint(C.bold, `${what.toUpperCase()}(1)`)}\n\n  ${page.replace(/\n/g, '\n  ')}\n`);
  return 0;
};

const help: Builtin = (c) => {
  c.out(
    `GNU bash, 버전 5.2.21(1)-release (x86_64-pc-linux-gnu)\n` +
      `KOK 터미널의 명령과 단축키는 ${paint(C.bold, 'cat ~/help.txt')} 에 모두 있어요.\n` +
      `KOK 자료·복습 데이터는 ${paint(C.bold, './setting')} 으로 관리해요.\n\n` +
      `셸 내장: cd echo export unset alias unalias history type help source exit\n`,
  );
  return 0;
};

const clear: Builtin = (c) => {
  c.io.clear();
  return 0;
};

const exit: Builtin = (c) => {
  c.out('logout\n');
  c.io.close();
  return Number(c.args[0]) || 0;
};

const sleep: Builtin = (c) => {
  const secs = Math.min(
    60,
    c.args.reduce((a, s) => a + (parseFloat(s) || 0) * (s.endsWith('m') ? 60 : 1), 0),
  );
  if (!c.args.length) {
    c.err('sleep: operand가 빠짐\n');
    return 1;
  }
  return new Promise<number>((resolve, reject) => {
    const t = setTimeout(() => resolve(0), secs * 1000);
    c.io.signal.addEventListener('abort', () => {
      clearTimeout(t);
      reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    });
  });
};

const seq: Builtin = (c) => {
  const nums = c.args.map(Number);
  if (!nums.length || nums.some((n) => !Number.isFinite(n))) {
    c.err('seq: operand가 빠짐\n');
    return 1;
  }
  const [first, inc, last] = nums.length === 1 ? [1, 1, nums[0]] : nums.length === 2 ? [nums[0], 1, nums[1]] : nums;
  if (!inc) return 1;
  const out: string[] = [];
  for (let v = first; inc > 0 ? v <= last : v >= last; v += inc) {
    out.push(String(Math.round(v * 1e9) / 1e9));
    if (out.length >= 10_000) break;
  }
  if (out.length) c.out(`${out.join('\n')}\n`);
  return 0;
};

const sudo: Builtin = async (c) => {
  if (!c.args.length) {
    c.err('usage: sudo -h | -K | -k | -V\nusage: sudo [-u user] command\n');
    return 1;
  }
  for (let i = 0; i < 3; i++) {
    const pw = await c.io.ask(`[sudo] ${c.sh.user}의 암호: `, { secret: true });
    if (pw === null) return 1;
    if (pw) break;
    if (i < 2) c.err('죄송합니다만, 다시 시도하십시오.\n');
  }
  c.err(`${c.sh.user} 은(는) sudoers 설정 파일에 없습니다.  이 시도를 보고합니다.\n`);
  return 1;
};

const su: Builtin = async (c) => {
  const pw = await c.io.ask('암호: ', { secret: true });
  if (pw === null) return 1;
  c.err('su: 인증 실패\n');
  return 1;
};

const apt: Builtin = (c) => {
  const sub = c.args[0];
  if (!sub) {
    c.out(
      'apt 2.7.14 (amd64)\n사용법: apt [옵션] 명령\n\n주로 쓰는 명령:\n  list - 패키지 목록\n  search - 패키지 설명 검색\n  install - 패키지 설치\n  update - 패키지 목록 업데이트\n',
    );
    return 0;
  }
  if (sub === 'list' || sub === 'search' || sub === 'show') {
    c.out('나열 중... 완료\nkok-study/now 1.0 amd64 [설치함]\n');
    return 0;
  }
  c.err(
    'E: 잠금 파일 /var/lib/dpkg/lock-frontend 파일을 열 수 없습니다 - open (13: 허가 거부)\n' +
      'E: 관리 디렉터리를 (/var/lib/dpkg/) 잠글 수 없습니다. 루트 사용자입니까?\n',
  );
  return 100;
};

const neofetch: Builtin = (c) => {
  const logo = ['  _  __  ___   _  __', ' | |/ / / _ \\ | |/ /', " | ' / | | | || ' / ", ' | . \\ | |_| || . \\ ', ' |_|\\_\\ \\___/ |_|\\_\\', ''];
  const up = Math.floor((c.sh.now() - c.sh.startedAt) / 60_000);
  const title = `${c.sh.user}@${HOST}`;
  const info = [
    paint(C.boldGreen, title),
    '-'.repeat(cells(title)),
    `${paint(C.boldGreen, 'OS')}: ${OS_NAME} x86_64`,
    `${paint(C.boldGreen, 'Host')}: KOK 공부 앱`,
    `${paint(C.boldGreen, 'Kernel')}: ${KERNEL}`,
    `${paint(C.boldGreen, 'Uptime')}: ${up} mins`,
    `${paint(C.boldGreen, 'Shell')}: bash 5.2.21`,
    `${paint(C.boldGreen, 'Terminal')}: kok-term`,
    `${paint(C.boldGreen, 'CPU')}: KOK Study Core (2) @ 2.40GHz`,
    `${paint(C.boldGreen, 'Memory')}: 812MiB / 4000MiB`,
    `${paint(C.boldGreen, 'Disk (/)')}: ${human(c.sh.fs.usedBytes())}B / ${human(FS_MAX_BYTES)}B`,
    '',
    ['\x1b[40m', '\x1b[41m', '\x1b[42m', '\x1b[43m', '\x1b[44m', '\x1b[45m', '\x1b[46m', '\x1b[47m'].map((b) => `${b}   ${C.reset}`).join(''),
  ];
  const side = c.io.cols() >= 58;
  const out: string[] = [];
  if (side) {
    for (let i = 0; i < Math.max(logo.length, info.length); i++) out.push(`${paint(C.boldGreen, padEnd(logo[i] ?? '', 22))} ${info[i] ?? ''}`);
  } else out.push(...logo.map((l) => paint(C.boldGreen, l)), ...info);
  c.out(`${out.join('\n')}\n`);
  return 0;
};

/** source 파일 · . 파일: 지금 셸에서 */
const source: Builtin = async (c) => {
  const f = c.args[0];
  if (!f) {
    c.err(`bash: ${c.name}: 파일 이름 인자가 필요함\n`);
    return 2;
  }
  let text: string;
  try {
    text = c.sh.readPath(f);
  } catch (e) {
    c.err(`bash: ${f}: ${fsMsg(e)}\n`);
    return 1;
  }
  return c.sh.runScript(text, { ...c, name: f, args: c.args.slice(1) }, 0, true);
};

/** bash 파일 · sh 파일: 실행 권한 없이도 스크립트 실행 (인자가 없으면 이미 셸 안이라고) */
const bash: Builtin = async (c) => {
  const f = c.args.find((a) => !a.startsWith('-'));
  if (!f) {
    if (c.args.includes('--version')) {
      c.out('GNU bash, 버전 5.2.21(1)-release (x86_64-pc-linux-gnu)\n');
      return 0;
    }
    c.out(paint(C.gray, '(이미 bash 안이에요. 스크립트를 실행하려면 bash 파일이름)\n'));
    return 0;
  }
  let text: string;
  try {
    text = c.sh.readPath(f);
  } catch (e) {
    c.err(`${c.name}: ${f}: ${fsMsg(e)}\n`);
    return 127;
  }
  return c.sh.runScript(text, { ...c, name: f, args: c.args.slice(c.args.indexOf(f) + 1) }, 0, false);
};

/** kok setting: ~/setting 과 같은 KOK 관리 모드 */
const kok: Builtin = (c) => {
  if (!c.args.length || c.args[0] === 'setting') return c.sh.runScript('#!/usr/bin/kok\n', { ...c, args: c.args.slice(1) }, 0, false);
  if (c.args[0] === '--version' || c.args[0] === '-v') {
    c.out('kok 1.0\n');
    return 0;
  }
  c.err(`kok: 알 수 없는 명령 '${c.args[0]}'\n사용법: kok setting\n`);
  return 2;
};

const truthy: Builtin = () => 0;
const falsy: Builtin = () => 1;

export const COMMANDS: Record<string, Builtin> = {
  '.': source,
  alias,
  apt,
  'apt-get': apt,
  basename: pathPart((p) => basename(p)),
  bash,
  cal,
  cat,
  cd,
  chmod,
  clear,
  cp: cpMv(false),
  date,
  df,
  dirname: pathPart((p) => dirname(p)),
  du,
  echo,
  env,
  exit,
  export: exportCmd,
  false: falsy,
  file: fileCmd,
  find,
  free,
  grep,
  head: headTail(false),
  help,
  history,
  hostname,
  id,
  kill,
  kok,
  less: cat,
  logout: exit,
  ls,
  man,
  mkdir,
  more: cat,
  mv: cpMv(true),
  nano,
  neofetch,
  printenv,
  printf,
  ps,
  pwd,
  realpath: pathPart((p) => normalize(p)),
  rm,
  rmdir,
  seq,
  sh: bash,
  sleep,
  sort,
  source,
  stat,
  su,
  sudo,
  tail: headTail(true),
  top,
  touch,
  tree,
  true: truthy,
  type,
  uname,
  unalias,
  uniq,
  unset,
  uptime,
  wc,
  which,
  whoami,
};

/** 설치되지 않은 프로그램 (apt 로 설치하라는 안내: 우분투처럼) */
export const NOT_INSTALLED: Record<string, string> = {
  vim: 'vim',
  vi: 'vim',
  emacs: 'emacs',
  git: 'git',
  python: 'python3',
  python3: 'python3',
  pip: 'python3-pip',
  node: 'nodejs',
  npm: 'npm',
  gcc: 'gcc',
  java: 'default-jre',
  htop: 'htop',
  curl: 'curl',
  wget: 'wget',
  docker: 'docker.io',
  cowsay: 'cowsay',
  sl: 'sl',
};
