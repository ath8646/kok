import { describe, expect, it } from 'vitest';
import {
  anonymousNames,
  cleanFileName,
  countText,
  fileSizeText,
  galleryKey,
  galleryNameProblem,
  galleryQuery,
  isOfficialGallery,
  nicknameProblem,
  organizable,
  readSharedMark,
  searchWords,
  shareContentType,
  shareExt,
  shareKindOf,
  sniffJpeg,
  sniffShareFile,
  timeAgo,
} from '@/lib/share';

const bytes = (...xs: number[]) => new Uint8Array(xs);
const text = (s: string) => new TextEncoder().encode(s);
/** zip 의 첫 파일 머리 (local file header: 이름 길이는 26~27 바이트, 이름은 30 바이트부터) */
function zipWith(name: string): Uint8Array {
  const n = text(name);
  const head = new Uint8Array(30 + n.length);
  head.set([0x50, 0x4b, 0x03, 0x04]);
  head[26] = n.length & 0xff;
  head[27] = n.length >> 8;
  head.set(n, 30);
  return head;
}

describe('갤러리 이름', () => {
  it('띄어쓰기·대소문자가 달라도 같은 갤러리로 본다', () => {
    expect(galleryKey('중학교 갤러리')).toBe(galleryKey('중학교갤러리'));
    expect(galleryKey(' TOEIC  스터디 ')).toBe(galleryKey('toeic스터디'));
  });

  it('운영자 갤러리는 처음에 넣은 일곱 개뿐 (주인이 탈퇴한 갤러리는 아니다)', () => {
    expect(isOfficialGallery('c0000000-0000-4000-8000-000000000001')).toBe(true);
    expect(isOfficialGallery('c0000000-0000-4000-8000-000000000007')).toBe(true);
    expect(isOfficialGallery('c0000000-0000-4000-8000-000000000008')).toBe(false);
    expect(isOfficialGallery('7f6fc5f2-8a37-48ba-8fcb-28bf5a744cc1')).toBe(false);
  });

  it('길이와 운영자처럼 보이는 이름을 막는다 (운영자는 된다)', () => {
    expect(galleryNameProblem('가', false)).toMatch(/2자 이상/);
    expect(galleryNameProblem('가'.repeat(31), false)).toMatch(/30자까지/);
    expect(galleryNameProblem('KOK 공식 갤러리', false)).toMatch(/쓸 수 없어요/);
    expect(galleryNameProblem('운 영 자 공지', false)).toMatch(/쓸 수 없어요/);
    expect(galleryNameProblem('KOK 공식 갤러리', true)).toBeNull();
    expect(galleryNameProblem('동성중 2학년', false)).toBeNull();
  });
});

describe('공유 파일', () => {
  it('확장자로 종류를 정한다 (못 올리는 파일은 null)', () => {
    expect(shareKindOf('시험지.PDF')).toBe('pdf');
    expect(shareKindOf('사진.jpeg')).toBe('image');
    expect(shareKindOf('a.webp')).toBe('image');
    expect(shareKindOf('보고서.hwpx')).toBe('hwpx');
    expect(shareKindOf('표.xlsx')).toBe('xlsx');
    expect(shareKindOf('setup.exe')).toBeNull();
    expect(shareKindOf('예전.doc')).toBeNull();
    expect(shareKindOf('이름없음')).toBeNull();
  });

  it('저장할 때의 형식과 확장자 (사진은 원래 확장자대로)', () => {
    expect(shareContentType('image', 'a.png')).toBe('image/png');
    expect(shareContentType('image', 'a.JPG')).toBe('image/jpeg');
    expect(shareContentType('hwp')).toBe('application/x-hwp');
    expect(shareExt('image', 'b.webp')).toBe('webp');
    expect(shareExt('image', 'b.jpeg')).toBe('jpg');
    expect(shareExt('docx')).toBe('docx');
  });

  it('엑셀만 KOK 으로 바로 정리하지 못한다', () => {
    expect(organizable('pdf')).toBe(true);
    expect(organizable('hwp')).toBe(true);
    expect(organizable('xlsx')).toBe(false);
  });

  it('앞부분 바이트가 그 종류의 파일인지 본다 (이름만 바꾼 파일을 막는다)', () => {
    expect(sniffShareFile('pdf', text('%PDF-1.7\n'))).toBe(true);
    expect(sniffShareFile('pdf', text('\n\n  %PDF-1.4'))).toBe(true);
    expect(sniffShareFile('pdf', text('MZ\x90\x00'))).toBe(false);
    expect(sniffShareFile('image', bytes(0xff, 0xd8, 0xff, 0xe0))).toBe(true);
    expect(sniffShareFile('image', bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe(true);
    expect(sniffShareFile('image', text('RIFF\x00\x00\x00\x00WEBPVP8 '))).toBe(true);
    expect(sniffShareFile('image', text('GIF89a'))).toBe(false);
    expect(sniffShareFile('hwp', bytes(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1))).toBe(true);
    expect(sniffShareFile('hwp', text('HWP Document File V3.00'))).toBe(true);
    expect(sniffShareFile('docx', zipWith('[Content_Types].xml'))).toBe(true);
    expect(sniffShareFile('hwpx', zipWith('mimetype'))).toBe(true);
    expect(sniffShareFile('pptx', zipWith('ppt/slides/slide1.xml'))).toBe(true);
    // 문서가 아닌 압축 파일 (안에 실행 파일)
    expect(sniffShareFile('docx', zipWith('virus.exe'))).toBe(false);
    expect(sniffShareFile('docx', text('PK'))).toBe(false);
    expect(sniffShareFile('txt', text('안녕하세요\n'))).toBe(true);
    expect(sniffShareFile('txt', bytes(0x41, 0x00, 0x42))).toBe(false);
    expect(sniffShareFile('pdf', new Uint8Array())).toBe(false);
  });

  it('미리보기는 JPEG 만', () => {
    expect(sniffJpeg(bytes(0xff, 0xd8, 0xff, 0xdb))).toBe(true);
    expect(sniffJpeg(text('<svg'))).toBe(false);
  });

  it('크기 글', () => {
    expect(fileSizeText(100)).toBe('1KB');
    expect(fileSizeText(340 * 1024)).toBe('340KB');
    expect(fileSizeText(1.25 * 1024 * 1024)).toBe('1.3MB');
    expect(fileSizeText(23 * 1024 * 1024)).toBe('23MB');
  });

  it('파일 이름 다듬기 (경로·제어 글자를 빼고 확장자는 남긴다)', () => {
    expect(cleanFileName('C:\\Users\\me\\정리.pdf')).toBe('정리.pdf');
    expect(cleanFileName('../../etc/passwd')).toBe('passwd');
    expect(cleanFileName('a\u0000b\nc.txt')).toBe('abc.txt');
    expect(cleanFileName('   ')).toBe('file');
    const long = cleanFileName(`${'가'.repeat(200)}.hwpx`);
    expect(long.length).toBe(120);
    expect(long.endsWith('.hwpx')).toBe(true);
  });
});

describe('찾기', () => {
  it('낱말 다섯 개까지, ILIKE 표시는 막는다', () => {
    expect(searchWords('  중2   과학  ')).toEqual(['중2', '과학']);
    expect(searchWords('a b c d e f g')).toHaveLength(5);
    expect(searchWords('100% 할인_코드\\')).toEqual(['100\\%', '할인\\_코드\\\\']);
    expect(searchWords('')).toEqual([]);
  });

  it('갤러리 찾기 글은 PostgREST or= 를 깨뜨리는 글자를 뺀다', () => {
    expect(galleryQuery('중학교,name.eq.x')).toBe('중학교 name.eq.x');
    expect(galleryQuery('a(b)"c\'*%_\\d')).toBe('a b c d');
    expect(galleryQuery('가'.repeat(50))).toHaveLength(30);
  });
});

describe('익명 이름', () => {
  it('글쓴이는 익명(글쓴이), 나머지는 처음 나온 차례로 같은 사람은 같은 번호', () => {
    const names = anonymousNames(
      [
        { author: 'u2', anonymous: true },
        { author: 'u1', anonymous: true },
        { author: 'u3', anonymous: false },
        { author: 'u2', anonymous: true },
        { author: 'u4', anonymous: true },
      ],
      'u1',
      true,
    );
    expect(names).toEqual(['익명1', '익명(글쓴이)', '', '익명1', '익명2']);
  });

  it('닉네임으로 쓴 글의 글쓴이가 익명으로 단 댓글에는 글쓴이 표시가 없다 (붙이면 익명이 풀린다)', () => {
    const names = anonymousNames(
      [
        { author: 'u1', anonymous: true },
        { author: 'u2', anonymous: true },
        { author: 'u1', anonymous: true },
      ],
      'u1',
      false,
    );
    expect(names).toEqual(['익명1', '익명2', '익명1']);
  });
});

describe('지난 시간 글 (한국 시간)', () => {
  const now = Date.parse('2026-10-31T06:00:00Z'); // 한국 15:00
  it('방금 · 분 · 시간', () => {
    expect(timeAgo('2026-10-31T05:59:30Z', now)).toBe('방금');
    expect(timeAgo('2026-10-31T05:45:00Z', now)).toBe('15분 전');
    expect(timeAgo('2026-10-31T01:00:00Z', now)).toBe('5시간 전');
  });
  it('어제 · 날짜 · 해가 다르면 해까지', () => {
    expect(timeAgo('2026-10-30T03:00:00Z', now)).toBe('어제');
    expect(timeAgo('2026-10-03T03:00:00Z', now)).toBe('10월 3일');
    expect(timeAgo('2025-01-05T03:00:00Z', now)).toBe('2025년 1월 5일');
    expect(timeAgo('잘못된 때', now)).toBe('');
  });
  it('어제·날짜는 한국 날짜로 센다 (UTC 날짜가 아니라)', () => {
    // 한국 10월 31일 00:30 에 본 글
    const kstMidnight = Date.parse('2026-10-30T15:30:00Z');
    expect(timeAgo('2026-10-30T03:00:00Z', kstMidnight)).toBe('12시간 전');
    // 한국 10월 30일 00:10 (UTC 10월 29일) → 어제
    expect(timeAgo('2026-10-29T15:10:00Z', kstMidnight)).toBe('어제');
    // 한국 10월 29일 23:50 (UTC 로는 하루 전이지만 한국으로는 이틀 전)
    expect(timeAgo('2026-10-29T14:50:00Z', kstMidnight)).toBe('10월 29일');
  });
});

describe('수 글', () => {
  it('천·만 단위로 줄인다', () => {
    expect(countText(999)).toBe('999');
    expect(countText(1200)).toBe('1.2천');
    expect(countText(3000)).toBe('3천');
    expect(countText(34_000)).toBe('3.4만');
    expect(countText(250_000)).toBe('25만');
  });
});

describe('공유받은 노트 표시', () => {
  it('글 번호가 있어야 읽는다', () => {
    const post = '0b8c6c1e-1111-4222-8333-444455556666';
    expect(readSharedMark({ shared: { post, title: '광합성', by: '익명', at: '2026-10-31T00:00:00Z' } })).toEqual({
      post,
      title: '광합성',
      by: '익명',
      at: '2026-10-31T00:00:00Z',
    });
    expect(readSharedMark({ shared: { post: 'x' } })).toBeNull();
    expect(readSharedMark({})).toBeNull();
    expect(readSharedMark(null)).toBeNull();
    expect(readSharedMark({ shared: { post, title: 3 } })).toEqual({ post, title: '', by: '', at: '' });
  });
});

describe('닉네임', () => {
  it('운영자처럼 보이거나 익명으로 시작하는 닉네임만 막는다', () => {
    for (const bad of ['익명', '익명1', '익명 (글쓴이)', 'KOK 운영자', '관리자님', '운영진', 'kok', 'KOK팀', 'kok 공식'])
      expect(nicknameProblem(bad), bad).not.toBeNull();
    for (const ok of ['수학공식왕', 'kokoa', '민지', 'KOK좋아', '무명', '나는익명이아님']) expect(nicknameProblem(ok), ok).toBeNull();
  });
});
