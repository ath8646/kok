import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { LegalPage, Sec } from '@/components/LegalPage';
import { getSiteInfo } from '@/lib/server/site';
import { APPLE_LOGIN, KAKAO_LOGIN } from '@/lib/login';

export const metadata: Metadata = { title: '개인정보처리방침' };
export const revalidate = 300;

export default async function PrivacyPage() {
  const site = await getSiteInfo();
  return (
    <LegalPage title="개인정보처리방침" updated="2026년 10월 31일">
      <p>KOK(이하 &lsquo;서비스&rsquo;)은 공부에 꼭 필요한 정보만 모으고, 이용자가 언제든 내려받거나 지울 수 있게 해요.</p>

      <Sec title="1. 모으는 정보와 이유">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-line text-left">
                <th className="py-2 pr-3">정보</th>
                <th className="py-2 pr-3">이유</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-line align-top">
                <td className="py-2 pr-3">구글로 로그인하면: 구글 계정 이메일, 이름, 프로필 사진 주소, 계정 식별 번호</td>
                <td className="py-2 pr-3">로그인, 계정 구분, 문의 답변</td>
              </tr>
              {KAKAO_LOGIN ? (
                <tr className="border-b border-line align-top">
                  <td className="py-2 pr-3">카카오로 로그인하면: 카카오 회원번호(계정 식별 번호), 동의한 경우 카카오계정 이메일·닉네임·프로필 사진 주소</td>
                  <td className="py-2 pr-3">로그인, 계정 구분, 문의 답변</td>
                </tr>
              ) : null}
              {APPLE_LOGIN ? (
                <tr className="border-b border-line align-top">
                  <td className="py-2 pr-3">
                    Apple로 로그인하면: Apple이 알려 주는 이메일(&lsquo;나의 이메일 가리기&rsquo;를 고르면 Apple이 만든 전달용 주소), 계정 식별 번호, 처음
                    로그인할 때 보내기로 고른 이름
                  </td>
                  <td className="py-2 pr-3">로그인, 계정 구분, 문의 답변</td>
                </tr>
              ) : null}
              <tr className="border-b border-line align-top">
                <td className="py-2 pr-3">닉네임</td>
                <td className="py-2 pr-3">화면에 이름 보여 주기 (실명이 아니어도 돼요)</td>
              </tr>
              <tr className="border-b border-line align-top">
                <td className="py-2 pr-3">
                  올린 공부 자료(PDF, 사진, 글, 한글·워드·PPT 문서의 글과 그림)와 AI가 만든 노트·그림·문제. 한글·워드·PPT 파일은 기기에서 글과 그림을 꺼내
                  보내고, 파일 자체는 올리지 않아요
                </td>
                <td className="py-2 pr-3">정리·문제 만들기와 보여 주기</td>
              </tr>
              <tr className="border-b border-line align-top">
                <td className="py-2 pr-3">푼 기록(답, 맞았는지, 걸린 시간), 설정</td>
                <td className="py-2 pr-3">복습 일정 계산, 오답노트, 연속 기록</td>
              </tr>
              <tr className="border-b border-line align-top">
                <td className="py-2 pr-3">채팅에 보낸 말과 사진·파일, AI 테마를 만들 때 적은 부탁 글</td>
                <td className="py-2 pr-3">AI 답·풀이, 테마 만들기 (홈 채팅은 저장하지 않고, 사진·파일은 Pro만 보관해요)</td>
              </tr>
              <tr className="border-b border-line align-top">
                <td className="py-2 pr-3">
                  자료 공유에 쓴 글·댓글, 올린 파일과 그 미리보기 그림, 붙인 노트, 만든 갤러리, 좋아요·즐겨찾기·받은 기록·차단 목록, 자료 공유 신고 내용(고른
                  이유, 적은 말, 신고할 때의 글)
                </td>
                <td className="py-2 pr-3">자료 공유(커뮤니티) 운영, 하루 받기 수 세기, 신고 확인과 규칙을 어긴 글 지우기</td>
              </tr>
              <tr className="border-b border-line align-top">
                <td className="py-2 pr-3">&lsquo;이상해요&rsquo; 신고 내용(고른 이유, 적은 말, 신고할 때 본 AI 결과)</td>
                <td className="py-2 pr-3">AI가 만든 틀리거나 맞지 않는 내용을 확인하고 고치기</td>
              </tr>
              <tr className="border-b border-line align-top">
                <td className="py-2 pr-3">AI 사용 기록(작업 종류, 토큰 수, 비용)</td>
                <td className="py-2 pr-3">에너지 한도 계산, 비용 관리, 부정 사용 막기</td>
              </tr>
              <tr className="align-top">
                <td className="py-2 pr-3">접속 기록(서버 로그)</td>
                <td className="py-2 pr-3">오류 해결과 보안</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          KOK은 실명, 생일, 학교, 전화번호를 따로 묻지 않아요. 로그인한 회사가 보낸 이름·프로필 사진은 로그인 정보에만 남고, 화면에는 직접 정한 닉네임만 보여요.
        </p>
        <p>
          <b>자료 공유에 올린 것은 다른 이용자에게 보여요.</b> 자료 공유에 쓴 글·댓글·파일·노트는 닉네임과 함께(익명으로 쓰면 &lsquo;익명&rsquo;으로) 다른
          이용자가 볼 수 있어요. 이메일과 계정 번호는 보이지 않고, 익명으로 쓴 글을 누가 썼는지는 신고를 확인하는 운영자만 볼 수 있어요. 이름·학교·연락처 같은
          개인정보는 자료 공유에 적지 마세요.
        </p>
      </Sec>

      <Sec title="2. 보관 기간과 지우기">
        <ul className="list-disc pl-5">
          <li>탈퇴하면 계정, 자료, 노트, 문제, 기록, 올린 파일을 바로 모두 지워요.</li>
          <li>
            다만 AI 비용 기록(작업 종류, 토큰 수, 비용)은 누구 것인지 알 수 없게 바꿔서 비용 관리를 위해 남겨요. 그리고 탈퇴하고 바로 다시 가입해 무료 에너지를
            또 받는 것을 막으려고, 이메일과 로그인 계정 식별 번호를 알아볼 수 없게 바꾼 값과 탈퇴 시각을 2일 동안만 보관해요.
          </li>
          <li>무료 요금제에서 올린 원본 파일(PDF, 사진, 문서에서 꺼낸 그림)은 처리 7일 뒤 지워요. 노트·그림·문제는 남아요.</li>
          <li>올렸지만 정리를 시작하지 않은 파일, 자료 공유에 올렸지만 글로 만들지 않은 파일은 하루 안에 지워요.</li>
          <li>
            자료 공유의 글·댓글·파일은 내가 지우거나 탈퇴할 때까지 보관해요. 갤러리를 만든 사람이나 운영자가 규칙에 따라 지울 수도 있어요. 다른 이용자가 이미
            받아 자기 자료함에 넣은 노트는 그 사람의 자료로 남아요. 내가 만든 갤러리는 탈퇴해도 다른 이용자의 글이 있어 남고, 만든 사람 표시 없이 운영자가
            관리해요.
          </li>
          <li>서버 로그는 호스팅 회사 정책에 따라 짧은 기간만 보관돼요.</li>
          <li>법령이 보관을 요구하는 정보가 생기면 그 기간 동안만 따로 보관해요.</li>
        </ul>
      </Sec>

      <Sec title="3. 맡기는 곳과 해외 이전">
        <p>
          서비스를 운영하려고 아래 회사에 정보 처리를 맡겨요. {KAKAO_LOGIN ? '카카오를 빼면 모두 해외 회사라서' : '모두 해외 회사라서'} 정보가 나라 밖으로
          옮겨져요(국외 이전). 서비스를 쓸 때마다 그때 필요한 정보만 암호화한 인터넷 통신(HTTPS)으로 보내요.
        </p>
        {/* 폰에서도 옆으로 밀지 않고 읽게 표 대신 회사마다 칸 하나 */}
        <ul className="grid gap-3">
          {transfers().map((t) => (
            <li key={t.name} className="rounded-2xl border border-line p-4">
              <p>
                <b>{t.name}</b>{' '}
                <span className="text-sm text-muted">
                  ({t.where}
                  {t.contact ? <> · {t.contact}</> : null})
                </span>
              </p>
              <dl className="mt-2 grid grid-cols-[5.5rem_1fr] gap-x-3 gap-y-1.5 text-sm">
                <dt className="font-semibold text-muted">맡기는 일</dt>
                <dd>{t.job}</dd>
                <dt className="font-semibold text-muted">옮기는 정보</dt>
                <dd>{t.items}</dd>
                <dt className="font-semibold text-muted">보관 기간</dt>
                <dd>{t.keep}</dd>
              </dl>
            </li>
          ))}
        </ul>
        <p>
          <b>거부하려면</b>: 국외 이전을 원하지 않으면 가입하지 않거나 언제든{' '}
          <a className="underline" href="/delete-account">
            탈퇴
          </a>
          할 수 있어요. 다만 이 회사들 없이는 서비스를 제공할 수 없어서, 거부하면 KOK을 쓸 수 없어요. AI 테마 그림을 만들지 않으면 Cloudflare로는 아무것도
          보내지 않아요.
        </p>
        <p>이 밖의 곳에 개인정보를 팔거나 넘기지 않아요. 법에 따른 요청이 있을 때만 예외로 해요.</p>
      </Sec>

      <Sec title="4. 이용자의 권리">
        <ul className="list-disc pl-5">
          <li>설정 &gt; 내 데이터에서 내 정보를 내려받을 수 있어요.</li>
          <li>닉네임, 자료, 노트, 문제, 자료 공유에 쓴 글과 댓글은 앱에서 직접 고치거나 지울 수 있어요.</li>
          <li>
            설정에서 탈퇴하면 모든 정보가 지워져요 (위 2번의 알아볼 수 없게 바꾼 기록은 빼고). 방법은{' '}
            <a className="underline" href="/delete-account">
              계정 삭제 안내
            </a>
            에 있어요.
          </li>
          <li>그 밖의 열람·정정·삭제·처리 정지 요청은 아래 연락처로 보내 주세요.</li>
        </ul>
      </Sec>

      <Sec title="5. 안전하게 지키는 방법">
        <ul className="list-disc pl-5">
          <li>모든 통신은 암호화(HTTPS)해요.</li>
          <li>데이터베이스가 직접 &lsquo;로그인한 본인의 것&rsquo;만 보이게 막아요 (행 단위 보안, RLS).</li>
          <li>AI 키와 데이터베이스 비밀 키는 서버에만 두고, 브라우저나 코드 저장소에 두지 않아요.</li>
          <li>로그인 유지를 위한 쿠키만 쓰고, 광고·추적 쿠키는 쓰지 않아요.</li>
        </ul>
      </Sec>

      <Sec title="6. 개인정보 보호책임자">
        <p>
          {site.operatorName}
          {site.contactEmail ? (
            <>
              {' '}
              ·{' '}
              <a className="underline" href={`mailto:${site.contactEmail}`}>
                {site.contactEmail}
              </a>
            </>
          ) : null}
        </p>
        <p className="text-sm text-muted">개인정보 침해 신고나 상담은 개인정보침해신고센터(국번 없이 118) 등에도 할 수 있어요.</p>
      </Sec>

      <Sec title="7. 바뀔 때">
        <p>이 방침이 바뀌면 앱 안 공지로 알리고, 바뀐 날짜를 이 문서 위에 적어요.</p>
      </Sec>
    </LegalPage>
  );
}

type Transfer = { name: string; where: string; contact: ReactNode; job: string; items: string; keep: string };

/** 처리를 맡기는 곳 (국외 이전: 받는 곳·나라·연락처·맡기는 일·옮기는 정보·보관 기간). 새 회사를 쓰면 여기에 더한다 */
function transfers(): Transfer[] {
  return [
    {
      name: 'Supabase, Inc.',
      where: '미국',
      contact: 'privacy@supabase.com',
      job: '로그인, 데이터베이스, 파일 저장 (데이터는 서울 지역 서버에 저장)',
      items: '위 1번의 정보 모두',
      keep: '탈퇴할 때까지',
    },
    {
      name: 'Vercel Inc.',
      where: '미국',
      contact: 'privacy@vercel.com',
      job: '웹사이트와 서버 실행 (서울 지역)',
      items: '요청 내용, 접속 기록(IP 주소, 브라우저 정보)',
      keep: '요청을 처리하는 동안, 서버 로그는 짧은 기간',
    },
    {
      name: 'Anthropic PBC',
      where: '미국',
      contact: 'privacy@anthropic.com',
      job: 'AI(Claude)로 정리·문제·채점·채팅 답·레슨·표지 그림·테마 만들기',
      items:
        '넣은 공부 자료(글, PDF, 사진, 문서에서 꺼낸 그림)와 노트 내용, 채팅에 보낸 말과 사진·파일, 테마 부탁 글 (이메일·이름 같은 계정 정보는 보내지 않아요)',
      keep: '받은 뒤 30일 안에 지워요 (이용 정책 위반으로 표시된 것은 최대 2년)',
    },
    {
      name: 'Cloudflare, Inc.',
      where: '미국',
      contact: 'privacyquestions@cloudflare.com',
      job: 'AI 테마의 배경 그림 그리기 (Workers AI)',
      items: 'AI가 내 부탁 글로 만든 그림 설명(영어 글)만',
      keep: '그림을 만드는 동안만 (저장하거나 AI 학습에 쓰지 않아요)',
    },
    {
      name: 'Google LLC',
      where: '미국',
      contact: (
        <a className="underline" href="https://support.google.com/policies/contact/general_privacy_form">
          개인정보 문의 양식
        </a>
      ),
      job: '구글 로그인',
      items: '구글로 로그인할 때 로그인 요청',
      keep: '구글의 개인정보처리방침에 따라',
    },
    ...(KAKAO_LOGIN
      ? [
          {
            name: '(주)카카오',
            where: '대한민국',
            contact: null,
            job: '카카오 로그인',
            items: '카카오로 로그인할 때 로그인 요청',
            keep: '카카오의 개인정보처리방침에 따라',
          },
        ]
      : []),
    ...(APPLE_LOGIN
      ? [
          {
            name: 'Apple Inc.',
            where: '미국',
            contact: null,
            job: 'Apple 로그인',
            items: 'Apple로 로그인할 때 로그인 요청',
            keep: 'Apple의 개인정보처리방침에 따라',
          },
        ]
      : []),
  ];
}
