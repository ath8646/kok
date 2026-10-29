// 터미널을 처음 열 때의 파일들: 리눅스 같은 폴더 뼈대, 내 집의 help.txt·setting·.bashrc, /etc·/proc 의 작은 파일들.
// help.txt 와 setting 은 지워도 터미널을 다시 열면 다시 생긴다 (ensureDefaults)
import type { VDir, VNode } from './vfs';

export const HOST = 'kok';
export const KERNEL = '6.8.0-kok';
export const OS_NAME = 'KOK Linux 1.0 (Study)';
/** setting 파일의 첫 줄: 이 줄로 시작하는 실행 파일은 KOK 관리 모드를 연다 */
export const KOK_SHEBANG = '#!/usr/bin/kok';

/** 셸이 아는 명령 (bin 폴더에 같은 이름의 실행 파일을 둔다) */
export const BIN_COMMANDS = [
  'bash',
  'cat',
  'chmod',
  'clear',
  'cp',
  'date',
  'df',
  'du',
  'echo',
  'env',
  'false',
  'file',
  'find',
  'grep',
  'head',
  'hostname',
  'id',
  'kill',
  'less',
  'ls',
  'mkdir',
  'more',
  'mv',
  'printf',
  'ps',
  'pwd',
  'rm',
  'rmdir',
  'sh',
  'sleep',
  'sort',
  'stat',
  'tail',
  'touch',
  'true',
  'uname',
  'uniq',
  'wc',
  'whoami',
] as const;
export const USR_BIN_COMMANDS = [
  'apt',
  'apt-get',
  'basename',
  'cal',
  'dirname',
  'free',
  'kok',
  'man',
  'nano',
  'neofetch',
  'printenv',
  'realpath',
  'seq',
  'su',
  'sudo',
  'top',
  'tree',
  'uptime',
  'which',
] as const;

export const HELP_TXT = `KOK 터미널 도움말
=================

KOK 터미널은 리눅스처럼 쓰는 작은 셸이에요. 여기서 만든 파일은 이 기기에만 저장되고,
KOK 자료와 복습 데이터는 setting 을 실행했을 때만 보고 바꿀 수 있어요.

  cat help.txt     이 도움말 보기 (less help.txt 도 돼요)
  ./setting        KOK 관리 모드: 자료·과목·복습 데이터를 명령어로
  exit             터미널 닫기 (setting 안에서는 setting 만 나가요)


1. 리눅스 명령
--------------
파일과 폴더
  ls [-a] [-l] [-h] [경로]     목록 (폴더는 파란색, 실행 파일은 초록색)
  cd [경로]                    폴더 옮기기 (cd ~ 내 집, cd - 전에 있던 곳)
  pwd                         지금 위치
  tree [-a] [-L 깊이] [경로]    나무 모양으로
  cat [-n] 파일                내용 보기 (less, more 도 같아요)
  head -n 5 파일, tail -n 5 파일   앞·뒤 몇 줄
  touch 파일                   빈 파일 만들기
  mkdir [-p] 폴더              폴더 만들기
  cp [-r] 원본 대상             복사
  mv 원본 대상                  옮기기·이름 바꾸기
  rm [-r] [-f] [-i] 대상        지우기 (rmdir 폴더: 빈 폴더 지우기)
  nano 파일                    편집기 (Ctrl+O 저장, Ctrl+X 나가기)
  chmod +x 파일                실행할 수 있게
  find [경로] -name '*.txt'     이름으로 찾기 (-type f 파일만, -type d 폴더만)
  grep [-i] [-n] [-v] [-c] 글자 파일   글자가 든 줄 찾기
  wc [-l] [-w] [-c], sort [-r] [-n] [-u], uniq [-c], stat, file, du -h, df -h

셸
  명령1 | 명령2                앞 명령의 결과를 뒤 명령에 (예: ls -l | grep txt)
  명령 > 파일, 명령 >> 파일      결과를 파일에 쓰기·덧붙이기 (< 파일: 파일에서 읽기)
  명령1 && 명령2               앞 명령이 되면 뒤 명령 (|| 는 안 되면, ; 는 그냥 차례로)
  echo $HOME, export 이름=값     변수
  alias ll='ls -l'             줄임 명령 (~/.bashrc 에 적어 두면 열 때마다)
  history, !!                  쓴 명령 목록, 방금 명령 다시
  #!/bin/sh 로 시작하는 파일을 chmod +x 하면 ./파일 로 실행할 수 있어요

시스템
  whoami  id  hostname  uname -a  date  cal  uptime  free -h  ps  top  kill
  env  which  type  man 명령  clear  neofetch  sleep 초  seq 1 10

단축키
  Tab        이름 채우기 (후보가 여럿이면 목록)
  ↑ / ↓      전에 쓴 명령
  Ctrl+C     지금 줄·명령 멈추기       Ctrl+L     화면 지우기
  Ctrl+A/E   줄 처음·끝                Ctrl+U/K   커서 앞·뒤 지우기
  Ctrl+D     나가기 (빈 줄에서)
  폰에서는 키보드 위 줄의 ESC·TAB·CTRL·화살표 단추를 써요.


2. setting — KOK 관리 모드
-------------------------
./setting 을 실행하면 프롬프트가 setting:/$ 로 바뀌어요. 과목은 폴더, 자료(노트)는 파일처럼
보여요. 이름에 빈칸이 있으면 따옴표로 감싸요: cat '세포 분열'
자료는 이름 대신 #번호로도 고를 수 있어요 (ls -l 에 보여요): info #3f2a9c
과목 안에서는 * 로 그 과목의 자료를 모두 고를 수 있어요: star *
exit 나 Ctrl+D 로 나가면 다시 리눅스 셸이에요 (setting 의 명령 기록은 따로 남아요).
명령을 붙여 실행하면 그 명령만 하고 셸에 남아요. 파이프·넘겨주기도 돼요:
  ./setting stats             kok setting ls -l 수학             ./setting tree > 자료목록.txt

둘러보기
  ls [-l] [-a] [과목]           과목 목록, 과목 안의 자료 (-l: 번호·별표·복습·종류·날짜, -a: 보관한 과목도)
  cd 과목, cd .., cd /          과목으로 들어가기·나오기
  tree                         모든 과목과 자료
  cat 자료                     노트 정리 보기 (요약·개념·용어·공식)
  info 자료                    자세히 (과목·단원·종류·상태·문제·복습 카드)
  find 글자                    이름·단원으로 찾기

자료 고치기
  mv 자료 새이름                이름 바꾸기
  mv 자료… 과목/                다른 과목으로 옮기기 (문제·복습 카드도 같이)
  rm 자료…                     지우기 (노트·문제·복습 기록까지. 묻고 지워요, -f 는 묻지 않아요)
  star 자료…, unstar 자료…      별표 달기·빼기
  review off 자료…              복습에서 빼기 (review on 자료… 다시 넣기)

과목
  mkdir 과목                   새 과목
  mv 과목 새이름                과목 이름 바꾸기 (맨 위 / 에서)
  rmdir 과목                   빈 과목 지우기 (자료가 있으면 rm -r 과목: 묻고 지워요)
  merge 과목 다른과목            과목 합치기 (앞 과목의 자료를 뒤 과목으로 옮기고 앞 과목은 지워요)
  pin 과목, unpin 과목          위에 고정·고정 풀기
  archive 과목, unarchive 과목  보관·보관 풀기 (자료함 목록에서만 빠지고 복습은 그대로)

복습 데이터
  stats                        복습 통계 (오늘 복습·카드 상태·과목별)
  due                          오늘 복습할 문제 (과목별)
  q 자료                       자료의 문제 목록 (번호·유형·상태·다음 복습·틀린 수)
  q rest 자료 번호…             문제 쉬게 하기 (복습에 안 나와요)
  q wake 자료 번호…             쉬던 문제 다시 복습에
  q reset 자료 [번호…]          복습 기록을 처음부터 (묻고 해요, 번호가 없으면 모든 문제)
  q rm 자료 번호…               문제 지우기 (묻고 지워요. 버전이 있는 노트는 앱의 문제 탭에서)
  wrong                        오답노트 목록
  wrong rm 번호…, wrong rm --all   오답노트에서 빼기 (다시 틀리면 다시 들어와요)
  sessions                     하던 복습 (홈의 오늘의 KOK·복습 탭·오답 다시 풀기)
  sessions rm home|review|wrong    하던 복습 지우기

설정
  config                       설정 보기
  config 이름 값                설정 바꾸기 (예: config review.dailyMax 80, config notify.done off)

기타
  help [명령], whoami, clear, exit (setting 나가기)


조심하세요
  - rm 으로 지운 자료와 q reset 은 되돌릴 수 없어요.
  - 터미널의 파일(이 도움말, 내가 만든 파일, 명령 기록)은 이 기기에만 있어요.
  - help.txt 와 setting 을 지워도 터미널을 다시 열면 다시 생겨요.
`;

export const SETTING_SCRIPT = `${KOK_SHEBANG}
# KOK setting — 내 자료·복습 데이터를 명령어로 관리해요.
# 실행: ./setting      도움말: cat ~/help.txt
exec kok setting "$@"
`;

export const BASHRC = `# ~/.bashrc: 터미널을 열 때마다 읽어요
alias ll='ls -alF'
alias la='ls -A'
alias l='ls -CF'
export EDITOR=nano
`;

const ELF = '\u007fELF\u0002\u0001\u0001\u0000 (실행 파일)\n';

function file(data: string, mode = 0o644, mtime = 0): VNode {
  return { t: 'f', mode, mtime, data };
}
function dir(kids: Record<string, VNode> = {}, mtime = 0, mode = 0o755): VDir {
  return { t: 'd', mode, mtime, kids };
}

/** 처음 여는 파일 시스템 */
export function freshTree(user: string, now: number): VDir {
  const bins = (names: readonly string[]) => Object.fromEntries(names.map((n) => [n, file(ELF, 0o755, now)]));
  return dir(
    {
      bin: dir(bins(BIN_COMMANDS), now),
      boot: dir({}, now),
      dev: dir({ null: file('', 0o666, now), zero: file('', 0o666, now) }, now),
      etc: dir(
        {
          hostname: file(`${HOST}\n`, 0o644, now),
          'os-release': file(`PRETTY_NAME="${OS_NAME}"\nNAME="KOK Linux"\nVERSION_ID="1.0"\nVERSION="1.0 (Study)"\nID=kok\nID_LIKE=debian\n`, 0o644, now),
          passwd: file(`root:x:0:0:root:/root:/bin/bash\n${user}:x:1000:1000:KOK:/home/${user}:/bin/bash\n`, 0o644, now),
          shells: file('/bin/sh\n/bin/bash\n', 0o644, now),
          motd: file(`KOK 공부 터미널이에요. 도움말은 cat help.txt, KOK 관리는 ./setting\n`, 0o644, now),
        },
        now,
      ),
      home: dir({ [user]: dir({}, now) }, now),
      lib: dir({}, now),
      media: dir({}, now),
      mnt: dir({}, now),
      opt: dir({}, now),
      proc: dir(
        {
          version: file(`Linux version ${KERNEL} (kok@build) (gcc 13.2.0, GNU ld 2.42) #1 SMP PREEMPT_DYNAMIC\n`, 0o444, now),
          cpuinfo: file('processor\t: 0\nvendor_id\t: KOK\nmodel name\t: KOK Study Core @ 2.40GHz\ncpu cores\t: 2\n', 0o444, now),
          meminfo: file('MemTotal:        4096000 kB\nMemFree:         2867200 kB\nMemAvailable:    3276800 kB\n', 0o444, now),
        },
        now,
      ),
      root: dir({}, now, 0o700),
      run: dir({}, now),
      srv: dir({}, now),
      tmp: dir({}, now, 0o777),
      usr: dir({ bin: dir(bins(USR_BIN_COMMANDS), now), local: dir({ bin: dir({}, now) }, now), share: dir({}, now) }, now),
      var: dir({ log: dir({ 'kok.log': file('', 0o640, now) }, now) }, now),
    },
    now,
  );
}

/** 내 집의 기본 파일 (없으면 만든다: 지워도 다시 열면 다시 생긴다). 처음 여는 집에는 .bashrc 도 */
export function ensureDefaults(root: VDir, user: string, now: number, first: boolean): void {
  const home = root.kids.home;
  if (!home || home.t !== 'd') return;
  let me = home.kids[user];
  if (!me || me.t !== 'd') {
    me = dir({}, now);
    home.kids[user] = me;
  }
  const kids = (me as VDir).kids;
  // 도움말은 늘 새 글로 (앱이 바뀌면 설명도 바뀐다)
  kids['help.txt'] = file(HELP_TXT, 0o644, now);
  if (!kids.setting) kids.setting = file(SETTING_SCRIPT, 0o755, now);
  if (first && !kids['.bashrc']) kids['.bashrc'] = file(BASHRC, 0o644, now);
}

/** 나를 부를 이름: 닉네임이 영문이면 그것을 소문자로, 아니면 student */
export function userName(nickname: string | null | undefined): string {
  const n = (nickname ?? '').trim().toLowerCase();
  return /^[a-z][a-z0-9_-]{0,15}$/.test(n) && n !== 'root' ? n : 'student';
}
