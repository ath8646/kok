// 채팅(노트 채팅·홈 AI 채팅)에 붙인 사진·파일과 AI 풀이 (서버 전용)
// 받은 파일 검사 → AI 에 보낼 내용과 예상 토큰, Pro 노트 채팅은 파일 보관, AI 가 준 풀이 검사
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { wrap } from '@/lib/ai/prompts';
import { CHAT_FILE_LIMITS, type ChatAttachmentMeta } from '@/lib/chat';
import { PdfError, pdfPageCount } from '@/lib/pdf';
import { SOURCES_BUCKET } from '@/lib/supabase/admin';
import { imageBlock, pdfBlock, textBlock, type ContentPart } from './claude';
import { UserFacingError } from './errors';
import { removeSourceFolders, sniff } from './files';

const BAD_FILE = '붙인 파일을 읽지 못했어요. 다시 붙여 주세요.';

export const zChatFileInput = z.object(
  {
    kind: z.enum(['image', 'pdf', 'text'], { error: BAD_FILE }),
    name: z
      .string()
      .catch('파일')
      .transform(
        (s) =>
          s
            .replace(/[\u0000-\u001f]/g, ' ')
            .trim()
            .slice(0, 120) || '파일',
      ),
    // 사진·PDF 는 base64, 글 파일은 글 그대로 (크기는 아래에서 다시 센다)
    data: z.string({ error: BAD_FILE }).max(5_000_000, '붙인 파일이 너무 커요.'),
  },
  { error: BAD_FILE },
);

/** 붙인 파일 목록: 하나라도 잘못되면 몰래 빼지 않고(빼고 답하면 에너지만 쓴다) 한국어로 거절한다 */
export const zChatAttachments = z
  .array(zChatFileInput, { error: BAD_FILE })
  .max(CHAT_FILE_LIMITS.files, `한 번에 ${CHAT_FILE_LIMITS.files}개까지 붙일 수 있어요.`)
  .optional()
  .transform((a) => a ?? []);

export type ChatFile = {
  kind: 'image' | 'pdf' | 'text';
  name: string;
  mime: 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf' | 'text/plain';
  bytes: Uint8Array | null;
  text: string | null;
  pages: number;
};

const MIME = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' } as const;

/** 받은 파일을 검사한다 (진짜 사진·PDF 인지, 크기·쪽수). 문제가 있으면 한국어로 알려 준다 */
export async function readChatFiles(raw: Array<z.infer<typeof zChatFileInput>>, maxPdfPages: number): Promise<ChatFile[]> {
  const L = CHAT_FILE_LIMITS;
  if (raw.length > L.files) throw new UserFacingError('too_many_files', `한 번에 ${L.files}개까지 붙일 수 있어요.`, 400);
  const out: ChatFile[] = [];
  let total = 0;
  for (const f of raw) {
    if (f.kind === 'text') {
      const text = f.data.slice(0, L.textChars);
      if (!text.trim()) continue;
      total += text.length;
      out.push({ kind: 'text', name: f.name, mime: 'text/plain', bytes: null, text, pages: 0 });
      continue;
    }
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(Buffer.from(f.data, 'base64'));
    } catch {
      throw new UserFacingError('bad_file', `'${f.name}' 파일을 읽지 못했어요.`, 400);
    }
    total += bytes.byteLength;
    const kind = sniff(bytes);
    if (f.kind === 'image') {
      if (kind !== 'jpeg' && kind !== 'png' && kind !== 'webp')
        throw new UserFacingError('bad_type', `'${f.name}'은 사진 파일이 아니에요 (JPG·PNG·WEBP).`, 400);
      if (bytes.byteLength > L.imageBytes) throw new UserFacingError('too_big', `'${f.name}' 사진이 너무 커요.`, 400);
      out.push({ kind: 'image', name: f.name, mime: MIME[kind], bytes, text: null, pages: 0 });
    } else {
      if (kind !== 'pdf') throw new UserFacingError('bad_type', `'${f.name}'은 PDF 파일이 아니에요.`, 400);
      if (bytes.byteLength > L.pdfBytes) {
        throw new UserFacingError('too_big', `PDF는 채팅에 ${Math.floor(L.pdfBytes / 100_000) / 10}MB까지 붙일 수 있어요. 큰 PDF는 자료로 넣어 주세요.`, 400);
      }
      let pages = 0;
      try {
        pages = await pdfPageCount(bytes);
      } catch (e) {
        if (e instanceof PdfError) throw new UserFacingError('bad_pdf', e.message, 400);
        throw new UserFacingError('bad_pdf', `'${f.name}' PDF를 열지 못했어요.`, 400);
      }
      const max = Math.min(maxPdfPages, L.pdfPages);
      if (pages > max) throw new UserFacingError('too_many_pages', `채팅에 붙이는 PDF는 ${max}쪽까지예요. 긴 PDF는 자료로 넣어 주세요.`, 400);
      out.push({ kind: 'pdf', name: f.name, mime: 'application/pdf', bytes, text: null, pages });
    }
  }
  if (total > L.totalBytes) throw new UserFacingError('too_big', '붙인 파일이 모두 합쳐 너무 커요. 몇 개만 붙여 주세요.', 400);
  return out;
}

/** AI 에 보낼 내용 (파일마다 이름 줄을 먼저) + 글로 세지 못하는 예상 토큰 (사진 장당 약 1,600, PDF 쪽당 약 2,000) */
export function chatFileBlocks(files: ChatFile[]): { blocks: ContentPart[]; tokens: number } {
  const blocks: ContentPart[] = [];
  let tokens = 0;
  files.forEach((f, i) => {
    const label = `Attachment ${i + 1} (${f.kind === 'image' ? 'photo' : f.kind === 'pdf' ? 'PDF' : 'text file'}): ${f.name.replace(/[<>]/g, '')}`;
    if (f.kind === 'text') {
      blocks.push(textBlock(wrap('attachment', `${label}\n${f.text ?? ''}`)));
      return;
    }
    blocks.push(textBlock(label));
    if (f.kind === 'image') {
      blocks.push(imageBlock(f.bytes!, f.mime as 'image/jpeg' | 'image/png' | 'image/webp'));
      tokens += 1600;
    } else {
      blocks.push(pdfBlock(f.bytes!));
      tokens += Math.max(1, f.pages) * 2000;
    }
  });
  return { blocks, tokens };
}

/**
 * 붙인 파일의 기록. keep(Pro 노트 채팅)이면 사진·PDF 를 `내id/chat/자료id/` 에 보관하고 그 경로를 적는다.
 * (원본 파일 청소와 따로 두려고 자료 폴더 밖에 둔다. 노트·과목·계정을 지우면 같이 지운다)
 */
export async function chatAttachmentMetas(
  admin: SupabaseClient,
  files: ChatFile[],
  keep: { userId: string; sourceId: string } | null,
): Promise<ChatAttachmentMeta[]> {
  const metas: ChatAttachmentMeta[] = [];
  for (const f of files) {
    const meta: ChatAttachmentMeta = { kind: f.kind, name: f.name };
    if (keep && f.bytes && f.kind !== 'text') {
      const ext = f.mime === 'application/pdf' ? 'pdf' : f.mime === 'image/png' ? 'png' : f.mime === 'image/webp' ? 'webp' : 'jpg';
      const path = `${chatFolder(keep.userId, keep.sourceId)}/${crypto.randomUUID()}.${ext}`;
      const { error } = await admin.storage.from(SOURCES_BUCKET).upload(path, f.bytes, { contentType: f.mime, upsert: false });
      if (error) console.warn('[kok] chat file upload failed', error.message);
      else meta.path = path;
    }
    metas.push(meta);
  }
  return metas;
}

/** 노트 채팅 파일을 보관하는 폴더 */
export function chatFolder(userId: string, sourceId: string): string {
  return `${userId}/chat/${sourceId}`;
}

/**
 * 노트(자료)를 지울 때 그 노트 채팅에 보관한 파일도 지운다. 몇 개면 그 폴더를 바로 지우고,
 * 많으면(과목 지우기) 보관한 폴더 목록을 끝까지 읽은 뒤 지운다 (읽는 중에 지우면 목록이 밀려 건너뛴다)
 */
export async function removeChatFolders(admin: SupabaseClient, userId: string, sourceIds: string[]): Promise<void> {
  await removeSourceFolders(admin, `${userId}/chat`, [...new Set(sourceIds)]);
}

/**
 * 노트들의 채팅에 보관한 파일이 든 폴더의 자료 번호 (`내id/chat/자료id/…`). 합친 노트의 채팅은 합쳐진 노트의 자료 폴더를 가리킨다
 * (그 자료 행이 버전을 지우며 없어졌어도 폴더는 남아 있다). 칸이 없는 예전 DB 면 빈 목록
 */
export async function chatFolderIdsOfNotes(admin: SupabaseClient, userId: string, noteIds: string[]): Promise<string[]> {
  const ids = new Set<string>();
  const prefix = `${userId}/chat/`;
  for (let i = 0; i < noteIds.length; i += 100) {
    const { data, error } = await admin
      .from('chat_messages')
      .select('attachments')
      .in('note_id', noteIds.slice(i, i + 100))
      .not('attachments', 'is', null);
    if (error) break;
    for (const row of data ?? []) {
      const list = Array.isArray(row.attachments) ? (row.attachments as Array<{ path?: unknown }>) : [];
      for (const a of list) {
        const path = typeof a?.path === 'string' ? a.path : '';
        if (!path.startsWith(prefix)) continue;
        const id = path.slice(prefix.length).split('/')[0];
        if (/^[0-9a-f-]{36}$/.test(id)) ids.add(id);
      }
    }
  }
  return [...ids];
}

export { finishReply, historyLine, readChatSolution } from '@/lib/chat-solution';
