'use client';
// 노트에 더하는 자료의 진행: 정리 중이면 진행 고리, 멈추면 다시 하기·지우기
import { useState } from 'react';
import type { ChildSource } from '@/lib/versions';
import { officeFileName } from '@/lib/office/names';
import { stepLabel } from '../ProcessingList';
import { Button, ICONS, Icon, ProgressRing, api, cx, useToast, DONE } from '../ui';
import { useConfirm } from '../Confirm';

const KIND_ICON = { text: ICONS.pen, pdf: ICONS.file, image: ICONS.image } as const;
const KIND_LABEL = { text: '글', pdf: 'PDF', image: '사진' } as const;

export function AppendStatus({ kids, onChanged }: { kids: ChildSource[]; onChanged: () => void }) {
  const toast = useToast();
  const ask = useConfirm();
  const [busy, setBusy] = useState<string | null>(null);
  const shown = kids.filter((k) => k.status !== 'ready');
  if (!shown.length) return null;
  return (
    <section className="grid gap-2" aria-label="노트에 더하는 자료" aria-live="polite">
      {shown.map((k) => {
        const failed = k.status === 'error';
        // 한글·워드·PPT 에서 꺼낸 글은 파일 이름으로
        const file = k.kind === 'text' ? officeFileName(k.text_content) : null;
        const snippet = k.kind === 'text' && k.text_content ? k.text_content.replace(/\s+/g, ' ').trim().slice(0, 24) : '';
        const name = k.title || file || (snippet ? `${snippet}…` : `${KIND_LABEL[k.kind]} 자료`);
        return (
          <div key={k.id} className={cx('kok-card kok-rise grid gap-2 p-3.5', failed && 'ring-2 ring-bad/30')}>
            <div className="flex items-center gap-3">
              {failed ? (
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-bad-soft text-bad">
                  <Icon d={ICONS.retry} size={19} />
                </span>
              ) : (
                <ProgressRing value={k.progress} size={40} stroke={4} label={`${name} 더하는 중`}>
                  <Icon d={KIND_ICON[k.kind]} size={15} className="text-muted" />
                </ProgressRing>
              )}
              <div className="min-w-0 flex-1">
                <p className={cx('truncate text-sm font-bold', failed && 'text-bad')}>
                  {failed ? '자료를 더하지 못했어요' : '이 노트에 자료를 더하는 중이에요'}
                </p>
                <p className="truncate text-xs text-muted">
                  {name} · {stepLabel(k)}
                </p>
              </div>
            </div>
            {failed ? (
              <div className="grid gap-2 pl-[52px]">
                <p className="text-sm text-muted">{k.error ?? '정리하다가 멈췄어요.'} 쓴 에너지는 돌려줬어요.</p>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    busy={busy === k.id}
                    onClick={async () => {
                      setBusy(k.id);
                      try {
                        await api(`/api/sources/${k.id}/retry`, { method: 'POST', body: '{}' });
                        toast('다시 시작했어요.', 'plain', DONE);
                        onChanged();
                      } catch (e) {
                        toast((e as Error).message, 'bad');
                      } finally {
                        setBusy(null);
                      }
                    }}
                  >
                    다시 하기
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy === k.id}
                    onClick={async () => {
                      if (
                        !(await ask({
                          title: '더하려던 자료 지우기',
                          body: '더하려던 이 자료를 지울까요?',
                          note: '노트는 그대로예요.',
                          ok: '지우기',
                          danger: true,
                        }))
                      )
                        return;
                      try {
                        await api(`/api/sources/${k.id}`, { method: 'DELETE' });
                        onChanged();
                      } catch (e) {
                        toast((e as Error).message, 'bad');
                      }
                    }}
                  >
                    지우기
                  </Button>
                </div>
              </div>
            ) : (
              <p className="pl-[52px] text-xs text-muted">끝나면 새 버전이 돼요. 그동안 정리·그림은 고칠 수 없어요.</p>
            )}
          </div>
        );
      })}
    </section>
  );
}
