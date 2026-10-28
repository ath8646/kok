"""탭을 오갈 때의 화면 시험만 따로 (데이터베이스를 비우고 학생 노트 하나를 만든 뒤 e2e.tab_steps).
사용: python3 e2e_tabs.py  (앱: localhost:3000, 가짜 백엔드: localhost:54321)
"""
import asyncio, pathlib, subprocess, sys

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import e2e  # noqa: E402
from playwright.async_api import async_playwright, expect  # noqa: E402

TEXT = "광합성 정리. 광합성은 식물이 빛을 받아 물과 이산화탄소로 포도당과 산소를 만드는 과정이다. 엽록체에서 일어난다. 기공으로 기체가 드나든다."


async def main():
    subprocess.run(["bash", str(pathlib.Path(__file__).parent / "db.sh"), "reset"], check=True)
    student = e2e.USERS["student"][0]
    e2e.db(f"update public.profiles set nickname = '학생', consented_at = now() where id = '{student}'")
    e2e.db(f"insert into public.subjects (user_id, name, color) values ('{student}', '과학', '#22c55e')")
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        # 노트 하나 (가짜 AI 가 정리하고 문제를 만든다)
        ctx, page = await e2e.new_ctx(browser, "student")
        await page.goto(e2e.BASE + "/library?compose=1")
        composer = page.get_by_role("dialog", name="자료 넣기")
        await expect(composer).to_be_visible()
        await composer.get_by_label("공부한 내용").fill(TEXT)
        await composer.get_by_label("공부한 내용").press("Enter")
        await expect(composer).to_be_hidden()
        await e2e.poll_db(f"select count(*) > 0 from public.cards where user_id = '{student}'", "t", timeout=60)
        await e2e.poll_db(f"select string_agg(status, ',') from public.sources where user_id = '{student}'", "ready", timeout=60)
        await ctx.close()
        await e2e.tab_steps(browser)
        await browser.close()
    print("\nSTEPS OK:", len(e2e.STEPS))
    if e2e.ERRORS:
        print("\nERRORS:")
        for e in e2e.ERRORS:
            print(" ", e[:400])
    else:
        print("no console/page errors")


if __name__ == "__main__":
    asyncio.run(main())
