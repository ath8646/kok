// 터미널 켜기: 저장해 둔 파일·기록으로 셸을 만들고, ./setting 을 KOK 관리 모드로 잇는다.
// 화면(components/terminal)과 시험(term.test.ts)이 같이 쓴다. 저장은 부른 쪽이 (이 기기의 localStorage)
import { ensureDefaults, freshTree } from './files';
import { TermSession } from './session';
import { SettingProgram, quoteName, type KokApi } from './setting';
import { Shell } from './shell';
import type { TermIO } from './types';
import { Vfs, readTree } from './vfs';

/** 이 기기에 남기는 것: 파일 시스템, 셸·setting 명령 기록, 마지막으로 연 때 */
export type TermSaved = { v: 1; fs: string; hist: string[]; shist: string[]; last: number | null };

export function readSaved(json: string | null): TermSaved | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json) as Partial<TermSaved> | null;
    if (!v || v.v !== 1 || typeof v.fs !== 'string') return null;
    const strs = (x: unknown) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string').slice(-500) : []);
    return { v: 1, fs: v.fs, hist: strs(v.hist), shist: strs(v.shist), last: typeof v.last === 'number' ? v.last : null };
  } catch {
    return null;
  }
}

export type Booted = {
  session: TermSession;
  shell: Shell;
  /** 인사를 쓰고 ~/.bashrc 를 읽는다 */
  start(): Promise<void>;
  /** 지금 상태 (저장할 것) */
  snapshot(): TermSaved;
};

export function bootTerminal(o: {
  user: string;
  saved: TermSaved | null;
  /** KOK 데이터 길 (setting 을 처음 실행할 때 만든다) */
  api: () => KokApi;
  now?: () => number;
  /** 파일·기록이 바뀌었다 (부른 쪽이 조금 뒤에 snapshot 을 저장) */
  onChange?: () => void;
}): Booted {
  const now = o.now ?? (() => Date.now());
  const home = `/home/${o.user}`;
  const t = now();
  const loaded = o.saved ? readTree(o.saved.fs) : null;
  const root = loaded ?? freshTree(o.user, t);
  ensureDefaults(root, o.user, t, !loaded);
  const fs = new Vfs(root, home, now);
  let settingHistory = o.saved?.shist ?? [];
  const changed = () => o.onChange?.();
  let api: KokApi | null = null;

  const runSetting = async (io: TermIO, args: string[]): Promise<number> => {
    api ??= o.api();
    const p = new SettingProgram(api, o.user, {
      now,
      onExit: () => {
        settingHistory = p.history.slice(-500);
        changed();
      },
    });
    p.history = [...settingHistory];
    if (args.length) {
      // ./setting ls -l 처럼: 그 명령만 하고 셸에 남는다
      if (!(await p.start(io, { quiet: true }))) return 1;
      await p.run(args.map((a) => (a.startsWith('-') ? a : quoteName(a))).join(' '), io);
      return p.status;
    }
    if (!(await p.start(io))) return 1;
    p.interactive = true;
    io.push(p);
    return 0;
  };

  const shell = new Shell({
    user: o.user,
    fs,
    history: o.saved?.hist ?? [],
    lastLogin: o.saved?.last ?? null,
    now,
    runSetting,
    onChange: changed,
  });
  const session = new TermSession(shell);
  const openedAt = t;

  return {
    session,
    shell,
    async start() {
      session.write(shell.motd());
      await shell.startup(session.io);
      changed();
    },
    snapshot() {
      // setting 이 열려 있으면 그 기록도
      const top = session.stack[session.stack.length - 1];
      if (top instanceof SettingProgram) settingHistory = top.history.slice(-500);
      return { v: 1, fs: fs.serialize(), hist: shell.history.slice(-500), shist: settingHistory, last: openedAt };
    },
  };
}
