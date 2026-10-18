import type { Metadata } from 'next';
import { LegalPage, Sec } from '@/components/LegalPage';

export const metadata: Metadata = { title: 'AI 사용 안내' };

export default function AiGuidePage() {
  return (
    <LegalPage title="AI 사용 안내" updated="2026년 10월 18일">
      <p>콕에서 정리 노트, 그림, 문제, 단답형 채점은 사람이 아니라 AI(Anthropic의 Claude)가 만들어요. 안심하고 쓰려면 아래를 꼭 기억해 주세요.</p>
      <Sec title="AI는 틀릴 수 있어요">
        <ul className="list-disc pl-5">
          <li>AI가 만든 내용에는 &lsquo;AI&rsquo; 표시와 출처 쪽이 붙어요. 중요한 내용은 원본과 비교해 확인해 주세요.</li>
          <li>AI는 문제를 만든 뒤 스스로 한 번 더 검사하지만, 그래도 실수가 있을 수 있어요.</li>
          <li>이상한 문제나 정리는 &lsquo;이상해요&rsquo;를 눌러 알려 주세요. AI가 고친 문제를 제안하고, 운영자도 확인해요.</li>
          <li>내가 고친 부분은 잠겨서, AI가 다시 만들어도 덮어쓰지 않아요.</li>
        </ul>
      </Sec>
      <Sec title="개인정보는 올리지 마세요">
        <ul className="list-disc pl-5">
          <li>넣은 자료는 AI가 처리하도록 서버를 거쳐 Anthropic으로 전송돼요.</li>
          <li>자료에 다른 사람의 이름, 전화번호, 주소 같은 개인정보가 있으면 지우고 올려 주세요.</li>
          <li>공부와 상관없는 민감한 내용은 넣지 마세요.</li>
        </ul>
      </Sec>
      <Sec title="공부를 대신하지 않아요">
        <ul className="list-disc pl-5">
          <li>콕은 준비(정리, 문제 만들기, 복습 일정)를 AI가 맡고, 외우는 것은 내가 하는 앱이에요.</li>
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
      <Sec title="학생에게 맞지 않는 내용은 만들지 않아요">
        <p>AI에게 공부 내용만 다루고, 자료에 숨은 지시를 따르지 않으며, 학생에게 맞지 않는 내용은 만들지 않도록 지시해 두었어요.</p>
      </Sec>
    </LegalPage>
  );
}
