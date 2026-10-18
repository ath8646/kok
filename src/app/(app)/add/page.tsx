'use client';
// 자료 넣기: 글 · PDF · 사진 → 예상 에너지 → 정리 시작
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMe } from '@/components/AppShell';
import { SubjectForm } from '@/components/SubjectForm';
import { Button, Card, Chip, Field, Segmented, Sheet, api, cx, inputClass, useToast } from '@/components/ui';
import { fetchSubjects, sb } from '@/lib/data';
import type { SubjectRow } from '@/lib/types';
import { estimateEnergy } from '@/lib/ai/models';
import { clientModel } from '@/lib/client-model';
import { shrinkImage } from '@/lib/image';

type Kind = 'text' | 'pdf' | 'image';
type Photo = { id: string; file: File; url: string };

function uuid(): string {
  return crypto.randomUUID();
}

export default function AddPage() {
  const { me, refresh } = useMe();
  const router = useRouter();
  const toast = useToast();
  const [subjects, setSubjects] = useState<SubjectRow[] | null>(null);
  const [subjectId, setSubjectId] = useState('');
  const [kind, setKind] = useState<Kind>(() => {
    // 이 화면은 로그인 정보를 받은 뒤 브라우저에서만 그려진다
    const k = typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('kind');
    return k === 'text' || k === 'pdf' || k === 'image' ? k : 'pdf';
  });
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [pdf, setPdf] = useState<{ file: File; pages: number } | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [newSubject, setNewSubject] = useState(false);
  const pdfInput = useRef<HTMLInputElement>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const want = new URLSearchParams(window.location.search).get('subject');
    let alive = true;
    fetchSubjects()
      .then((s) => {
        if (!alive) return;
        setSubjects(s);
        setSubjectId(want && s.some((x) => x.id === want) ? want : (s[0]?.id ?? ''));
      })
      .catch(() => {
        if (alive) setSubjects([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  const urls = useRef<string[]>([]);
  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), []);

  const plan = me?.plan;
  const model = me ? clientModel(me, me.settings.models.organize) : 'claude-haiku-5-5';
  const estimate = useMemo(() => {
    if (!me) return 0;
    if (kind === 'text') return text.trim().length >= 20 ? estimateEnergy({ kind, chars: text.length }, model, me.usdPerEnergy) : 0;
    if (kind === 'pdf') return pdf ? estimateEnergy({ kind, pages: pdf.pages }, model, me.usdPerEnergy) : 0;
    return photos.length ? estimateEnergy({ kind, images: photos.length }, model, me.usdPerEnergy) : 0;
  }, [me, kind, text, pdf, photos, model]);

  if (!me || !plan) return null;
  const remaining = me.energy.unlimited ? Infinity : (me.energy.remaining ?? 0);
  const enough = estimate <= remaining;

  const pickPdf = async (f: File | undefined) => {
    setPdf(null);
    setPdfError(null);
    if (!f) return;
    if (!/\.pdf$/i.test(f.name) && f.type !== 'application/pdf') return setPdfError('PDF 파일만 넣을 수 있어요.');
    if (f.size > plan.fileMb * 1024 * 1024) return setPdfError(`파일이 너무 커요. ${plan.fileMb}MB까지 넣을 수 있어요.`);
    setBusy('PDF 쪽수 세는 중…');
    try {
      const { PDFDocument } = await import('pdf-lib');
      const doc = await PDFDocument.load(new Uint8Array(await f.arrayBuffer()), { ignoreEncryption: true, updateMetadata: false });
      if (doc.isEncrypted) throw new Error('암호가 걸린 PDF는 읽을 수 없어요. 암호를 풀고 다시 올려 주세요.');
      const pages = doc.getPageCount();
      if (pages > plan.pdfPages) throw new Error(`이 PDF는 ${pages}쪽이에요. 한 번에 ${plan.pdfPages}쪽까지 넣을 수 있어요. 나눠서 올려 주세요.`);
      setPdf({ file: f, pages });
      if (!title) setTitle(f.name.replace(/\.pdf$/i, '').slice(0, 60));
    } catch (e) {
      setPdfError(e instanceof Error && e.message.includes('PDF') ? e.message : 'PDF 파일을 열 수 없어요. 다른 프로그램에서 PDF로 다시 저장해 올려 주세요.');
    } finally {
      setBusy(null);
    }
  };

  const addPhotos = (files: FileList | null) => {
    if (!files?.length) return;
    const room = plan.images - photos.length;
    const list = Array.from(files).filter((f) => f.type.startsWith('image/') || /\.(jpe?g|png|webp|heic|heif)$/i.test(f.name));
    if (list.length > room) toast(`사진은 한 번에 ${plan.images}장까지 넣을 수 있어요.`, 'bad');
    const added = list.slice(0, Math.max(0, room)).map((file) => ({ id: uuid(), file, url: URL.createObjectURL(file) }));
    urls.current.push(...added.map((a) => a.url));
    setPhotos((ps) => [...ps, ...added]);
  };

  const ready =
    !!subjectId &&
    estimate > 0 &&
    enough &&
    me.aiEnabled &&
    (kind === 'text' ? text.trim().length >= 20 && text.length <= plan.textChars : kind === 'pdf' ? !!pdf : photos.length > 0);

  const start = async () => {
    if (!ready) return;
    const id = uuid();
    const files: string[] = [];
    try {
      if (kind !== 'text') {
        // 1) 올릴 파일 준비 (사진은 작게 줄인다)
        const blobs: Blob[] = [];
        if (kind === 'pdf' && pdf) blobs.push(pdf.file);
        if (kind === 'image') {
          for (let i = 0; i < photos.length; i++) {
            setBusy(`사진 줄이는 중 (${i + 1}/${photos.length})…`);
            blobs.push(await shrinkImage(photos[i].file));
          }
        }
        // 2) 서버에서 올릴 자리를 받는다 (개수·크기·하루 한도 검사)
        setBusy('올릴 준비 중…');
        const { uploads } = await api<{ uploads: Array<{ path: string; token: string }> }>('/api/uploads', {
          method: 'POST',
          body: JSON.stringify({ sourceId: id, kind, files: blobs.map((b) => ({ size: b.size })) }),
        });
        // 3) 받은 자리에 올린다
        const bucket = sb().storage.from('sources');
        for (let i = 0; i < uploads.length; i++) {
          setBusy(kind === 'pdf' ? 'PDF 올리는 중…' : `사진 올리는 중 (${i + 1}/${uploads.length})…`);
          const { error } = await bucket.uploadToSignedUrl(uploads[i].path, uploads[i].token, blobs[i], {
            contentType: kind === 'pdf' ? 'application/pdf' : 'image/jpeg',
          });
          if (error)
            throw new Error(kind === 'pdf' ? 'PDF를 올리지 못했어요. 인터넷 연결을 확인해 주세요.' : '사진을 올리지 못했어요. 인터넷 연결을 확인해 주세요.');
          files.push(uploads[i].path);
        }
      }
      setBusy('정리 시작하는 중…');
      await api('/api/sources', {
        method: 'POST',
        body: JSON.stringify({ id, subjectId, kind, title: title.trim(), text: kind === 'text' ? text : undefined, files }),
      });
      refresh();
      router.push(`/notes/${id}`);
    } catch (e) {
      // 올리다 만 파일은 서버가 나중에 지운다
      toast((e as Error).message, 'bad');
      setBusy(null);
    }
  };

  return (
    <div className="grid gap-4">
      <h1 className="font-display text-2xl">자료 넣기</h1>

      <Card className="grid gap-3">
        <Field label="과목" htmlFor="add-subject">
          <div className="flex gap-2">
            <select id="add-subject" className={inputClass} value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
              {(subjects ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
              {subjects && !subjects.length ? <option value="">과목을 먼저 만들어 주세요</option> : null}
            </select>
            <Button variant="secondary" className="shrink-0 whitespace-nowrap" onClick={() => setNewSubject(true)}>
              새 과목
            </Button>
          </div>
        </Field>
        <Segmented
          label="자료 종류"
          value={kind}
          onChange={(k) => setKind(k)}
          options={[
            { value: 'pdf', label: '📄 PDF' },
            { value: 'image', label: '📷 사진' },
            { value: 'text', label: '✍️ 직접 쓰기' },
          ]}
        />
        <Field label="제목 (없으면 AI가 붙여요)" htmlFor="add-title">
          <input
            id="add-title"
            className={inputClass}
            value={title}
            maxLength={120}
            placeholder="예: 2단원 광합성 학습지"
            onChange={(e) => setTitle(e.target.value)}
          />
        </Field>
      </Card>

      {kind === 'pdf' ? (
        <Card className="grid gap-3">
          <input ref={pdfInput} type="file" accept="application/pdf,.pdf" className="sr-only" onChange={(e) => pickPdf(e.target.files?.[0])} />
          <button
            type="button"
            onClick={() => pdfInput.current?.click()}
            className="grid place-items-center gap-1 rounded-2xl border-2 border-dashed border-line bg-surface-2 px-4 py-10 text-center hover:border-accent"
          >
            <span className="text-3xl" aria-hidden="true">
              📄
            </span>
            <span className="font-bold">{pdf ? pdf.file.name : 'PDF 고르기'}</span>
            <span className="text-sm text-muted">
              {pdf ? `${pdf.pages}쪽 · ${(pdf.file.size / 1024 / 1024).toFixed(1)}MB` : `한 번에 ${plan.pdfPages}쪽, ${plan.fileMb}MB까지`}
            </span>
          </button>
          {pdfError ? <p className="text-sm font-semibold text-bad">{pdfError}</p> : null}
          <p className="text-xs text-muted">한글(HWP)·워드·PPT 파일은 다음 버전에서 열려요. 지금은 그 프로그램에서 PDF로 저장해 올려 주세요.</p>
        </Card>
      ) : null}

      {kind === 'image' ? (
        <Card className="grid gap-3">
          <input
            ref={photoInput}
            type="file"
            accept="image/*"
            multiple
            className="sr-only"
            onChange={(e) => {
              addPhotos(e.target.files);
              e.target.value = '';
            }}
          />
          <input
            ref={cameraInput}
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            onChange={(e) => {
              addPhotos(e.target.files);
              e.target.value = '';
            }}
          />
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" size="lg" onClick={() => cameraInput.current?.click()} disabled={photos.length >= plan.images}>
              📷 사진 찍기
            </Button>
            <Button variant="secondary" size="lg" onClick={() => photoInput.current?.click()} disabled={photos.length >= plan.images}>
              🖼️ 앨범에서
            </Button>
          </div>
          {photos.length ? (
            <ol className="grid grid-cols-3 gap-2 sm:grid-cols-5">
              {photos.map((p, i) => (
                <li key={p.id} className="relative overflow-hidden rounded-xl border border-line">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.url} alt={`사진 ${i + 1}`} className="aspect-[3/4] w-full object-cover" />
                  <span className="absolute left-1 top-1 rounded-full bg-ink/80 px-1.5 text-xs font-bold text-surface">{i + 1}</span>
                  <button
                    type="button"
                    aria-label={`사진 ${i + 1} 빼기`}
                    className="absolute right-1 top-1 grid h-7 w-7 place-items-center rounded-full bg-bad text-sm font-bold text-white"
                    onClick={() => {
                      URL.revokeObjectURL(p.url);
                      setPhotos((ps) => ps.filter((x) => x.id !== p.id));
                    }}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ol>
          ) : null}
          <p className="text-sm text-muted">
            {photos.length}/{plan.images}장 · 순서대로 정리해요. 손글씨도 읽어요.
          </p>
        </Card>
      ) : null}

      {kind === 'text' ? (
        <Card className="grid gap-2">
          <label htmlFor="add-text" className="text-sm font-semibold">
            공부한 내용을 쓰거나 붙여 넣어 주세요
          </label>
          <textarea
            id="add-text"
            className={cx(inputClass, 'min-h-64 leading-relaxed')}
            value={text}
            placeholder="내가 쓴 표현은 그대로 살리고, 구조만 정리해요. 틀려 보이는 곳은 고치지 않고 '확인해 보세요'라고 알려 줘요."
            onChange={(e) => setText(e.target.value)}
          />
          <p className={cx('text-right text-xs', text.length > plan.textChars ? 'font-bold text-bad' : 'text-muted')}>
            {text.length.toLocaleString()} / {plan.textChars.toLocaleString()}자
          </p>
        </Card>
      ) : null}

      <Card className="grid gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-semibold">예상 AI 에너지</span>
          <span className="flex items-center gap-2">
            <Chip tone={enough ? 'accent' : 'bad'}>⚡ 약 {estimate || '-'}</Chip>
            <span className="text-sm text-muted">남은 에너지 {me.energy.unlimited ? '무제한' : Math.floor(remaining)}</span>
          </span>
        </div>
        {!enough ? (
          <p className="text-sm text-bad">
            에너지가 부족해요. {me.energy.period === 'day' ? '내일 다시 채워져요.' : '다음 달에 다시 채워져요.'} 자료를 나눠서 넣으면 적게 들어요.
          </p>
        ) : null}
        <p className="text-xs text-muted">끝난 뒤 실제로 쓴 만큼만 빠져요. 실패하면 돌려줘요.</p>
      </Card>

      <div className="rounded-2xl bg-surface-2 p-4 text-sm text-muted">
        <p>• AI는 틀릴 수 있어요. 정리와 문제에는 출처 쪽이 붙으니 원본과 비교해 보세요.</p>
        <p>• 자료에 다른 사람의 이름·전화번호 같은 개인정보가 있으면 지우고 올려 주세요.</p>
        {plan.fileDays ? <p>• 무료 요금제는 원본 파일을 처리 {plan.fileDays}일 뒤 지워요. 노트·그림·문제는 계속 남아요.</p> : null}
      </div>

      <Button size="lg" disabled={!ready || !!busy} busy={!!busy} onClick={start}>
        {busy ?? (kind === 'text' ? '완료하고 정리하기' : '정리 시작')}
      </Button>
      {!me.aiEnabled ? <p className="text-center text-sm text-muted">지금은 AI 기능을 잠깐 쉬고 있어요.</p> : null}

      <Sheet open={newSubject} onClose={() => setNewSubject(false)} title="새 과목">
        <SubjectForm
          withExam={false}
          onCancel={() => setNewSubject(false)}
          onSave={async (d) => {
            const { data, error } = await sb()
              .from('subjects')
              .insert({ name: d.name, color: d.color, position: subjects?.length ?? 0 })
              .select('id, name, color, exam_date, position, created_at')
              .single();
            if (error || !data) return toast('과목을 만들지 못했어요.', 'bad');
            setSubjects((s) => [...(s ?? []), data as SubjectRow]);
            setSubjectId(data.id);
            setNewSubject(false);
          }}
        />
      </Sheet>
    </div>
  );
}
