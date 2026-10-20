"""자료 그림 시험만 따로 (데이터베이스를 비우고 학생(Pro)·친구(무료)를 바로 만든 뒤 e2e.figure_steps).
사용: python3 e2e_figs.py  (앱: localhost:3000, 가짜 백엔드: localhost:54321)
"""
import asyncio, pathlib, subprocess, sys

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import e2e  # noqa: E402
from playwright.async_api import async_playwright  # noqa: E402


async def main():
    subprocess.run(["bash", str(pathlib.Path(__file__).parent / "db.sh"), "reset"], check=True)
    student, other = e2e.USERS["student"][0], e2e.USERS["other"][0]
    e2e.db(f"update public.profiles set nickname = '학생', consented_at = now(), plan = 'pro', pro_until = now() + interval '30 days' where id = '{student}'")
    e2e.db(f"update public.profiles set nickname = '친구', consented_at = now() where id = '{other}'")
    for uid in (student, other):
        e2e.db(f"insert into public.subjects (user_id, name, color) values ('{uid}', '한국사', '#3b82f6')")
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        await e2e.figure_steps(browser)
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
