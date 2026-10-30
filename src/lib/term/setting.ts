// KOK setting: 터미널에서 ~/setting 을 실행하면 뜨는 관리 모드. 과목은 폴더, 자료(노트)는 파일처럼 보이고
// 자료·과목·복습 데이터를 명령어로 보고 고치고 지운다. 데이터는 KokApi(kok-api.ts: 앱과 같은 길)로만 읽고 쓴다.
// 화면과 상관없는 코드 (시험은 가짜 KokApi 로: term.test.ts)
import { ParseError, parse } from './parse';
import { C, clip, columns, padEnd, paint, table } from './text';
import type { Completion, Program, TermIO } from './types';

export type KSubject = { id: string; name: string; color: string; pinned: boolean; archived: boolean; position: number };
export type KNote = {
  id: string;
  title: string;
  subject_id: string;
  kind: 'text' | 'pdf' | 'image';
  status: string;
  progress: number;
  starred: boolean;
  in_review: boolean;
  created_at: string;
  unit: string;
  page_count: number | null;
};
export type KNoteBody = {
  title: string;
  summary: string;
  key_points: Array<{ title: string; explanation: string; importance: string; starred?: boolean }>;
  terms: Array<{ term: string; meaning: string }>;
  formulas: Array<{ latex: string; label: string }>;
};
export type KQuestion = {
  id: string;
  type: string;
  prompt: string;
  status: string;
  due: string | null;
  state: number | null;
  reps: number;
  lapses: number;
  wrong_count: number;
  in_wrong_note: boolean;
};
export type KStats = {
  total: number;
  due: number;
  doneToday: number;
  dailyMax: number;
  wrong: number;
  /** 쉬는 문제 수 */
  resting: number;
  /** 복습을 끈 노트의 문제 수 */
  reviewOff: number;
  byState: [number, number, number, number];
  bySubject: Array<{ name: string; cards: number; due: number }>;
};
export type KWrong = { question_id: string; prompt: string; subject: string; note: string; wrong_count: number };
export type KSession = { key: string; day: string | null; planned: number; answered: number };
export type KFeatures = { organize: boolean; merge: boolean; subjectDrawer: boolean; sessions: boolean };
export type KConfig = { key: string; value: string; label: string };

/** setting 이 쓰는 데이터 길 (앱과 같은 길: 브라우저 Supabase·서버 API. RLS 가 내 것만 허락한다) */
export interface KokApi {
  features: KFeatures;
  load(): Promise<{ subjects: KSubject[]; notes: KNote[] }>;
  noteBody(sourceId: string): Promise<KNoteBody | null>;
  /** versions: 노트에 버전이 있는지 (있으면 문제 지우기는 앱에서) */
  questions(sourceId: string): Promise<{ versions: boolean; list: KQuestion[] }>;
  rename(sourceId: string, title: string): Promise<void>;
  setFlag(ids: string[], flag: 'starred' | 'in_review', on: boolean): Promise<void>;
  move(ids: string[], subjectId: string): Promise<void>;
  remove(ids: string[]): Promise<void>;
  createSubject(name: string): Promise<KSubject>;
  updateSubject(id: string, patch: { name?: string; pinned?: boolean; archived?: boolean; position?: number }): Promise<void>;
  deleteSubject(id: string): Promise<void>;
  mergeSubjects(from: string, into: string): Promise<void>;
  stats(): Promise<KStats>;
  wrong(): Promise<KWrong[]>;
  unwrong(questionIds: string[]): Promise<void>;
  sessions(): Promise<KSession[]>;
  dropSession(key: string): Promise<void>;
  setQuestionStatus(questionIds: string[], status: 'active' | 'suspended'): Promise<void>;
  resetCards(questionIds: string[]): Promise<void>;
  deleteQuestions(questionIds: string[]): Promise<void>;
  config(): KConfig[];
  setConfig(key: string, value: string): Promise<string>;
}

const KIND = { text: '글', pdf: 'PDF', image: '사진' } as const;
const STATE = ['새 문제', '익히는 중', '복습', '다시 익히는 중'] as const;
const TYPE: Record<string, string> = { mcq: '객관식', ox: 'OX', cloze: '빈칸', short: '단답' };
const SESSION_NAME: Record<string, string> = { home: '홈 · 오늘의 KOK', review: '복습 탭', wrong: '오답 다시 풀기' };
const YES = /^(y|yes|ㅇ|ㅇㅇ|예|네|응)$/i;

export function noteName(n: Pick<KNote, 'title'>): string {
  return n.title.trim() || '제목 없는 자료';
}

function shortDate(iso: string, now: Date): string {
  const d = new Date(iso);
  return d.getFullYear() === now.getFullYear() ? `${d.getMonth() + 1}월 ${d.getDate()}일` : `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}.`;
}

/** 이름 비교: 빈칸 하나로, 대소문자 상관없이 */
const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();

/** 낱말에 따옴표 밖 * ? 가 있으면 패턴 */
type Arg = { text: string; glob: boolean };

/** 쓰는 법이 틀렸거나 할 수 없는 일: 빨간 '하지 못했어요' 없이 그 글만 보인다 (KokApi 도 던질 수 있다) */
export class SettingError extends Error {}
class Usage extends SettingError {}

export class SettingProgram implements Program {
  history: string[] = [];
  /** 마지막 명령의 끝 번호 (0 이면 됨: ./setting 명령 처럼 한 번만 부를 때 셸에 돌려준다) */
  status = 0;
  /** 셸 앞에 띄워 둔 관리 모드인지 (exit 로 셸로 돌아간다). 한 번만 부르는 ./setting ls 는 false */
  interactive = false;
  private subjects: KSubject[] = [];
  private notes: KNote[] = [];
  /** 지금 들어와 있는 과목 (null 이면 맨 위 /) */
  private cwd: string | null = null;
  private done = false;
  private onExit: () => void;
  private now: () => number;

  constructor(
    private api: KokApi,
    private user: string,
    o: { onExit?: () => void; now?: () => number } = {},
  ) {
    this.onExit = o.onExit ?? (() => {});
    this.now = o.now ?? (() => Date.now());
  }

  private get subject(): KSubject | null {
    return this.cwd ? (this.subjects.find((s) => s.id === this.cwd) ?? null) : null;
  }

  private path(): string {
    return this.subject ? `/${this.subject.name}` : '/';
  }

  title(): string {
    return `KOK setting: ${this.path()}`;
  }

  prompt(): string {
    return `${paint(C.boldCyan, 'setting')}:${paint(C.boldBlue, this.path())}$ `;
  }

  /** 처음: 데이터를 읽고 인사 (quiet: 한 번만 부를 때는 인사 없이). 못 읽으면 false (셸로 돌아간다) */
  async start(io: TermIO, o: { quiet?: boolean } = {}): Promise<boolean> {
    if (!o.quiet) io.print(paint(C.gray, 'KOK 데이터를 불러오는 중…\n'));
    try {
      await this.reload();
    } catch (e) {
      io.print(`${paint(C.red, 'setting: KOK 데이터를 불러오지 못했어요')}: ${(e as Error)?.message ?? e}\n`);
      return false;
    }
    if (o.quiet) return true;
    let due = '';
    try {
      const s = await this.api.stats();
      due = ` · 오늘 복습 ${s.due}문제`;
    } catch {
      /* 통계는 없어도 된다 */
    }
    const live = this.notes.filter((n) => n.status === 'ready').length;
    io.print(
      `${paint(C.boldCyan, 'KOK setting 1.0')} — 내 공부 데이터를 명령어로 관리해요.\n` +
        `과목 ${this.subjects.length}개 · 자료 ${live}개${due}\n` +
        `${paint(C.bold, 'help')} 로 명령을 보고, ${paint(C.bold, 'exit')} 로 나가요.\n`,
    );
    return true;
  }

  private async reload() {
    const r = await this.api.load();
    this.subjects = r.subjects;
    this.notes = r.notes;
    if (this.cwd && !this.subjects.some((s) => s.id === this.cwd)) this.cwd = null;
  }

  // ------------------------------------------------------------------ 이름 찾기
  private findSubject(raw: string): KSubject | null {
    const name = norm(raw.replace(/\/+$/, '').replace(/^\//, ''));
    if (!name) return null;
    return this.subjects.find((s) => norm(s.name) === name) ?? null;
  }

  /** 과목 하나 (없으면 Usage 오류) */
  private subjectArg(cmd: string, raw: string): KSubject {
    const s = this.findSubject(raw);
    if (!s) throw new Usage(`${cmd}: '${raw}': 그런 과목이 없어요`);
    return s;
  }

  /** 자료 고르기: #번호, 과목/이름, 이름 (지금 과목 안, 맨 위면 모든 과목), * ? 패턴 (과목 안) */
  private findNotes(cmd: string, a: Arg): KNote[] {
    const live = this.notes;
    const raw = a.text;
    if (raw.startsWith('#')) {
      const pre = raw.slice(1).toLowerCase();
      if (pre.length < 4) throw new Usage(`${cmd}: 번호는 # 뒤에 네 글자 이상 적어 주세요 (ls -l 에 보여요)`);
      const hit = live.filter((n) => n.id.toLowerCase().startsWith(pre));
      if (!hit.length) throw new Usage(`${cmd}: '${raw}': 그런 번호의 자료가 없어요`);
      if (hit.length > 1) throw new Usage(`${cmd}: '${raw}': 번호가 같은 자료가 여럿이에요. 더 길게 적어 주세요`);
      return hit;
    }
    let scope = this.cwd;
    let name = raw;
    const slash = raw.lastIndexOf('/');
    if (slash >= 0) {
      const dir = raw.slice(0, slash);
      name = raw.slice(slash + 1);
      if (dir === '' || dir === '/') scope = null;
      else if (dir === '..') scope = null;
      else {
        const s = this.findSubject(dir);
        if (!s) throw new Usage(`${cmd}: '${dir}': 그런 과목이 없어요`);
        scope = s.id;
      }
    }
    const pool = scope ? live.filter((n) => n.subject_id === scope) : live;
    if (a.glob) {
      if (!scope) throw new Usage(`${cmd}: * 는 과목 안에서 써요 (cd 과목 으로 들어간 뒤)`);
      const re = new RegExp(
        `^${name
          .replace(/[.+^${}()|[\]\\]/g, '\\$&')
          .replace(/\*/g, '.*')
          .replace(/\?/g, '.')}$`,
        'iu',
      );
      const hit = pool.filter((n) => re.test(noteName(n)));
      if (!hit.length) throw new Usage(`${cmd}: '${raw}': 맞는 자료가 없어요`);
      return hit;
    }
    const exact = pool.filter((n) => norm(noteName(n)) === norm(name));
    if (exact.length === 1) return exact;
    if (exact.length > 1) {
      throw new Usage(
        `${cmd}: '${raw}': 같은 이름의 자료가 ${exact.length}개 있어요. #번호로 골라 주세요: ${exact.map((n) => `#${n.id.slice(0, 6)}`).join(', ')}`,
      );
    }
    const sub = this.subjects.find((s) => norm(s.name) === norm(name.replace(/\/$/, '')));
    if (sub) throw new Usage(`${cmd}: '${raw}': 과목이에요 (자료가 아니에요)`);
    throw new Usage(`${cmd}: '${raw}': 그런 자료가 없어요${scope ? '' : ' (과목 안의 자료는 과목/이름 으로, 또는 cd 과목 으로 들어가서)'}`);
  }

  private notesArgs(cmd: string, args: Arg[]): KNote[] {
    if (!args.length) throw new Usage(`${cmd}: 자료를 적어 주세요 (예: ${cmd} 광합성)`);
    const seen = new Map<string, KNote>();
    for (const a of args) for (const n of this.findNotes(cmd, a)) seen.set(n.id, n);
    return [...seen.values()];
  }

  private ready(cmd: string, list: KNote[]): KNote[] {
    const busy = list.filter((n) => n.status !== 'ready');
    if (busy.length && busy.length === list.length) {
      throw new Usage(`${cmd}: '${noteName(busy[0])}'는 아직 ${busy[0].status === 'error' ? '멈춘' : '정리 중인'} 자료예요`);
    }
    return list.filter((n) => n.status === 'ready');
  }

  private async confirm(io: TermIO, question: string): Promise<boolean> {
    const a = await io.ask(`${question} [y/N] `);
    return !!a && YES.test(a.trim());
  }

  private need(flag: keyof KFeatures) {
    if (!this.api.features[flag]) throw new Usage('이 기능은 아직 쓸 수 없어요 (운영자가 데이터베이스를 새로 고치면 돼요)');
  }

  // ------------------------------------------------------------------ 실행
  async run(line: string, io: TermIO): Promise<void> {
    if (line.trim() && this.history[this.history.length - 1] !== line) this.history.push(line);
    if (this.history.length > 500) this.history.splice(0, this.history.length - 500);
    this.status = 0;
    let words: Arg[];
    try {
      // #번호 (자료 고르기) 는 주석이 아니다: 낱말 처음의 # 을 글자로
      const script = parse(keepHashes(line));
      if (!script.length) return;
      if (script.length > 1 || script[0].pipeline.length > 1 || script[0].pipeline[0].redirs.length) {
        io.print(`setting: 여기서는 명령을 하나씩 써요 (| ; > 는 exit 로 나간 셸에서)\n`);
        this.status = 2;
        return;
      }
      words = script[0].pipeline[0].words.map((w) => ({
        text: w.map((p) => p.text).join(''),
        glob: w.some((p) => p.quote === 'none' && /[*?]/.test(p.text)),
      }));
    } catch (e) {
      if (e instanceof ParseError) {
        io.print(`setting: ${e.message}\n`);
        this.status = 2;
        return;
      }
      throw e;
    }
    if (!words.length) return;
    const [cmd, ...args] = words;
    try {
      await this.dispatch(cmd.text, args, io);
    } catch (e) {
      this.status = 1;
      if (e instanceof SettingError) io.print(`${e.message}\n`);
      else io.print(`${paint(C.red, `${cmd.text}: 하지 못했어요`)}: ${(e as Error)?.message ?? e}\n`);
    }
  }

  private async dispatch(cmd: string, args: Arg[], io: TermIO): Promise<void> {
    const flags = new Set(args.filter((a) => /^-[a-z]+$/i.test(a.text)).flatMap((a) => a.text.slice(1).split('')));
    const rest = args.filter((a) => !/^-[a-z]+$/i.test(a.text) || a.text === '-');
    const texts = rest.map((a) => a.text);
    switch (cmd) {
      case 'help':
      case '?':
        return this.help(io, texts[0]);
      case 'exit':
      case 'quit':
      case 'logout':
      case 'q!':
        this.exit(io);
        return;
      case 'clear':
        io.clear();
        return;
      case 'whoami':
        io.print(`${this.user}\n`);
        return;
      case 'pwd':
        io.print(`${this.path()}\n`);
        return;
      case 'ls':
      case 'll':
      case 'dir':
        return this.ls(io, texts[0], flags.has('l') || cmd === 'll', flags.has('a'));
      case 'cd':
        return this.cd(texts[0]);
      case 'tree':
        return this.tree(io);
      case 'cat':
      case 'less':
      case 'more':
        return this.cat(io, rest);
      case 'info':
      case 'stat':
        return this.info(io, rest);
      case 'find':
      case 'grep':
        return this.find(io, texts.join(' '));
      case 'mv':
      case 'rename':
        return this.mv(io, rest);
      case 'rm':
        return this.rm(io, rest, flags.has('r') || flags.has('R'), flags.has('f'));
      case 'star':
      case 'unstar':
        return this.flag(io, cmd, rest, 'starred', cmd === 'star');
      case 'review':
        return this.review(io, rest);
      case 'mkdir':
        return this.mkdir(io, texts);
      case 'rmdir':
        return this.rmdir(io, texts);
      case 'merge':
        return this.merge(io, texts);
      case 'pin':
      case 'unpin':
      case 'archive':
      case 'unarchive':
        return this.subjectFlag(io, cmd, texts);
      case 'stats':
        return this.stats(io);
      case 'due':
        return this.due(io);
      case 'q':
      case 'questions':
        return this.questions(io, rest);
      case 'wrong':
        return this.wrongCmd(io, texts);
      case 'sessions':
        return this.sessions(io, texts);
      case 'config':
        return this.config(io, texts);
      case 'cp':
      case 'touch':
      case 'nano':
      case 'vim':
      case 'chmod':
        throw new Usage(`${cmd}: setting 에서는 쓸 수 없어요. 파일은 exit 로 나간 셸에서 다뤄요`);
      default:
        throw new Usage(`${cmd}: 모르는 명령이에요. help 로 명령을 볼 수 있어요`);
    }
  }

  private exit(io: TermIO) {
    // 한 번만 부른 ./setting exit 는 할 일이 없다 (셸은 그대로)
    if (this.done || !this.interactive) return;
    this.done = true;
    io.print(`setting 을 나왔어요.\n`);
    this.onExit();
    io.pop();
  }

  // ------------------------------------------------------------------ 둘러보기
  private ls(io: TermIO, target: string | undefined, long: boolean, all: boolean) {
    let scope = this.cwd;
    if (target) {
      if (target === '/' || target === '..') scope = null;
      else {
        const s = this.findSubject(target);
        if (!s) {
          // 자료 하나를 적었으면 그 자료만 (ls 파일 처럼)
          const one = this.notes.filter((n) => (scope ? n.subject_id === scope : true) && norm(noteName(n)) === norm(target));
          if (one.length) {
            io.print(`${one.map((n) => this.noteLine(n, long)).join('\n')}\n`);
            return;
          }
          throw new Usage(`ls: '${target}'에 접근할 수 없음: 그런 과목이나 자료가 없어요`);
        }
        scope = s.id;
      }
    }
    if (!scope) {
      const subs = this.subjects.filter((s) => all || !s.archived).sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.position - b.position);
      if (!subs.length) {
        io.print(paint(C.gray, '과목이 없어요. mkdir 과목이름 으로 만들 수 있어요.\n'));
        return;
      }
      if (long) {
        const rows = subs.map((s) => {
          const count = this.notes.filter((n) => n.subject_id === s.id).length;
          return [
            paint(s.archived ? C.gray : C.boldBlue, `${s.name}/`),
            `자료 ${count}개`,
            [s.pinned ? '고정' : '', s.archived ? '보관' : ''].filter(Boolean).join(' '),
          ];
        });
        io.print(`${table(rows)}\n`);
      } else {
        io.print(
          `${columns(
            subs.map((s) => paint(s.archived ? C.gray : C.boldBlue, `${quoteName(s.name)}/`)),
            io.cols(),
          )}\n`,
        );
      }
      const hidden = this.subjects.length - subs.length;
      if (hidden) io.print(paint(C.gray, `(보관한 과목 ${hidden}개는 ls -a 로)\n`));
      return;
    }
    const list = this.sorted(this.notes.filter((n) => n.subject_id === scope));
    if (!list.length) {
      io.print(paint(C.gray, '이 과목에는 자료가 없어요.\n'));
      return;
    }
    if (long) io.print(`${table(list.map((n) => this.noteRow(n)))}\n`);
    else
      io.print(
        `${columns(
          list.map((n) => this.colored(n)),
          io.cols(),
        )}\n`,
      );
  }

  /** 별표 먼저 → 새 자료 먼저 (자료함과 비슷하게) */
  private sorted(list: KNote[]): KNote[] {
    return [...list].sort((a, b) => Number(b.starred) - Number(a.starred) || Date.parse(b.created_at) - Date.parse(a.created_at));
  }

  /** 자료 이름에 색 (별표 노랑, 복습 끔·정리 중 회색). quote: ls 처럼 빈칸 있는 이름은 따옴표로 */
  private colored(n: KNote, quote = true): string {
    const name = quote ? quoteName(noteName(n)) : noteName(n);
    if (n.status !== 'ready') return paint(C.gray, `${name}…`);
    if (n.starred) return paint(C.boldYellow, name);
    if (!n.in_review) return paint(C.gray, name);
    return name;
  }

  private noteRow(n: KNote): string[] {
    const state = n.status === 'ready' ? '' : n.status === 'error' ? paint(C.red, '(멈춤)') : paint(C.gray, `(정리 중 ${n.progress}%)`);
    return [
      paint(C.gray, `#${n.id.slice(0, 6)}`),
      n.starred ? paint(C.yellow, '★') : '·',
      n.in_review ? '복습' : paint(C.gray, '끔'),
      KIND[n.kind] ?? n.kind,
      shortDate(n.created_at, new Date(this.now())),
      `${this.colored(n)}${state ? ` ${state}` : ''}`,
    ];
  }

  private noteLine(n: KNote, long: boolean): string {
    return long ? table([this.noteRow(n)]) : this.colored(n);
  }

  private cd(target: string | undefined) {
    if (!target || target === '/' || target === '~' || target === '..') {
      this.cwd = null;
      return;
    }
    if (target === '.') return;
    const s = this.findSubject(target);
    if (!s) {
      const isNote = this.notes.some((n) => norm(noteName(n)) === norm(target));
      throw new Usage(`cd: ${target}: ${isNote ? '디렉터리가 아닙니다 (자료예요: cat 이나 info 로 보세요)' : '그런 과목이 없어요'}`);
    }
    this.cwd = s.id;
  }

  private tree(io: TermIO) {
    const subs = [...this.subjects].sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.position - b.position);
    const out = [paint(C.boldBlue, '/')];
    subs.forEach((s, i) => {
      const last = i === subs.length - 1;
      out.push(`${last ? '└── ' : '├── '}${paint(s.archived ? C.gray : C.boldBlue, `${s.name}/`)}`);
      const list = this.sorted(this.notes.filter((n) => n.subject_id === s.id));
      list.forEach((n, k) => out.push(`${last ? '    ' : '│   '}${k === list.length - 1 ? '└── ' : '├── '}${this.colored(n, false)}`));
    });
    out.push('', `과목 ${this.subjects.length}개, 자료 ${this.notes.length}개`);
    io.print(`${out.join('\n')}\n`);
  }

  private async cat(io: TermIO, args: Arg[]) {
    const list = this.ready('cat', this.notesArgs('cat', args));
    for (const n of list) {
      const body = await this.api.noteBody(n.id);
      if (!body) {
        io.print(`cat: '${noteName(n)}': 노트를 찾을 수 없어요\n`);
        continue;
      }
      const out = [paint(C.bold, `# ${body.title || noteName(n)}`)];
      if (body.summary) out.push(body.summary);
      if (body.key_points.length) {
        out.push('', paint(C.boldCyan, '개념'));
        // AI 가 정한 중요도는 설정(note.importance)을 켰을 때만 (앱의 개념 카드와 같게)
        const showImp = this.api.config().some((c) => c.key === 'note.importance' && c.value === 'on');
        body.key_points.forEach((k, i) => {
          const mark = showImp && k.importance === 'high' ? paint(C.yellow, ' (꼭 외우기)') : '';
          out.push(`  ${i + 1}. ${paint(C.bold, k.title)}${k.starred ? paint(C.yellow, ' ★') : ''}${mark}`);
          if (k.explanation) out.push(`     ${k.explanation}`);
        });
      }
      if (body.terms.length) {
        out.push('', paint(C.boldCyan, '용어'));
        for (const t of body.terms) out.push(`  ${paint(C.bold, t.term)}: ${t.meaning}`);
      }
      if (body.formulas.length) {
        out.push('', paint(C.boldCyan, '공식'));
        for (const f of body.formulas) out.push(`  ${f.label ? `${f.label}: ` : ''}${f.latex}`);
      }
      io.print(`${out.join('\n')}\n`);
    }
  }

  private async info(io: TermIO, args: Arg[]) {
    // 과목 정보
    if (args.length === 1 && !args[0].glob) {
      const s = this.findSubject(args[0].text);
      if (s && !this.notes.some((n) => n.subject_id === this.cwd && norm(noteName(n)) === norm(args[0].text))) {
        const count = this.notes.filter((n) => n.subject_id === s.id).length;
        io.print(
          `${table([
            ['과목', paint(C.boldBlue, `${s.name}/`)],
            ['자료', `${count}개`],
            ['고정', s.pinned ? '예' : '아니요'],
            ['보관', s.archived ? '예 (자료함 목록에서만 빠져요)' : '아니요'],
          ])}\n`,
        );
        return;
      }
    }
    const list = this.notesArgs('info', args);
    for (const n of list) {
      const subj = this.subjects.find((s) => s.id === n.subject_id);
      const rows: string[][] = [
        ['이름', this.colored(n)],
        ['번호', `#${n.id.slice(0, 6)} ${paint(C.gray, `(${n.id})`)}`],
        ['과목', `${subj?.name ?? '?'}${n.unit ? ` · 단원 ${n.unit}` : ''}`],
        [
          '종류',
          `${KIND[n.kind] ?? n.kind}${n.page_count ? ` ${n.page_count}${n.kind === 'image' ? '장' : '쪽'}` : ''} · ${shortDate(n.created_at, new Date(this.now()))} 만듦`,
        ],
        ['상태', n.status === 'ready' ? '완료' : n.status === 'error' ? paint(C.red, '멈춤') : `정리 중 ${n.progress}%`],
        ['별표', n.starred ? paint(C.yellow, '★ 있음') : '없음'],
        ['복습', n.in_review ? '켬' : paint(C.gray, '끔 (복습에 안 나와요)')],
      ];
      if (n.status === 'ready') {
        const q = await this.api.questions(n.id);
        const active = q.list.filter((x) => x.status === 'active');
        const resting = q.list.filter((x) => x.status === 'suspended').length;
        const byState = [0, 0, 0, 0];
        for (const x of active) if (x.state !== null) byState[Math.max(0, Math.min(3, x.state))]++;
        const next = active
          .map((x) => x.due)
          .filter((d): d is string => !!d)
          .sort()[0];
        rows.push(['문제', `${active.length}개${resting ? ` (쉬는 문제 ${resting}개)` : ''}${q.versions ? paint(C.gray, ' · 버전 있음') : ''}`]);
        rows.push(['카드', STATE.map((label, i) => `${label} ${byState[i]}`).join(' · ')]);
        if (next) rows.push(['다음 복습', dueText(next, this.now())]);
        const wrong = active.filter((x) => x.in_wrong_note).length;
        if (wrong) rows.push(['오답노트', `${wrong}문제`]);
      }
      io.print(`${table(rows)}\n`);
      if (list.length > 1) io.print('\n');
    }
  }

  private find(io: TermIO, text: string) {
    const q = norm(text);
    if (!q) throw new Usage('find: 찾을 글자를 적어 주세요 (예: find 광합성)');
    const hit = this.notes.filter((n) => norm(noteName(n)).includes(q) || norm(n.unit).includes(q));
    if (!hit.length) {
      io.print(paint(C.gray, `'${text}'가 들어간 자료가 없어요.\n`));
      return;
    }
    const rows = this.sorted(hit).map((n) => {
      const s = this.subjects.find((x) => x.id === n.subject_id);
      return [paint(C.gray, `#${n.id.slice(0, 6)}`), `${paint(C.boldBlue, `${s?.name ?? '?'}/`)}${this.colored(n)}`, n.unit ? paint(C.gray, n.unit) : ''];
    });
    io.print(`${table(rows)}\n`);
  }

  // ------------------------------------------------------------------ 자료 고치기
  private async mv(io: TermIO, args: Arg[]) {
    if (args.length < 2) throw new Usage('mv: 사용법: mv 자료 새이름 · mv 자료… 과목/ · mv 과목 새이름 (맨 위에서)');
    const dst = args[args.length - 1];
    const srcs = args.slice(0, -1);
    // 과목 이름 바꾸기: 과목 하나 → 새 이름 (과목 안에서 같은 이름의 자료가 있으면 그 자료)
    const one = srcs.length === 1 && !srcs[0].glob ? srcs[0] : null;
    const asSubject = one ? this.findSubject(one.text) : null;
    const noteHere = one && this.cwd ? this.notes.some((n) => n.subject_id === this.cwd && norm(noteName(n)) === norm(one.text)) : false;
    if (asSubject && !noteHere) {
      const name = dst.text.replace(/\/+$/, '').replace(/\s+/g, ' ').trim().slice(0, 40);
      if (!name) throw new Usage('mv: 새 과목 이름을 적어 주세요');
      const other = this.findSubject(name);
      if (other && other.id !== asSubject.id)
        throw new Usage(`mv: '${name}' 과목이 이미 있어요. 합치려면 merge ${quoteName(asSubject.name)} ${quoteName(name)}`);
      await this.api.updateSubject(asSubject.id, { name });
      await this.reload();
      io.print(`과목 이름을 '${name}'로 바꿨어요.\n`);
      return;
    }
    const notes = this.notesArgs('mv', srcs);
    const target = this.findSubject(dst.text);
    if (target || dst.text.endsWith('/')) {
      if (!target) throw new Usage(`mv: '${dst.text}': 그런 과목이 없어요 (mkdir ${quoteName(dst.text.replace(/\/+$/, ''))} 로 먼저 만들어요)`);
      this.need('merge');
      const moving = notes.filter((n) => n.subject_id !== target.id);
      if (!moving.length) {
        io.print(`이미 '${target.name}' 과목에 있어요.\n`);
        return;
      }
      await this.api.move(
        moving.map((n) => n.id),
        target.id,
      );
      await this.reload();
      io.print(`자료 ${moving.length}개를 '${target.name}' 과목으로 옮겼어요. 문제와 복습 카드도 같이 옮겨졌어요.\n`);
      return;
    }
    if (notes.length > 1) throw new Usage(`mv: 대상 '${dst.text}'는 과목이 아니에요 (여러 자료는 과목/ 으로만 옮겨요)`);
    const title = dst.text.replace(/\s+/g, ' ').trim().slice(0, 120);
    if (!title) throw new Usage('mv: 새 이름을 적어 주세요');
    await this.api.rename(notes[0].id, title);
    await this.reload();
    io.print(`'${noteName(notes[0])}' → '${title}' 이름을 바꿨어요.\n`);
  }

  private async rm(io: TermIO, args: Arg[], recursive: boolean, force: boolean) {
    if (!args.length) throw new Usage('rm: 지울 자료를 적어 주세요 (과목은 rm -r 과목)');
    // 과목 지우기
    const subj = args.length === 1 && !args[0].glob ? this.findSubject(args[0].text) : null;
    const isNoteToo = subj ? this.notes.some((n) => (this.cwd ? n.subject_id === this.cwd : false) && norm(noteName(n)) === norm(args[0].text)) : false;
    if (subj && !isNoteToo) {
      if (!recursive)
        throw new Usage(`rm: '${args[0].text}'를 지울 수 없음: 과목이에요 (자료까지 모두 지우려면 rm -r ${quoteName(subj.name)}, 빈 과목은 rmdir)`);
      const count = this.notes.filter((n) => n.subject_id === subj.id).length;
      if (!force && !(await this.confirm(io, `'${subj.name}' 과목과 자료 ${count}개를 모두 지울까요? 노트·문제·복습 기록도 지워지고 되돌릴 수 없어요.`))) {
        io.print('그만뒀어요.\n');
        return;
      }
      await this.api.deleteSubject(subj.id);
      await this.reload();
      io.print(`'${subj.name}' 과목을 지웠어요.\n`);
      return;
    }
    const notes = this.notesArgs('rm', args);
    const names = notes
      .slice(0, 5)
      .map((n) => `'${noteName(n)}'`)
      .join(', ');
    if (
      !force &&
      !(await this.confirm(
        io,
        `자료 ${notes.length}개(${names}${notes.length > 5 ? ' …' : ''})를 지울까요? 노트·문제·복습 기록도 같이 지워지고 되돌릴 수 없어요.`,
      ))
    ) {
      io.print('그만뒀어요.\n');
      return;
    }
    await this.api.remove(notes.map((n) => n.id));
    await this.reload();
    io.print(`자료 ${notes.length}개를 지웠어요.\n`);
  }

  private async flag(io: TermIO, cmd: string, args: Arg[], flag: 'starred' | 'in_review', on: boolean) {
    this.need('organize');
    const notes = this.notesArgs(cmd, args);
    const todo = notes.filter((n) => n[flag] !== on);
    if (todo.length) {
      await this.api.setFlag(
        todo.map((n) => n.id),
        flag,
        on,
      );
      await this.reload();
    }
    const what =
      flag === 'starred' ? (on ? '별표를 달았어요' : '별표를 뺐어요') : on ? '복습에 다시 넣었어요' : '복습에서 뺐어요 (노트에서 직접 푸는 것은 돼요)';
    io.print(`자료 ${notes.length}개: ${what}.\n`);
  }

  private async review(io: TermIO, args: Arg[]) {
    const mode = args[0]?.text;
    if (mode !== 'on' && mode !== 'off') throw new Usage('review: 사용법: review off 자료… (복습에서 빼기) · review on 자료… (다시 넣기)');
    return this.flag(io, 'review', args.slice(1), 'in_review', mode === 'on');
  }

  // ------------------------------------------------------------------ 과목
  private async mkdir(io: TermIO, names: string[]) {
    if (!names.length) throw new Usage('mkdir: 과목 이름을 적어 주세요 (예: mkdir 수학)');
    if (this.cwd) throw new Usage('mkdir: 과목은 맨 위(/)에만 만들 수 있어요 (cd / 로 나가서)');
    for (const raw of names) {
      const name = raw.replace(/\/+$/, '').replace(/\s+/g, ' ').trim().slice(0, 40);
      if (!name) continue;
      if (this.findSubject(name)) {
        io.print(`mkdir: '${name}' 디렉터리를 만들 수 없습니다: 같은 이름의 과목이 있어요\n`);
        continue;
      }
      await this.api.createSubject(name);
      io.print(`'${name}' 과목을 만들었어요.\n`);
    }
    await this.reload();
  }

  private async rmdir(io: TermIO, names: string[]) {
    if (!names.length) throw new Usage('rmdir: 지울 과목을 적어 주세요');
    for (const raw of names) {
      const s = this.subjectArg('rmdir', raw);
      const count = this.notes.filter((n) => n.subject_id === s.id).length;
      if (count) {
        io.print(`rmdir: '${s.name}' 삭제 실패: 자료가 ${count}개 있어요 (모두 지우려면 rm -r ${quoteName(s.name)})\n`);
        continue;
      }
      await this.api.deleteSubject(s.id);
      io.print(`'${s.name}' 과목을 지웠어요.\n`);
    }
    await this.reload();
  }

  private async merge(io: TermIO, names: string[]) {
    if (names.length !== 2) throw new Usage('merge: 사용법: merge 과목 다른과목 (앞 과목의 자료를 뒤 과목으로 옮기고 앞 과목은 지워요)');
    this.need('merge');
    const from = this.subjectArg('merge', names[0]);
    const into = this.subjectArg('merge', names[1]);
    if (from.id === into.id) throw new Usage('merge: 같은 과목이에요');
    const count = this.notes.filter((n) => n.subject_id === from.id).length;
    if (!(await this.confirm(io, `'${from.name}'의 자료 ${count}개를 '${into.name}'로 옮기고 '${from.name}' 과목을 지울까요?`))) {
      io.print('그만뒀어요.\n');
      return;
    }
    await this.api.mergeSubjects(from.id, into.id);
    if (this.cwd === from.id) this.cwd = into.id;
    await this.reload();
    io.print(`'${from.name}'를 '${into.name}'에 합쳤어요. 문제·복습 카드·푼 기록도 같이 옮겨졌어요.\n`);
  }

  private async subjectFlag(io: TermIO, cmd: string, names: string[]) {
    this.need('subjectDrawer');
    if (!names.length) throw new Usage(`${cmd}: 과목을 적어 주세요`);
    let top = Math.max(0, ...this.subjects.map((s) => s.position));
    for (const raw of names) {
      const s = this.subjectArg(cmd, raw);
      if (cmd === 'pin') {
        if (s.pinned && !s.archived) continue;
        await this.api.updateSubject(s.id, { pinned: true, archived: false, ...(s.pinned ? {} : { position: ++top }) });
      } else if (cmd === 'unpin') await this.api.updateSubject(s.id, { pinned: false });
      else await this.api.updateSubject(s.id, { archived: cmd === 'archive' });
    }
    await this.reload();
    const said = {
      pin: '위에 고정했어요',
      unpin: '고정을 풀었어요',
      archive: '보관했어요 (자료함 목록에서만 빠지고 복습은 그대로예요)',
      unarchive: '보관을 풀었어요',
    }[cmd];
    io.print(`과목 ${names.length}개: ${said}.\n`);
  }

  // ------------------------------------------------------------------ 복습 데이터
  private async stats(io: TermIO) {
    const s = await this.api.stats();
    const skipped = [s.resting ? `쉬는 문제 ${s.resting}개` : '', s.reviewOff ? `복습을 끈 노트의 문제 ${s.reviewOff}개` : ''].filter(Boolean);
    const rows: string[][] = [
      ['오늘 복습', `${paint(C.boldGreen, String(s.due))}문제 남음 · 오늘 ${s.doneToday}문제 풀었어요 (하루 최대 ${s.dailyMax})`],
      ['복습 카드', `${s.total}개${skipped.length ? ` (${skipped.join('·')} 빼고)` : ''}`],
      ['카드 상태', STATE.map((l, i) => `${l} ${s.byState[i]}`).join(' · ')],
      ['오답노트', `${s.wrong}문제`],
    ];
    io.print(`${table(rows)}\n`);
    if (s.bySubject.length) {
      io.print(
        `\n${table([[paint(C.bold, '과목'), paint(C.bold, '카드'), paint(C.bold, '오늘')], ...s.bySubject.map((x) => [x.name, String(x.cards), String(x.due)])], ['l', 'r', 'r'])}\n`,
      );
    }
  }

  private async due(io: TermIO) {
    const s = await this.api.stats();
    if (!s.due) {
      io.print(`오늘 복습할 문제가 없어요. ${paint(C.gray, `(오늘 ${s.doneToday}문제 풀었어요)`)}\n`);
      return;
    }
    io.print(`오늘 복습할 문제 ${paint(C.boldGreen, String(s.due))}개\n`);
    const rows = s.bySubject.filter((x) => x.due).map((x) => [`  ${x.name}`, `${x.due}문제`]);
    if (rows.length) io.print(`${table(rows, ['l', 'r'])}\n`);
  }

  private async questions(io: TermIO, args: Arg[]) {
    const sub = args[0]?.text;
    if (sub === 'rest' || sub === 'wake' || sub === 'reset' || sub === 'rm') {
      const [noteArg, ...nums] = args.slice(1);
      if (!noteArg) throw new Usage(`q ${sub}: 사용법: q ${sub} 자료 ${sub === 'reset' ? '[번호…]' : '번호…'}`);
      const note = this.ready('q', this.findNotes('q', noteArg));
      if (note.length !== 1) throw new Usage('q: 자료를 하나만 골라 주세요');
      const { versions, list } = await this.api.questions(note[0].id);
      const visible = list.filter((x) => x.status !== 'hidden');
      const picked = pickByNumber(
        `q ${sub}`,
        visible,
        nums.map((a) => a.text),
        sub === 'reset',
      );
      if (!picked.length) {
        io.print(paint(C.gray, '고른 문제가 없어요.\n'));
        return;
      }
      if (sub === 'rest' || sub === 'wake') {
        await this.api.setQuestionStatus(
          picked.map((x) => x.id),
          sub === 'rest' ? 'suspended' : 'active',
        );
        io.print(`문제 ${picked.length}개를 ${sub === 'rest' ? '쉬게 했어요 (복습에 안 나와요)' : '다시 복습에 넣었어요'}.\n`);
        return;
      }
      if (sub === 'reset') {
        if (!(await this.confirm(io, `문제 ${picked.length}개의 복습 기록을 처음부터 할까요? 다음 복습 날짜·익힌 정도가 처음으로 돌아가요.`))) {
          io.print('그만뒀어요.\n');
          return;
        }
        await this.api.resetCards(picked.map((x) => x.id));
        io.print(`문제 ${picked.length}개의 복습을 처음부터 시작해요.\n`);
        return;
      }
      if (versions) throw new Usage('q rm: 버전이 있는 노트의 문제는 앱의 문제 탭에서 지워요 (버전마다 문제 목록이 달라서)');
      if (!(await this.confirm(io, `문제 ${picked.length}개를 지울까요? 푼 기록도 같이 지워져요.`))) {
        io.print('그만뒀어요.\n');
        return;
      }
      await this.api.deleteQuestions(picked.map((x) => x.id));
      io.print(`문제 ${picked.length}개를 지웠어요.\n`);
      return;
    }
    if (!args.length) throw new Usage('q: 사용법: q 자료 (문제 목록) · q rest|wake|reset|rm 자료 번호…');
    const note = this.ready('q', this.findNotes('q', args[0]));
    if (note.length !== 1) throw new Usage('q: 자료를 하나만 골라 주세요');
    const { list } = await this.api.questions(note[0].id);
    const visible = list.filter((x) => x.status !== 'hidden');
    if (!visible.length) {
      io.print(paint(C.gray, '이 자료에는 문제가 없어요.\n'));
      return;
    }
    const width = Math.max(20, io.cols() - 34);
    const rows = visible.map((x, i) => [
      padEnd(String(i + 1), 2),
      TYPE[x.type] ?? x.type,
      x.status === 'suspended' ? paint(C.gray, '쉼') : x.in_wrong_note ? paint(C.red, '오답') : STATE[Math.max(0, Math.min(3, x.state ?? 0))],
      x.status === 'suspended' || !x.due ? '' : dueText(x.due, this.now()),
      clip(x.prompt.replace(/\s+/g, ' '), width),
    ]);
    io.print(`${table(rows)}\n`);
    io.print(paint(C.gray, `문제 ${visible.length}개 · 번호로 고쳐요: q rest|wake|reset ${quoteName(noteName(note[0]))} 1 2\n`));
  }

  private async wrongCmd(io: TermIO, args: string[]) {
    const list = await this.api.wrong();
    if (args[0] === 'rm') {
      const nums = args.slice(1);
      if (!nums.length) throw new Usage('wrong rm: 사용법: wrong rm 번호… · wrong rm --all');
      const picked = nums.includes('--all') ? list : pickByNumber('wrong rm', list, nums, false);
      if (!picked.length) {
        io.print(paint(C.gray, '뺄 문제가 없어요.\n'));
        return;
      }
      if (nums.includes('--all') && !(await this.confirm(io, `오답노트의 ${picked.length}문제를 모두 뺄까요? (다시 틀리면 다시 들어와요)`))) {
        io.print('그만뒀어요.\n');
        return;
      }
      await this.api.unwrong(picked.map((x) => x.question_id));
      io.print(`오답노트에서 ${picked.length}문제를 뺐어요. 다시 틀리면 다시 들어와요.\n`);
      return;
    }
    if (!list.length) {
      io.print('오답노트가 비어 있어요.\n');
      return;
    }
    const width = Math.max(16, io.cols() - 26);
    io.print(
      `${table(list.map((x, i) => [padEnd(String(i + 1), 2), paint(C.red, `${x.wrong_count}번`), clip(`${x.subject}/${x.note}`, 18), clip(x.prompt.replace(/\s+/g, ' '), width)]))}\n`,
    );
    io.print(paint(C.gray, `오답 ${list.length}문제 · 빼기: wrong rm 1 2 · 모두: wrong rm --all\n`));
  }

  private async sessions(io: TermIO, args: string[]) {
    this.need('sessions');
    if (args[0] === 'rm') {
      const key = args[1];
      if (!key || !SESSION_NAME[key]) throw new Usage('sessions rm: 사용법: sessions rm home|review|wrong');
      await this.api.dropSession(key);
      io.print(`'${SESSION_NAME[key]}'의 하던 복습을 지웠어요. 다음에는 새로 골라요.\n`);
      return;
    }
    const list = await this.api.sessions();
    if (!list.length) {
      io.print('하던 복습이 없어요.\n');
      return;
    }
    io.print(
      `${table(list.map((s) => [s.key, SESSION_NAME[s.key] ?? s.key, `${s.answered}/${s.planned}문제`, s.answered >= s.planned ? paint(C.green, '다 풀었어요') : `${s.planned - s.answered}문제 남음`, s.day ?? '']))}\n`,
    );
  }

  private async config(io: TermIO, args: string[]) {
    if (!args.length) {
      const rows = this.api.config().map((c) => [paint(C.bold, c.key), c.value, paint(C.gray, c.label)]);
      io.print(`${table(rows)}\n${paint(C.gray, '바꾸기: config 이름 값 (예: config review.dailyMax 80, config notify.done off)')}\n`);
      return;
    }
    if (args.length < 2) {
      const c = this.api.config().find((x) => x.key === args[0]);
      if (!c) throw new Usage(`config: '${args[0]}': 그런 설정이 없어요 (config 로 목록을 봐요)`);
      io.print(`${c.key} = ${c.value}  ${paint(C.gray, c.label)}\n`);
      return;
    }
    const said = await this.api.setConfig(args[0], args.slice(1).join(' '));
    io.print(`${said}\n`);
  }

  // ------------------------------------------------------------------ 도움말·자동 완성
  private help(io: TermIO, what?: string) {
    if (what && HELP[what]) {
      io.print(`${HELP[what]}\n`);
      return;
    }
    const groups: Array<[string, string[]]> = [
      ['둘러보기', ['ls', 'cd', 'tree', 'cat', 'info', 'find']],
      ['자료', ['mv', 'rm', 'star', 'unstar', 'review']],
      ['과목', ['mkdir', 'rmdir', 'merge', 'pin', 'unpin', 'archive', 'unarchive']],
      ['복습', ['stats', 'due', 'q', 'wrong', 'sessions']],
      ['그 밖', ['config', 'help', 'whoami', 'clear', 'exit']],
    ];
    const out = groups.map(([g, cmds]) => `${paint(C.boldCyan, padEnd(g, 10))}${cmds.join('  ')}`);
    io.print(`${out.join('\n')}\n\n${paint(C.gray, '명령마다 설명: help 명령 (예: help mv) · 전체 설명: exit 한 뒤 cat ~/help.txt')}\n`);
  }

  complete(line: string, cursor: number): Completion | null {
    const before = line.slice(0, cursor);
    let start = 0;
    for (let i = 0; i < before.length; i++) {
      if (before[i] === '\\') {
        i++;
        continue;
      }
      if (/\s/.test(before[i])) start = i + 1;
    }
    const word = before.slice(start).replace(/\\(.)/g, '$1');
    const head = before.slice(0, start).trim();
    if (!head) {
      return { start, end: cursor, options: COMMAND_NAMES.filter((c) => c.startsWith(word)), space: true };
    }
    const esc = (s: string) => s.replace(/([\s'"\\$`|&;<>()*?!#])/g, '\\$1');
    const [first, sub] = head.split(/\s+/);
    if ((first === 'review' && !sub) || first === 'q' || first === 'questions') {
      if (!sub && first !== 'review') {
        const subs = ['rest', 'wake', 'reset', 'rm'].filter((x) => x.startsWith(word));
        const notes = this.completeNotes(word, esc);
        return { start, end: cursor, options: [...subs, ...notes], space: true };
      }
      if (first === 'review') return { start, end: cursor, options: ['on', 'off'].filter((x) => x.startsWith(word)), space: true };
    }
    if (first === 'sessions' && head === 'sessions rm')
      return { start, end: cursor, options: ['home', 'review', 'wrong'].filter((x) => x.startsWith(word)), space: true };
    if (first === 'config' && !sub)
      return {
        start,
        end: cursor,
        options: this.api
          .config()
          .map((c) => c.key)
          .filter((k) => k.startsWith(word)),
        space: true,
      };
    const subjectsOnly = ['cd', 'mkdir', 'rmdir', 'merge', 'pin', 'unpin', 'archive', 'unarchive'].includes(first);
    const slash = word.lastIndexOf('/');
    if (slash >= 0) {
      // 과목/자료
      const s = this.findSubject(word.slice(0, slash));
      if (!s) return null;
      const prefix = norm(word.slice(slash + 1));
      const opts = this.notes.filter((n) => n.subject_id === s.id && norm(noteName(n)).startsWith(prefix)).map((n) => `${esc(s.name)}/${esc(noteName(n))}`);
      return { start, end: cursor, options: opts, space: true };
    }
    const subs = this.subjects.filter((s) => norm(s.name).startsWith(norm(word))).map((s) => `${esc(s.name)}/`);
    if (subjectsOnly || !this.cwd) {
      const notes = subjectsOnly ? [] : this.completeNotes(word, esc);
      return { start, end: cursor, options: [...subs, ...notes], space: false };
    }
    return { start, end: cursor, options: [...this.completeNotes(word, esc), ...(first === 'mv' ? subs : [])], space: true };
  }

  private completeNotes(word: string, esc: (s: string) => string): string[] {
    const pool = this.cwd ? this.notes.filter((n) => n.subject_id === this.cwd) : [];
    return pool.filter((n) => norm(noteName(n)).startsWith(norm(word))).map((n) => esc(noteName(n)));
  }
}

/** 따옴표 밖에서 낱말 처음의 # 앞에 \ 를 붙인다 (셸 문법에서는 주석이지만 setting 에서는 #번호) */
export function keepHashes(line: string): string {
  let out = '';
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === quote) quote = null;
      else if (ch === '\\' && quote === '"' && i + 1 < line.length) {
        out += ch + line[++i];
        continue;
      }
      out += ch;
      continue;
    }
    if (ch === '\\' && i + 1 < line.length) {
      out += ch + line[++i];
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '#' && (i === 0 || /\s/.test(line[i - 1]))) out += '\\';
    out += ch;
  }
  return out;
}

/** 번호로 고르기 (1부터). allIfEmpty 면 번호가 없을 때 모두 */
function pickByNumber<T>(cmd: string, list: T[], nums: string[], allIfEmpty: boolean): T[] {
  if (!nums.length) {
    if (allIfEmpty) return list;
    throw new Usage(`${cmd}: 번호를 적어 주세요 (목록의 왼쪽 숫자)`);
  }
  const out: T[] = [];
  for (const raw of nums) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(raw);
    if (!m) throw new Usage(`${cmd}: '${raw}': 번호가 아니에요`);
    const a = Number(m[1]);
    const b = Number(m[2] ?? m[1]);
    for (let k = Math.min(a, b); k <= Math.max(a, b); k++) {
      const v = list[k - 1];
      if (!v) throw new Usage(`${cmd}: ${k}번이 없어요 (1~${list.length})`);
      if (!out.includes(v)) out.push(v);
    }
  }
  return out;
}

/** 다음 복습까지: 지금·오늘·내일·N일 뒤 */
export function dueText(iso: string, now: number): string {
  const t = Date.parse(iso);
  if (t <= now) return paint(C.green, '지금');
  const day = (x: number) => Math.floor((x + 9 * 3_600_000) / 86_400_000);
  const d = day(t) - day(now);
  if (d <= 0) return '오늘';
  if (d === 1) return '내일';
  return `${d}일 뒤`;
}

/** 빈칸 있는 이름은 따옴표로 (다시 입력할 수 있게) */
export function quoteName(s: string): string {
  return /[\s'"\\$`|&;<>()*?!#]/.test(s) ? `'${s.replace(/'/g, `'\\''`)}'` : s;
}

const COMMAND_NAMES = [
  'archive',
  'cat',
  'cd',
  'clear',
  'config',
  'due',
  'exit',
  'find',
  'help',
  'info',
  'ls',
  'merge',
  'mkdir',
  'mv',
  'pin',
  'pwd',
  'q',
  'review',
  'rm',
  'rmdir',
  'sessions',
  'star',
  'stats',
  'tree',
  'unarchive',
  'unpin',
  'unstar',
  'whoami',
  'wrong',
];

const HELP: Record<string, string> = {
  ls: 'ls [-l] [-a] [과목]   과목 목록, 과목 안의 자료. -l: 번호·별표·복습·종류·날짜, -a: 보관한 과목도',
  cd: 'cd 과목 · cd .. · cd /   과목으로 들어가기·나오기',
  tree: 'tree   모든 과목과 자료를 나무 모양으로',
  cat: 'cat 자료…   노트 정리 보기 (요약·개념·용어·공식)',
  info: 'info 자료… · info 과목   자세히 (과목·종류·상태·별표·복습·문제·카드·다음 복습)',
  find: 'find 글자   이름·단원에 그 글자가 든 자료 찾기',
  mv: 'mv 자료 새이름        자료 이름 바꾸기\nmv 자료… 과목/        다른 과목으로 옮기기 (문제·복습 카드도 같이)\nmv 과목 새이름        과목 이름 바꾸기 (맨 위 / 에서)',
  rm: 'rm [-f] 자료…   자료 지우기 (노트·문제·복습 기록까지, 묻고 지워요. -f 는 묻지 않아요)\nrm -r 과목      과목과 그 자료 모두 지우기',
  star: 'star 자료… · unstar 자료…   별표 달기·빼기 (별표한 자료는 자료함 맨 위)',
  unstar: 'unstar 자료…   별표 빼기',
  review: 'review off 자료…   복습에서 빼기 (노트에서 직접 푸는 것은 돼요)\nreview on 자료…    다시 넣기',
  mkdir: 'mkdir 과목…   새 과목 (맨 위 / 에서)',
  rmdir: 'rmdir 과목…   빈 과목 지우기',
  merge: 'merge 과목 다른과목   앞 과목의 자료를 뒤 과목으로 옮기고 앞 과목은 지워요',
  pin: 'pin 과목… · unpin 과목…   위에 고정·고정 풀기 (보관한 과목을 고정하면 보관도 풀어요)',
  unpin: 'unpin 과목…   고정 풀기',
  archive: 'archive 과목… · unarchive 과목…   보관·보관 풀기 (자료함 목록에서만 빠지고 복습은 그대로)',
  unarchive: 'unarchive 과목…   보관 풀기',
  stats: 'stats   복습 통계: 오늘 남은 문제·카드 상태·오답노트·과목별',
  due: 'due   오늘 복습할 문제 (과목별)',
  q: 'q 자료                 문제 목록 (번호·유형·상태·다음 복습)\nq rest 자료 번호…      쉬게 하기 (복습에 안 나와요)\nq wake 자료 번호…      다시 복습에\nq reset 자료 [번호…]   복습 기록을 처음부터 (번호가 없으면 모든 문제)\nq rm 자료 번호…        문제 지우기\n번호는 1 2 5 처럼, 또는 1-4 처럼',
  wrong: 'wrong            오답노트 목록\nwrong rm 번호…   오답노트에서 빼기 (다시 틀리면 다시 들어와요)\nwrong rm --all   모두 빼기',
  sessions: 'sessions                        하던 복습 (홈·복습 탭·오답)\nsessions rm home|review|wrong   하던 복습 지우기',
  config: 'config            설정 보기\nconfig 이름 값    설정 바꾸기 (on/off 나 숫자)',
  exit: 'exit   setting 을 나가 셸로 돌아가요',
};
