'use client';
// 그림 탭 아래 'PDF 요약 정리': 노트를 KOK 스타일 PDF 로 만들어 모아 둔다 (만들 때마다 한 개씩, AI 없이).
// 누르면 앱 안에서 보고(PdfViewer), ⋯ 로 이름 바꾸기·내려받기·지우기, 꾹 누르면 여러 개 골라 지우기
import { useEffect, useState } from 'react';
import { sb } from '@/lib/data';
import { PDF_LIMITS, pdfSizeLabel, type NotePdfRow, type PdfTheme } from '@/lib/note-pdf';
import { PdfViewer } from '../PdfViewer';
import { BarAction, SelectionBar, pickKeyHandler, useMultiSelect } from '../SelectionBar';
import { useLongPress } from '../useLongPress';
import { Button, Chip, ICONS, Icon, IconButton, Menu, Sheet, api, cx, inputClass, radioKeys, useToast, DONE, type MenuItem } from '../ui';

const THEMES: Array<{ value: PdfTheme; label: string; desc: string }> = [
  { value: 'dark', label: '어두운 모눈', desc: '검은 모눈종이에 밝은 글씨 (화면으로 볼 때)' },
  { value: 'light', label: '밝은 종이', desc: '종이색 바탕 (인쇄할 때)' },
];
const THEME_KEY = 'kok.pdf.theme';

export function NotePdfs({ noteId, noteTitle, canCreate }: { noteId: string; noteTitle: string; canCreate: boolean }) {
  const toast = useToast();
  const [rows, setRows] = useState<NotePdfRow[] | null>(null);
  const [tick, setTick] = useState(0);
  const [making, setMaking] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [theme, setTheme] = useState<PdfTheme>(() => {
    try {
      return localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark';
    } catch {
      return 'dark';
    }
  });
  const [viewing, setViewing] = useState<{ row: NotePdfRow; url: string } | null>(null);
  const [renaming, setRenaming] = useState<NotePdfRow | null>(null);
  const [newName, setNewName] = useState('');
  const [renameBusy, setRenameBusy] = useState(false);
  const [confirm, setConfirm] = useState<string[] | null>(null);
  const [deleting, setDeleting] = useState(false);
  const { selecting, picked, setPicked, startSelect, endSelect, togglePick } = useMultiSelect();

  useEffect(() => {
    let alive = true;
    sb()
      .from('note_pdfs')
      .select('id, name, path, bytes, pages, version, created_at, updated_at')
      .eq('note_id', noteId)
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (!alive) return;
        setRows(error ? [] : ((data ?? []) as NotePdfRow[]));
      });
    return () => {
      alive = false;
    };
  }, [noteId, tick]);

  const list = rows ?? [];
  const pickedRows = list.filter((r) => picked.has(r.id));
  const allPicked = list.length > 0 && pickedRows.length === list.length;

  const signedUrl = async (row: NotePdfRow, download: boolean): Promise<string | null> => {
    // 여러 개 주소 만들기로 하나만 (하나짜리 주소 만들기는 시험 서버가 받지 않는다)
    const { data, error } = await sb()
      .storage.from('sources')
      .createSignedUrls([row.path], 60 * 30, download ? { download: `${row.name}.pdf` } : undefined);
    const url = data?.[0]?.signedUrl;
    if (error || !url) {
      toast('PDF 파일을 찾지 못했어요.', 'bad');
      return null;
    }
    return url;
  };
  const open = async (row: NotePdfRow) => {
    const url = await signedUrl(row, false);
    if (url) setViewing({ row, url });
  };
  const download = async (row: NotePdfRow) => {
    const url = await signedUrl(row, true);
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = `${row.name}.pdf`;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const create = async () => {
    if (creating) return;
    setCreating(true);
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* 저장소를 못 쓰는 환경 */
    }
    try {
      const r = await api<{ pdf: NotePdfRow }>(`/api/notes/${noteId}/pdf`, { method: 'POST', body: JSON.stringify({ name: name.trim() || undefined, theme }) });
      setRows((cur) => [r.pdf, ...(cur ?? [])]);
      setMaking(false);
      setName('');
      toast('PDF 요약 정리를 만들었어요.', 'ok', DONE);
    } catch (e) {
      toast((e as Error).message, 'bad');
    } finally {
      setCreating(false);
    }
  };

  const rename = async () => {
    if (!renaming) return;
    const n = newName.trim().slice(0, PDF_LIMITS.name);
    if (!n) return;
    setRenameBusy(true);
    const { error } = await sb().from('note_pdfs').update({ name: n }).eq('id', renaming.id);
    setRenameBusy(false);
    if (error) {
      toast('이름을 바꾸지 못했어요.', 'bad');
      return;
    }
    setRows((cur) => (cur ?? []).map((r) => (r.id === renaming.id ? { ...r, name: n } : r)));
    setRenaming(null);
    toast('이름을 바꿨어요.', 'plain', DONE);
  };

  const remove = async (ids: string[]) => {
    setDeleting(true);
    try {
      const r = await api<{ deleted: number }>(`/api/notes/${noteId}/pdf`, { method: 'DELETE', body: JSON.stringify({ ids }) });
      setRows((cur) => (cur ?? []).filter((x) => !ids.includes(x.id)));
      setConfirm(null);
      endSelect();
      toast(`PDF ${r.deleted}개를 지웠어요.`, 'plain', DONE);
    } catch (e) {
      toast((e as Error).message, 'bad');
      setTick((t) => t + 1);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <section className="grid gap-3" aria-label="PDF 요약 정리">
      <div className="flex items-center gap-2">
        <h3 className="min-w-0 flex-1 font-display text-lg">
          {selecting ? (
            <span className="kok-swap">{pickedRows.length ? `${pickedRows.length}개 선택` : 'PDF 고르기'}</span>
          ) : (
            <>
              PDF 요약 정리 {list.length ? <span className="ml-1 text-sm font-semibold text-muted">{list.length}</span> : null}
            </>
          )}
        </h3>
        {selecting ? (
          <>
            <button
              type="button"
              className="press rounded-full bg-accent-soft px-3 py-2 text-sm font-semibold text-accent hover:brightness-95"
              onClick={() => setPicked(allPicked ? new Set() : new Set(list.map((r) => r.id)))}
            >
              {allPicked ? '모두 풀기' : '모두 고르기'}
            </button>
            <IconButton label="고르기 끝내기" onClick={endSelect}>
              <Icon d={ICONS.close} />
            </IconButton>
          </>
        ) : (
          <Button size="sm" variant={list.length ? 'secondary' : 'primary'} disabled={!canCreate || rows === null} onClick={() => setMaking(true)}>
            <Icon d={ICONS.plus} size={16} strokeWidth={2.6} />
            만들기
          </Button>
        )}
      </div>
      {!list.length && rows !== null && !selecting ? (
        <p className="rounded-2xl bg-surface-2 px-4 py-3 text-sm leading-relaxed text-muted">
          정리·용어·공식·마인드맵·자료 그림을 손글씨 필기 느낌의 PDF로 만들어요. 만들 때마다 하나씩 쌓여서 자료를 더한 뒤에도 그때 정리를 따로 둘 수 있어요.
        </p>
      ) : null}
      {rows === null ? (
        <div className="kok-skel grid gap-2" aria-busy="true">
          <div className="kok-card kok-shimmer h-[72px] rounded-[20px]" aria-hidden="true" />
        </div>
      ) : (
        <ul className="grid gap-2">
          {list.map((row) => (
            <PdfRow
              key={row.id}
              row={row}
              selecting={selecting}
              picked={picked.has(row.id)}
              onPick={() => togglePick(row.id)}
              onLongPress={() => (selecting ? togglePick(row.id) : startSelect(row.id))}
              onOpen={() => open(row)}
              menu={[
                { label: '보기', icon: ICONS.expand, onSelect: () => open(row) },
                { label: '내려받기', icon: ICONS.download, onSelect: () => download(row) },
                {
                  label: '이름 바꾸기',
                  icon: ICONS.pen,
                  onSelect: () => {
                    setNewName(row.name);
                    setRenaming(row);
                  },
                },
                { label: '여러 개 고르기', icon: ICONS.select, onSelect: () => startSelect(row.id) },
                { label: '지우기', icon: ICONS.trash, onSelect: () => setConfirm([row.id]), danger: true },
              ]}
            />
          ))}
        </ul>
      )}
      {!selecting && list.length > 1 ? <p className="-mt-1 px-1 text-xs text-muted">카드를 꾹 누르면 여러 개를 한꺼번에 지울 수 있어요.</p> : null}

      {selecting ? (
        <SelectionBar count={pickedRows.length} noun="PDF">
          <BarAction
            icon={ICONS.trash}
            label={pickedRows.length ? `${pickedRows.length}개 지우기` : '지울 PDF를 골라 주세요'}
            prominent
            danger
            disabled={!pickedRows.length || deleting}
            onClick={() => setConfirm(pickedRows.map((r) => r.id))}
          />
        </SelectionBar>
      ) : null}

      {/* 만들기 */}
      <Sheet
        open={making}
        onClose={() => !creating && setMaking(false)}
        title="PDF 요약 정리 만들기"
        footer={
          <Button size="lg" className="w-full" busy={creating} onClick={create}>
            {creating ? 'PDF를 그리는 중…' : '만들기'}
          </Button>
        }
      >
        <div className="grid gap-4">
          <p className="text-sm leading-relaxed text-muted">지금 노트의 정리·용어·공식·마인드맵·자료 그림이 들어가요. AI를 쓰지 않아서 에너지가 들지 않아요.</p>
          <label className="grid gap-1.5">
            <span className="text-sm font-semibold">이름</span>
            <input className={inputClass} value={name} maxLength={PDF_LIMITS.name} placeholder={`${noteTitle}${list.length ? ` (${list.length + 1})` : ''}`} onChange={(e) => setName(e.target.value)} />
          </label>
          <div role="radiogroup" aria-label="종이" className="grid grid-cols-2 gap-2">
            {THEMES.map((t, i) => {
              const on = t.value === theme;
              return (
                <button
                  key={t.value}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  tabIndex={t.value === theme ? 0 : -1}
                  onKeyDown={(e) => radioKeys(e, i, THEMES.length, (n) => setTheme(THEMES[n].value))}
                  onClick={() => setTheme(t.value)}
                  className={cx('press grid gap-2 rounded-2xl border-2 p-3 text-left transition-colors', on ? 'border-accent bg-accent-soft' : 'border-line bg-surface hover:border-accent/60')}
                >
                  <PaperPreview theme={t.value} />
                  <span className="block text-sm font-semibold">{t.label}</span>
                  <span className="block text-xs leading-snug text-muted">{t.desc}</span>
                </button>
              );
            })}
          </div>
        </div>
      </Sheet>

      {/* 이름 바꾸기 */}
      <Sheet
        open={!!renaming}
        onClose={() => !renameBusy && setRenaming(null)}
        title="PDF 이름 바꾸기"
        footer={
          <Button size="lg" className="w-full" busy={renameBusy} disabled={!newName.trim()} onClick={rename}>
            바꾸기
          </Button>
        }
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            rename();
          }}
        >
          <input className={inputClass} value={newName} maxLength={PDF_LIMITS.name} autoFocus aria-label="새 이름" onChange={(e) => setNewName(e.target.value)} />
        </form>
      </Sheet>

      {/* 지우기 확인 */}
      <Sheet
        open={!!confirm}
        onClose={() => !deleting && setConfirm(null)}
        title="PDF 지우기"
        footer={
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" size="lg" onClick={() => setConfirm(null)} disabled={deleting}>
              그대로 두기
            </Button>
            <Button variant="danger" size="lg" busy={deleting} onClick={() => confirm && remove(confirm)}>
              지우기
            </Button>
          </div>
        }
      >
        <p className="text-[15px] leading-relaxed">
          {confirm && confirm.length > 1 ? `PDF ${confirm.length}개를 지울까요?` : `'${list.find((r) => r.id === confirm?.[0])?.name ?? 'PDF'}'를 지울까요?`} 되돌릴 수 없어요.
        </p>
      </Sheet>

      {viewing ? <PdfViewer url={viewing.url} title={viewing.row.name} onClose={() => setViewing(null)} onDownload={() => download(viewing.row)} /> : null}
    </section>
  );
}

/** PDF 한 줄: 아이콘 · 이름 · 쪽수·크기·날짜 (·버전). 누르면 보기, 꾹 누르면 고르기 */
function PdfRow({
  row,
  selecting,
  picked,
  onPick,
  onLongPress,
  onOpen,
  menu,
}: {
  row: NotePdfRow;
  selecting: boolean;
  picked: boolean;
  onPick: () => void;
  onLongPress: () => void;
  onOpen: () => void;
  menu: MenuItem[];
}) {
  const press = useLongPress(onLongPress, true);
  const date = new Date(row.created_at).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });
  const meta = [`${row.pages}쪽`, pdfSizeLabel(row.bytes), date].join(' · ');
  const selectProps = selecting ? { role: 'checkbox' as const, 'aria-checked': picked, tabIndex: 0, onKeyDown: pickKeyHandler(onPick) } : {};
  return (
    <li
      className="kok-no-callout relative"
      {...press}
      onPointerDown={(e) => {
        if ((e.target as Element).closest('button, [role="menu"]')) return;
        press.onPointerDown(e);
      }}
      onClickCapture={(e) => {
        press.onClickCapture(e);
        if (e.defaultPrevented) return;
        if (selecting) {
          e.preventDefault();
          e.stopPropagation();
          onPick();
        }
      }}
    >
      <div
        className={cx('kok-card flex items-center gap-3 rounded-[20px] p-3 pr-1.5', selecting && 'cursor-pointer', selecting && picked && 'ring-2 ring-accent ring-offset-2 ring-offset-bg')}
        {...selectProps}
      >
        {selecting ? (
          <span aria-hidden="true" className={cx('grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 transition-colors', picked ? 'border-accent bg-accent text-accent-ink' : 'border-line bg-surface')}>
            {picked ? <Icon d={ICONS.check} size={14} strokeWidth={3} /> : null}
          </span>
        ) : (
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-accent-soft text-accent" aria-hidden="true">
            <Icon d={ICONS.pdf} size={22} />
          </span>
        )}
        <button type="button" className="min-w-0 flex-1 py-1 text-left" onClick={onOpen} tabIndex={selecting ? -1 : undefined} aria-label={`${row.name} 보기`}>
          <span className="block truncate font-semibold">{row.name}</span>
          <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
            {meta}
            {row.version ? <Chip>v{row.version}</Chip> : null}
          </span>
        </button>
        {!selecting ? <Menu label={`${row.name} 메뉴`} items={menu} small /> : null}
      </div>
    </li>
  );
}

/** 종이 고르기의 작은 미리보기: 모눈 바탕 위 제목 줄과 알약 */
function PaperPreview({ theme }: { theme: PdfTheme }) {
  const dark = theme === 'dark';
  return (
    <span
      aria-hidden="true"
      className="block h-20 w-full overflow-hidden rounded-xl"
      style={{
        background: dark ? '#14161e' : '#faf8f2',
        backgroundImage: `linear-gradient(${dark ? 'rgba(255,255,255,0.08)' : 'rgba(80,70,50,0.14)'} 1px, transparent 1px), linear-gradient(90deg, ${dark ? 'rgba(255,255,255,0.08)' : 'rgba(80,70,50,0.14)'} 1px, transparent 1px)`,
        backgroundSize: '10px 10px',
      }}
    >
      <span className="mx-auto mt-3 block h-2 w-16 rounded-sm" style={{ background: dark ? '#eef0f6' : '#1c1c1e' }} />
      <span className="mx-auto mt-1 block h-0.5 w-20" style={{ background: dark ? '#b9abf7' : '#6d5fe8' }} />
      <span className="ml-3 mt-3 block h-3.5 w-14 rounded-md" style={{ background: dark ? '#b9abf7' : '#6d5fe8' }} />
      <span className="ml-3 mt-1.5 block h-1.5 w-28 rounded-sm" style={{ background: dark ? 'rgba(238,240,246,0.7)' : 'rgba(28,28,30,0.6)' }} />
    </span>
  );
}
