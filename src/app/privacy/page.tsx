import type { Metadata } from 'next';
import { LegalPage, Sec } from '@/components/LegalPage';
import { getSiteInfo } from '@/lib/server/site';

export const metadata: Metadata = { title: '개인정보처리방침' };
export const revalidate = 300;

export default async function PrivacyPage() {
  const site = await getSiteInfo();
  return (
    <LegalPage title="개인정보처리방침" updated="2026년 10월 18일">
      <p>콕(이하 &lsquo;서비스&rsquo;)은 공부에 꼭 필요한 정보만 모으고, 이용자가 언제든 내려받거나 지울 수 있게 해요.</p>

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
              <tr className="border-b border-line align-top">
                <td className="py-2 pr-3">
                  Apple로 로그인하면: Apple이 알려 주는 이메일(&lsquo;나의 이메일 가리기&rsquo;를 고르면 Apple이 만든 전달용 주소), 계정 식별 번호, 처음
                  로그인할 때 보내기로 고른 이름
                </td>
                <td className="py-2 pr-3">로그인, 계정 구분, 문의 답변</td>
              </tr>
              <tr className="border-b border-line align-top">
                <td className="py-2 pr-3">닉네임</td>
                <td className="py-2 pr-3">화면에 이름 보여 주기 (실명이 아니어도 돼요)</td>
              </tr>
              <tr className="border-b border-line align-top">
                <td className="py-2 pr-3">올린 공부 자료(PDF, 사진, 글)와 AI가 만든 노트·그림·문제</td>
                <td className="py-2 pr-3">정리·문제 만들기와 보여 주기</td>
              </tr>
              <tr className="border-b border-line align-top">
                <td className="py-2 pr-3">푼 기록(답, 맞았는지, 걸린 시간), 설정</td>
                <td className="py-2 pr-3">복습 일정 계산, 오답노트, 연속 기록</td>
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
        <p>콕은 실명, 생일, 학교, 전화번호를 따로 묻지 않아요. 구글·Apple이 보낸 이름은 로그인 정보에만 남고, 화면에는 직접 정한 닉네임만 보여요.</p>
      </Sec>

      <Sec title="2. 보관 기간과 지우기">
        <ul className="list-disc pl-5">
          <li>탈퇴하면 계정, 자료, 노트, 문제, 기록, 올린 파일을 바로 모두 지워요.</li>
          <li>
            다만 AI 비용 기록(작업 종류, 토큰 수, 비용)은 누구 것인지 알 수 없게 바꿔서 비용 관리를 위해 남겨요. 그리고 탈퇴하고 바로 다시 가입해 무료 에너지를
            또 받는 것을 막으려고, 이메일을 알아볼 수 없게 바꾼 값과 탈퇴 시각을 2일 동안만 보관해요.
          </li>
          <li>무료 요금제에서 올린 원본 파일(PDF, 사진)은 처리 7일 뒤 지워요. 노트·그림·문제는 남아요.</li>
          <li>올렸지만 정리를 시작하지 않은 파일은 하루 안에 지워요.</li>
          <li>서버 로그는 호스팅 회사 정책에 따라 짧은 기간만 보관돼요.</li>
          <li>법령이 보관을 요구하는 정보가 생기면 그 기간 동안만 따로 보관해요.</li>
        </ul>
      </Sec>

      <Sec title="3. 맡기는 곳과 해외 이전">
        <p>서비스를 운영하려고 아래 회사에 정보 처리를 맡겨요. 모두 해외 회사라서, 서비스를 쓰는 동안 인터넷으로 정보가 전송돼요.</p>
        <ul className="list-disc pl-5">
          <li>
            <b>Supabase Inc.</b> (미국) · 로그인, 데이터베이스, 파일 저장 · 데이터는 서울 지역 서버에 저장 · 탈퇴할 때까지
          </li>
          <li>
            <b>Vercel Inc.</b> (미국) · 웹사이트와 서버 실행(서울 지역) · 요청을 처리하는 동안과 짧은 로그 보관 기간
          </li>
          <li>
            <b>Anthropic PBC</b> (미국) · AI(Claude)로 자료 정리·문제 만들기·채점 · 공부 자료와 답이 AI 처리를 위해 전송돼요. Anthropic의 상업용 API 정책에 따라
            처리되고 정해진 기간이 지나면 지워져요.
          </li>
          <li>
            <b>Google LLC</b> (미국) · 구글 로그인 · 구글로 로그인할 때
          </li>
          <li>
            <b>Apple Inc.</b> (미국) · Apple 로그인 · Apple로 로그인할 때
          </li>
        </ul>
        <p>이 밖의 곳에 개인정보를 팔거나 넘기지 않아요. 법에 따른 요청이 있을 때만 예외로 해요.</p>
      </Sec>

      <Sec title="4. 이용자의 권리">
        <ul className="list-disc pl-5">
          <li>설정 &gt; 내 데이터에서 내 정보를 내려받을 수 있어요.</li>
          <li>닉네임, 자료, 노트, 문제는 앱에서 직접 고치거나 지울 수 있어요.</li>
          <li>설정에서 탈퇴하면 모든 정보가 지워져요 (위 2번의 알아볼 수 없게 바꾼 기록은 빼고).</li>
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
