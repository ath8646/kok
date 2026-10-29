// 터미널 명령 줄 읽기 (bash 의 작은 부분): 따옴표·역슬래시, $변수, ~, *·? 파일 이름 펼치기, | 파이프, ; && ||, > >> < 2> 2>&1 &>, # 주석.
// 화면과 상관없는 순수 코드 (시험 term.test.ts)

/** 낱말 조각: 따옴표 종류에 따라 펼치는 것이 다르다 (none: 변수·~·*, double: 변수만, single: 그대로) */
export type Part = { text: string; quote: 'none' | 'double' | 'single' };
export type Word = Part[];
export type RedirOp = '>' | '>>' | '<' | '2>' | '2>>' | '&>' | '2>&1';
export type Redir = { op: RedirOp; target: Word | null };
export type Cmd = { words: Word[]; redirs: Redir[] };
export type Pipeline = Cmd[];
/** 줄 하나: 파이프라인들과 그 사이의 이음 (; && ||). next 는 다음 것과의 이음 */
export type Script = Array<{ pipeline: Pipeline; next: ';' | '&&' | '||' | null }>;

type Tok = { k: 'word'; w: Word } | { k: 'op'; op: '|' | '||' | '&&' | ';' | '&' } | { k: 'redir'; op: RedirOp };

export class ParseError extends Error {}

/** bash 처럼: 문법 오류 글 */
const near = (t: string) => new ParseError(`예기치 않은 토큰 \`${t}' 근처에서 문법 오류`);

export function lex(line: string): Tok[] {
  const out: Tok[] = [];
  let word: Word = [];
  let started = false;
  const push = (text: string, quote: Part['quote']) => {
    const last = word[word.length - 1];
    if (last && last.quote === quote) last.text += text;
    else word.push({ text, quote });
    started = true;
  };
  const end = () => {
    if (started) out.push({ k: 'word', w: word });
    word = [];
    started = false;
  };
  let i = 0;
  while (i < line.length) {
    const c = line[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      end();
      i++;
      continue;
    }
    if (c === '#' && !started) break;
    if (c === "'") {
      const j = line.indexOf("'", i + 1);
      if (j < 0) throw new ParseError("예상치 못한 파일의 끝에서 `'' 를 찾는 중");
      push(line.slice(i + 1, j), 'single');
      i = j + 1;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      let buf = '';
      while (j < line.length && line[j] !== '"') {
        if (line[j] === '\\' && j + 1 < line.length && '"\\$`'.includes(line[j + 1])) {
          // \$ 는 변수가 아닌 글자 $ (single 로 둔다)
          if (line[j + 1] === '$') {
            if (buf) push(buf, 'double');
            buf = '';
            push('$', 'single');
          } else buf += line[j + 1];
          j += 2;
          continue;
        }
        buf += line[j];
        j++;
      }
      if (j >= line.length) throw new ParseError('예상치 못한 파일의 끝에서 `"\' 를 찾는 중');
      push(buf, 'double');
      i = j + 1;
      continue;
    }
    if (c === '\\') {
      if (i + 1 < line.length) push(line[i + 1], 'single');
      i += 2;
      continue;
    }
    // 2> 2>> 2>&1 은 낱말 처음의 2 뒤에만
    if (c === '2' && !started && line[i + 1] === '>') {
      end();
      if (line.startsWith('2>&1', i)) {
        out.push({ k: 'redir', op: '2>&1' });
        i += 4;
      } else if (line.startsWith('2>>', i)) {
        out.push({ k: 'redir', op: '2>>' });
        i += 3;
      } else {
        out.push({ k: 'redir', op: '2>' });
        i += 2;
      }
      continue;
    }
    if (c === '&' && line[i + 1] === '>') {
      end();
      out.push({ k: 'redir', op: '&>' });
      i += 2;
      continue;
    }
    if (c === '>' || c === '<') {
      end();
      if (line.startsWith('>>', i)) {
        out.push({ k: 'redir', op: '>>' });
        i += 2;
      } else {
        out.push({ k: 'redir', op: c as RedirOp });
        i += 1;
      }
      continue;
    }
    if (c === '|' || c === '&' || c === ';') {
      end();
      const two = line.slice(i, i + 2);
      if (two === '||' || two === '&&') {
        out.push({ k: 'op', op: two });
        i += 2;
      } else {
        out.push({ k: 'op', op: c as '|' | '&' | ';' });
        i += 1;
      }
      continue;
    }
    push(c, 'none');
    i++;
  }
  end();
  return out;
}

/** 줄 → 실행할 모양. 빈 줄이면 [] */
export function parse(line: string): Script {
  const toks = lex(line);
  const script: Script = [];
  let cmd: Cmd = { words: [], redirs: [] };
  let pipe: Pipeline = [];
  const closeCmd = (tok: string) => {
    if (!cmd.words.length && !cmd.redirs.length) throw near(tok);
    pipe.push(cmd);
    cmd = { words: [], redirs: [] };
  };
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.k === 'word') {
      cmd.words.push(t.w);
    } else if (t.k === 'redir') {
      if (t.op === '2>&1') {
        cmd.redirs.push({ op: t.op, target: null });
        continue;
      }
      const next = toks[i + 1];
      if (!next || next.k !== 'word') throw near(next ? (next.k === 'op' ? next.op : next.op) : 'newline');
      cmd.redirs.push({ op: t.op, target: next.w });
      i++;
    } else if (t.op === '|') {
      closeCmd('|');
    } else {
      // ; && || & : 파이프라인 끝 (& 는 뒤에서 돌리기 없이 ; 처럼)
      const op = t.op === '&' ? ';' : t.op;
      closeCmd(t.op);
      script.push({ pipeline: pipe, next: op });
      pipe = [];
    }
  }
  if (cmd.words.length || cmd.redirs.length) {
    pipe.push(cmd);
  } else if (pipe.length) {
    throw near('newline');
  }
  if (pipe.length) script.push({ pipeline: pipe, next: null });
  else if (script.length) {
    // 끝의 ; 는 괜찮다 (a; ), && · || 로 끝나면 bash 는 다음 줄을 기다리지만 여기서는 오류
    const last = script[script.length - 1];
    if (last.next === '&&' || last.next === '||') throw near('newline');
    last.next = null;
  }
  return script;
}

/** 낱말에 펼칠 것(*·?)이 있는지: 따옴표 밖에만 */
export function hasGlob(w: Word): boolean {
  return w.some((p) => p.quote === 'none' && /[*?]/.test(p.text));
}

export type ExpandEnv = {
  vars: (name: string) => string | undefined;
  status: number;
  home: string;
  pid: number;
};

/** $이름·${이름}·$?·$$·$1…$9·$#·$0 펼치기 */
export function expandVars(text: string, env: ExpandEnv): string {
  return text.replace(/\$(\?|\$|#|\d|\{([A-Za-z_][A-Za-z0-9_]*|\d+|#)\}|[A-Za-z_][A-Za-z0-9_]*)/g, (_, all: string, braced?: string) => {
    if (all === '?') return String(env.status);
    if (all === '$') return String(env.pid);
    return env.vars(braced ?? all) ?? '';
  });
}

/**
 * 낱말 하나 → 글자 (변수·~ 를 펼친다). 파일 이름 펼치기(*)는 셸이 이 결과와 패턴으로 한다.
 * glob: 따옴표 밖의 * ? 는 패턴 글자로 두고, 따옴표 안의 * ? 는 \ 로 감싼 패턴 (globPattern)
 */
export function expandWord(w: Word, env: ExpandEnv): { text: string; pattern: string | null } {
  let text = '';
  let pattern = '';
  w.forEach((p, idx) => {
    let t = p.text;
    if (p.quote === 'none' && idx === 0 && (t === '~' || t.startsWith('~/'))) t = env.home + t.slice(1);
    if (p.quote !== 'single') t = expandVars(t, env);
    text += t;
    pattern += p.quote === 'none' ? t : t.replace(/[*?]/g, (m) => `\\${m}`);
  });
  return { text, pattern: hasGlob(w) ? pattern : null };
}

/** 패턴 글자를 정규식으로 (\* 는 글자 * ) */
export function patternRegex(pattern: string): RegExp {
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '\\' && i + 1 < pattern.length) {
      re += pattern[i + 1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      i++;
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`, 'u');
}
