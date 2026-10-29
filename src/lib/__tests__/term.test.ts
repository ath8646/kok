import { describe, expect, it, vi } from 'vitest';
import { bootTerminal, readSaved, type TermSaved } from '@/lib/term/boot';
import { ParseError, parse } from '@/lib/term/parse';
import { commonPrefix } from '@/lib/term/session';
import { gridParts, parseAnsi } from '@/lib/term/ansi';
import { keepHashes, type KConfig, type KNote, type KQuestion, type KSubject, type KokApi } from '@/lib/term/setting';
import { cells, clip, columns, stripAnsi, table } from '@/lib/term/text';
import { FsFail, FS_MAX_BYTES, Vfs, normalize, readTree } from '@/lib/term/vfs';
import { freshTree } from '@/lib/term/files';

// ------------------------------------------------------------------ 가짜 KOK 데이터
function fakeApi() {
  const calls: string[] = [];
  const subjects: KSubject[] = [
    { id: 's1aaaa', name: '수학', color: 'blue', pinned: true, archived: false, position: 0 },
    { id: 's2bbbb', name: '과학', color: 'green', pinned: false, archived: false, position: 1 },
    { id: 's3cccc', name: '옛날 과목', color: 'red', pinned: false, archived: true, position: 2 },
  ];
  const note = (id: string, title: string, subject_id: string, o: Partial<KNote> = {}): KNote => ({
    id,
    title,
    subject_id,
    kind: 'pdf',
    status: 'ready',
    progress: 100,
    starred: false,
    in_review: true,
    created_at: '2026-10-01T00:00:00Z',
    unit: '',
    page_count: 3,
    ...o,
  });
  const notes: KNote[] = [
    note('3f2a9c11', '이차방정식', 's1aaaa', { starred: true }),
    note('7b1d0e22', '함수의 극한', 's1aaaa'),
    note('9c4e5f33', '광합성', 's2bbbb', { kind: 'image', page_count: 2 }),
    note('aa00bb44', '세포 분열', 's2bbbb', { status: 'processing', progress: 40 }),
  ];
  const questions: KQuestion[] = [
    {
      id: 'q1',
      type: 'mcq',
      prompt: '근의 공식은?',
      status: 'active',
      due: '2026-10-29T00:00:00Z',
      state: 2,
      reps: 3,
      lapses: 1,
      wrong_count: 2,
      in_wrong_note: true,
    },
    {
      id: 'q2',
      type: 'ox',
      prompt: '판별식이 0이면 중근이다',
      status: 'active',
      due: '2026-11-03T00:00:00Z',
      state: 2,
      reps: 2,
      lapses: 0,
      wrong_count: 0,
      in_wrong_note: false,
    },
    { id: 'q3', type: 'short', prompt: '꼭짓점의 좌표는?', status: 'suspended', due: null, state: 0, reps: 0, lapses: 0, wrong_count: 0, in_wrong_note: false },
  ];
  const settings: KConfig[] = [{ key: 'review.dailyMax', value: '50', label: '하루 최대 복습 문제' }];
  let versions = false;
  const api: KokApi = {
    features: { organize: true, merge: true, subjectDrawer: true, sessions: true },
    async load() {
      return { subjects: subjects.map((s) => ({ ...s })), notes: notes.map((n) => ({ ...n })) };
    },
    async noteBody(id) {
      if (id !== '3f2a9c11') return null;
      return {
        title: '이차방정식',
        summary: '이차방정식을 푸는 방법을 정리했어요.',
        key_points: [{ title: '근의 공식', explanation: 'x = (-b ± √(b²-4ac))/(2a)', importance: 'high', starred: true }],
        terms: [{ term: '판별식', meaning: 'b²-4ac' }],
        formulas: [{ latex: 'D = b²-4ac', label: '판별식' }],
      };
    },
    async questions() {
      return { versions, list: questions.map((q) => ({ ...q })) };
    },
    async rename(id, title) {
      calls.push(`rename ${id} ${title}`);
      notes.find((n) => n.id === id)!.title = title;
    },
    async setFlag(ids, flag, on) {
      calls.push(`flag ${flag} ${on} ${ids.join(',')}`);
      for (const n of notes) if (ids.includes(n.id)) n[flag] = on;
    },
    async move(ids, subjectId) {
      calls.push(`move ${ids.join(',')} -> ${subjectId}`);
      for (const n of notes) if (ids.includes(n.id)) n.subject_id = subjectId;
    },
    async remove(ids) {
      calls.push(`remove ${ids.join(',')}`);
      for (const id of ids)
        notes.splice(
          notes.findIndex((n) => n.id === id),
          1,
        );
    },
    async createSubject(name) {
      calls.push(`mkdir ${name}`);
      const s = { id: `new${subjects.length}`, name, color: 'teal', pinned: false, archived: false, position: subjects.length };
      subjects.push(s);
      return s;
    },
    async updateSubject(id, patch) {
      calls.push(`subject ${id} ${JSON.stringify(patch)}`);
      Object.assign(
        subjects.find((s) => s.id === id)!,
        patch,
      );
    },
    async deleteSubject(id) {
      calls.push(`rmdir ${id}`);
      subjects.splice(
        subjects.findIndex((s) => s.id === id),
        1,
      );
      for (let i = notes.length - 1; i >= 0; i--) if (notes[i].subject_id === id) notes.splice(i, 1);
    },
    async mergeSubjects(from, into) {
      calls.push(`merge ${from} ${into}`);
      for (const n of notes) if (n.subject_id === from) n.subject_id = into;
      subjects.splice(
        subjects.findIndex((s) => s.id === from),
        1,
      );
    },
    async stats() {
      return {
        total: 2,
        due: 1,
        doneToday: 4,
        dailyMax: 50,
        wrong: 1,
        resting: 1,
        reviewOff: 0,
        byState: [0, 0, 2, 0],
        bySubject: [{ name: '수학', cards: 2, due: 1 }],
      };
    },
    async wrong() {
      return [{ question_id: 'q1', prompt: '근의 공식은?', subject: '수학', note: '이차방정식', wrong_count: 2 }];
    },
    async unwrong(ids) {
      calls.push(`unwrong ${ids.join(',')}`);
    },
    async sessions() {
      return [{ key: 'home', day: '2026-10-30', planned: 8, answered: 3 }];
    },
    async dropSession(key) {
      calls.push(`drop ${key}`);
    },
    async setQuestionStatus(ids, status) {
      calls.push(`status ${status} ${ids.join(',')}`);
    },
    async resetCards(ids) {
      calls.push(`reset ${ids.join(',')}`);
    },
    async deleteQuestions(ids) {
      calls.push(`qrm ${ids.join(',')}`);
    },
    config: () => settings,
    async setConfig(key, value) {
      calls.push(`config ${key}=${value}`);
      settings[0].value = value;
      return `${key} = ${value}`;
    },
  };
  return { api, calls, notes, subjects, setVersions: (v: boolean) => (versions = v) };
}

const NOW = Date.parse('2026-10-30T12:00:00+09:00');

function boot(saved: TermSaved | null = null) {
  const fake = fakeApi();
  const b = bootTerminal({ user: 'student', saved, api: () => fake.api, now: () => NOW });
  return { ...b, ...fake };
}

/** 명령 하나를 치고 끝날 때까지 */
async function run(s: ReturnType<typeof boot>['session'], line: string) {
  await s.enter(line);
}

/** 화면 글 (색 없이) */
const screen = (s: ReturnType<typeof boot>['session']) => stripAnsi(s.text());

/** 마지막 명령의 출력만 (그 명령 줄 다음부터) */
async function out(b: ReturnType<typeof boot>, line: string): Promise<string> {
  b.session.clearScreen();
  await run(b.session, line);
  const lines = screen(b.session).split('\n');
  return lines.slice(1).join('\n').trim();
}

/** 묻기에 답한다 (명령이 묻기를 기다리는 동안) */
async function answer(s: ReturnType<typeof boot>['session'], text: string) {
  await vi.waitFor(() => expect(s.ask).not.toBeNull());
  await s.enter(text);
}

// ------------------------------------------------------------------ 글 도우미
describe('터미널 글: 한글은 두 칸, 열 맞추기', () => {
  it('칸 수와 열', () => {
    expect(cells('ab한글')).toBe(6);
    expect(cells('\x1b[1;32mok\x1b[0m')).toBe(2);
    expect(columns(['a', 'bb', 'ccc'], 80)).toBe('a  bb  ccc');
    expect(columns(['aaaa', 'bbbb', 'cccc', 'dddd'], 10).split('\n').length).toBeGreaterThan(1);
    expect(
      table(
        [
          ['이름', '1'],
          ['가', '22'],
        ],
        ['l', 'r'],
      ),
    ).toBe('이름   1\n가    22');
    expect(commonPrefix(['help.txt', 'hello', 'he'])).toBe('he');
  });
});

describe('ANSI 색과 칸 맞추기 (화면이 그리는 조각)', () => {
  it('색·굵게·뒤집기 조각, 그 밖의 제어 글은 버린다', () => {
    const s = parseAnsi('\x1b[1;32mok\x1b[0m 끝\x1b[7m반\x1b[27m\x1b[2J');
    expect(s.map((x) => x.text)).toEqual(['ok', ' 끝', '반']);
    expect(s[0].style).toMatchObject({ fg: 2, bold: true });
    expect(s[2].style.inverse).toBe(true);
    expect(parseAnsi('ab\tc')[0].text).toBe('ab      c');
  });
  it('글꼴이 칸에 맞게 그리지 않는 기호는 1·2칸 상자, 붙는 글자는 앞 글자에', () => {
    expect(gridParts('├── 과학 · ★…')).toEqual([
      { text: '├', cells: 1 },
      { text: '─', cells: 1 },
      { text: '─', cells: 1 },
      { text: ' 과학 ', cells: 0 },
      { text: '·', cells: 1 },
      { text: ' ', cells: 0 },
      { text: '★', cells: 1 },
      { text: '…', cells: 2 },
    ]);
    expect(gridParts('F\u20d7 x\u0304')).toEqual([{ text: 'F\u20d7 x\u0304', cells: 0 }]);
    expect(cells('F\u20d7…')).toBe(3);
    expect(clip('가나다라마바사', 8)).toBe('가나다…');
    expect(cells(clip('가나다라마바사', 8))).toBeLessThanOrEqual(8);
  });
});

describe('명령 줄 읽기 (bash 의 작은 부분)', () => {
  it('따옴표·파이프·넘겨주기·이음', () => {
    const s = parse(`echo "a b" 'c $d' e\\ f | grep a > out.txt && ls; pwd # 주석`);
    expect(s).toHaveLength(3);
    expect(s[0].pipeline).toHaveLength(2);
    expect(s[0].pipeline[0].words.map((w) => w.map((p) => p.text).join(''))).toEqual(['echo', 'a b', 'c $d', 'e f']);
    expect(s[0].pipeline[1].redirs[0].op).toBe('>');
    expect(s[0].next).toBe('&&');
    expect(s[2].pipeline[0].words).toHaveLength(1);
  });
  it('문법 오류는 bash 처럼', () => {
    expect(() => parse('| ls')).toThrow(ParseError);
    expect(() => parse('echo "abc')).toThrow(ParseError);
    expect(() => parse('ls &&')).toThrow(ParseError);
  });
  it('setting 의 #번호는 주석이 아니다', () => {
    expect(keepHashes('info #3f2a')).toBe('info \\#3f2a');
    expect(keepHashes("cat '#x' a#b")).toBe("cat '#x' a#b");
  });
});

describe('가상 파일 시스템', () => {
  const make = () => new Vfs(freshTree('student', NOW), '/home/student', () => NOW);
  it('내 집과 /tmp 만 쓸 수 있다', () => {
    const fs = make();
    fs.writeFile('/home/student/a.txt', 'hi');
    expect(fs.readFile('/home/student/a.txt')).toBe('hi');
    expect(() => fs.writeFile('/etc/x', 'no')).toThrow(FsFail);
    expect(() => fs.readFile('/root/.bashrc')).toThrow(/허가 거부/);
    fs.mkdir('/tmp/a/b/c', true);
    expect(fs.readdir('/tmp/a/b')).toEqual(['c']);
    expect(() => fs.remove('/home/student', true)).toThrow(/허가 거부/);
  });
  it('공간이 넘치면 쓰지 않는다', () => {
    const fs = make();
    expect(() => fs.writeFile('/home/student/big', 'x'.repeat(FS_MAX_BYTES))).toThrow(/공간/);
  });
  it('저장한 모양이 이상하면 새로', () => {
    expect(readTree('{"t":"d","mode":493,"mtime":0,"kids":{"../x":{"t":"f"}}}')).toBeNull();
    expect(readTree(JSON.stringify(freshTree('student', NOW)))).not.toBeNull();
    expect(normalize('/a/./b/../c//d')).toBe('/a/c/d');
  });
});

// ------------------------------------------------------------------ 셸
describe('셸: 리눅스 같은 명령', () => {
  it('처음 열면 인사와 내 집의 help.txt·setting', async () => {
    const b = boot();
    await b.start();
    expect(screen(b.session)).toContain('KOK Linux 1.0');
    expect(await out(b, 'pwd')).toBe('/home/student');
    expect(await out(b, 'ls')).toBe('help.txt  setting');
    expect(await out(b, 'cat help.txt | head -n 1')).toBe('KOK 터미널 도움말');
    // .bashrc 의 줄임 명령
    expect(await out(b, 'type ll')).toContain('ls -alF');
  });

  it('파일 만들기·파이프·넘겨주기·변수', async () => {
    const b = boot();
    await b.start();
    await run(b.session, 'echo hello world > a.txt');
    expect(await out(b, 'cat a.txt')).toBe('hello world');
    await run(b.session, 'echo hello again >> a.txt');
    expect(await out(b, 'wc -l a.txt')).toMatch(/2 a\.txt$/);
    expect(await out(b, 'cat a.txt | grep -c hello')).toBe('2');
    expect(await out(b, 'grep -v world a.txt')).toBe('hello again');
    expect(await out(b, 'NAME=콕; echo "$NAME $HOME"')).toBe('콕 /home/student');
    expect(await out(b, 'false || echo 안됨 && echo 됨')).toBe('안됨\n됨');
    expect(await out(b, 'mkdir -p x/y && cd x/y && pwd')).toBe('/home/student/x/y');
    expect(await out(b, 'cd - > /dev/null; pwd')).toBe('/home/student');
  });

  it('오류는 한국어 우분투처럼', async () => {
    const b = boot();
    await b.start();
    expect(await out(b, 'cat nope')).toBe('cat: nope: 그런 파일이나 디렉터리가 없습니다');
    expect(await out(b, 'ls /root')).toContain('허가 거부');
    expect(await out(b, 'touch /etc/x')).toContain('허가 거부');
    expect(await out(b, 'nosuch')).toBe('nosuch: 명령을 찾을 수 없습니다');
    expect(await out(b, 'vim a')).toContain('sudo apt install vim');
    expect(await out(b, 'rm -rf /')).toContain('위험합니다');
    expect(await out(b, 'cd help.txt')).toContain('디렉터리가 아닙니다');
    expect(await out(b, 'echo "abc')).toContain('찾는 중');
  });

  it('sudo 는 암호를 묻고 거절한다', async () => {
    const b = boot();
    await b.start();
    b.session.clearScreen();
    const done = b.session.enter('sudo ls');
    await answer(b.session, 'secret');
    await done;
    const text = screen(b.session);
    expect(text).toContain('sudoers');
    expect(text).not.toContain('secret');
  });

  it('스크립트: chmod +x 하고 ./ 로 실행', async () => {
    const b = boot();
    await b.start();
    await run(b.session, `printf '#!/bin/sh\\necho 인자 $1\\n' > s.sh`);
    expect(await out(b, './s.sh 하나')).toContain('허가 거부');
    await run(b.session, 'chmod +x s.sh');
    expect(await out(b, './s.sh 하나')).toBe('인자 하나');
  });

  it('탭 채우기·기록·!!', async () => {
    const b = boot();
    await b.start();
    expect(b.session.complete('neo', 3)).toEqual({ input: 'neofetch ', cursor: 9 });
    // cal·cat: 더 채울 것이 없으면 첫 탭은 그대로
    expect(b.session.complete('ca', 2)).toBeNull();
    expect(b.session.complete('cat he', 6)).toEqual({ input: 'cat help.txt ', cursor: 13 });
    // 여럿이면 두 번째 탭에 목록
    await run(b.session, 'touch hello.md');
    expect(b.session.complete('cat hel', 7)).toBeNull();
    expect(b.session.complete('cat hel', 7)).toEqual({ input: 'cat hel', cursor: 7 });
    expect(screen(b.session)).toContain('hello.md  help.txt');
    await run(b.session, 'echo 하나');
    expect(b.session.historyUp('')).toBe('echo 하나');
    expect(b.session.historyUp('')).toBe('touch hello.md');
    expect(b.session.historyDown()).toBe('echo 하나');
    expect(b.session.historyDown()).toBe('');
    expect(await out(b, '!!')).toContain('하나');
  });

  it('exit 는 터미널을 닫는다', async () => {
    const b = boot();
    await b.start();
    await run(b.session, 'exit');
    expect(b.session.closed).toBe(true);
    expect(screen(b.session)).toContain('logout');
  });

  it('저장한 것으로 다시 열면 파일과 기록이 그대로 (help.txt 는 새로)', async () => {
    const b = boot();
    await b.start();
    await run(b.session, 'echo 메모 > memo.txt; rm help.txt');
    const saved = readSaved(JSON.stringify(b.snapshot()));
    expect(saved).not.toBeNull();
    const again = boot(saved);
    await again.start();
    expect(screen(again.session)).toContain('마지막 로그인');
    expect(await out(again, 'cat memo.txt')).toBe('메모');
    expect(await out(again, 'ls')).toBe('help.txt  memo.txt  setting');
    expect(again.shell.history).toContain('echo 메모 > memo.txt; rm help.txt');
  });
});

// ------------------------------------------------------------------ setting
describe('setting: KOK 데이터를 명령어로', () => {
  async function open() {
    const b = boot();
    await b.start();
    await run(b.session, './setting');
    expect(b.session.stack).toHaveLength(2);
    return b;
  }

  it('./setting 으로 들어가고 exit 로 셸로 돌아온다', async () => {
    const b = await open();
    expect(screen(b.session)).toContain('KOK setting 1.0');
    expect(stripAnsi(b.session.prompt() ?? '')).toBe('setting:/$ ');
    await run(b.session, 'exit');
    expect(b.session.stack).toHaveLength(1);
    expect(stripAnsi(b.session.prompt() ?? '')).toBe('student@kok:~$ ');
    expect(b.session.closed).toBe(false);
  });

  it('둘러보기: ls·cd·ls -l·tree·cat·info·find', async () => {
    const b = await open();
    expect(await out(b, 'ls')).toBe('수학/  과학/\n(보관한 과목 1개는 ls -a 로)');
    expect(await out(b, 'ls -a')).toContain("'옛날 과목'/");
    await run(b.session, 'cd 수학');
    expect(stripAnsi(b.session.prompt() ?? '')).toBe('setting:/수학$ ');
    const long = await out(b, 'ls -l');
    expect(long).toContain('#3f2a9c');
    expect(long.split('\n')[0]).toContain('이차방정식');
    expect(await out(b, 'cat 이차방정식')).toContain('근의 공식');
    expect(await out(b, 'info #7b1d0e')).toContain('함수의 극한');
    expect(await out(b, 'cd ..; pwd')).toContain('여기서는 명령을 하나씩');
    await run(b.session, 'cd /');
    expect(await out(b, 'tree')).toContain('└── ');
    expect(await out(b, "cat '세포 분열'")).toContain('정리 중인');
    expect(await out(b, 'find 광합')).toContain('과학/');
    expect(await out(b, 'cd 없는과목')).toContain('그런 과목이 없어요');
  });

  it('자료 고치기: 이름·옮기기·별표·복습 끄기', async () => {
    const b = await open();
    await run(b.session, 'cd 수학');
    await run(b.session, 'mv 함수의\\ 극한 극한');
    expect(b.calls).toContain('rename 7b1d0e22 극한');
    await run(b.session, 'mv 극한 과학/');
    expect(b.calls).toContain('move 7b1d0e22 -> s2bbbb');
    await run(b.session, 'unstar 이차방정식');
    expect(b.calls).toContain('flag starred false 3f2a9c11');
    await run(b.session, 'review off *');
    expect(b.calls).toContain('flag in_review false 3f2a9c11');
  });

  it('지우기는 묻고 한다 (n 이면 그대로)', async () => {
    const b = await open();
    let done = b.session.enter('rm 과학/광합성');
    await answer(b.session, 'n');
    await done;
    expect(b.calls.some((c) => c.startsWith('remove'))).toBe(false);
    done = b.session.enter('rm 과학/광합성');
    await answer(b.session, 'y');
    await done;
    expect(b.calls).toContain('remove 9c4e5f33');
    // 과목은 rm -r 로만
    expect(await out(b, 'rm 수학')).toContain('rm -r');
    expect(await out(b, 'rmdir 수학')).toContain('자료가 2개');
  });

  it('과목: mkdir·mv·merge·pin·archive', async () => {
    const b = await open();
    await run(b.session, 'mkdir 국어');
    expect(b.calls).toContain('mkdir 국어');
    await run(b.session, 'mv 국어 문학');
    expect(b.calls.at(-1)).toContain('"name":"문학"');
    expect(await out(b, 'mkdir 수학')).toContain('같은 이름');
    await run(b.session, 'pin 과학');
    expect(b.calls.at(-1)).toContain('"pinned":true');
    await run(b.session, 'unarchive 옛날\\ 과목');
    expect(b.calls.at(-1)).toContain('"archived":false');
    const done = b.session.enter('merge 과학 수학');
    await answer(b.session, 'y');
    await done;
    expect(b.calls).toContain('merge s2bbbb s1aaaa');
  });

  it('복습 데이터: stats·due·q·wrong·sessions', async () => {
    const b = await open();
    expect(await out(b, 'stats')).toContain('1문제 남음');
    expect(await out(b, 'due')).toContain('수학');
    const q = await out(b, 'q 수학/이차방정식');
    expect(q).toContain('근의 공식은?');
    expect(q).toContain('쉼');
    await run(b.session, 'q rest 수학/이차방정식 2');
    expect(b.calls).toContain('status suspended q2');
    await run(b.session, 'q wake 수학/이차방정식 3');
    expect(b.calls).toContain('status active q3');
    let done = b.session.enter('q reset 수학/이차방정식 1-2');
    await answer(b.session, 'y');
    await done;
    expect(b.calls).toContain('reset q1,q2');
    b.setVersions(true);
    expect(await out(b, 'q rm 수학/이차방정식 1')).toContain('버전이 있는 노트');
    expect(await out(b, 'q rest 수학/이차방정식 9')).toContain('9번이 없어요');
    expect(await out(b, 'wrong')).toContain('근의 공식은?');
    await run(b.session, 'wrong rm 1');
    expect(b.calls).toContain('unwrong q1');
    expect(await out(b, 'sessions')).toContain('3/8');
    await run(b.session, 'sessions rm home');
    expect(b.calls).toContain('drop home');
    done = b.session.enter('wrong rm --all');
    await answer(b.session, 'y');
    await done;
  });

  it('설정 보기·바꾸기, 모르는 명령, 도움말', async () => {
    const b = await open();
    expect(await out(b, 'config')).toContain('review.dailyMax');
    await run(b.session, 'config review.dailyMax 80');
    expect(b.calls).toContain('config review.dailyMax=80');
    expect(await out(b, 'nosuch')).toContain('모르는 명령');
    expect(await out(b, 'help')).toContain('둘러보기');
    expect(await out(b, 'help mv')).toContain('과목/');
    expect(await out(b, 'cp a b')).toContain('setting 에서는 쓸 수 없어요');
  });

  it('탭 채우기: 명령·과목·자료', async () => {
    const b = await open();
    expect(b.session.complete('tre', 3)).toEqual({ input: 'tree ', cursor: 5 });
    expect(b.session.complete('cd 수', 4)).toEqual({ input: 'cd 수학/', cursor: 6 });
    expect(b.session.complete('cat 수학/이', 8)).toEqual({ input: 'cat 수학/이차방정식 ', cursor: 13 });
  });

  it('./setting 명령 하나만 (셸에 남고, 파이프도)', async () => {
    const b = boot();
    await b.start();
    expect(await out(b, './setting ls')).toBe('수학/  과학/\n(보관한 과목 1개는 ls -a 로)');
    expect(b.session.stack).toHaveLength(1);
    expect(await out(b, './setting ls -a | grep 옛날')).toContain("'옛날 과목'/");
    expect(await out(b, 'kok setting stats > s.txt; cat s.txt')).toContain('오늘 복습');
  });

  it('Ctrl+D 는 exit 와 같다 (기록에는 남기지 않는다)', async () => {
    const b = await open();
    await b.session.eof();
    expect(b.session.stack).toHaveLength(1);
    await b.session.eof();
    expect(b.session.closed).toBe(true);
    expect(b.shell.history).not.toContain('exit');
  });
});
