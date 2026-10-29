// 터미널의 가상 파일 시스템 (이 기기에만 저장: components/terminal 이 localStorage 에 둔다).
// 리눅스처럼 / 아래 bin·etc·home·tmp … 이 있고, 쓸 수 있는 곳은 내 집(/home/<나>)과 /tmp 뿐이다 (나머지는 '허가 거부').
// 화면과 상관없는 순수 코드 (시험 term.test.ts)
import { byteLength } from './text';

export type VFile = { t: 'f'; mode: number; mtime: number; data: string };
export type VDir = { t: 'd'; mode: number; mtime: number; kids: Record<string, VNode> };
export type VNode = VFile | VDir;

export type FsCode = 'ENOENT' | 'ENOTDIR' | 'EISDIR' | 'EEXIST' | 'EACCES' | 'ENOTEMPTY' | 'EINVAL' | 'ENOSPC';

/** 리눅스(한국어)와 같은 오류 글 */
export const FS_MESSAGE: Record<FsCode, string> = {
  ENOENT: '그런 파일이나 디렉터리가 없습니다',
  ENOTDIR: '디렉터리가 아닙니다',
  EISDIR: '디렉터리입니다',
  EEXIST: '파일이 있습니다',
  EACCES: '허가 거부',
  ENOTEMPTY: '디렉터리가 비어있지 않음',
  EINVAL: '잘못된 인자',
  ENOSPC: '장치에 남은 공간이 없음',
};

export class FsFail extends Error {
  constructor(
    public code: FsCode,
    public path: string,
  ) {
    super(FS_MESSAGE[code]);
  }
}

/** 모든 파일을 합친 크기의 끝 (기기 저장 공간을 아끼게) */
export const FS_MAX_BYTES = 400_000;

/** 경로 정리: 빈 칸·'.'·'..' 을 푼 절대 경로 */
export function normalize(p: string): string {
  const parts: string[] = [];
  for (const seg of p.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return `/${parts.join('/')}`;
}

export function dirname(p: string): string {
  const n = normalize(p);
  const i = n.lastIndexOf('/');
  return i <= 0 ? '/' : n.slice(0, i);
}

export function basename(p: string): string {
  const n = normalize(p);
  return n === '/' ? '/' : n.slice(n.lastIndexOf('/') + 1);
}

export const isDir = (n: VNode | null | undefined): n is VDir => !!n && n.t === 'd';
export const isFile = (n: VNode | null | undefined): n is VFile => !!n && n.t === 'f';
export const isExec = (n: VNode | null | undefined): boolean => isFile(n) && (n.mode & 0o111) !== 0;

export class Vfs {
  constructor(
    public root: VDir,
    /** 내 집 (쓸 수 있는 곳) */
    public home: string,
    private now: () => number = () => Date.now(),
  ) {}

  /** cwd 를 기준으로 p 의 절대 경로 */
  abs(cwd: string, p: string): string {
    return normalize(p.startsWith('/') ? p : `${cwd}/${p}`);
  }

  node(abs: string): VNode | null {
    let cur: VNode = this.root;
    for (const seg of normalize(abs).split('/').filter(Boolean)) {
      if (!isDir(cur)) return null;
      const next: VNode | undefined = cur.kids[seg];
      if (!next) return null;
      cur = next;
    }
    return cur;
  }

  /** 읽을 수 있는지: /root 는 관리자(root)만 */
  canRead(abs: string): boolean {
    const n = normalize(abs);
    return !(n === '/root' || n.startsWith('/root/'));
  }

  /** 쓸 수 있는지: 내 집과 /tmp 아래만 */
  canWrite(abs: string): boolean {
    const n = normalize(abs);
    const under = (base: string) => n === base || n.startsWith(`${base}/`);
    return under(this.home) || under('/tmp');
  }

  /** 디렉터리 (없거나 파일이면 오류) */
  dir(abs: string): VDir {
    if (!this.canRead(abs)) throw new FsFail('EACCES', abs);
    const n = this.node(abs);
    if (!n) throw new FsFail('ENOENT', abs);
    if (!isDir(n)) throw new FsFail('ENOTDIR', abs);
    return n;
  }

  /** 부모 디렉터리와 이름 (부모가 없으면 오류) */
  private parentOf(abs: string): { dir: VDir; name: string } {
    const n = normalize(abs);
    if (n === '/') throw new FsFail('EINVAL', abs);
    const parent = this.node(dirname(n));
    if (!parent) throw new FsFail('ENOENT', abs);
    if (!isDir(parent)) throw new FsFail('ENOTDIR', abs);
    return { dir: parent, name: basename(n) };
  }

  readFile(abs: string): string {
    if (!this.canRead(abs)) throw new FsFail('EACCES', abs);
    const n = this.node(abs);
    if (!n) throw new FsFail('ENOENT', abs);
    if (isDir(n)) throw new FsFail('EISDIR', abs);
    return n.data;
  }

  readdir(abs: string): string[] {
    return Object.keys(this.dir(abs).kids).sort(byName);
  }

  /** 모든 파일 크기의 합 */
  usedBytes(): number {
    const walk = (d: VDir): number => Object.values(d.kids).reduce((a, k) => a + (isDir(k) ? walk(k) : byteLength(k.data)), 0);
    return walk(this.root);
  }

  writeFile(abs: string, data: string, append = false): void {
    const { dir, name } = this.parentOf(abs);
    const cur = dir.kids[name];
    if (isDir(cur)) throw new FsFail('EISDIR', abs);
    if (!this.canWrite(abs)) throw new FsFail('EACCES', abs);
    const next = append && cur ? cur.data + data : data;
    const grow = byteLength(next) - (cur ? byteLength(cur.data) : 0);
    if (grow > 0 && this.usedBytes() + grow > FS_MAX_BYTES) throw new FsFail('ENOSPC', abs);
    const t = this.now();
    if (cur) {
      cur.data = next;
      cur.mtime = t;
    } else {
      dir.kids[name] = { t: 'f', mode: 0o644, mtime: t, data: next };
      dir.mtime = t;
    }
  }

  /** 빈 파일 만들기 또는 고친 시각만 바꾸기 */
  touch(abs: string): void {
    const n = this.node(abs);
    if (n) {
      if (!this.canWrite(abs)) throw new FsFail('EACCES', abs);
      n.mtime = this.now();
      return;
    }
    this.writeFile(abs, '');
  }

  mkdir(abs: string, parents = false): void {
    const n = normalize(abs);
    if (parents) {
      let cur = '';
      for (const seg of n.split('/').filter(Boolean)) {
        cur += `/${seg}`;
        const node = this.node(cur);
        if (isDir(node)) continue;
        if (node) throw new FsFail('EEXIST', cur);
        this.mkdir(cur);
      }
      return;
    }
    const { dir, name } = this.parentOf(n);
    if (dir.kids[name]) throw new FsFail('EEXIST', n);
    if (!this.canWrite(n)) throw new FsFail('EACCES', n);
    const t = this.now();
    dir.kids[name] = { t: 'd', mode: 0o755, mtime: t, kids: {} };
    dir.mtime = t;
  }

  rmdir(abs: string): void {
    const n = this.node(abs);
    if (!n) throw new FsFail('ENOENT', abs);
    if (!isDir(n)) throw new FsFail('ENOTDIR', abs);
    if (Object.keys(n.kids).length) throw new FsFail('ENOTEMPTY', abs);
    this.unlink(abs);
  }

  /** 파일(또는 recursive 면 디렉터리째) 지우기 */
  remove(abs: string, recursive = false): void {
    const n = this.node(abs);
    if (!n) throw new FsFail('ENOENT', abs);
    if (isDir(n) && !recursive) throw new FsFail('EISDIR', abs);
    this.unlink(abs);
  }

  private unlink(abs: string): void {
    const { dir, name } = this.parentOf(abs);
    if (!this.canWrite(abs) || normalize(abs) === this.home) throw new FsFail('EACCES', abs);
    delete dir.kids[name];
    dir.mtime = this.now();
  }

  /** 복사 (디렉터리는 recursive 일 때만). dst 가 디렉터리면 그 안에 같은 이름으로 */
  copy(src: string, dst: string, recursive = false): void {
    const from = this.node(src);
    if (!from || !this.canRead(src)) throw new FsFail(from ? 'EACCES' : 'ENOENT', src);
    if (isDir(from) && !recursive) throw new FsFail('EISDIR', src);
    let target = normalize(dst);
    if (isDir(this.node(target))) target = normalize(`${target}/${basename(src)}`);
    if (isDir(from) && (target === normalize(src) || target.startsWith(`${normalize(src)}/`))) throw new FsFail('EINVAL', dst);
    const clone = JSON.parse(JSON.stringify(from)) as VNode;
    const grow = isDir(clone) ? sizeOf(clone) : byteLength(clone.data);
    if (this.usedBytes() + grow > FS_MAX_BYTES) throw new FsFail('ENOSPC', dst);
    const { dir, name } = this.parentOf(target);
    if (!this.canWrite(target)) throw new FsFail('EACCES', target);
    if (isDir(dir.kids[name]) && !isDir(clone)) throw new FsFail('EISDIR', target);
    const t = this.now();
    stamp(clone, t);
    dir.kids[name] = clone;
    dir.mtime = t;
  }

  /** 옮기기·이름 바꾸기. dst 가 디렉터리면 그 안으로 */
  move(src: string, dst: string): void {
    const from = this.node(src);
    if (!from) throw new FsFail('ENOENT', src);
    let target = normalize(dst);
    if (isDir(this.node(target))) target = normalize(`${target}/${basename(src)}`);
    if (target === normalize(src)) return;
    if (isDir(from) && target.startsWith(`${normalize(src)}/`)) throw new FsFail('EINVAL', dst);
    if (!this.canWrite(src)) throw new FsFail('EACCES', src);
    const { dir, name } = this.parentOf(target);
    if (!this.canWrite(target)) throw new FsFail('EACCES', target);
    if (isDir(dir.kids[name]) && !isDir(from)) throw new FsFail('EISDIR', target);
    const old = this.parentOf(src);
    delete old.dir.kids[old.name];
    dir.kids[name] = from;
    const t = this.now();
    dir.mtime = t;
    old.dir.mtime = t;
  }

  chmod(abs: string, mode: number): void {
    const n = this.node(abs);
    if (!n) throw new FsFail('ENOENT', abs);
    if (!this.canWrite(abs)) throw new FsFail('EACCES', abs);
    n.mode = mode & 0o777;
  }

  serialize(): string {
    return JSON.stringify(this.root);
  }
}

/** 이름 차례 (점 파일·대소문자 상관없이 글자 차례) */
export function byName(a: string, b: string): number {
  const x = a.replace(/^\./, '').toLowerCase();
  const y = b.replace(/^\./, '').toLowerCase();
  return x < y ? -1 : x > y ? 1 : a < b ? -1 : a > b ? 1 : 0;
}

/** 디렉터리 안 파일 크기의 합 */
export function sizeOf(n: VNode): number {
  return isDir(n) ? Object.values(n.kids).reduce((a, k) => a + sizeOf(k), 0) : byteLength(n.data);
}

function stamp(n: VNode, t: number) {
  n.mtime = t;
  if (isDir(n)) for (const k of Object.values(n.kids)) stamp(k, t);
}

/** 저장해 둔 파일 시스템 읽기 (모양이 이상하면 null) */
export function readTree(json: string | null): VDir | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json) as unknown;
    return validDir(v) ? v : null;
  } catch {
    return null;
  }
}

function validDir(v: unknown, depth = 0): v is VDir {
  if (!v || typeof v !== 'object' || depth > 32) return false;
  const d = v as Record<string, unknown>;
  if (d.t !== 'd' || typeof d.mode !== 'number' || typeof d.mtime !== 'number' || !d.kids || typeof d.kids !== 'object') return false;
  for (const [name, k] of Object.entries(d.kids as Record<string, unknown>)) {
    if (!name || name.includes('/') || name === '.' || name === '..') return false;
    const kid = k as Record<string, unknown> | null;
    if (!kid || typeof kid !== 'object') return false;
    if (kid.t === 'f') {
      if (typeof kid.data !== 'string' || typeof kid.mode !== 'number' || typeof kid.mtime !== 'number') return false;
    } else if (!validDir(kid, depth + 1)) return false;
  }
  return true;
}
