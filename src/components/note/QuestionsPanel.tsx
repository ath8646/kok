'use client';
// 문제 탭: 문제 관리, 직접 만들기, 다시 만들기(미리보기 → 바꾸기)
import { useState } from 'react';
import type { MeResponse, QuestionRow } from '@/lib/types';
import { estimateSmallTask } from '@/lib/ai/models';
import { clientModel } from '@/lib/client-model';
import { sb } from '@/lib/data';
import { QuestionEditor } from '../QuestionEditor';
import { QuestionList, QuestionPreview, createOwnQuestion, type CardInfo, type QuestionRemoval } from '../QuestionList';
import { ApiError, Button, Energy, LinkButton, Sheet, api, useToast } from '../ui';

type PreviewRow = Pick<QuestionRow, 'type' | 'prompt' | 'choices' | 'answer' | 'accepted' | 'explanation' | 'difficulty' | 'pages'> & { key_point_id: string };

export function QuestionsPanel({
  me,
  noteId,
  subjectId,
  questions,
  cards,
  keyPoints,
  practice,
  onChanged,
  removal,
  oldVersion,
}: {
  me: MeResponse;
  noteId: string;
  subjectId: string;
  questions: QuestionRow[];
  cards: Map<string, CardInfo>;
  keyPoints: Array<{ id: string; title: string }>;
  /** 이 노트 문제 풀기 (풀 문제가 있을 때만): 주소와, 가기 전에 할 일 */
  practice?: { href: string; onOpen: () => void };
  onChanged: () => void;
  /** 지우기 대신 (노트 버전이 있으면 다른 버전의 문제는 남긴다) */
  removal?: (q: QuestionRow) => QuestionRemoval;
  /** 지난 버전을 보고 있을 때: 만든 문제를 그 버전 목록에 넣는다 */
  oldVersion?: { number: number; addQuestion: (id: string) => Promise<boolean> };
}) {
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{ rows: PreviewRow[]; replaceCount: number; keptCount: number; version: number | null } | null>(null);
  const quizModel = clientModel(me, me.settings.models.quiz);
  const est = Math.round((estimateSmallTask(quizModel, me.usdPerEnergy, 4000, 3500) + estimateSmallTask(quizModel, me.usdPerEnergy, 6000, 800)) * 10) / 10;

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-2">
        {practice && !oldVersion ? (
          <LinkButton href={practice.href} onClick={practice.onOpen}>
            이 노트 문제 풀기
          </LinkButton>
        ) : null}
        <Button variant="secondary" onClick={() => setAdding(true)}>
          직접 만들기
        </Button>
        {!oldVersion ? (
          <Button
            variant="secondary"
            busy={busy}
            disabled={!me.aiEnabled}
            onClick={async () => {
              setBusy(true);
              try {
                const r = await api<{ preview: PreviewRow[]; replaceCount: number; keptCount: number; version?: number | null }>(`/api/notes/${noteId}/quiz`, {
                  method: 'POST',
                  body: JSON.stringify({ action: 'preview' }),
                });
                if (!r.preview.length) toast('새 문제를 만들지 못했어요. 다시 해 주세요.', 'bad');
                else setPreview({ rows: r.preview, replaceCount: r.replaceCount, keptCount: r.keptCount, version: r.version ?? null });
              } catch (e) {
                toast((e as Error).message, 'bad');
              } finally {
                setBusy(false);
              }
            }}
          >
            다시 만들기 <Energy n={est} />
          </Button>
        ) : null}
      </div>
      <p className="text-xs text-muted">
        {oldVersion
          ? `버전 ${oldVersion.number}의 문제예요. 여기서 만든 문제는 이 버전을 쓸 때 복습에 나와요. AI로 다시 만들려면 이 버전을 먼저 써 주세요.`
          : '잠근 문제, 내가 고친 문제, 내가 만든 문제는 다시 만들어도 그대로 남아요.'}
      </p>

      <QuestionList
        questions={questions}
        cards={cards}
        keyPoints={keyPoints}
        onChanged={onChanged}
        removal={removal}
        emptyText={oldVersion ? '이 버전에는 문제가 없어요.' : '이 노트에는 아직 문제가 없어요.'}
      />

      <Sheet open={adding} onClose={() => setAdding(false)} title="문제 직접 만들기">
        <QuestionEditor
          keyPoints={keyPoints}
          saving={saving}
          onCancel={() => setAdding(false)}
          onSave={async (d) => {
            setSaving(true);
            const id = await createOwnQuestion(d, { noteId, subjectId, hidden: !!oldVersion });
            const ok = !!id && (!oldVersion || (await oldVersion.addQuestion(id)));
            // 지난 버전 목록에 넣지 못했으면(그사이 그 버전이 바뀜) 만든 문제를 남기지 않는다
            if (id && !ok) await sb().from('questions').delete().eq('id', id);
            setSaving(false);
            if (!ok) return toast('저장하지 못했어요.', 'bad');
            toast(oldVersion ? `버전 ${oldVersion.number}에 문제를 만들었어요.` : '문제를 만들었어요. 오늘 복습에 나와요.', 'ok');
            setAdding(false);
            onChanged();
          }}
        />
      </Sheet>

      <Sheet
        open={!!preview}
        onClose={() => setPreview(null)}
        title="새 문제 미리보기"
        footer={
          preview ? (
            <div className="flex gap-2">
              <Button
                busy={saving}
                onClick={async () => {
                  setSaving(true);
                  try {
                    await api(`/api/notes/${noteId}/quiz`, {
                      method: 'POST',
                      body: JSON.stringify({ action: 'apply', questions: preview.rows, version: preview.version ?? undefined }),
                    });
                    toast('새 문제로 바꿨어요.', 'ok');
                    setPreview(null);
                    onChanged();
                  } catch (e) {
                    toast((e as Error).message, 'bad');
                    // 그사이 노트가 다른 버전으로 바뀌었다: 미리보기를 닫고 새 버전을 불러온다
                    if (e instanceof ApiError && e.code === 'stale_version') {
                      setPreview(null);
                      onChanged();
                    }
                  } finally {
                    setSaving(false);
                  }
                }}
              >
                바꾸기
              </Button>
              <Button variant="ghost" onClick={() => setPreview(null)}>
                그대로 두기
              </Button>
            </div>
          ) : null
        }
      >
        {preview ? (
          <div className="grid gap-3">
            <p className="text-sm">
              새 문제 <b>{preview.rows.length}개</b>로 AI 문제 <b>{preview.replaceCount}개</b>를 바꿔요. 지켜 둔 문제 {preview.keptCount}개는 그대로예요.
            </p>
            <ol className="grid gap-2">
              {preview.rows.map((q, i) => (
                <li key={i} className="rounded-2xl border border-line p-3">
                  <QuestionPreview q={q} />
                </li>
              ))}
            </ol>
          </div>
        ) : null}
      </Sheet>
    </div>
  );
}
