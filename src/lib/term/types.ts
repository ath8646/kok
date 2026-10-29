// 터미널 화면(components/terminal)과 그 안에서 도는 프로그램(셸, setting)이 주고받는 모양

/** 탭 자동 완성: line[start, end) 를 바꿀 후보들 (하나면 그것으로, 여럿이면 같은 앞부분까지 채우고 목록을 보인다) */
export type Completion = { start: number; end: number; options: string[]; /** 끝에 빈칸을 붙일지 (디렉터리는 / 로 끝나서 안 붙인다) */ space?: boolean };

/** 화면이 프로그램에 빌려 주는 것 */
export interface TermIO {
  /** 글 쓰기 (ANSI 색 코드 가능, 줄바꿈은 \n) */
  print(text: string): void;
  /** 화면 지우기 (clear, Ctrl+L) */
  clear(): void;
  /** 한 줄 묻고 답 받기 (확인 y/N, 비밀번호). Ctrl+C 면 null */
  ask(prompt: string, opts?: { secret?: boolean }): Promise<string | null>;
  /** 앞에 프로그램을 띄운다 (setting). 그 프로그램이 끝나면 pop */
  push(p: Program): void;
  pop(): void;
  /** 터미널을 닫는다 (exit) */
  close(): void;
  /**
   * nano 편집기를 열고 나갈 때까지 기다린다. save 는 Ctrl+O(쓰기)·나갈 때 저장에서 부른다:
   * 쓰지 못했으면 그 까닭(글), 썼으면 null
   */
  edit(name: string, text: string, save: (text: string) => string | null): Promise<void>;
  /** 한 줄에 들어가는 글자 칸 수 */
  cols(): number;
  /** Ctrl+C 로 지금 명령을 멈춘다 (sleep 등이 듣는다) */
  signal: AbortSignal;
}

export interface Program {
  /** 입력 줄 앞에 보일 글 (ANSI 색 가능) */
  prompt(): string;
  run(line: string, io: TermIO): Promise<void>;
  complete(line: string, cursor: number): Completion | null;
  /** 창 위 띠에 보일 이름 */
  title(): string;
  /** 위·아래 화살표로 다시 부르는 명령 기록 (프로그램마다 따로) */
  history: string[];
}
