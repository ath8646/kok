'use client';
// 마인드맵: 보기, 편집(글자·가지 추가·삭제·옮기기·끌어서 옮기기), 가리기 모드, 이미지 저장
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { Mindmap } from '@/lib/ai/schemas';
import type { UserSettings } from '@/lib/settings';
import {
  ROOT_ID,
  addChild,
  addSibling,
  buildTree,
  deleteNode,
  descendants,
  edgePath,
  layoutMindmap,
  moveNode,
  renameNode,
  reorderNode,
  type PlacedNode,
} from '@/lib/mindmap-layout';
import { Select } from './Select';
import { Button, cx, inputClass } from './ui';
import { SUBJECT_COLOR_INDEX } from '@/lib/colors';
import { subscribeTheme, themeSnapshot } from '@/lib/theme';

type VisualSettings = UserSettings['visual'];

const FONT = { sm: 13, md: 15, lg: 17 } as const;

type Palette = {
  ink: string;
  muted: string;
  line: string;
  surface: string;
  surface2: string;
  hl: string;
  accent: string;
  branches: string[];
};

function readPalette(): Palette {
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string, fb: string) => cs.getPropertyValue(name).trim() || fb;
  return {
    ink: v('--ink', '#18212e'),
    muted: v('--muted', '#566378'),
    line: v('--line', '#d6deea'),
    surface: v('--surface', '#ffffff'),
    surface2: v('--surface-2', '#f6f8fc'),
    hl: v('--hl', '#ffd93d'),
    accent: v('--accent', '#2456e8'),
    branches: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => v(`--b${i}`, '#2456e8')),
  };
}

/** 화면 색(밝은/어두운, 테마)이 바뀌면 다시 읽는다. 서버에서는 null */
function usePalette(): Palette | null {
  const scheme = useSyncExternalStore(subscribeTheme, themeSnapshot, () => 'server');
  return useMemo(() => (scheme === 'server' ? null : readPalette()), [scheme]);
}

export type RecallResult = { nodeId: string; keyPointId: string; ok: boolean };

export function MindMap({
  spec,
  settings,
  subjectColor = 'blue',
  editable = false,
  onChange,
  highlightKeyPoint,
  hideMode = false,
  onRecallDone,
  compact = false,
  onOpen,
}: {
  spec: Mindmap;
  settings: VisualSettings;
  subjectColor?: string;
  editable?: boolean;
  onChange?: (next: Mindmap) => void;
  highlightKeyPoint?: string | null;
  hideMode?: boolean;
  onRecallDone?: (results: RecallResult[]) => void;
  /** 노트 맨 위 '한눈에 보기': 작게, 도구 없이, 누르면 onOpen */
  compact?: boolean;
  onOpen?: () => void;
}) {
  const palette = usePalette();
  const svgRef = useRef<SVGSVGElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [moveTarget, setMoveTarget] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [scale, setScale] = useState(1);
  const [revealKey, setRevealKey] = useState(0);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [recall, setRecall] = useState<Map<string, boolean>>(new Map());
  const [drag, setDrag] = useState<{ id: string; x: number; y: number; over: string | null } | null>(null);
  const dragStart = useRef<{ id: string; sx: number; sy: number; moved: boolean; pointer: number } | null>(null);

  const fontSize = FONT[settings.fontSize] ?? 15;
  const tree = useMemo(() => buildTree(spec, collapsed), [spec, collapsed]);
  const placed = useMemo(() => layoutMindmap(tree, { layout: settings.layout, fontSize }), [tree, settings.layout, fontSize]);
  const childCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const n of spec.nodes) {
      const p = n.parent_id || ROOT_ID;
      m.set(p, (m.get(p) ?? 0) + 1);
    }
    return m;
  }, [spec.nodes]);

  const pad = 28;
  const vb = {
    x: placed.minX - pad,
    y: placed.minY - pad,
    w: placed.maxX - placed.minX + pad * 2,
    h: placed.maxY - placed.minY + pad * 2,
  };

  // 처음 크기: 한눈에 보기는 폭에 맞추고, 크게 볼 때는 글자가 읽히는 크기(75% 이상)로
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const fit = Math.min(1, (el.clientWidth - 8) / vb.w);
    const safe = Number.isFinite(fit) ? fit : 1;
    setScale(compact ? Math.max(0.3, safe) : Math.max(0.75, safe));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.layout, fontSize, compact]);

  // 가운데 주제가 보이도록 스크롤
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const rootX = (0 - vb.x) * scale;
    const rootY = (0 - vb.y) * scale;
    el.scrollLeft = settings.layout === 'right' ? 0 : Math.max(0, rootX - el.clientWidth / 2);
    el.scrollTop = settings.layout === 'down' ? 0 : Math.max(0, rootY - el.clientHeight / 2);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scale, settings.layout]);

  // 가리기 모드나 그림이 바뀌면 처음부터 (이전 값과 비교해 렌더 중에 고친다)
  const [prev, setPrev] = useState({ hideMode, spec });
  if (prev.hideMode !== hideMode || prev.spec !== spec) {
    setPrev({ hideMode, spec });
    setRevealed(new Set());
    setRecall(new Map());
  }

  const colorOf = useCallback(
    (n: PlacedNode): string => {
      if (!palette) return '#888';
      if (n.depth === 0) return palette.ink;
      if (settings.color === 'mono') return palette.ink;
      if (settings.color === 'subject') return palette.branches[SUBJECT_COLOR_INDEX[subjectColor] ?? 0];
      return palette.branches[((n.branch % 8) + 8) % 8];
    },
    [palette, settings.color, subjectColor],
  );

  const toSvg = (clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const pt = new DOMPoint(clientX, clientY);
    const m = svg.getScreenCTM();
    if (!m) return { x: 0, y: 0 };
    const p = pt.matrixTransform(m.inverse());
    return { x: p.x, y: p.y };
  };

  const hitTest = (x: number, y: number, exclude: Set<string>): string | null => {
    for (const n of placed.nodes) {
      if (exclude.has(n.id)) continue;
      if (Math.abs(x - n.x) <= n.w / 2 && Math.abs(y - n.y) <= n.h / 2) return n.id;
    }
    return null;
  };

  const hideable = (n: PlacedNode) => hideMode && n.depth > 0;

  const onNodeTap = (n: PlacedNode) => {
    if (hideable(n) && !revealed.has(n.id)) {
      setRevealed((s) => new Set(s).add(n.id));
      setSelected(n.id);
      return;
    }
    setSelected((cur) => (cur === n.id ? null : n.id));
    setEditText(n.label);
    setMoveTarget('');
    setConfirmDelete(false);
  };

  const onPointerDown = (e: React.PointerEvent, n: PlacedNode) => {
    if (e.button !== 0) return;
    dragStart.current = { id: n.id, sx: e.clientX, sy: e.clientY, moved: false, pointer: e.pointerId };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const st = dragStart.current;
    if (!st || !editable || hideMode || st.id === ROOT_ID) return;
    const dist = Math.hypot(e.clientX - st.sx, e.clientY - st.sy);
    if (!st.moved && dist < 10) return;
    if (!st.moved) {
      st.moved = true;
      (e.currentTarget as Element).setPointerCapture?.(st.pointer);
    }
    const p = toSvg(e.clientX, e.clientY);
    const exclude = descendants(spec, st.id);
    exclude.add(st.id);
    setDrag({ id: st.id, x: p.x, y: p.y, over: hitTest(p.x, p.y, exclude) });
  };

  const onPointerUp = (n?: PlacedNode) => {
    const st = dragStart.current;
    dragStart.current = null;
    if (drag && st?.moved) {
      if (drag.over && onChange) onChange(moveNode(spec, drag.id, drag.over));
      setDrag(null);
      return;
    }
    setDrag(null);
    if (n && st && !st.moved) onNodeTap(n);
  };

  const sel = selected ? (placed.nodes.find((n) => n.id === selected) ?? null) : null;
  const allHideable = placed.nodes.filter((n) => n.depth > 0);
  const answered = recall.size;

  const finishRecall = () => {
    const results: RecallResult[] = [];
    for (const [nodeId, ok] of recall) {
      // 가장 가까운 핵심 개념 번호를 찾는다
      let cur = spec.nodes.find((x) => x.id === nodeId);
      let kp = cur?.key_point_id ?? '';
      while (!kp && cur && cur.parent_id) {
        cur = spec.nodes.find((x) => x.id === cur!.parent_id);
        kp = cur?.key_point_id ?? '';
      }
      results.push({ nodeId, keyPointId: kp, ok });
    }
    onRecallDone?.(results);
  };

  const exportPng = async () => {
    const svg = svgRef.current;
    if (!svg) return;
    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.setAttribute('width', String(Math.round(vb.w * 2)));
    clone.setAttribute('height', String(Math.round(vb.h * 2)));
    const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    bg.setAttribute('x', String(vb.x));
    bg.setAttribute('y', String(vb.y));
    bg.setAttribute('width', String(vb.w));
    bg.setAttribute('height', String(vb.h));
    bg.setAttribute('fill', palette?.surface ?? '#fff');
    clone.insertBefore(bg, clone.firstChild);
    const data = new XMLSerializer().serializeToString(clone);
    const url = URL.createObjectURL(new Blob([data], { type: 'image/svg+xml;charset=utf-8' }));
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('image'));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(vb.w * 2);
    canvas.height = Math.round(vb.h * 2);
    canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(url);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${spec.root_label || '마인드맵'}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }, 'image/png');
  };

  if (!palette) return <div className="h-64 animate-pulse rounded-2xl bg-surface-2" />;

  const moveOptions = sel
    ? [
        { id: ROOT_ID, label: spec.root_label || '가운데 주제' },
        ...spec.nodes.filter((n) => n.id !== sel.id && !descendants(spec, sel.id).has(n.id)).map((n) => ({ id: n.id, label: n.label })),
      ]
    : [];

  return (
    <div className="grid gap-3">
      {hideMode || settings.reveal === 'step' ? (
        <div className="flex flex-wrap items-center gap-2">
          {settings.reveal === 'step' && !compact ? (
            <Button size="sm" variant="secondary" onClick={() => setRevealKey((k) => k + 1)}>
              다시 펼치기
            </Button>
          ) : null}
          {hideMode ? (
            <span className="text-sm text-muted">
              확인 {answered}/{allHideable.length}
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="relative">
        {!compact ? (
          <div className="absolute right-2 top-2 z-10 inline-flex overflow-hidden rounded-xl border border-line bg-surface/95 shadow-sm backdrop-blur">
            <button
              type="button"
              className="px-2.5 py-1 text-sm font-bold hover:bg-surface-2"
              onClick={() => setScale((x) => Math.max(0.3, Math.round((x - 0.15) * 100) / 100))}
              aria-label="작게"
            >
              −
            </button>
            <button
              type="button"
              className="min-w-12 border-x border-line px-2 py-1 text-xs font-semibold hover:bg-surface-2"
              onClick={() => setScale(1)}
              aria-label="원래 크기"
            >
              {Math.round(scale * 100)}%
            </button>
            <button
              type="button"
              className="px-2.5 py-1 text-sm font-bold hover:bg-surface-2"
              onClick={() => setScale((x) => Math.min(2.5, Math.round((x + 0.15) * 100) / 100))}
              aria-label="크게"
            >
              +
            </button>
            <button
              type="button"
              className="border-l border-line px-2.5 py-1 text-sm hover:bg-surface-2"
              onClick={() => exportPng().catch(() => {})}
              aria-label="이미지로 저장"
              title="이미지로 저장"
            >
              ⤓
            </button>
          </div>
        ) : null}
        <div
          ref={boxRef}
          className={cx('relative overflow-auto kok-card', compact && onOpen ? 'cursor-pointer' : '')}
          style={{ maxHeight: compact ? '240px' : '70dvh', touchAction: drag ? 'none' : 'pan-x pan-y pinch-zoom' }}
          onClick={compact && onOpen ? onOpen : undefined}
        >
          <svg
            ref={svgRef}
            key={revealKey}
            xmlns="http://www.w3.org/2000/svg"
            viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
            width={Math.round(vb.w * scale)}
            height={Math.round(vb.h * scale)}
            role="img"
            aria-label={`마인드맵: ${spec.root_label}`}
            onPointerMove={onPointerMove}
            onPointerUp={() => onPointerUp()}
            onPointerLeave={() => {
              if (!dragStart.current?.moved) dragStart.current = null;
            }}
            style={{ display: 'block', fontFamily: 'Pretendard, "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", sans-serif' }}
          >
            <g>
              {placed.edges.map((e) => (
                <path
                  key={`e-${e.to.id}`}
                  d={edgePath(e, settings.layout)}
                  fill="none"
                  stroke={colorOf(e.to)}
                  strokeOpacity={settings.color === 'mono' ? 0.55 : 0.75}
                  strokeWidth={e.to.depth === 1 ? 3 : 2}
                  strokeLinecap="round"
                  className={settings.reveal === 'step' ? 'mm-step' : undefined}
                  style={settings.reveal === 'step' ? { animationDelay: `${e.to.order * 90}ms` } : undefined}
                />
              ))}
            </g>
            {placed.nodes.map((n) => {
              const color = colorOf(n);
              const hidden = hideable(n) && !revealed.has(n.id);
              const isSel = n.id === selected;
              const isHl = !!highlightKeyPoint && n.keyPointId === highlightKeyPoint;
              const isOver = drag?.over === n.id;
              const fill = n.depth === 0 ? palette.surface2 : n.depth === 1 && settings.color !== 'mono' ? `${color}24` : palette.surface;
              const label = (settings.icons && n.icon ? `${n.icon} ` : '') + n.label;
              const fs = n.depth === 0 ? Math.round(fontSize * 1.25) : fontSize;
              const kids = childCount.get(n.id) ?? 0;
              const isCollapsed = collapsed.has(n.id);
              const mark = recall.get(n.id);
              return (
                <g
                  key={n.id}
                  transform={`translate(${n.x},${n.y})`}
                  className={settings.reveal === 'step' ? 'mm-step' : undefined}
                  style={{
                    cursor: 'pointer',
                    ...(settings.reveal === 'step' ? { animationDelay: `${n.order * 90}ms` } : {}),
                    opacity: drag?.id === n.id ? 0.35 : 1,
                  }}
                  onPointerDown={(e) => onPointerDown(e, n)}
                  onPointerUp={(e) => {
                    e.stopPropagation();
                    onPointerUp(n);
                  }}
                  role="button"
                  tabIndex={0}
                  aria-label={hidden ? '가려진 가지, 눌러서 확인' : n.label}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onNodeTap(n);
                    }
                  }}
                >
                  {isHl || isSel || isOver ? (
                    <rect
                      x={-n.w / 2 - 5}
                      y={-n.h / 2 - 5}
                      width={n.w + 10}
                      height={n.h + 10}
                      rx={n.depth === 0 ? (n.h + 10) / 2 : 14}
                      fill="none"
                      stroke={isOver ? palette.accent : palette.hl}
                      strokeWidth={4}
                    />
                  ) : null}
                  <rect
                    x={-n.w / 2}
                    y={-n.h / 2}
                    width={n.w}
                    height={n.h}
                    rx={n.depth === 0 ? n.h / 2 : 10}
                    fill={hidden ? palette.surface2 : fill}
                    stroke={n.depth === 0 ? palette.ink : color}
                    strokeWidth={n.depth <= 1 ? 2 : 1.25}
                    strokeDasharray={hidden ? '5 4' : undefined}
                  />
                  <text x={0} y={fs * 0.36} textAnchor="middle" fontSize={fs} fontWeight={n.depth <= 1 ? 700 : 500} fill={hidden ? palette.muted : palette.ink}>
                    {hidden ? '눌러서 확인' : label}
                  </text>
                  {mark !== undefined ? <circle cx={n.w / 2 - 2} cy={-n.h / 2 + 2} r={7} fill={mark ? 'var(--ok)' : 'var(--bad)'} /> : null}
                  {kids > 0 && n.depth > 0 ? (
                    <g
                      transform={`translate(${settings.layout === 'down' ? 0 : n.side * (n.w / 2 + 10)},${settings.layout === 'down' ? n.h / 2 + 10 : 0})`}
                      onPointerDown={(e) => e.stopPropagation()}
                      onPointerUp={(e) => {
                        e.stopPropagation();
                        dragStart.current = null;
                        setCollapsed((s) => {
                          const next = new Set(s);
                          if (next.has(n.id)) next.delete(n.id);
                          else next.add(n.id);
                          return next;
                        });
                      }}
                    >
                      <circle r={9} fill={palette.surface} stroke={color} strokeWidth={1.5} />
                      <text y={4} textAnchor="middle" fontSize={11} fontWeight={700} fill={color}>
                        {isCollapsed ? kids : '−'}
                      </text>
                    </g>
                  ) : null}
                </g>
              );
            })}
            {drag ? (
              <g transform={`translate(${drag.x},${drag.y})`} pointerEvents="none">
                <rect x={-40} y={-14} width={80} height={28} rx={8} fill={palette.accent} opacity={0.85} />
                <text y={5} textAnchor="middle" fontSize={12} fill="#fff" fontWeight={700}>
                  {drag.over ? '여기로 옮기기' : '옮기는 중'}
                </text>
              </g>
            ) : null}
          </svg>
        </div>
      </div>

      {hideMode && sel && revealed.has(sel.id) && sel.depth > 0 ? (
        <div className="flex flex-wrap items-center gap-2 kok-card p-3">
          <span className="text-sm font-semibold">“{sel.label}” 기억났나요?</span>
          <Button size="sm" variant="secondary" className="border-ok text-ok" onClick={() => setRecall((m) => new Map(m).set(sel.id, true))}>
            기억났어요
          </Button>
          <Button size="sm" variant="secondary" className="border-bad text-bad" onClick={() => setRecall((m) => new Map(m).set(sel.id, false))}>
            헷갈렸어요
          </Button>
        </div>
      ) : null}
      {hideMode && answered > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-surface-2 p-3 text-sm">
          <span>
            기억 {[...recall.values()].filter(Boolean).length} · 헷갈림 {[...recall.values()].filter((x) => !x).length}
          </span>
          <Button size="sm" onClick={finishRecall}>
            결과 저장
          </Button>
        </div>
      ) : null}

      {editable && !hideMode && sel ? (
        <div className="grid gap-3 kok-card p-4">
          <div className="flex gap-2">
            <input
              aria-label="가지 글자"
              className={inputClass}
              value={editText}
              maxLength={60}
              onChange={(e) => setEditText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && onChange) {
                  onChange(renameNode(spec, sel.id, editText));
                }
              }}
            />
            <Button size="sm" className="shrink-0" onClick={() => onChange?.(renameNode(spec, sel.id, editText))}>
              저장
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                if (!onChange) return;
                const r = addChild(spec, sel.id);
                onChange(r.map);
                setSelected(r.id);
                setEditText('새 가지');
              }}
            >
              가지 추가
            </Button>
            {sel.id !== ROOT_ID ? (
              <>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    if (!onChange) return;
                    const r = addSibling(spec, sel.id);
                    onChange(r.map);
                    setSelected(r.id);
                    setEditText('새 가지');
                  }}
                >
                  옆에 추가
                </Button>
                <Button size="sm" variant="secondary" onClick={() => onChange?.(reorderNode(spec, sel.id, -1))}>
                  위로
                </Button>
                <Button size="sm" variant="secondary" onClick={() => onChange?.(reorderNode(spec, sel.id, 1))}>
                  아래로
                </Button>
              </>
            ) : null}
          </div>
          {sel.id !== ROOT_ID ? (
            <div className="flex flex-wrap items-center gap-2">
              <Select
                aria-label="옮길 곳"
                className="w-auto flex-1"
                value={moveTarget}
                onChange={setMoveTarget}
                options={[{ value: '', label: '다른 가지 아래로 옮기기…' }, ...moveOptions.map((o) => ({ value: o.id, label: o.label }))]}
              />
              <Button size="sm" variant="secondary" disabled={!moveTarget} onClick={() => moveTarget && onChange?.(moveNode(spec, sel.id, moveTarget))}>
                옮기기
              </Button>
              {confirmDelete ? (
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => {
                    onChange?.(deleteNode(spec, sel.id));
                    setSelected(null);
                  }}
                >
                  정말 지우기
                </Button>
              ) : (
                <Button size="sm" variant="ghost" className="text-bad" onClick={() => setConfirmDelete(true)}>
                  지우기
                </Button>
              )}
            </div>
          ) : null}
          <p className="text-xs text-muted">가지를 꾹 눌러 끌어서 다른 가지 위에 놓으면 그 아래로 옮겨져요. 고친 가지는 AI가 다시 만들어도 그대로 남아요.</p>
        </div>
      ) : null}
    </div>
  );
}
