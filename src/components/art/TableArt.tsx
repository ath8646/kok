'use client';
// 표 다시 그리기: 진짜 표(<table>)로. 폰에서 칸이 많으면 옆으로 밀어 본다
import { memo } from 'react';
import type { TableArt } from '@/lib/art/spec';
import { FONT } from './shared';

const cell = {
  padding: '8px 10px',
  minWidth: 64,
  borderBottom: '1px solid var(--line)',
  textAlign: 'left',
  verticalAlign: 'top',
  wordBreak: 'keep-all',
  overflowWrap: 'anywhere',
  lineHeight: 1.45,
} as const;

export const TableArtView = memo(function TableArtView({ art, label }: { art: TableArt; label: string }) {
  const head = art.columns.some(Boolean);
  const minW = Math.max(art.columns.length * 72, 260);
  return (
    <div style={{ overflowX: 'auto', borderRadius: 14, border: '1px solid var(--line)', background: 'var(--surface)' }}>
      <table aria-label={label} style={{ width: '100%', minWidth: minW, borderCollapse: 'collapse', fontFamily: FONT, fontSize: 13, color: 'var(--ink)' }}>
        {head ? (
          <thead>
            <tr>
              {art.columns.map((c, k) => (
                <th
                  key={k}
                  scope="col"
                  style={{
                    ...cell,
                    background: 'var(--surface-2)',
                    fontWeight: 700,
                    fontSize: 12.5,
                    ...(k === 0 && art.row_header ? { whiteSpace: 'nowrap' } : null),
                  }}
                >
                  {c}
                </th>
              ))}
            </tr>
          </thead>
        ) : null}
        <tbody>
          {art.rows.map((row, i) => (
            <tr key={i}>
              {row.map((v, k) =>
                k === 0 && art.row_header ? (
                  <th
                    key={k}
                    scope="row"
                    style={{
                      ...cell,
                      background: 'var(--surface-2)',
                      fontWeight: 700,
                      whiteSpace: 'nowrap',
                      ...(i === art.rows.length - 1 ? { borderBottom: 'none' } : null),
                    }}
                  >
                    {v}
                  </th>
                ) : (
                  <td key={k} style={{ ...cell, ...(i === art.rows.length - 1 ? { borderBottom: 'none' } : null) }}>
                    {v}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
});
