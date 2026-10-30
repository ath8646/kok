import type { Metadata } from 'next';
import { LegalPage, Sec } from '@/components/LegalPage';

export const metadata: Metadata = { title: 'AI 사용 안내' };

export default function AiGuidePage() {
  return (
    <LegalPage title="AI 사용 안내" updated="2026년 10월 30일">
      <p>
        KOK에서 정리 노트, 그림, 문제, 단답형 채점, 채팅 답, 레슨, 표지 그림은 사람이 아니라 생성형 AI(Anthropic의 Claude)가 만들어요. AI 테마의 배경 그림은
        Cloudflare의 그림 AI가 그려요. 채팅에서 답하는 것도 사람이 아니라 AI예요. 안심하고 쓰려면 아래를 꼭 기억해 주세요.
      </p>
      <Sec title="AI는 틀릴 수 있어요">
        <ul className="list-disc pl-5">
          <li>중요한 내용은 원본과 비교해 확인해 주세요. 정리와 문제에는 출처 쪽이 붙어요.</li>
          <li>AI는 문제를 만든 뒤 스스로 한 번 더 검사하지만, 그래도 실수가 있을 수 있어요.</li>
          <li>내가 고친 부분은 잠겨서, AI가 다시 만들어도 덮어쓰지 않아요.</li>
        </ul>
      </Sec>
      <Sec title="AI가 만든 것에는 표시가 붙어요">
        <ul className="list-disc pl-5">
          <li>
            노트 위의 &lsquo;AI 정리&rsquo;, 채팅의 &lsquo;AI 답&rsquo;, 레슨의 &lsquo;AI가 만든 레슨&rsquo;, 표지 그림과 AI 테마 그림의 AI 표시처럼 AI가 만든
            것을 알 수 있게 해요.
          </li>
          <li>내려받는 요약 PDF에는 쪽마다 &lsquo;AI 정리&rsquo;가 적히고, 파일 정보에도 AI가 만든 내용이라고 남겨요.</li>
          <li>직접 만든 빈 노트처럼 내가 쓴 것에는 AI 표시를 붙이지 않아요.</li>
        </ul>
      </Sec>
      <Sec title="이상하면 &lsquo;이상해요&rsquo;로 알려 주세요">
        <ul className="list-disc pl-5">
          <li>문제, 노트, 채팅 답, 표지 그림, 레슨, AI 테마 그림 어디서나 &lsquo;이상해요&rsquo;를 눌러 틀리거나 불쾌한 내용을 알릴 수 있어요.</li>
          <li>신고하면 고른 이유와 신고할 때 본 AI 결과가 운영자에게 가요. 운영자가 확인하고, 문제는 쉬게 하거나 AI 지시를 고쳐요.</li>
          <li>문제를 신고하면 AI가 고친 문제를 바로 제안해서, 내가 골라 바꿀 수 있어요.</li>
        </ul>
      </Sec>
      <Sec title="개인정보는 올리지 마세요">
        <ul className="list-disc pl-5">
          <li>넣은 자료와 채팅에 보낸 말은 AI가 처리하도록 서버를 거쳐 Anthropic으로 전송돼요. 자세한 것은 개인정보처리방침에 있어요.</li>
          <li>자료에 다른 사람의 이름, 전화번호, 주소 같은 개인정보가 있으면 지우고 올려 주세요.</li>
          <li>공부와 상관없는 민감한 내용은 넣지 마세요.</li>
        </ul>
      </Sec>
      <Sec title="공부를 대신하지 않아요">
        <ul className="list-disc pl-5">
          <li>KOK은 준비(정리, 문제 만들기, 복습 일정)를 AI가 맡고, 외우는 것은 내가 하는 앱이에요.</li>
          <li>숙제나 수행평가를 대신 써 주는 기능은 없어요.</li>
          <li>오래 붙잡지 않아요. 오늘 할 복습이 끝나면 &lsquo;오늘 할 일 끝&rsquo; 화면을 보여 줘요.</li>
        </ul>
      </Sec>
      <Sec title="AI 에너지">
        <ul className="list-disc pl-5">
          <li>AI를 쓰면 실제 비용만큼 에너지가 빠져요. 1 에너지는 약 0.001달러(약 1.4원)예요.</li>
          <li>작업 전에 예상 에너지를 보여 주고, 끝난 뒤 실제로 쓴 만큼만 빼요. 처리에 실패하면 돌려줘요.</li>
          <li>무료는 하루 20 에너지, Pro는 한 달 2,000 에너지(하루 최대 300)예요. 운영 상황에 따라 바뀔 수 있어요.</li>
        </ul>
      </Sec>
      <Sec title="학생을 지키는 장치">
        <p>KOK은 학생이 쓰는 공부 앱이라, AI를 쓰는 곳마다 아래 장치를 두었어요.</p>
        <ul className="list-disc pl-5">
          <li>
            AI에게 공부 내용만 다루고, 자료에 숨은 지시를 따르지 않으며, 학생에게 맞지 않는 내용(성적인 내용·폭력·혐오 표현 등)은 자료가 시켜도 만들지 않도록
            지시해 두었어요.
          </li>
          <li>AI 테마 그림은 사람·글자·캐릭터 없이 풍경과 무늬로만 그리게 해요.</li>
          <li>AI 사용량에는 하루 한도가 있고, 오늘 할 복습이 끝나면 그만해도 된다고 알려 줘요.</li>
          <li>AI 결과마다 &lsquo;이상해요&rsquo; 신고가 있고, 운영자가 신고를 확인해요. 운영 규칙을 어기는 계정은 AI 기능을 막을 수 있어요.</li>
          <li>
            Anthropic의 이용 정책과 미성년자 이용 지침(AI라는 것을 알리기, 맞지 않는 내용 거르기, 살펴보고 신고받기, 안전하게 쓰는 법 안내)과 한국의 개인정보
            보호법·인공지능기본법을 지키려고 노력해요.
          </li>
        </ul>
      </Sec>
    </LegalPage>
  );
}
