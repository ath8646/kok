'use client';
// 표지 그림 창 (Pro, 자료함 카드 메뉴 '표지 그림'): 지금 표지를 크게 보고 다시 그리기(번개 조금)·빼기.
// 그리기·빼기 요청과 목록 고치기는 여는 화면(LibraryView)이 한다 (onDraw·onRemove)
import { useState } from 'react';
import { estimateCover } from '@/lib/ai/models';
import { subjectVar } from '@/lib/colors';
import { clientModel } from '@/lib/client-model';
import type { Cover } from '@/lib/cover';
import { ICONS } from '@/lib/icons';
import { useMe } from './AppShell';
import { CoverArt } from './CoverArt';
import { Button, DONE, EnergyEstimate, Icon, Sheet, Spinner, cx, useToast } from './ui';

export function CoverSheet({
  open,
  onClose,
  name,
  cover,
  tint,
  onDraw,
  onRemove,
}: {
  open: boolean;
  onClose: () => void;
  /** 노트 이름 */
  name: string;
  cover: Cover | null;
  /** 과목 색 (카드처럼 바탕을 옅게 물들인다) */
  tint: string | null;
  /** 그리고 저장한다 (실패하면 던진다: 까닭은 알림으로) */
  onDraw: () => Promise<void>;
  onRemove: () => Promise<void>;
}) {
  const { me } = useMe();
  const toast = useToast();
  const [busy, setBusy] = useState<'draw' | 'remove' | null>(null);
  // 새로 그릴 때마다 그림이 번지며 나타나게 (key)
  const [drawn, setDrawn] = useState(0);
  const est = me ? estimateCover(clientModel(me, me.settings.models.visual), me.usdPerEnergy) : null;

  const draw = async () => {
    if (busy) return;
    const had = !!cover;
    setBusy('draw');
    try {
      await onDraw();
      setDrawn((n) => n + 1);
      toast(had ? '표지를 새로 그렸어요.' : '표지를 그렸어요.', 'plain', DONE);
    } catch (e) {
      toast((e as Error).message, 'bad');
    } finally {
      setBusy(null);
    }
  };
  const remove = async () => {
    if (busy) return;
    setBusy('remove');
    try {
      await onRemove();
      toast('표지를 뺐어요. 카드에 한 줄 요약이 다시 보여요.', 'plain', DONE);
      onClose();
    } catch (e) {
      toast((e as Error).message, 'bad');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="표지 그림"
      footer={
        <div className="flex gap-2">
          {cover ? (
            <Button variant="secondary" className="flex-1" busy={busy === 'remove'} disabled={!!busy} onClick={remove}>
              표지 빼기
            </Button>
          ) : null}
          <Button className="flex-1" busy={busy === 'draw'} disabled={!!busy} onClick={draw}>
            {cover ? '다시 그리기' : '그리기'}
            {est !== null ? (
              <span className="text-[13px] font-semibold opacity-90">
                <EnergyEstimate est={est} />
              </span>
            ) : null}
          </Button>
        </div>
      }
    >
      <div className="grid gap-3">
        <div
          className="relative aspect-[3/2] overflow-hidden rounded-[22px] bg-surface ring-1 ring-line"
          style={{ backgroundImage: `linear-gradient(color-mix(in srgb, ${subjectVar(tint)} 8%, transparent), color-mix(in srgb, ${subjectVar(tint)} 8%, transparent))` }}
        >
          {cover ? (
            <CoverArt
              key={drawn}
              cover={cover}
              tint={tint}
              reserve={{ w: 0, h: 0 }}
              describe
              className={cx('kok-fade absolute inset-0 h-full w-full p-2 transition-opacity duration-200', busy === 'draw' && 'opacity-30')}
            />
          ) : (
            <div className="absolute inset-0 grid place-content-center justify-items-center gap-2 p-6 text-center text-sm text-muted">
              <Icon d={ICONS.image} size={26} />
              <p>아직 표지가 없어요. 지금은 카드에 한 줄 요약이 보여요.</p>
            </div>
          )}
          {busy === 'draw' ? (
            <div className="absolute inset-0 grid place-items-center">
              <span className="inline-flex items-center gap-2 rounded-full bg-surface px-3.5 py-2 text-sm font-semibold shadow-[0_6px_18px_var(--shadow-strong)] ring-1 ring-line">
                <Spinner />
                그리는 중…
              </span>
            </div>
          ) : null}
        </div>
        <p className="sr-only" aria-live="polite">
          {busy === 'draw' ? '표지를 그리는 중이에요.' : ''}
        </p>
        <p className="text-[15px] leading-relaxed">
          <span className="font-semibold">{name}</span>의 핵심을 AI가 연표·흐름도·비교표 같은 작은 도표로 그려요. 다시 그리면 새로 골라서 그려요.
        </p>
        <p className="text-xs text-muted">자료를 넣을 때 표지를 저절로 그릴지는 설정의 시각화에서 바꿀 수 있어요.</p>
      </div>
    </Sheet>
  );
}
