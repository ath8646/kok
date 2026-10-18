"""콕 v0.1 끝-끝 시험 (가짜 Supabase·Claude + 로컬 Postgres).
사용: python3 e2e.py  (앱: localhost:3000, 가짜 백엔드: localhost:54321)
"""
import asyncio, base64, json, os, pathlib, sys, time, io, re
from playwright.async_api import async_playwright, expect

# 로컬 Postgres 접속 (db.sh 와 같은 기본값)
os.environ.setdefault("PGHOST", "/tmp")
os.environ.setdefault("PGPORT", "54329")
os.environ.setdefault("PGUSER", "postgres")

BASE = os.environ.get("KOK_BASE", "http://localhost:3000")
OUT = pathlib.Path(__file__).parent / "shots"
OUT.mkdir(exist_ok=True)
USERS = {
    "student": ("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "student@example.com"),
    "admin": ("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "admin@example.com"),
    "other": ("cccccccc-cccc-4ccc-8ccc-cccccccccccc", "other@example.com"),
}
ERRORS = []
STEPS = []


def b64u(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).decode().rstrip("=")


def session_cookie(uid, email):
    now = int(time.time())
    header = b64u(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
    payload = b64u(
        json.dumps(
            {"sub": uid, "email": email, "role": "authenticated", "aud": "authenticated", "iat": now, "exp": now + 30 * 86400, "app_metadata": {"provider": "google", "providers": ["google"]}, "is_anonymous": False}
        ).encode()
    )
    token = f"{header}.{payload}.{b64u(b'fake-signature')}"
    sess = {
        "access_token": token,
        "token_type": "bearer",
        "expires_in": 30 * 86400,
        "expires_at": now + 30 * 86400,
        "refresh_token": "fake-refresh",
        "user": {"id": uid, "aud": "authenticated", "role": "authenticated", "email": email, "app_metadata": {"provider": "google"}, "user_metadata": {}, "created_at": "2026-10-18T00:00:00Z"},
    }
    return {"name": "sb-localhost-auth-token", "value": "base64-" + b64u(json.dumps(sess).encode()), "domain": "localhost", "path": "/", "sameSite": "Lax"}


def step(name):
    STEPS.append(name)
    print("·", name, flush=True)


async def new_ctx(browser, who=None, width=390, scheme="light"):
    ctx = await browser.new_context(viewport={"width": width, "height": 860}, color_scheme=scheme, device_scale_factor=1, locale="ko-KR")
    if who:
        uid, email = USERS[who]
        await ctx.add_cookies([session_cookie(uid, email)])
    page = await ctx.new_page()
    tag = f"{who or 'anon'}-{width}"
    page.on("console", lambda m: ERRORS.append(f"[{tag}] console.{m.type}: {m.text}") if m.type == "error" else None)
    page.on("pageerror", lambda e: ERRORS.append(f"[{tag}] pageerror: {e}"))
    page.on("response", lambda r: ERRORS.append(f"[{tag}] HTTP {r.status} {r.request.method} {r.url[:160]}") if r.status >= 400 and r.status != 401 else None)
    return ctx, page


async def shot(page, name, full=True):
    await page.wait_for_timeout(250)
    await page.screenshot(path=str(OUT / f"{name}.png"), full_page=full)


async def no_hscroll(page, where):
    sw = await page.evaluate("document.documentElement.scrollWidth")
    cw = await page.evaluate("document.documentElement.clientWidth")
    if sw > cw + 1:
        ERRORS.append(f"[layout] horizontal scroll on {where}: {sw} > {cw}")


def make_pdf(pages=3) -> bytes:
    objs = []
    kids = " ".join(f"{3 + i} 0 R" for i in range(pages))
    objs.append("<< /Type /Catalog /Pages 2 0 R >>")
    objs.append(f"<< /Type /Pages /Kids [{kids}] /Count {pages} >>")
    for i in range(pages):
        objs.append(f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents {3 + pages + i} 0 R /Resources << /Font << /F1 {3 + 2 * pages} 0 R >> >> >>")
    for i in range(pages):
        stream = f"BT /F1 24 Tf 72 760 Td (Photosynthesis page {i + 1}) Tj ET"
        objs.append(f"<< /Length {len(stream)} >>\nstream\n{stream}\nendstream")
    objs.append("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    out = io.BytesIO()
    out.write(b"%PDF-1.4\n")
    offsets = []
    for i, o in enumerate(objs):
        offsets.append(out.tell())
        out.write(f"{i + 1} 0 obj\n{o}\nendobj\n".encode())
    xref = out.tell()
    out.write(f"xref\n0 {len(objs) + 1}\n0000000000 65535 f \n".encode())
    for off in offsets:
        out.write(f"{off:010d} 00000 n \n".encode())
    out.write(f"trailer\n<< /Size {len(objs) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode())
    return out.getvalue()


def make_jpeg(color=(240, 240, 230), w=1600, h=1200) -> bytes:
    from PIL import Image, ImageDraw
    im = Image.new("RGB", (w, h), color)
    d = ImageDraw.Draw(im)
    for y in range(100, h, 80):
        d.line([(100, y), (w - 100, y)], fill=(60, 60, 60), width=4)
    b = io.BytesIO()
    im.save(b, "JPEG", quality=85)
    return b.getvalue()


LIBRARY_SUBJECT = re.compile(r"/library/[0-9a-f-]{36}")


async def drag_files(page, files):
    """파일을 화면 위로 끌고 온다 (놓기 전). files: [(이름, 종류, 내용 bytes)]"""
    payload = [[n, t, base64.b64encode(b).decode()] for n, t, b in files]
    await page.evaluate(
        """(files) => {
          const dt = new DataTransfer();
          for (const [name, type, b64] of files) {
            const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
            dt.items.add(new File([bytes], name, { type }));
          }
          window.__kokDrag = dt;
          for (const t of ['dragenter', 'dragover']) window.dispatchEvent(new DragEvent(t, { dataTransfer: dt, bubbles: true, cancelable: true }));
        }""",
        payload,
    )


async def drop_files(page):
    await page.evaluate("() => window.dispatchEvent(new DragEvent('drop', { dataTransfer: window.__kokDrag, bubbles: true, cancelable: true }))")


async def wait_ready(page, timeout=60):
    t0 = time.time()
    while time.time() - t0 < timeout:
        if await page.get_by_role("tab", name=re.compile("정리")).count():
            return True
        await page.wait_for_timeout(700)
    return False


async def main():
    import subprocess
    subprocess.run(["bash", str(pathlib.Path(__file__).parent / "db.sh"), "reset"], check=True)
    tmp = pathlib.Path(__file__).parent / "tmp"
    tmp.mkdir(exist_ok=True)
    (tmp / "sample.pdf").write_bytes(make_pdf(3))
    (tmp / "p1.jpg").write_bytes(make_jpeg())
    (tmp / "p2.jpg").write_bytes(make_jpeg((230, 240, 250)))

    async with async_playwright() as p:
        browser = await p.chromium.launch()

        # ---------------- 로그인 전
        step("landing (phone, desktop dark)")
        ctx, page = await new_ctx(browser)
        await page.goto(BASE + "/")
        await expect(page.get_by_role("button", name="구글로 시작하기")).to_be_visible()
        await shot(page, "01-landing-phone")
        await no_hscroll(page, "landing")
        await page.goto(BASE + "/home")
        assert "/?next=%2Fhome" in page.url or page.url.endswith("/?next=/home"), page.url
        for path in ["/terms", "/privacy", "/ai-guide", "/offline"]:
            r = await page.goto(BASE + path)
            assert r.status == 200, (path, r.status)
            await no_hscroll(page, path)
        await shot(page, "02-offline")
        await page.goto(BASE + "/privacy")
        await shot(page, "03-privacy-phone")
        await ctx.close()
        ctx, page = await new_ctx(browser, width=1280, scheme="dark")
        await page.goto(BASE + "/")
        await shot(page, "04-landing-desktop-dark")
        await ctx.close()

        # ---------------- 학생: 가입 확인
        step("welcome flow")
        ctx, page = await new_ctx(browser, "student")
        await page.goto(BASE + "/home")
        await page.wait_for_url("**/welcome")
        await expect(page.get_by_role("heading", name=re.compile("세 가지만"))).to_be_visible()
        await shot(page, "05-welcome")
        await page.get_by_role("button", name="모두 동의").click()
        await page.get_by_label(re.compile("콕에서 쓸 이름")).fill("공부하는 고래")
        await page.get_by_role("button", name="과학", exact=True).click()
        await page.get_by_role("button", name="시작하기").click()
        await page.wait_for_url(LIBRARY_SUBJECT)
        step("quick add: + composer opens, type, Enter")
        composer = page.get_by_role("dialog", name="자료 넣기")
        await expect(composer).to_be_visible()
        assert "compose=1" not in page.url, page.url
        await shot(page, "06-composer-empty", full=False)
        text = "내가 쓴 광합성 정리. 광합성은 식물이 빛을 받아 물과 이산화탄소로 포도당과 산소를 만드는 과정이다. 엽록체에서 일어난다. 밤에도 광합성을 한다."
        box = composer.get_by_label("공부한 내용")
        await box.fill("짧은 글")
        await box.press("Enter")  # 20자 안 되면 보내지 않는다
        await expect(composer).to_be_visible()
        await box.fill(text)
        await expect(composer.get_by_text(re.compile("약 \\d+"))).to_be_visible()
        await shot(page, "06-composer-text", full=False)
        await no_hscroll(page, "composer")
        await box.press("Shift+Enter")  # 줄바꿈만
        await expect(composer).to_be_visible()
        await box.press("Enter")
        await expect(composer).to_be_hidden()
        card = page.locator("main a[href^='/notes/']").first
        await expect(card).to_be_visible(timeout=15000)
        await shot(page, "07-library-new-card", full=False)
        await card.click()
        await page.wait_for_url("**/notes/*")
        await shot(page, "07-processing", full=False)
        ok = await wait_ready(page)
        assert ok, "note did not become ready"
        step("note page")
        await expect(page.get_by_text("한 줄 요약")).to_be_visible()
        await shot(page, "08-note-summary")
        await no_hscroll(page, "note")
        # 요약 고치기
        await page.get_by_role("button", name="요약 고치기").click()
        await page.get_by_label("요약").fill("광합성은 엽록체에서 빛으로 포도당을 만드는 과정이다.")
        await page.get_by_role("button", name="저장", exact=True).first.click()
        await expect(page.get_by_text("엽록체에서 빛으로 포도당을")).to_be_visible()
        # 개념 별표
        await page.get_by_role("button", name="★ 별표").first.click()
        await expect(page.get_by_text("★ 별표").first).to_be_visible()

        step("visual tab")
        await page.get_by_role("tab", name="그림").click()
        await page.wait_for_timeout(500)
        await shot(page, "09-mindmap")
        await no_hscroll(page, "mindmap")
        await page.get_by_role("button", name="가리기 모드").click()
        hidden = page.get_by_role("button", name="가려진 가지, 눌러서 확인")
        n_hidden = await hidden.count()
        assert n_hidden > 3, n_hidden
        await hidden.first.click()
        await page.get_by_role("button", name="헷갈렸어요").click()
        await page.get_by_role("button", name="가려진 가지, 눌러서 확인").first.click()
        await page.get_by_role("button", name="기억났어요").click()
        await shot(page, "10-hide-mode", full=False)
        await page.get_by_role("button", name="결과 저장").click()
        await expect(page.get_by_text(re.compile("오늘 복습에 넣었어요|모두 기억났어요"))).to_be_visible()
        await page.get_by_role("button", name="가리기 끄기").click()
        # 고치기
        await page.get_by_role("button", name="고치기", exact=True).click()
        await page.get_by_role("button", name="재료").click()
        await page.get_by_label("가지 글자").fill("재료(원료)")
        await page.get_by_role("button", name="저장", exact=True).click()
        await expect(page.get_by_role("button", name="재료(원료)")).to_be_visible()
        await page.get_by_role("button", name="가지 추가").click()
        await expect(page.get_by_text("저장됨")).to_be_visible()
        await shot(page, "11-mindmap-edit", full=False)
        await page.get_by_role("button", name="고치기 끝").click()
        # 다시 그리기
        await page.get_by_role("button", name="더보기").click()
        await page.get_by_role("button", name=re.compile("AI로 다시 그리기")).click()
        await expect(page.get_by_role("heading", name="새 그림 미리보기")).to_be_visible()
        await page.get_by_role("button", name="적용").click()
        await expect(page.get_by_text("새 그림으로 바꿨어요.")).to_be_visible()
        await page.wait_for_timeout(600)
        assert await page.get_by_role("button", name="재료(원료)").count() >= 1, "edited node should survive regenerate"
        # 표로 만들기
        await page.get_by_role("button", name="더보기").click()
        await page.get_by_role("button", name=re.compile("^표로 만들기")).click()
        await page.get_by_role("button", name="적용").click()
        await expect(page.get_by_role("radio", name="표")).to_be_visible()
        await page.get_by_role("radio", name="표").click()
        await shot(page, "12-table", full=False)
        for layout in ["오른쪽", "아래로", "퍼지기"]:
            await page.get_by_role("radio", name="마인드맵").click() if await page.get_by_role("radio", name="마인드맵").count() else None
            await page.get_by_role("radio", name=layout).click()
            await page.wait_for_timeout(250)
            await shot(page, f"13-layout-{layout}", full=False)

        step("questions tab")
        await page.get_by_role("tab", name=re.compile("문제")).click()
        await expect(page.get_by_text("광합성이 일어나는 세포 소기관은?")).to_be_visible()
        await page.get_by_role("button", name="직접 만들기").click()
        await page.get_by_role("dialog").get_by_role("radio", name="OX").click()
        dlg = page.get_by_role("dialog")
        await dlg.get_by_label("문제", exact=True).fill("엽록소는 초록색 색소이다.")
        await dlg.get_by_role("button", name="저장", exact=True).click()
        await expect(page.get_by_text("문제를 만들었어요.")).to_be_visible()
        # 잠그기
        await page.get_by_text("광합성이 일어나는 세포 소기관은?").click()
        await page.get_by_role("button", name="잠그기").click()
        await expect(page.get_by_text(re.compile("잠갔어요"))).to_be_visible()
        await page.get_by_role("button", name=re.compile("다시 만들기")).click()
        await expect(page.get_by_role("heading", name="새 문제 미리보기")).to_be_visible()
        await shot(page, "14-quiz-preview", full=False)
        await page.get_by_role("button", name="바꾸기").click()
        await expect(page.get_by_text("새 문제로 바꿨어요.")).to_be_visible()
        await page.wait_for_timeout(500)
        await shot(page, "15-questions")
        step("original tab")
        await page.get_by_role("tab", name="원본").click()
        await expect(page.get_by_text("내가 쓴 원문")).to_be_visible()

        step("review session")
        await page.goto(BASE + "/review")
        await expect(page.get_by_role("button", name="시작")).to_be_visible()
        await shot(page, "16-review-start", full=False)
        await page.get_by_role("button", name="시작").click()
        seen = 0
        answered_types = set()
        for i in range(30):
            if await page.get_by_role("heading", name=re.compile("오늘 할 일 끝|다음에 또")).count():
                break
            card_text = await page.locator("main").inner_text()
            if "그만하기" not in card_text:
                await page.wait_for_timeout(400)
                continue
            # 유형별로 답하기
            if await page.get_by_role("button", name="O 맞다").count():
                answered_types.add("ox")
                await page.get_by_role("button", name="X 틀리다").click()
            elif await page.get_by_label("답").count():
                inp = page.get_by_label("답")
                if "기체가 드나드는" in card_text:
                    answered_types.add("short")
                    await inp.fill("잎의 구멍")
                else:
                    answered_types.add("cloze")
                    await inp.fill("전분")
                await page.get_by_role("button", name="확인").click()
            else:
                answered_types.add("mcq")
                await page.locator("main button:has-text('1')").first.click()
            await expect(page.get_by_role("button", name="다음")).to_be_visible(timeout=15000)
            if seen == 0:
                await shot(page, "17-review-graded", full=False)
            if "short" in answered_types and seen < 8 and "AI 채점" in await page.locator("main").inner_text():
                await shot(page, "18-review-ai-grade", full=False)
            seen += 1
            await page.get_by_role("button", name="다음").click()
            await page.wait_for_timeout(200)
        if not await page.get_by_role("heading", name=re.compile("오늘 할 일 끝|다음에 또")).count():
            await shot(page, "debug-review")
        await expect(page.get_by_role("heading", name=re.compile("오늘 할 일 끝|다음에 또"))).to_be_visible(timeout=10000)
        await shot(page, "19-review-end", full=False)
        print("   answered:", seen, sorted(answered_types))

        step("wrong note")
        await page.goto(BASE + "/wrong")
        await expect(page.get_by_role("heading", name="오답노트")).to_be_visible()
        await page.wait_for_timeout(600)
        await shot(page, "20-wrong")
        await no_hscroll(page, "wrong")

        step("home / library / subject / questions")
        await page.goto(BASE + "/home")
        await page.wait_for_timeout(800)
        await shot(page, "21-home")
        await no_hscroll(page, "home")
        await page.goto(BASE + "/library")
        await page.wait_for_timeout(600)
        await shot(page, "22-library")
        await no_hscroll(page, "library")
        await page.get_by_role("tab", name=re.compile("^과학")).click()
        await page.wait_for_url(LIBRARY_SUBJECT)
        await expect(page.get_by_role("heading", name="과학", exact=True)).to_be_visible()
        await page.wait_for_timeout(600)
        await shot(page, "23-subject")
        await page.get_by_role("tab", name=re.compile("^전체")).click()
        await page.wait_for_url(re.compile(r"/library$"))
        await page.goto(BASE + "/questions")
        await page.wait_for_timeout(800)
        await shot(page, "24-questions-all")

        step("drop a PDF anywhere → organized automatically")
        import subprocess
        subprocess.run(["psql", "-d", "kokapp", "-qc", "delete from public.energy_ledger where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'"], check=True)
        await page.goto(BASE + "/library")
        await expect(page.locator("main a[href^='/notes/']").first).to_be_visible()
        await drag_files(page, [("3단원_광합성.pdf", "application/pdf", (tmp / "sample.pdf").read_bytes())])
        await expect(page.get_by_text("여기에 놓으면 콕이 정리해요")).to_be_visible()
        await shot(page, "25-drop-overlay", full=False)
        await drop_files(page)
        await expect(page.get_by_text("여기에 놓으면 콕이 정리해요")).to_be_hidden()
        await expect(page.get_by_label("넣는 중인 자료")).to_be_visible()
        await shot(page, "25-drop-tray", full=False)
        pdf_card = page.get_by_role("link", name="3단원 광합성", exact=True)
        await expect(pdf_card).to_be_visible(timeout=60000)
        await shot(page, "25-library-after-drop", full=False)
        await pdf_card.click()
        assert await wait_ready(page), "pdf note not ready"
        await page.get_by_role("tab", name="원본").click()
        await expect(page.get_by_role("link", name=re.compile("PDF 열기|쪽 열기"))).to_be_visible()

        step("unsupported file is refused with a reason")
        await page.goto(BASE + "/library")
        await expect(page.locator("main a[href^='/notes/']").first).to_be_visible()
        await drag_files(page, [("발표.pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation", b"PK fake")])
        await drop_files(page)
        await expect(page.get_by_text(re.compile("PDF로 저장해서 넣어 주세요"))).to_be_visible()

        step("photos attached in the composer, short text becomes the title")
        await page.get_by_role("button", name="자료 넣기", exact=True).click()
        composer = page.get_by_role("dialog", name="자료 넣기")
        await expect(composer).to_be_visible()
        await composer.locator("input[type=file][multiple]").set_input_files([str(tmp / "p1.jpg"), str(tmp / "p2.jpg")])
        await expect(composer.get_by_role("list", name="붙인 파일").locator("li")).to_have_count(2)
        await composer.get_by_label("공부한 내용").fill("세포 학습지")
        await shot(page, "26-composer-photos", full=False)
        await composer.get_by_label("공부한 내용").press("Enter")
        await expect(composer).to_be_hidden()
        photo_card = page.get_by_role("link", name="세포 학습지", exact=True)
        await expect(photo_card).to_be_visible(timeout=60000)
        await photo_card.click()
        assert await wait_ready(page), "photo note not ready"
        await page.get_by_role("tab", name="원본").click()
        await expect(page.get_by_alt_text("원본 사진 1")).to_be_visible()
        await shot(page, "27-photo-original", full=False)

        step("pasting text anywhere opens the composer with that text")
        await page.goto(BASE + "/library")
        await expect(page.locator("main a[href^='/notes/']").first).to_be_visible()
        # 엑셀·PPT처럼 글과 함께 그 글의 그림도 들어 있는 붙여 넣기 → 그림이 아니라 글로 받는다
        await page.evaluate(
            """(text) => {
              const dt = new DataTransfer();
              dt.setData('text/plain', text);
              dt.setData('text/html', '<p>' + text + '</p>');
              dt.items.add(new File([new Uint8Array([137, 80, 78, 71])], 'image.png', { type: 'image/png' }));
              document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
            }""",
            "엽록체는 빛에너지를 화학 에너지로 바꾸는 세포 소기관이에요.",
        )
        composer = page.get_by_role("dialog", name="자료 넣기")
        await expect(composer).to_be_visible()
        await expect(composer.get_by_label("공부한 내용")).to_have_value(re.compile("엽록체는 빛에너지"))
        assert await composer.get_by_role("list", name="붙인 파일").count() == 0, "picture of the text must not be attached"
        assert await page.get_by_label("넣는 중인 자료").count() == 0, "nothing must be uploaded"
        await composer.get_by_label("공부한 내용").fill("")
        await page.keyboard.press("Escape")
        await expect(composer).to_be_hidden()
        assert await page.evaluate("document.activeElement && document.activeElement.getAttribute('aria-label')") == "자료 넣기", "focus goes back to +"

        step("the composer does not come back after leaving for a page without +")
        await page.goto(BASE + "/review")
        await page.get_by_role("navigation", name="주 메뉴").get_by_role("link", name="자료함").first.click()
        await page.wait_for_url(re.compile(r"/library"))
        await page.get_by_role("button", name="자료 넣기", exact=True).click()
        await expect(composer).to_be_visible()
        await page.go_back()
        await page.wait_for_url(re.compile(r"/review"))
        await page.go_forward()
        await page.wait_for_url(re.compile(r"/library"))
        await page.wait_for_timeout(400)
        await expect(composer).to_be_hidden()

        step("dragging a file over a page without + explains where to drop it")
        await page.goto(BASE + "/settings")
        await expect(page.get_by_role("heading", name="설정", exact=True)).to_be_visible()
        await drag_files(page, [("메모.pdf", "application/pdf", b"%PDF-1.4")])
        await expect(page.get_by_text("자료함이나 홈 화면에 끌어다 놓아 주세요.")).to_be_visible()

        step("old /add address opens the composer")
        await page.goto(BASE + "/add")
        await page.wait_for_url(re.compile(r"/library"))
        await expect(page.get_by_role("dialog", name="자료 넣기")).to_be_visible()
        await page.keyboard.press("Escape")
        await expect(page.get_by_role("dialog", name="자료 넣기")).to_be_hidden()

        step("settings")
        await page.goto(BASE + "/settings")
        await page.get_by_role("radio", name="오른쪽으로").click()
        await expect(page.get_by_text("저장됨")).to_be_visible(timeout=5000)
        await page.reload()
        await expect(page.get_by_role("radio", name="오른쪽으로")).to_have_attribute("aria-checked", "true")
        await shot(page, "28-settings")
        await no_hscroll(page, "settings")

        step("plan: bad coupon")
        await page.goto(BASE + "/plan")
        await page.get_by_label("쿠폰 번호").fill("KOK-NOPE-NOPE")
        await page.get_by_role("button", name="쿠폰 쓰기").click()
        await expect(page.get_by_text("없는 쿠폰이에요. 글자를 다시 확인해 주세요.")).to_be_visible()
        await shot(page, "29-plan", full=False)
        await ctx.close()

        # ---------------- 관리자
        step("admin")
        ctx, page = await new_ctx(browser, "admin", width=1280)
        await page.goto(BASE + "/welcome")
        await page.get_by_role("button", name="모두 동의").click()
        await page.get_by_label(re.compile("콕에서 쓸 이름")).fill("운영자")
        await page.get_by_label("과목 이름").fill("수학")
        await page.get_by_role("button", name="시작하기").click()
        await page.wait_for_url(LIBRARY_SUBJECT)
        await page.goto(BASE + "/admin")
        await expect(page.get_by_text(re.compile("연결됨"))).to_be_visible()
        await page.get_by_role("button", name="키 시험").click()
        await expect(page.get_by_text(re.compile("작동해요"))).to_be_visible()
        await page.get_by_role("button", name="쿠폰 만들기").click()
        code_btn = page.locator("button.font-mono").first
        await expect(code_btn).to_be_visible()
        code = (await code_btn.inner_text()).strip()
        await page.get_by_label("공지 글").fill("오늘 밤 10시에 잠깐 점검해요")
        await page.get_by_text("공지 보이기").click()
        await page.get_by_role("button", name="공지 저장").click()
        await expect(page.get_by_text("공지를 저장했어요.")).to_be_visible()
        await shot(page, "30-admin")
        await ctx.close()

        step("student redeems coupon, sees notice")
        ctx, page = await new_ctx(browser, "student")
        await page.goto(BASE + "/plan")
        await page.get_by_label("쿠폰 번호").fill(code)
        await page.get_by_role("button", name="쿠폰 쓰기").click()
        await expect(page.get_by_text(re.compile("Pro가 켜졌어요"))).to_be_visible()
        await page.goto(BASE + "/home")
        await expect(page.get_by_text("오늘 밤 10시에 잠깐 점검해요")).to_be_visible()
        await shot(page, "31-home-pro-notice", full=False)
        await ctx.close()

        step("isolation: other user sees nothing")
        ctx, page = await new_ctx(browser, "other")
        await page.goto(BASE + "/welcome")
        await page.get_by_role("button", name="모두 동의").click()
        await page.get_by_label(re.compile("콕에서 쓸 이름")).fill("다른학생")
        await page.get_by_label("과목 이름").fill("영어")
        await page.get_by_role("button", name="시작하기").click()
        await page.wait_for_url(LIBRARY_SUBJECT)
        await page.goto(BASE + "/library")
        await page.wait_for_timeout(800)
        body = await page.locator("main").inner_text()
        assert "과학" not in body, "other user must not see student's subject"
        r = await page.request.get(BASE + "/api/me")
        me = await r.json()
        assert me["email"] == "other@example.com", me
        await ctx.close()

        # 다크 모드 폰 한 장
        step("dark phone note")
        ctx, page = await new_ctx(browser, "student", scheme="dark")
        await page.goto(BASE + "/library")
        await page.wait_for_timeout(500)
        await shot(page, "32-library-dark")
        await page.get_by_role("tab", name=re.compile("^과학")).click()
        await page.wait_for_url(LIBRARY_SUBJECT)
        await page.get_by_role("link", name=re.compile("광합성")).first.click()
        await wait_ready(page)
        await shot(page, "32-note-dark")
        await page.get_by_role("tab", name="그림").click()
        await page.wait_for_timeout(500)
        await shot(page, "33-mindmap-dark", full=False)

        step("mind map step reveal keeps every branch in its place")
        subprocess.run(
            [
                "psql", "-d", "kokapp", "-qc",
                "update public.profiles set settings = settings || jsonb_build_object('visual', coalesce(settings->'visual', '{}'::jsonb) || '{\"reveal\": \"step\"}'::jsonb) "
                "where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'",
            ],
            check=True,
        )
        await page.reload()
        await page.get_by_role("tab", name="그림").click()
        await page.wait_for_timeout(2500)
        centers = await page.evaluate(
            "() => [...document.querySelectorAll('svg g.mm-step')].map((g) => { const r = g.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })"
        )
        xs = [c[0] for c in centers]
        ys = [c[1] for c in centers]
        assert len(centers) > 3 and (max(xs) - min(xs)) + (max(ys) - min(ys)) > 150, centers
        await shot(page, "34-mindmap-step", full=False)
        await ctx.close()
        await browser.close()

    print("\nSTEPS OK:", len(STEPS))
    if ERRORS:
        print("\nERRORS:")
        for e in ERRORS:
            print(" ", e[:400])
    else:
        print("no console/page errors")


if __name__ == '__main__':
    asyncio.run(main())
