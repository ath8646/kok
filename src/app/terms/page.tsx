import type { Metadata } from 'next';
import { LegalPage, Sec } from '@/components/LegalPage';
import { APPLE_LOGIN } from '@/lib/login';

export const metadata: Metadata = { title: '이용약관' };

export default function TermsPage() {
  return (
    <LegalPage title="이용약관" updated="2026년 10월 18일">
      <Sec title="1. 목적">
        <p>이 약관은 공부 앱 &lsquo;콕&rsquo;(이하 &lsquo;서비스&rsquo;)을 쓰는 데 필요한 운영자와 이용자의 권리, 의무, 책임을 정해요.</p>
      </Sec>
      <Sec title="2. 가입과 계정">
        <ul className="list-disc pl-5">
          <li>{APPLE_LOGIN ? '구글 계정이나 Apple 계정' : '구글 계정'}으로 가입하고, 약관·개인정보처리방침·AI 사용 안내에 동의하면 쓸 수 있어요.</li>
          <li>닉네임은 실명이 아니어도 돼요. 다른 사람을 흉내 내거나 불쾌한 닉네임은 쓸 수 없어요.</li>
          <li>계정은 본인만 써야 하고, 다른 사람에게 빌려주거나 팔 수 없어요.</li>
        </ul>
      </Sec>
      <Sec title="3. 서비스 내용">
        <ul className="list-disc pl-5">
          <li>이용자가 넣은 공부 자료를 AI가 정리 노트·그림(마인드맵·표·연표)·문제로 바꾸고, 복습 일정을 계산해 줘요.</li>
          <li>
            AI 기능은 &lsquo;에너지&rsquo; 안에서 쓸 수 있어요. 무료 요금제는 하루, Pro 요금제는 한 달 단위로 한도가 정해지고, 한도는 운영 상황에 따라 바뀔 수
            있어요.
          </li>
          <li>복습, 오답노트, 직접 만든 문제, 마인드맵 고치기처럼 AI 비용이 들지 않는 기능은 한도 없이 쓸 수 있어요.</li>
          <li>결제 기능이 열리기 전에는 운영자가 나눠 주는 쿠폰으로 Pro를 켤 수 있어요.</li>
        </ul>
      </Sec>
      <Sec title="4. AI가 만든 결과물">
        <ul className="list-disc pl-5">
          <li>AI가 만든 정리·그림·문제·채점은 공부를 돕는 참고 자료예요. 틀린 내용이 있을 수 있으니 원본과 비교해 확인해 주세요.</li>
          <li>운영자는 AI 결과물이 정확하거나 시험 결과를 보장한다고 약속하지 않아요. 이상한 내용은 &lsquo;이상해요&rsquo;로 알려 주세요.</li>
        </ul>
      </Sec>
      <Sec title="5. 이용자가 지킬 것">
        <ul className="list-disc pl-5">
          <li>다른 사람의 개인정보(이름, 전화번호 등)가 들어 있는 자료는 그 부분을 지우고 올려 주세요.</li>
          <li>저작권을 가진 사람이 허락하지 않은 방법으로 자료를 퍼뜨리는 데 콕을 쓰면 안 돼요. 올린 원본은 본인만 볼 수 있어요.</li>
          <li>불법이거나 학생에게 맞지 않는 내용, 다른 사람을 괴롭히는 내용을 올리면 안 돼요.</li>
          <li>자동 프로그램으로 대량 요청을 보내거나, 한도를 피하려고 여러 계정을 만드는 등 서비스를 방해하면 안 돼요.</li>
        </ul>
      </Sec>
      <Sec title="6. 이용자의 자료와 권리">
        <p>
          이용자가 올린 자료와 직접 쓴 글의 권리는 이용자에게 있어요. 운영자는 서비스를 제공하는 데 필요한 범위(저장, AI 처리, 화면에 보여 주기)에서만 자료를
          다뤄요. 탈퇴하면 자료는 모두 지워져요.
        </p>
      </Sec>
      <Sec title="7. 서비스 변경과 중단">
        <ul className="list-disc pl-5">
          <li>운영자는 기능, 한도, 요금제를 바꿀 수 있고, 중요한 변경은 앱 안 공지로 미리 알려요.</li>
          <li>AI 비용이 갑자기 늘거나 장애가 생기면 AI 기능을 잠시 멈출 수 있어요. 이때도 복습은 쓸 수 있어요.</li>
        </ul>
      </Sec>
      <Sec title="8. 이용 제한과 탈퇴">
        <ul className="list-disc pl-5">
          <li>이 약관을 어기면 AI 기능 사용을 멈추거나 계정 이용을 제한할 수 있어요.</li>
          <li>
            이용자는 언제든 설정에서 탈퇴할 수 있고, 탈퇴하면 모든 데이터와 파일이 지워져요. 탈퇴한 날에는 같은 계정으로 다시 가입해도 AI 기능을 쓸 수 없어요.
          </li>
        </ul>
      </Sec>
      <Sec title="9. 책임의 한계">
        <p>
          운영자는 서비스를 안정적으로 제공하려고 노력하지만, 천재지변·외부 서비스 장애 등 운영자가 막을 수 없는 일, 그리고 AI 결과물을 확인하지 않고 써서 생긴
          손해에 대해서는 법이 허용하는 범위에서 책임지지 않아요. 무료로 제공하는 기능도 마찬가지예요.
        </p>
      </Sec>
      <Sec title="10. 준거법과 분쟁">
        <p>이 약관은 대한민국 법을 따르고, 분쟁이 생기면 먼저 서로 대화로 풀도록 노력해요.</p>
      </Sec>
      <p className="text-sm text-muted">이 약관은 2026년 10월 18일부터 적용돼요.</p>
    </LegalPage>
  );
}
