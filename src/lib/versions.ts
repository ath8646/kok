// 노트 버전 (화면): 버전 기록 목록, 지난 버전 보기·고치기에 쓰는 모양과 계산
import type { SourceListRow } from './types';

/** 버전에 들어간 자료 (note_versions.materials 의 한 칸) */
export type Material = { source_id: string; kind: 'text' | 'pdf' | 'image'; title: string; page_count: number | null };

/** note_versions 행 (목록용: 정리·그림 본문은 빼고) */
export type VersionRow = {
  id: string;
  number: number;
  title: string;
  materials: Material[];
  question_ids: string[];
  created_at: string;
  updated_at: string;
};

export const VERSION_LIST_COLS = 'id, number, title, materials, question_ids, created_at, updated_at';

/** 노트에 더한 자료 (부모를 가리키는 자료 행) */
export type ChildSource = SourceListRow & { text_content: string | null; unit: string };

export type VersionItem = {
  number: number;
  current: boolean;
  /** 이 버전을 만든 자료 (버전 1은 처음 자료, 그 뒤는 그때 더한 자료) */
  added: Material | null;
  /** 이 버전에 들어 있는 자료 수 */
  materialCount: number;
  questionCount: number;
  createdAt: string | null;
};

function asMaterials(v: unknown): Material[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((m): m is Record<string, unknown> => !!m && typeof m === 'object' && typeof (m as Record<string, unknown>).source_id === 'string')
    .map((m) => ({
      source_id: String(m.source_id),
      kind: m.kind === 'pdf' || m.kind === 'image' ? m.kind : 'text',
      title: typeof m.title === 'string' ? m.title : '',
      page_count: typeof m.page_count === 'number' ? m.page_count : null,
    }));
}

/** DB 에서 읽은 행을 화면 모양으로 (모르는 값은 버린다) */
export function toVersionRow(r: Record<string, unknown>): VersionRow {
  return {
    id: String(r.id),
    number: Number(r.number),
    title: typeof r.title === 'string' ? r.title : '',
    materials: asMaterials(r.materials),
    question_ids: Array.isArray(r.question_ids) ? r.question_ids.map(String) : [],
    created_at: String(r.created_at ?? ''),
    updated_at: String(r.updated_at ?? ''),
  };
}

/**
 * 버전 기록 목록 (번호 순). 버전 행이 없으면 지금 노트를 '버전 1'로 본다.
 * 지금 버전의 문제 수는 노트에 지금 있는 문제로 센다 (버전 행은 버전을 바꿀 때만 저장되므로).
 * 지난 버전의 문제 수는 그 버전 목록 중 아직 있는 문제만 센다.
 */
export function versionItems(
  rows: VersionRow[],
  current: number,
  live: { first: Material; questionCount: number; createdAt: string | null; existing: Set<string> },
): VersionItem[] {
  if (!rows.length) {
    return [{ number: 1, current: true, added: live.first, materialCount: 1, questionCount: live.questionCount, createdAt: live.createdAt }];
  }
  return [...rows]
    .sort((a, b) => a.number - b.number)
    .map((r) => ({
      number: r.number,
      current: r.number === current,
      added: r.materials[r.materials.length - 1] ?? (r.number === 1 ? live.first : null),
      materialCount: Math.max(1, r.materials.length),
      questionCount: r.number === current ? live.questionCount : r.question_ids.filter((id) => live.existing.has(id)).length,
      createdAt: r.created_at || null,
    }));
}

/**
 * 문제를 지금 보는 버전에서 뺄 때: 다른 버전에도 있으면 그 버전에 남기고, 아무 데도 없으면 지운다.
 * - hide: 지금 버전에서 숨긴다 (status = hidden)
 * - unlist: 지난 버전의 문제 목록에서만 뺀다
 * - delete: 문제를 지운다 (푼 기록도)
 * current: 지금 쓰는 버전 번호, viewing: 지금 보는 버전 번호, inCurrent: 지금 버전에 있는 문제인지 (status 가 hidden 이 아님).
 * 지금 버전의 행은 오래됐을 수 있어서 보지 않고 inCurrent 로 판단한다.
 */
export function removalPlan(questionId: string, rows: VersionRow[], current: number, viewing: number, inCurrent: boolean): 'hide' | 'delete' | 'unlist' {
  const elsewhere = rows.some((r) => r.number !== viewing && r.number !== current && r.question_ids.includes(questionId));
  if (viewing === current) return elsewhere ? 'hide' : 'delete';
  return elsewhere || inCurrent ? 'unlist' : 'delete';
}

/** 자료 이름 (없으면 종류로) */
export function materialLabel(m: Pick<Material, 'kind' | 'title' | 'page_count'>): string {
  if (m.title) return m.title;
  if (m.kind === 'pdf') return `PDF${m.page_count ? ` ${m.page_count}쪽` : ''}`;
  if (m.kind === 'image') return `사진${m.page_count ? ` ${m.page_count}장` : ''}`;
  return '직접 쓴 글';
}
