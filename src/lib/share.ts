// 자료 공유(커뮤니티): 화면과 서버가 같이 쓰는 규칙·모양 (계산만, 시험 share.test.ts).
// 갤러리 분류, 글·댓글 길이, 올릴 수 있는 파일과 그 첫 바이트 검사, 찾는 낱말, 익명 이름, 지난 시간 글.

// ------------------------------------------------------------- 갤러리
export const GALLERY_CATEGORIES = ['elementary', 'middle', 'high', 'college', 'license', 'language', 'etc'] as const;
export type GalleryCategory = (typeof GALLERY_CATEGORIES)[number];
export const CATEGORY_LABEL: Record<GalleryCategory, string> = {
  elementary: '초등',
  middle: '중학교',
  high: '고등학교',
  college: '대학',
  license: '자격증',
  language: '어학',
  etc: '기타',
};

export const SHARE_TEXT = {
  galleryName: { min: 2, max: 30 },
  galleryDesc: 200,
  title: 80,
  body: 5000,
  comment: 1000,
  nickname: 20,
} as const;

/** 운영자가 처음에 만든 갤러리 (schema.sql 이 넣는 일곱 개). 만든 사람이 탈퇴해 주인이 없어진 갤러리는 운영자 갤러리가 아니다 */
export function isOfficialGallery(id: string): boolean {
  return /^c0000000-0000-4000-8000-00000000000[1-7]$/.test(id);
}

/** 같은 갤러리인지 보는 열쇠: 띄어쓰기를 빼고 소문자로 ('중학교 갤러리' = '중학교갤러리') */
export function galleryKey(name: string): string {
  return name.normalize('NFC').replace(/\s+/g, '').toLowerCase();
}

/** 운영자로 보일 수 있는 이름 (관리자만 쓴다) */
const RESERVED = /(운영자|관리자|운영진|공식|kok)/i;

/** 갤러리 이름 검사: 문제가 있으면 한국어 이유, 없으면 null */
export function galleryNameProblem(name: string, isAdmin: boolean): string | null {
  const n = name.replace(/\s+/g, ' ').trim();
  if (n.length < SHARE_TEXT.galleryName.min) return `갤러리 이름은 ${SHARE_TEXT.galleryName.min}자 이상 적어 주세요.`;
  if (n.length > SHARE_TEXT.galleryName.max) return `갤러리 이름은 ${SHARE_TEXT.galleryName.max}자까지예요.`;
  if (!isAdmin && RESERVED.test(galleryKey(n))) return "'운영자'·'공식'·'KOK' 같은 말은 갤러리 이름에 쓸 수 없어요.";
  return null;
}

// ------------------------------------------------------------- 파일
export const SHARE_KINDS = ['pdf', 'image', 'hwp', 'hwpx', 'docx', 'pptx', 'xlsx', 'txt'] as const;
export type ShareKind = (typeof SHARE_KINDS)[number];

/** 파일 이름의 확장자 → 종류 (못 올리는 파일이면 null) */
export function shareKindOf(name: string): ShareKind | null {
  const ext = /\.([a-z0-9]{2,5})$/i.exec(name.trim())?.[1]?.toLowerCase() ?? '';
  if (ext === 'pdf') return 'pdf';
  if (['jpg', 'jpeg', 'png', 'webp'].includes(ext)) return 'image';
  if (ext === 'hwp' || ext === 'hwpx' || ext === 'docx' || ext === 'pptx' || ext === 'xlsx' || ext === 'txt') return ext;
  return null;
}

/** 저장소에 올릴 때의 Content-Type ('community' 버킷의 allowed_mime_types 와 같게). 사진은 확장자로 */
export function shareContentType(kind: ShareKind, name = ''): string {
  switch (kind) {
    case 'pdf':
      return 'application/pdf';
    case 'image':
      return /\.png$/i.test(name) ? 'image/png' : /\.webp$/i.test(name) ? 'image/webp' : 'image/jpeg';
    case 'hwp':
      return 'application/x-hwp';
    case 'hwpx':
      return 'application/hwp+zip';
    case 'docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    case 'pptx':
      return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
    case 'xlsx':
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    case 'txt':
      return 'text/plain';
  }
}

/** 저장소 경로의 확장자 */
export function shareExt(kind: ShareKind, name = ''): string {
  if (kind === 'image') return /\.png$/i.test(name) ? 'png' : /\.webp$/i.test(name) ? 'webp' : 'jpg';
  return kind;
}

export const SHARE_KIND_LABEL: Record<ShareKind, string> = {
  pdf: 'PDF',
  image: '사진',
  hwp: '한글',
  hwpx: '한글',
  docx: '워드',
  pptx: 'PPT',
  xlsx: '엑셀',
  txt: '글',
};

/** 파일 고르기 칸의 accept */
export const SHARE_ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp,.hwp,.hwpx,.docx,.pptx,.xlsx,.txt';
export const SHARE_KINDS_TEXT = 'PDF·사진·한글·워드·PPT·엑셀·글 파일';

/** KOK 으로 바로 정리할 수 있는 종류 (자료 넣기와 같게: 엑셀은 PDF 로 저장해서) */
export function organizable(kind: ShareKind): boolean {
  return kind !== 'xlsx';
}

const startsWith = (b: Uint8Array, sig: number[], at = 0) => sig.every((v, i) => b[at + i] === v);
const ascii = (b: Uint8Array, from: number, to: number) => String.fromCharCode(...b.subarray(from, Math.min(to, b.length)));

/** zip(워드·PPT·엑셀·HWPX)의 첫 파일 이름: 문서가 아닌 압축 파일(실행 파일 등)을 막는다 */
function firstZipEntry(b: Uint8Array): string | null {
  if (!startsWith(b, [0x50, 0x4b, 0x03, 0x04]) || b.length < 30) return null;
  const nameLen = b[26] | (b[27] << 8);
  if (!nameLen || 30 + nameLen > b.length) return null;
  return ascii(b, 30, 30 + nameLen);
}
const OFFICE_ENTRY =
  /^(\[Content_Types\]\.xml|mimetype|_rels\/|docProps\/|word\/|ppt\/|xl\/|customXml\/|Contents\/|META-INF\/|BinData\/|Preview\/|settings\.xml|version\.xml)/;

/**
 * 파일의 앞부분(4KB)이 그 종류의 파일인지: PDF·JPEG·PNG·WEBP 표시, 한글(복합 문서·예전 한글), 문서 zip 의 첫 파일, 글 파일은 0 바이트가 없는지.
 * 이름만 바꾼 다른 파일(실행 파일 등)을 막는다
 */
export function sniffShareFile(kind: ShareKind, head: Uint8Array): boolean {
  if (!head.length) return false;
  switch (kind) {
    case 'pdf':
      // 앞에 다른 글자가 조금 붙은 PDF 도 있다 (1KB 안에 %PDF-)
      return ascii(head, 0, 1024).includes('%PDF-');
    case 'image':
      return (
        startsWith(head, [0xff, 0xd8, 0xff]) ||
        startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) ||
        (ascii(head, 0, 4) === 'RIFF' && ascii(head, 8, 12) === 'WEBP')
      );
    case 'hwp':
      return startsWith(head, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]) || ascii(head, 0, 20).startsWith('HWP Document File');
    case 'hwpx':
    case 'docx':
    case 'pptx':
    case 'xlsx': {
      const first = firstZipEntry(head);
      return !!first && OFFICE_ENTRY.test(first);
    }
    case 'txt':
      return !head.includes(0);
  }
}

/** 미리보기 JPEG 인지 */
export function sniffJpeg(head: Uint8Array): boolean {
  return startsWith(head, [0xff, 0xd8, 0xff]);
}

/** 1.2MB · 340KB */
export function fileSizeText(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)}MB`;
  return `${Math.max(1, Math.round(bytes / 1024))}KB`;
}

/** 파일 이름 다듬기 (경로·이상한 글자 빼고 120자까지, 확장자는 남긴다) */
export function cleanFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name;
  // 제어 글자는 빼고(이름에 들어가면 받기 이름이 깨진다) 빈칸은 하나로
  const clean = Array.from(base)
    .filter((ch) => ch.charCodeAt(0) >= 0x20 && ch.charCodeAt(0) !== 0x7f)
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  if (clean.length <= 120) return clean || 'file';
  const ext = /(\.[a-z0-9]{2,5})$/i.exec(clean)?.[1] ?? '';
  return clean.slice(0, 120 - ext.length) + ext;
}

// ------------------------------------------------------------- 찾기
/** 찾는 말 → 낱말들 (모두 들어 있는 글을 찾는다): 다섯 개까지, 낱말마다 30자까지, ILIKE 의 \ % _ 는 막는다 */
export function searchWords(q: string): string[] {
  return q
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .slice(0, 5)
    .map((w) => w.slice(0, 30).replace(/[\\%_]/g, (c) => `\\${c}`));
}

/** PostgREST or= 안에 넣을 갤러리 이름 찾기 글 (쉼표·괄호·따옴표·별표는 빈칸으로, ILIKE 표시는 막는다) */
export function galleryQuery(q: string): string {
  return q
    .replace(/[,()"'*\\%_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 30);
}

// ------------------------------------------------------------- 이름·시간
/**
 * 익명 댓글의 이름 (서버가 쓴 사람 번호로 셈: 화면에는 번호를 보내지 않는다). 글쓴이면 '익명(글쓴이)',
 * 아니면 그 글에서 처음 나온 차례로 '익명1'·'익명2' (같은 사람은 같은 이름). 익명이 아니면 ''
 */
export function anonymousNames(comments: Array<{ author: string; anonymous: boolean }>, postAuthor: string): string[] {
  const seen = new Map<string, number>();
  return comments.map((c) => {
    if (!c.anonymous) return '';
    if (c.author === postAuthor) return '익명(글쓴이)';
    if (!seen.has(c.author)) seen.set(c.author, seen.size + 1);
    return `익명${seen.get(c.author)}`;
  });
}

/** '방금' · '3분 전' · '2시간 전' · '어제' · '10월 3일' · '2025년 1월 5일' (한국 시간) */
export function timeAgo(iso: string, now = Date.now()): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return '방금';
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
  const kst = (ms: number) => new Date(ms + 9 * 3600_000);
  const d = kst(t);
  const n = kst(now);
  const days = Math.round(
    (Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()) - Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())) / 86400_000,
  );
  if (days === 1) return '어제';
  if (d.getUTCFullYear() !== n.getUTCFullYear()) return `${d.getUTCFullYear()}년 ${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일`;
  return `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일`;
}

/** 1.2천 · 3.4만 (목록의 수) */
export function countText(n: number): string {
  if (n >= 10_000) return `${(n / 10_000).toFixed(n >= 100_000 ? 0 : 1).replace(/\.0$/, '')}만`;
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}천`;
  return String(n);
}

// ------------------------------------------------------------- 공유받은 노트 표시
/** 공유받아 넣은 노트의 표시 (body.shared: 어느 글에서 누가 공유했는지) */
export type SharedMark = { post: string; title: string; by: string; at: string };

export function readSharedMark(raw: unknown): SharedMark | null {
  const m = (raw as { shared?: unknown } | null)?.shared as Partial<SharedMark> | undefined;
  if (!m || typeof m !== 'object' || typeof m.post !== 'string' || !/^[0-9a-f-]{36}$/i.test(m.post)) return null;
  return {
    post: m.post,
    title: typeof m.title === 'string' ? m.title : '',
    by: typeof m.by === 'string' ? m.by : '',
    at: typeof m.at === 'string' ? m.at : '',
  };
}

// ------------------------------------------------------------- 신고
/** 신고할 수 있는 것 (DB 의 reports.target_type 은 share_ 를 붙인다) */
export const SHARE_REPORT_KINDS = ['post', 'comment', 'gallery'] as const;
export type ShareReportKind = (typeof SHARE_REPORT_KINDS)[number];
/** 고르는 이유 (하나만 고르고 더 적을 말은 글로) */
export const SHARE_REPORT_REASONS = [
  '남의 저작물을 허락 없이 올렸어요',
  '욕설·비하·괴롭힘이에요',
  '음란하거나 폭력적인 내용이에요',
  '광고·도배예요',
  '개인정보가 들어 있어요',
  '그 밖의 문제가 있어요',
] as const;
/** 서로 다른 사람의 신고가 이만큼 쌓이면 운영자가 볼 때까지 글·댓글을 가린다 */
export const SHARE_HIDE_AT = 5;

// ------------------------------------------------------------- 화면과 서버가 주고받는 모양
export type GalleryView = {
  id: string;
  name: string;
  description: string;
  category: GalleryCategory;
  posts: number;
  lastPostAt: string | null;
  /** 운영자가 처음에 만든 갤러리 (isOfficialGallery) */
  official: boolean;
  /** 내가 만든 갤러리 (글·댓글을 지울 수 있다) */
  mine: boolean;
  /** 즐겨찾기 */
  fav: boolean;
};

export type PostSummary = {
  id: string;
  galleryId: string;
  galleryName: string;
  title: string;
  /** 내용 앞부분 (목록 한 줄) */
  excerpt: string;
  authorName: string;
  anonymous: boolean;
  mine: boolean;
  hasFiles: boolean;
  hasNote: boolean;
  likes: number;
  comments: number;
  downloads: number;
  views: number;
  /** 첫 파일의 종류와 수 (목록 아이콘) */
  fileKinds: ShareKind[];
  createdAt: string;
  hidden: boolean;
};

export type FileView = {
  id: string;
  kind: ShareKind;
  name: string;
  size: number;
  pages: number | null;
  /** 미리보기 그림 (누구나 볼 수 있는 작은 그림, 50분 주소) */
  previewUrl: string | null;
};

export type NotePreview = {
  title: string;
  subject: string;
  summary: string;
  keyPoints: string[];
  keyPointCount: number;
  questions: number;
  terms: number;
  formulas: number;
  figures: number;
  hasMindmap: boolean;
};

export type CommentView = {
  id: string;
  parentId: string | null;
  authorName: string;
  /** 글쓴이가 쓴 댓글 */
  byPostAuthor: boolean;
  mine: boolean;
  body: string;
  likes: number;
  liked: boolean;
  deleted: boolean;
  /** 내가 차단한 사람의 댓글 (답글이 달려 자리만 남긴 것) */
  blocked: boolean;
  hidden: boolean;
  edited: boolean;
  createdAt: string;
  canDelete: boolean;
};

export type PostDetail = PostSummary & {
  body: string;
  edited: boolean;
  liked: boolean;
  /** 받았거나 내 글이라 파일·노트를 쓸 수 있는지 */
  unlocked: boolean;
  files: FileView[];
  note: NotePreview | null;
  /** 댓글과 답글 (만든 차례) */
  thread: CommentView[];
  gallery: GalleryView;
  canEdit: boolean;
  canDelete: boolean;
  /** 관리자에게만: 익명 글의 실제 글쓴이 */
  realAuthor?: { nickname: string | null; email: string | null } | null;
  /** 오늘 받기 (null = 제한 없음) */
  downloadsLeft: number | null;
  downloadsDaily: number | null;
};
