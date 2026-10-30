'use client';
// 글 칸 속 수식 고치기 창: 수식 조각을 누르거나 꾸미기 줄의 '수식'을 누르면 열린다
import { useState } from 'react';
import type { Editor } from '@tiptap/core';
import { Button, Sheet } from '@/components/ui';
import { TexInput, useTexProblem } from './TexInput';

export type MathTarget = { editor: Editor; key: string; pos: number | null; tex: string };

export function MathSheet({ target, onClose }: { target: MathTarget | null; onClose: () => void }) {
  if (!target) return null;
  return <MathSheetBody key={`${target.key}:${target.pos ?? 'new'}`} target={target} onClose={onClose} />;
}

function MathSheetBody({ target, onClose }: { target: MathTarget; onClose: () => void }) {
  const [tex, setTex] = useState(target.tex);
  const problem = useTexProblem(tex);
  const ed = target.editor;
  const clean = tex.replace(/\s*\n\s*/g, ' ').trim();

  /** apply: 고친 수식을 넣는다 / remove: 수식을 뺀다 / 그 밖(닫기): 그대로 두고 칸으로 돌아간다 */
  const finish = (how: 'apply' | 'remove' | 'cancel') => {
    onClose();
    if (ed.isDestroyed) return;
    const pos = target.pos;
    const node = pos === null ? null : ed.state.doc.nodeAt(pos);
    const isMath = node?.type.name === 'math';
    const chain = ed.chain().focus();
    if (how === 'apply' && clean && !problem) {
      if (pos !== null && isMath) {
        chain
          .command(({ tr }) => {
            tr.setNodeMarkup(pos, undefined, { ...node!.attrs, tex: clean });
            return true;
          })
          .setTextSelection(pos + 1)
          .run();
      } else chain.insertContent({ type: 'math', attrs: { tex: clean, display: false } }).run();
      return;
    }
    if ((how === 'remove' || (how === 'apply' && !clean)) && pos !== null && isMath) {
      chain.deleteRange({ from: pos, to: pos + node!.nodeSize }).run();
      return;
    }
    if (pos !== null && isMath) chain.setTextSelection(pos + 1).run();
    else chain.run();
  };

  return (
    <Sheet
      open
      onClose={() => finish('cancel')}
      title={target.pos === null ? '수식 넣기' : '수식 고치기'}
      footer={
        <div className="flex items-center gap-2">
          {target.pos !== null ? (
            <Button variant="ghost" className="text-bad" onClick={() => finish('remove')}>
              수식 빼기
            </Button>
          ) : null}
          <Button className="ml-auto" disabled={!!problem || (!clean && target.pos === null)} onClick={() => finish('apply')}>
            {target.pos === null ? '넣기' : '완료'}
          </Button>
        </div>
      }
    >
      <TexInput value={tex} onChange={setTex} label="수식" placeholder="예: x^2 + 1" display={false} autoFocus onSubmit={() => finish('apply')} />
    </Sheet>
  );
}
