// 노트 버전 (화면): 버전 기록 목록, 지난 버전 보기·고치기에 쓰는 모양과 계산
import type { SourceListRow } from './types';

/** 버전에 들어간 자료 (note_versions.materials 의 한 칸). added: 이 버전에 새로 들어온 자료 (더한 자료·합쳐 들어온 노트의 자료) */
export type Material = { source_id: string; kind: 'text' | 'pdf' | 'image'; title: string; page_count: number | null; added?: boolean };

/** 버전이 생긴 까닭 (note_versions.kind): 처음 자료, 자료를 더함, 합친 노트를 AI 로 다시 정리, 다른 노트를 합침. 예전 행은 null */
export type VersionKind = 'first' | 'append' | 'reorganize' | 'merge';

/** note_versions 행 (목록용: 정리·그림 본문은 빼고) */
export type VersionRow = {
  id: string;
  number: number;
  title: string;
  materials: Material[];
  question_ids: string[];
  created_at: string;
  updated_at: string;
  kind?: VersionKind | null;
};

export const VERSION_LIST_COLS = 'id, number, title, materials, question_ids, created_at, updated_at';
/** 버전이 생긴 까닭 칸까지 (features.merge: schema.sql 을 다시 실행한 뒤) */
export const VERSION_LIST_COLS_KIND = `${VERSION_LIST_COLS}, kind`;

/** 노트에 더한 자료 (부모를 가리키는 자료 행) */
export type ChildSource = SourceListRow & { text_content: string | null; unit: string };

export type VersionItem = {
  number: number;
  current: boolean;
  /** 버전이 생긴 까닭: 처음 자료 · 자료를 더함 · AI 로 다시 정리 · 노트를 합침 */
  kind: 'first' | 'added' | 'reorganized' | 'merged';
  /** 이 버전을 만든 자료 (버전 1은 처음 자료, 더한 버전은 그때 더한 자료, 합친 버전은 합쳐 들어온 자료들, 다시 정리한 버전은 없음) */
  added: Material[];
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
      ...(m.added === true ? { added: true } : {}),
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
    kind: r.kind === 'first' || r.kind === 'append' || r.kind === 'reorganize' || r.kind === 'merge' ? r.kind : null,
  };
}

/** 버전이 생긴 까닭 (예전 행은 번호로: 1이면 처음 자료, 아니면 더한 자료) */
function kindOf(r: VersionRow): VersionItem['kind'] {
  if (r.kind === 'reorganize') return 'reorganized';
  if (r.kind === 'merge') return 'merged';
  if (r.kind === 'first' || (!r.kind && r.number === 1)) return 'first';
  return 'added';
}

/** 이 버전을 만든 자료: added 표시가 있으면 그것 (예전 행에는 없어서, 더한 버전은 마지막 자료) */
function addedOf(r: VersionRow, kind: VersionItem['kind'], first: Material): Material[] {
  if (kind === 'reorganized') return [];
  if (kind === 'first') return [r.materials[0] ?? first];
  const marked = r.materials.filter((m) => m.added);
  if (marked.length) return marked;
  const last = r.materials[r.materials.length - 1];
  return kind === 'added' && last ? [last] : [];
}

/**
 * 버전 기록 목록 (번호 순). 버전 행이 없으면 지금 노트를 '버전 1'로 본다 (합친 노트면 합쳐 들어온 자료까지 센다: kids).
 * 지금 버전의 문제 수는 노트에 지금 있는 문제로 센다 (버전 행은 버전을 바꿀 때만 저장되므로).
 * 지난 버전의 문제 수는 그 버전 목록 중 아직 있는 문제만 센다.
 */
export function versionItems(
  rows: VersionRow[],
  current: number,
  live: { first: Material; questionCount: number; createdAt: string | null; existing: Set<string>; kids?: number },
): VersionItem[] {
  if (!rows.length) {
    return [
      {
        number: 1,
        current: true,
        kind: 'first',
        added: [live.first],
        materialCount: 1 + (live.kids ?? 0),
        questionCount: live.questionCount,
        createdAt: live.createdAt,
      },
    ];
  }
  return [...rows]
    .sort((a, b) => a.number - b.number)
    .map((r) => {
      const kind = kindOf(r);
      return {
        number: r.number,
        current: r.number === current,
        kind,
        added: addedOf(r, kind, live.first),
        materialCount: Math.max(1, r.materials.length),
        questionCount: r.number === current ? live.questionCount : r.question_ids.filter((id) => live.existing.has(id)).length,
        createdAt: r.created_at || null,
      };
    });
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

/**
 * 버전을 지우면 같이 지워지는 자료: 그 버전에만 있는 자료 (처음 넣은 자료는 노트와 함께 남는다).
 * kok_delete_version 과 같은 규칙 (다른 버전의 자료 목록에 없는 더한 자료)
 */
export function onlyInVersion(rows: VersionRow[], number: number, parentId: string): Material[] {
  const row = rows.find((r) => r.number === number);
  if (!row) return [];
  const elsewhere = new Set(rows.filter((r) => r.number !== number).flatMap((r) => r.materials.map((m) => m.source_id)));
  return row.materials.filter((m) => m.source_id !== parentId && !elsewhere.has(m.source_id));
}

/** 자료 이름 (없으면 종류로) */
export function materialLabel(m: Pick<Material, 'kind' | 'title' | 'page_count'>): string {
  if (m.title) return m.title;
  if (m.kind === 'pdf') return `PDF${m.page_count ? ` ${m.page_count}쪽` : ''}`;
  if (m.kind === 'image') return `사진${m.page_count ? ` ${m.page_count}장` : ''}`;
  return '직접 쓴 글';
}
