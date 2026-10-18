// 빠른 추가: 끌어 놓거나 고른 파일, 입력한 글을 "자료" 단위로 나누는 규칙 (화면 없이 계산만)
import type { MeResponse } from './types';

export type PlanLimits = MeResponse['plan'];

export type FileLike = { name: string; type: string; size: number };

export type FileKind = 'pdf' | 'image' | 'text' | 'office' | 'other';

/** 글을 자료로 넣을 때 가장 짧은 길이 (서버와 같다) */
export const MIN_TEXT_CHARS = 20;

const IMAGE_EXT = /\.(jpe?g|png|webp|heic|heif|gif|bmp)$/i;
const TEXT_EXT = /\.(txt|md|markdown)$/i;
const OFFICE_EXT = /\.(hwp|hwpx|docx?|pptx?|xlsx?|key|pages|numbers)$/i;

export function fileKind(f: Pick<FileLike, 'name' | 'type'>): FileKind {
  const name = f.name || '';
  const type = (f.type || '').toLowerCase();
  if (type === 'application/pdf' || /\.pdf$/i.test(name)) return 'pdf';
  if (type.startsWith('image/') || IMAGE_EXT.test(name)) return 'image';
  if (type === 'text/plain' || type === 'text/markdown' || TEXT_EXT.test(name)) return 'text';
  if (OFFICE_EXT.test(name)) return 'office';
  return 'other';
}

/** 카메라·캡처가 붙이는 뜻 없는 이름 (IMG_1234, 20261018_101010, KakaoTalk_…, Screenshot 2026-10-18 …) */
const MEANINGLESS_NAME =
  /^(?:(?:img|image|photo|pxl|dsc|dcim|mvimg|scan|scanned|screenshot|screen shot|스크린샷|화면 캡처|캡처|사진|kakaotalk|카카오톡)[\s_-]*)?[\s\d_.()-]*$/i;

/** 파일 이름에서 확장자를 떼고 제목으로 (60자까지). 뜻 없는 사진 이름은 쓰지 않는다 (AI가 제목을 붙인다) */
export function titleFromName(name: string): string {
  const base = name
    .replace(/\.[^./\\]+$/, '')
    .replace(/[_]+/g, ' ')
    .trim();
  if (!base || MEANINGLESS_NAME.test(base)) return '';
  return base.slice(0, 60);
}

export type Rejected = { name: string; reason: string };

export type FileGroups<F extends FileLike = FileLike> = {
  pdfs: F[];
  imageGroups: F[][];
  textFiles: F[];
  rejected: Rejected[];
};

/**
 * 파일을 자료 단위로 나눈다.
 * - PDF 는 하나씩 자료가 된다
 * - 사진은 한 번에 넣은 것끼리 한 자료(학습지 여러 장)로 묶는다. 요금제 한도를 넘으면 나눠 묶는다
 * - 글 파일(.txt, .md)은 글 자료가 된다
 * - 한글·워드·PPT 는 아직 못 읽는다 (PDF로 저장해 넣도록 안내)
 */
export function groupFiles<F extends FileLike>(files: F[], plan: PlanLimits): FileGroups<F> {
  const out: FileGroups<F> = { pdfs: [], imageGroups: [], textFiles: [], rejected: [] };
  const maxBytes = plan.fileMb * 1024 * 1024;
  const images: F[] = [];
  for (const f of files) {
    const kind = fileKind(f);
    if (kind === 'pdf') {
      if (f.size > maxBytes) out.rejected.push({ name: f.name, reason: `${plan.fileMb}MB보다 커요` });
      else if (f.size === 0) out.rejected.push({ name: f.name, reason: '빈 파일이에요' });
      else out.pdfs.push(f);
    } else if (kind === 'image') {
      // 사진은 올리기 전에 작게 줄이므로 원본은 넉넉히 받는다 (줄인 뒤 서버가 다시 검사)
      if (f.size > Math.max(maxBytes, 40 * 1024 * 1024)) out.rejected.push({ name: f.name, reason: '사진이 너무 커요' });
      else images.push(f);
    } else if (kind === 'text') {
      if (f.size > 2 * 1024 * 1024) out.rejected.push({ name: f.name, reason: '글 파일이 너무 커요' });
      else out.textFiles.push(f);
    } else if (kind === 'office') {
      out.rejected.push({ name: f.name, reason: '한글·워드·PPT는 아직 못 읽어요. PDF로 저장해서 넣어 주세요' });
    } else {
      out.rejected.push({ name: f.name, reason: 'PDF, 사진, 글 파일만 넣을 수 있어요' });
    }
  }
  const per = Math.max(1, plan.images);
  for (let i = 0; i < images.length; i += per) out.imageGroups.push(images.slice(i, i + per));
  return out;
}

export type TextCheck = { ok: true; text: string } | { ok: false; reason: string };

/** 입력한 글을 자료로 넣을 수 있는지 */
export function checkText(raw: string, plan: PlanLimits): TextCheck {
  const text = raw.replace(/\r\n/g, '\n').trim();
  if (text.length < MIN_TEXT_CHARS) return { ok: false, reason: `${MIN_TEXT_CHARS}자 이상 적어 주세요. (지금 ${text.length}자)` };
  if (text.length > plan.textChars) return { ok: false, reason: `한 번에 ${plan.textChars.toLocaleString()}자까지 넣을 수 있어요.` };
  return { ok: true, text };
}

/**
 * 입력창에서 보낼 때: 붙인 파일이 있으면 짧은 글은 그 자료의 제목으로 쓰고,
 * 20자 이상이면 글도 따로 한 자료가 된다.
 */
export function splitComposer(raw: string, attachmentCount: number): { textAsSource: string | null; titleForFiles: string } {
  const text = raw.replace(/\r\n/g, '\n').trim();
  if (!attachmentCount) return { textAsSource: text, titleForFiles: '' };
  if (text.length >= MIN_TEXT_CHARS) return { textAsSource: text, titleForFiles: '' };
  return { textAsSource: null, titleForFiles: text.replace(/\s+/g, ' ').slice(0, 120) };
}

/** Enter 를 누르면 보낼지 (Shift+Enter 는 줄바꿈, 한글 조합 중에는 보내지 않는다) */
export function isSubmitKey(e: { key: string; shiftKey: boolean; isComposing?: boolean; keyCode?: number }): boolean {
  if (e.key !== 'Enter' || e.shiftKey) return false;
  if (e.isComposing || e.keyCode === 229) return false;
  return true;
}
