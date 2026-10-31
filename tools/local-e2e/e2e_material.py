"""자료 종류(기출·단어장 …) 시험만 따로 (데이터베이스를 비우고 e2e.material_steps).
사용: python3 e2e_material.py  (앱: localhost:3000, 가짜 백엔드: localhost:54321)
"""
import asyncio, pathlib, subprocess, sys

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import e2e  # noqa: E402
from playwright.async_api import async_playwright  # noqa: E402


async def main():
    subprocess.run(["bash", str(pathlib.Path(__file__).parent / "db.sh"), "reset"], check=True)
    student = e2e.USERS["student"][0]
    # 전체 시험에서 이 단계에 이르면 학생은 Pro 다 (무료 하루 에너지로는 자료 둘을 넉넉히 정리하지 못한다)
    e2e.db(f"update public.profiles set nickname = '학생', consented_at = now(), plan = 'pro', pro_until = now() + interval '30 days' where id = '{student}'")
    e2e.db(f"insert into public.subjects (user_id, name, color) values ('{student}', '과학', '#22c55e')")
    # 관리자 (단어장에 단어장을 더하는 단계: 노트에 자료 더하기는 Pro 혜택)
    admin = e2e.USERS["admin"][0]
    e2e.db(f"update public.profiles set nickname = '운영자', consented_at = now() where id = '{admin}'")
    e2e.db(f"insert into public.subjects (user_id, name, color) values ('{admin}', '수학', '#3b82f6')")
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        await e2e.material_steps(browser)
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
