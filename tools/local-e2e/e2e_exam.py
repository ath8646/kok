"""문제를 실제 시험지처럼 (과목마다 모양), 풀기의 채점 띠, 문제 신고 검사, 선택 해제만 따로 (데이터베이스를 비우고 e2e.exam_steps).
사용: python3 e2e_exam.py  (앱: localhost:3000, 가짜 백엔드: localhost:54321)
"""
import asyncio, pathlib, subprocess, sys

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import e2e  # noqa: E402
from playwright.async_api import async_playwright  # noqa: E402


async def main():
    subprocess.run(["bash", str(pathlib.Path(__file__).parent / "db.sh"), "reset"], check=True)
    student = e2e.USERS["student"][0]
    e2e.db(f"update public.profiles set nickname = '학생', consented_at = now() where id = '{student}'")
    e2e.db(f"insert into public.subjects (user_id, name, color) values ('{student}', '과학', '#22c55e')")
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        await e2e.exam_steps(browser)
        await browser.close()
    print("\nSTEPS OK:", len(e2e.STEPS))
    if e2e.ERRORS:
        print("\n".join(e2e.ERRORS[:20]))


if __name__ == "__main__":
    asyncio.run(main())
