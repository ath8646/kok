"""단계별 학습(듀오링고식 레슨)만 따로 (데이터베이스를 비우고 노트 둘을 만든 뒤 e2e.course_steps).
사용: python3 e2e_course.py  (앱: localhost:3000, 가짜 백엔드: localhost:54321)
"""
import asyncio, pathlib, subprocess, sys, uuid

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import e2e  # noqa: E402
from playwright.async_api import async_playwright  # noqa: E402


async def make_note(page, user_id, text):
    """가짜 AI 로 정리한 글 노트 하나 (끝날 때까지 기다린다)"""
    subject = e2e.db(f"select id from public.subjects where user_id = '{user_id}' order by created_at limit 1")
    sid = str(uuid.uuid4())
    r = await page.request.post(e2e.BASE + "/api/sources", data={"id": sid, "subjectId": subject, "kind": "text", "title": "", "text": text}, headers={"origin": e2e.BASE})
    assert r.ok, await r.text()
    await e2e.poll_db(f"select status from public.sources where id = '{sid}'", "ready", timeout=120)
    return sid


async def main():
    subprocess.run(["bash", str(pathlib.Path(__file__).parent / "db.sh"), "reset"], check=True)
    student = e2e.USERS["student"][0]
    other = e2e.USERS["other"][0]
    # 학생은 Max (레슨 혜택), 다른 사람은 무료
    e2e.db(f"update public.profiles set nickname = '학생', consented_at = now(), plan = 'pro', pro_until = now() + interval '30 days', max_until = now() + interval '30 days' where id = '{student}'")
    e2e.db(f"update public.profiles set nickname = '다른사람', consented_at = now() where id = '{other}'")
    for uid in (student, other):
        e2e.db(f"insert into public.subjects (user_id, name, color) values ('{uid}', '과학', '#22c55e')")
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        ctx, page = await e2e.new_ctx(browser, "student")
        fig_sid = await make_note(page, student, "그림 풀이 시험 자료. 광합성은 빛 에너지로 물과 이산화탄소에서 포도당과 산소를 만든다. 빛이 셀수록 광합성량이 늘다가 일정해진다.")
        octx, opage = await e2e.new_ctx(browser, "other")
        sid = await make_note(opage, other, "영어 단어 정리. apple 은 사과, banana 는 바나나, cherry 는 체리라는 뜻이다. 과일 이름을 외우자.")
        await octx.close()
        await e2e.course_steps(browser, page, fig_sid, sid)
        await ctx.close()
        await browser.close()
    print("\nSTEPS OK:", len(e2e.STEPS))


if __name__ == "__main__":
    asyncio.run(main())
