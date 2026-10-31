'use client';
// 터미널 (시그니처 테마 '터미널'의 숨은 화면): 홈 위의 터미널 아이콘으로 들어온다.
// 다른 테마에서는 안내만 (터미널 테마를 고르면 열린다)
import { useEffect, useSyncExternalStore } from 'react';
import { useMe } from '@/components/AppShell';
import { Terminal } from '@/components/terminal/Terminal';
import { EmptyState, ICONS, Icon, LinkButton } from '@/components/ui';
import { perkNeed } from '@/lib/plans';

/** <html data-skin> (테마가 바뀌면 다시 읽는다) */
function subscribeSkin(fn: () => void): () => void {
  const mo = new MutationObserver(fn);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-skin'] });
  return () => mo.disconnect();
}
const readSkin = () => document.documentElement.getAttribute('data-skin');

export default function TerminalPage() {
  const { me, refresh, setFocus } = useMe();
  const skin = useSyncExternalStore(subscribeSkin, readSkin, () => null);
  const open = skin === 'terminal';

  // 터미널은 아래 메뉴·위 빛 없이 화면 가득 (집중 모드)
  useEffect(() => {
    if (!open) return;
    setFocus(true);
    return () => setFocus(false);
  }, [open, setFocus]);

  if (!me) return null;
  if (!open) {
    return (
      <div className="grid gap-3 pt-10">
        <EmptyState
          icon={<Icon d={ICONS.terminal} size={34} />}
          title="터미널 테마에서 열려요"
          body={
            me.canSkins
              ? "설정 > 테마에서 시그니처 테마 '터미널'을 고르면 홈 위에 터미널 아이콘이 생겨요."
              : `${perkNeed(me.perkTiers, 'skins', '시그니처 테마')} '터미널'을 고르면 홈 위에 터미널 아이콘이 생겨요.`
          }
          action={
            me.canSkins ? (
              <LinkButton href="/settings#skins" variant="secondary">
                테마 고르러 가기
              </LinkButton>
            ) : (
              <LinkButton href="/plan" variant="secondary">
                요금제 보기
              </LinkButton>
            )
          }
        />
      </div>
    );
  }
  return <Terminal me={me} refreshMe={refresh} />;
}
