// 채팅에 붙일 파일 준비 (화면): 사진은 긴 변 1568px JPEG 로 줄이고(AI 도 그 크기로 본다), PDF·글 파일은 그대로.
// 한 번에 보내는 양은 Vercel 요청 한도 안이어야 해서 한도를 넘으면 한국어로 알려 준다
import { CHAT_FILE_LIMITS, type ChatFileInput } from './chat';
import { shrinkImage } from './image';

export type ChatFileKind = 'image' | 'pdf' | 'text';

/** 붙인 파일 하나 (preview: 사진의 미리보기 주소, 창을 닫거나 대화를 지우면 돌려준다) */
export type ChatPick = { id: string; file: File; kind: ChatFileKind; preview: string | null };

export function chatKindOf(file: File): ChatFileKind | null {
  const n = file.name.toLowerCase();
  if (file.type.startsWith('image/') || /\.(jpe?g|png|webp|heic|heif|gif|bmp)$/.test(n)) return 'image';
  if (file.type === 'application/pdf' || n.endsWith('.pdf')) return 'pdf';
  if (file.type.startsWith('text/') || /\.(txt|md|markdown)$/.test(n)) return 'text';
  return null;
}

let seq = 0;

/** 고른 파일 → 붙일 것 (모르는 파일은 빼고 그 이름을 돌려준다) */
export function pickChatFiles(files: File[]): { picks: ChatPick[]; skipped: string[] } {
  const picks: ChatPick[] = [];
  const skipped: string[] = [];
  for (const file of files) {
    const kind = chatKindOf(file);
    if (!kind) {
      skipped.push(file.name);
      continue;
    }
    picks.push({ id: `f${++seq}`, file, kind, preview: kind === 'image' ? URL.createObjectURL(file) : null });
  }
  return { picks, skipped };
}

export function releasePicks(picks: Array<{ preview: string | null }>) {
  for (const p of picks) if (p.preview) URL.revokeObjectURL(p.preview);
}

async function toBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
}

const mb = (n: number) => `${Math.round((n / 1_000_000) * 10) / 10}MB`;

/** 보낼 모양으로 (사진 줄이기·base64). 한도를 넘으면 Error (한국어) */
export async function prepareChatFiles(picks: ChatPick[]): Promise<ChatFileInput[]> {
  const L = CHAT_FILE_LIMITS;
  if (picks.length > L.files) throw new Error(`한 번에 ${L.files}개까지 붙일 수 있어요.`);
  const out: ChatFileInput[] = [];
  let total = 0;
  for (const p of picks) {
    const name = p.file.name || (p.kind === 'image' ? '사진' : '파일');
    if (p.kind === 'image') {
      let blob = await shrinkImage(p.file, L.imageSide, 0.85);
      if (blob.size > L.imageBytes) blob = await shrinkImage(p.file, 1200, 0.72);
      if (blob.size > L.imageBytes) throw new Error(`'${name}' 사진이 너무 커요.`);
      total += blob.size;
      out.push({ kind: 'image', name, data: await toBase64(blob) });
    } else if (p.kind === 'pdf') {
      if (p.file.size > L.pdfBytes) throw new Error(`PDF는 채팅에 ${mb(L.pdfBytes)}까지 붙일 수 있어요. 큰 PDF는 자료로 넣어 주세요.`);
      total += p.file.size;
      out.push({ kind: 'pdf', name, data: await toBase64(p.file) });
    } else {
      const text = (await p.file.text()).slice(0, L.textChars);
      if (!text.trim()) continue;
      total += new TextEncoder().encode(text).length;
      out.push({ kind: 'text', name, data: text });
    }
  }
  if (total > L.totalBytes) throw new Error(`붙인 파일이 모두 합쳐 ${mb(L.totalBytes)}를 넘어요. 몇 개만 붙여 주세요.`);
  return out;
}

/** 예상 에너지에 더할 입력 토큰 (사진 장당 약 1,600, PDF 는 크기로 쪽수를 어림한다, 글은 글자 수로) */
export function picksTokens(picks: ChatPick[]): number {
  let t = 0;
  for (const p of picks) {
    if (p.kind === 'image') t += 1600;
    else if (p.kind === 'pdf') t += Math.max(1, Math.round(p.file.size / 80_000)) * 2000;
    else t += Math.min(CHAT_FILE_LIMITS.textChars, p.file.size) * 0.9;
  }
  return Math.ceil(t);
}
