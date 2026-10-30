// 계정 삭제 안내 (로그인하지 않아도 열린다): 앱을 다시 설치하지 않고도 계정과 데이터를 지우는 방법.
// Google Play 데이터 보안 양식의 '계정 삭제 웹 주소'로 이 페이지를 적는다.
import type { Metadata } from 'next';
import { LegalPage, Sec } from '@/components/LegalPage';
import { LinkButton } from '@/components/ui';
import { getSiteInfo } from '@/lib/server/site';

export const metadata: Metadata = { title: '계정 삭제', description: 'KOK 계정과 모든 공부 데이터를 지우는 방법' };
export const revalidate = 300;

export default async function DeleteAccountPage() {
  const site = await getSiteInfo();
  return (
    <LegalPage title="계정 삭제" updated="2026년 10월 30일">
      <p>KOK 계정과 모든 공부 데이터는 언제든 직접 지울 수 있어요. 앱을 다시 설치하지 않아도 이 페이지에서 시작할 수 있어요.</p>

      <Sec title="1. 바로 지우기">
        <ol className="list-decimal pl-5">
          <li>KOK에 로그인해요 (앱이나 웹 모두 같아요).</li>
          <li>
            <b>설정 → 내 데이터 → 탈퇴하기</b>를 눌러요.
          </li>
          <li>
            확인 칸에 <b>탈퇴</b>라고 적고 <b>모든 데이터 지우고 탈퇴</b>를 눌러요.
          </li>
        </ol>
        {/* 로그인하지 않았으면 로그인한 뒤 이 자리로 돌아온다 (주소의 ?값은 로그인 뒤에도 남는다) */}
        <LinkButton href="/settings?delete=1" variant="danger" size="lg" className="justify-self-start">
          로그인하고 계정 지우기
        </LinkButton>
        <p className="text-sm text-muted">지우기 전에 같은 곳의 &lsquo;내 데이터 내려받기&rsquo;로 내 기록을 받아 둘 수 있어요.</p>
      </Sec>

      <Sec title="2. 지워지는 것과 남는 것">
        <ul className="list-disc pl-5">
          <li>
            <b>바로 모두 지워져요</b>: 계정, 과목, 올린 자료와 파일, 노트·그림·문제, 복습 기록, 채팅과 붙인 파일, 요약 PDF, 내가 만든 테마와 배경 그림, 설정.
          </li>
          <li>
            <b>남는 것</b>: AI 비용 기록(작업 종류, 토큰 수, 비용)은 누구 것인지 알 수 없게 바꿔서 비용 관리를 위해 남겨요. 탈퇴하고 바로 다시 가입해 무료
            에너지를 또 받는 것을 막으려고, 이메일과 로그인 계정 번호를 알아볼 수 없게 바꾼 값과 탈퇴 시각을 2일 동안만 보관해요.
          </li>
          <li>지금은 KOK 안에서 돈을 받지 않아서, 탈퇴하기 전에 따로 해지할 구독은 없어요.</li>
          <li>지운 데이터는 되살릴 수 없어요.</li>
        </ul>
      </Sec>

      <Sec title="3. 로그인할 수 없을 때">
        {site.contactEmail ? (
          <p>
            로그인한 계정(구글·카카오)의 이메일을 적어{' '}
            <a className="font-semibold underline" href={`mailto:${site.contactEmail}?subject=${encodeURIComponent('KOK 계정 삭제 요청')}`}>
              {site.contactEmail}
            </a>
            로 보내 주세요. 본인 계정인지 확인한 뒤 지우고, 지웠다고 메일로 알려 드려요.
          </p>
        ) : (
          <p>
            <a className="font-semibold underline" href="/privacy">
              개인정보처리방침
            </a>
            의 개인정보 보호책임자 연락처로 로그인한 계정을 알려 주세요. 본인 계정인지 확인한 뒤 지우고 알려 드려요.
          </p>
        )}
      </Sec>
    </LegalPage>
  );
}
