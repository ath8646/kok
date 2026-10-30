"""시그니처 테마 화면 모아 찍기 (눈으로 다듬을 때): 데이터베이스를 비우고 학생 노트 몇 개(과목 셋, 표지 그림 넷)를 만든 뒤,
테마마다 홈·자료함·노트(정리·마인드맵·문제)·복습·오답·설정·자료 넣기 창을 폰(390)·넓은 화면(1280)으로 찍는다.
사용: python3 skin_shots.py [테마 …] [--keep] [--css 파일] [--pages home,library,…] [--widths 390,1280]
  (앱: localhost:3000, 가짜 백엔드: localhost:54321)  → skin-shots/<테마>-<폭>-<화면>.png
테마 이름: default(기본 KOK) neon glitch synthwave terminal brutal sketch. 이름이 없으면 모두.
--keep: 데이터베이스를 비우지 않고 지난번 노트로 찍는다. --css: 빌드하지 않고 CSS 를 덧붙여 본다 (다듬는 동안).
"""
import argparse, asyncio, json, pathlib, subprocess, sys, uuid

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import e2e  # noqa: E402
from playwright.async_api import async_playwright, expect  # noqa: E402

OUT = pathlib.Path(__file__).parent / "skin-shots"
SKINS = ["default", "neon", "glitch", "synthwave", "terminal", "brutal", "sketch"]
STUDENT = e2e.USERS["student"][0]

# 과목, 제목, 글 (가짜 AI 는 늘 광합성 노트를 만든다: 제목·표지만 바꿔 자료함을 그럴듯하게)
NOTES = [
    ("과학", "광합성의 원리", "광합성 정리. 광합성은 식물이 빛을 받아 물과 이산화탄소로 포도당과 산소를 만드는 과정이다. 엽록체에서 일어난다."),
    ("과학", "세포 호흡과 에너지", "세포 호흡 정리. 미토콘드리아에서 포도당을 분해해 에너지를 얻는다. 산소를 쓰고 이산화탄소를 내놓는다."),
    ("한국사", "조선 전기의 정치", "조선 건국 1392, 훈민정음 반포 1446, 임진왜란 1592, 병자호란 1636. 조선 전기의 큰 사건들."),
    ("수학", "이차함수의 그래프", "이차함수 y = x^2 - 2x 의 그래프는 아래로 볼록하고 꼭짓점은 (1, -1) 이다. 축은 x = 1 이다."),
]
COVERS = [
    {"v": 2, "kind": "flow", "items": [{"text": "빛 흡수"}, {"text": "물 분해"}, {"text": "ATP 생성"}, {"text": "포도당 합성", "key": True}], "alt": "광합성의 흐름"},
    {
        "v": 2,
        "kind": "compare",
        "left": "광합성",
        "right": "세포 호흡",
        "items": [{"text": "엽록체", "side": "left"}, {"text": "에너지 저장", "side": "left"}, {"text": "미토콘드리아", "side": "right"}, {"text": "에너지 방출", "side": "right"}],
        "alt": "광합성과 세포 호흡 비교",
    },
    {
        "v": 2,
        "kind": "timeline",
        "items": [{"text": "조선 건국", "sub": "1392"}, {"text": "훈민정음 반포", "sub": "1446"}, {"text": "임진왜란", "sub": "1592", "key": True}, {"text": "병자호란", "sub": "1636"}],
        "alt": "조선 전기 연표",
    },
    {"v": 2, "kind": "formula", "title": "y = x^2 - 2x", "items": [{"text": "x", "sub": "변수"}, {"text": "y", "sub": "함숫값"}], "alt": "이차함수 식"},
]
SUBJECT_COLORS = {"과학": "green", "한국사": "orange", "수학": "blue"}


def theme_for(skin: str) -> str:
    if skin == "default":
        return json.dumps({"light": "preset:default", "dark": "preset:default", "color": "default"})
    return json.dumps({"light": f"skin:{skin}", "dark": f"skin:{skin}", "color": "default"})


async def seed(browser) -> str:
    subprocess.run(["bash", str(pathlib.Path(__file__).parent / "db.sh"), "reset"], check=True)
    e2e.db(f"update public.profiles set nickname = '학생', consented_at = now(), plan = 'pro', pro_until = now() + interval '30 days' where id = '{STUDENT}'")
    subjects = {}
    for name, color in SUBJECT_COLORS.items():
        subjects[name] = e2e.db(f"insert into public.subjects (user_id, name, color) values ('{STUDENT}', '{name}', '{color}') returning id").splitlines()[0]
    ctx, page = await e2e.new_ctx(browser, "student")
    await page.goto(e2e.BASE + "/home")
    ids = []
    for subject, title, text in NOTES:
        sid = str(uuid.uuid4())
        r = await page.request.post(e2e.BASE + "/api/sources", headers={"origin": e2e.BASE}, data={"id": sid, "subjectId": subjects[subject], "kind": "text", "title": "", "text": text})
        assert r.ok, await r.text()
        ids.append((sid, title))
        # 한 번에 정리하는 자료 수에 한도가 있어서 하나씩
        await e2e.poll_db(f"select status from public.sources where id = '{sid}'", "ready", timeout=120)
    for (sid, title), cover in zip(ids, COVERS):
        e2e.db(f"update public.sources set title = '{title}', cover = '{json.dumps(cover, ensure_ascii=False)}'::jsonb where id = '{sid}'")
    # 하나는 별표, 하나는 복습 끔 (카드 모양이 달라지는 것들)
    e2e.db(f"update public.sources set starred = true where id = '{ids[0][0]}'")
    e2e.db(f"update public.sources set in_review = false where id = '{ids[3][0]}'")
    # 오답노트·연속 기록이 비지 않게: 문제 몇 개를 어제 풀고 틀린 것으로
    e2e.db(
        f"insert into public.review_logs (user_id, question_id, subject_id, rating, correct, reviewed_at) "
        f"select user_id, question_id, subject_id, 1, false, now() - interval '1 day' from public.cards where user_id = '{STUDENT}' limit 4"
    )
    e2e.db(
        f"update public.cards set in_wrong_note = true, last_correct = false, wrong_count = 1, lapses = 1, reps = 1, last_review = now() - interval '1 day' "
        f"where question_id in (select question_id from public.cards where user_id = '{STUDENT}' limit 4)"
    )
    await ctx.close()
    return ids[0][0]


EXTRA_CSS = ""


async def settle(page, skin):
    want = "" if skin == "default" else skin
    await page.wait_for_function("(s) => (document.documentElement.dataset.skin || '') === s", arg=want, timeout=15000)
    if EXTRA_CSS:
        await page.add_style_tag(content=EXTRA_CSS)
    await page.wait_for_timeout(900)


async def shoot(browser, skin, width, note_id, pages):
    tag = "phone" if width < 700 else "wide"
    ctx, page = await e2e.new_ctx(browser, "student", width=width, scheme="dark" if skin in ("neon", "glitch", "synthwave", "terminal") else "light")
    name = lambda s: str(OUT / f"{skin}-{tag}-{s}.png")  # noqa: E731
    full = width < 700
    want = lambda p: p in pages  # noqa: E731
    if want("home"):
        await page.goto(e2e.BASE + "/home")
        await expect(page.locator("h1").first).to_be_visible(timeout=30000)
        await settle(page, skin)
        await page.screenshot(path=name("1-home"), full_page=full)
    if want("library"):
        await page.goto(e2e.BASE + "/library")
        await expect(page.locator("[data-flip]").first).to_be_visible(timeout=30000)
        await settle(page, skin)
        await page.screenshot(path=name("2-library"), full_page=full)
    if want("note"):
        await page.goto(e2e.BASE + f"/notes/{note_id}")
        await expect(page.get_by_role("tab", name="정리")).to_be_visible(timeout=30000)
        await settle(page, skin)
        await page.screenshot(path=name("3-note"), full_page=False)
        await page.mouse.wheel(0, 900)
        await page.wait_for_timeout(500)
        await page.screenshot(path=name("3-note-b"), full_page=False)
        for label, fname in (("그림", "4-map"), ("문제", "5-questions")):
            t = page.get_by_role("tab", name=label)
            if await t.count():
                await t.first.click()
                await page.wait_for_timeout(900)
                await page.screenshot(path=name(fname), full_page=False)
    if want("practice"):
        await page.goto(e2e.BASE + f"/notes/{note_id}/practice")
        await page.wait_for_timeout(1500)
        await settle(page, skin)
        await page.screenshot(path=name("6-practice"), full_page=False)
        # 하나 골라 채점된 모습도
        opt = page.locator("[data-choice], [role=radio]").first
        if await opt.count():
            await opt.click()
            await page.wait_for_timeout(900)
            await page.screenshot(path=name("6-practice-b"), full_page=False)
    for key, url, fname in (("review", "/review", "7-review"), ("wrong", "/wrong", "8-wrong")):
        if want(key):
            await page.goto(e2e.BASE + url)
            await page.wait_for_timeout(1500)
            await settle(page, skin)
            await page.screenshot(path=name(fname), full_page=full)
    if want("settings"):
        await page.goto(e2e.BASE + "/settings")
        await page.wait_for_timeout(1500)
        await settle(page, skin)
        await page.screenshot(path=name("9-settings"), full_page=False)
        await page.mouse.wheel(0, 700)
        await page.wait_for_timeout(500)
        await page.screenshot(path=name("9-settings-b"), full_page=False)
    if want("compose"):
        await page.goto(e2e.BASE + "/library?compose=1")
        await page.wait_for_timeout(1500)
        await settle(page, skin)
        await page.screenshot(path=name("10-compose"), full_page=False)
    await ctx.close()


PAGES = ["home", "library", "note", "practice", "review", "wrong", "settings", "compose"]


async def main():
    global EXTRA_CSS
    ap = argparse.ArgumentParser()
    ap.add_argument("skins", nargs="*")
    ap.add_argument("--keep", action="store_true")
    ap.add_argument("--css")
    ap.add_argument("--pages", default=",".join(PAGES))
    ap.add_argument("--widths", default="390,1280")
    a = ap.parse_args()
    want = [s for s in a.skins if s in SKINS] or SKINS
    if a.css:
        EXTRA_CSS = pathlib.Path(a.css).read_text()
    pages = a.pages.split(",")
    OUT.mkdir(exist_ok=True)
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        if a.keep:
            note_id = e2e.db(f"select id from public.sources where user_id = '{STUDENT}' and starred order by created_at limit 1")
        else:
            note_id = await seed(browser)
        for skin in want:
            e2e.db(f"update public.profiles set settings = jsonb_set(coalesce(settings, '{{}}'::jsonb), '{{theme}}', '{theme_for(skin)}'::jsonb) where id = '{STUDENT}'")
            for width in (int(w) for w in a.widths.split(",")):
                await shoot(browser, skin, width, note_id, pages)
            print("·", skin, flush=True)
        await browser.close()
    errs = [e for e in e2e.ERRORS if "HTTP 404" not in e]
    print("\n".join(errs[:20]) if errs else "no console/page errors")


if __name__ == "__main__":
    asyncio.run(main())
