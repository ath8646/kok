"""첫 화면(/)에 넣는 앱 화면 캡처 만들기: 데이터베이스를 비우고 학생 노트 둘(광합성 정리 노트, 시험지 모양 서술형 문제)을 만든 뒤
밝은 화면·어두운 화면에서 2배 해상도로 찍어 public/landing/{exam,note}-{light,dark}.webp 에 둔다.
사용: python3 landing_shots.py  (앱: localhost:3000, 가짜 백엔드: localhost:54321). 앱 화면이 바뀌어 첫 화면 그림이 낡으면 다시 찍는다.
next start 는 빌드할 때 있던 public 파일만 내보내서, 새로 찍었으면 다시 빌드해야 첫 화면에 보인다.
그림 크기가 바뀌면 src/app/page.tsx 의 SHOTS 크기도 고친다 (끝에 화면 크기(CSS px)를 알려 준다).
"""
import asyncio, io, json, pathlib, subprocess, sys, uuid

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import e2e  # noqa: E402
from PIL import Image  # noqa: E402
from playwright.async_api import async_playwright, expect  # noqa: E402

HERE = pathlib.Path(__file__).parent
OUT = HERE.parents[1] / "public" / "landing"
STUDENT = e2e.USERS["student"][0]
SCALE = 2
# 캡처에 들어가지 않게: 아래 메뉴·떠 있는 버튼
HIDE = ".kok-tabbar, .kok-fab { visibility: hidden !important; }"
NOTE_TEXT = "광합성 정리. 광합성은 식물이 빛을 받아 물과 이산화탄소로 포도당과 산소를 만드는 과정이다. 엽록체에서 일어난다."


async def open_ctx(browser, scheme):
    # 손가락 기기처럼 (답안 칸 안내에 'Ctrl + Enter' 가 붙지 않게)
    ctx = await browser.new_context(
        viewport={"width": 390, "height": 844}, color_scheme=scheme, device_scale_factor=SCALE, locale="ko-KR", has_touch=True, is_mobile=True
    )
    uid, email = e2e.USERS["student"]
    await ctx.add_cookies([e2e.session_cookie(uid, email)])
    return ctx, await ctx.new_page()


async def seed(browser):
    subprocess.run(["bash", str(HERE / "db.sh"), "reset"], check=True)
    e2e.db(f"update public.profiles set nickname = '학생', consented_at = now() where id = '{STUDENT}'")
    subject = e2e.db(f"insert into public.subjects (user_id, name, color) values ('{STUDENT}', '과학', 'green') returning id").splitlines()[0]
    ctx, page = await open_ctx(browser, "light")
    await page.goto(e2e.BASE + "/home")
    # 정리 노트 (가짜 AI 는 광합성 노트를 만든다)
    sid = str(uuid.uuid4())
    r = await page.request.post(e2e.BASE + "/api/sources", headers={"origin": e2e.BASE}, data={"id": sid, "subjectId": subject, "kind": "text", "title": "", "text": NOTE_TEXT})
    assert r.ok, await r.text()
    await e2e.poll_db(f"select status from public.sources where id = '{sid}'", "ready", timeout=120)
    # 시험지 모양 서술형 문제 (e2e 의 시험지 문제와 같은 글)
    r = await page.request.post(e2e.BASE + "/api/notes/blank", headers={"origin": e2e.BASE}, data={"subjectId": subject, "title": "항상성 학습지"})
    assert r.ok, await r.text()
    xsid = e2e.db(f"select id from public.sources where user_id = '{STUDENT}' and title = '항상성 학습지' order by created_at desc limit 1")
    xnid = e2e.db(f"select id from public.notes where source_id = '{xsid}'")
    answer = json.dumps(e2e.EXAM_A1, ensure_ascii=False)
    qid = e2e.db(
        "insert into public.questions (user_id, note_id, subject_id, type, prompt, choices, answer, explanation, created_by) values "
        f"('{STUDENT}', '{xnid}', '{subject}', 'short', $q${e2e.EXAM_Q1}$q$, null, $a${answer}$a$::jsonb, $e$두 과정 모두 시상 하부가 조절해요.$e$, 'ai') returning id"
    ).splitlines()[0]
    e2e.db(f"insert into public.cards (question_id, user_id, subject_id) values ('{qid}', '{STUDENT}', '{subject}')")
    await ctx.close()
    return sid, xsid


def save(png: bytes, name: str):
    im = Image.open(io.BytesIO(png)).convert("RGB")
    im.save(OUT / f"{name}.webp", "WEBP", quality=84, method=6)
    return im.size


async def settle(page):
    await page.add_style_tag(content=HIDE)
    await page.evaluate("document.fonts.ready")
    await page.wait_for_timeout(900)


async def shoot(browser, scheme, sid, xsid):
    sizes = {}
    ctx, page = await open_ctx(browser, scheme)
    # 정리 노트: 제목부터 한 줄 요약까지 (화면 위 720px)
    await page.goto(e2e.BASE + f"/notes/{sid}")
    await expect(page.get_by_text("한 줄 요약")).to_be_visible(timeout=30000)
    await settle(page)
    sizes["note"] = save(await page.screenshot(clip={"x": 0, "y": 0, "width": 390, "height": 720}), f"note-{scheme}")
    # 시험지 문제: 문제지 카드만 (지문 상자·발문·답안 칸)
    await page.goto(e2e.BASE + f"/notes/{xsid}/practice")
    card = page.locator(".kok-card").filter(has=page.locator(".kok-exam-stem")).first
    await expect(card).to_be_visible(timeout=30000)
    await settle(page)
    sizes["exam"] = save(await card.screenshot(), f"exam-{scheme}")
    await ctx.close()
    return sizes


async def main():
    OUT.mkdir(parents=True, exist_ok=True)
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        sid, xsid = await seed(browser)
        for scheme in ("light", "dark"):
            sizes = await shoot(browser, scheme, sid, xsid)
            print(scheme, {k: (w // SCALE, h // SCALE) for k, (w, h) in sizes.items()}, flush=True)
        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
