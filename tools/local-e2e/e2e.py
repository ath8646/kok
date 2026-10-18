"""콕 v0.1 끝-끝 시험 (가짜 Supabase·Claude + 로컬 Postgres).
사용: python3 e2e.py  (앱: localhost:3000, 가짜 백엔드: localhost:54321)
"""
import asyncio, base64, json, os, pathlib, sys, time, io, re, urllib.request
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


def make_pdf(pages=3, pad=0) -> bytes:
    """쪽마다 pad 바이트만큼 무거운 PDF (내용 스트림 안의 주석이라 보이지 않는다)"""
    import random
    rng = random.Random(7)
    objs = []
    kids = " ".join(f"{3 + i} 0 R" for i in range(pages))
    objs.append("<< /Type /Catalog /Pages 2 0 R >>")
    objs.append(f"<< /Type /Pages /Kids [{kids}] /Count {pages} >>")
    for i in range(pages):
        objs.append(f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents {3 + pages + i} 0 R /Resources << /Font << /F1 {3 + 2 * pages} 0 R >> >> >>")
    for i in range(pages):
        filler = "".join(rng.choice("abcdefghijklmnopqrstuvwxyz0123456789") for _ in range(pad))
        stream = f"BT /F1 24 Tf 72 760 Td (Photosynthesis page {i + 1}) Tj ET" + (f"\n%{filler}" if pad else "")
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
        # 조각 한도(시험 12KB)보다 큰 PDF: 서버가 나눠 저장하고 조각마다 정리한 뒤 조각을 지운다
        big_pdf = make_pdf(3, pad=5000)
        assert len(big_pdf) > 12000, len(big_pdf)
        before = json.loads(urllib.request.urlopen("http://localhost:54321/__stats").read())
        await drag_files(page, [("3단원_광합성.pdf", "application/pdf", big_pdf)])
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
        after = json.loads(urllib.request.urlopen("http://localhost:54321/__stats").read())
        assert after["maxDocBytes"] <= 12000, after["maxDocBytes"]
        assert after["docs"] - before["docs"] >= 2, (before["docs"], after["docs"])  # 조각 2개 이상
        assert after["tasks"].get("organize", 0) - before["tasks"].get("organize", 0) >= 3, (before["tasks"], after["tasks"])  # 조각 정리 + 합치기
        pdf_sid = page.url.rstrip("/").split("/")[-1].split("?")[0]
        parts_dir = pathlib.Path(__file__).parent / "fakebase" / "files" / "sources" / USERS["student"][0] / pdf_sid / "parts"
        assert not parts_dir.exists() or not any(parts_dir.iterdir()), list(parts_dir.iterdir())
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
        n0 = len(ERRORS)
        await page.get_by_label("쿠폰 번호").fill("KOK-NOPE-NOPE")
        await page.get_by_role("button", name="쿠폰 쓰기").click()
        await expect(page.get_by_text("없는 쿠폰이에요. 글자를 다시 확인해 주세요.")).to_be_visible()
        # 일부러 낸 400 은 오류 목록에서 뺀다
        assert all("/api/coupon" in e or "status of 400" in e for e in ERRORS[n0:]), ERRORS[n0:]
        del ERRORS[n0:]
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
        await page.get_by_role("button", name="Pro 코드 만들기").click()
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

        # ---------------- 관리자가 만든 테스트 플랜
        step("test plan: admin makes a plan and a code")
        actx, apage = await new_ctx(browser, "admin", width=1280)
        await apage.goto(BASE + "/admin")
        await apage.get_by_role("button", name="+ 새 플랜").click()
        sheet = apage.get_by_role("dialog", name="새 테스트 플랜")
        await expect(sheet).to_be_visible()
        # 한 글자씩 쳐도 입력칸 초점이 그대로여야 한다 (창이 초점을 빼앗던 문제)
        await sheet.get_by_label("플랜 이름").click()
        await apage.keyboard.type("베타 테스터")
        await expect(sheet.get_by_label("플랜 이름")).to_have_value("베타 테스터")
        await sheet.get_by_label("번개(⚡) 총량").fill("100")
        await sheet.get_by_label("PDF 쪽수 (한 번에)").fill("33")
        await sheet.get_by_text("꼼꼼 모델 쓰기").click()  # 끈다
        await shot(apage, "35-admin-plan-form", full=False)
        await sheet.get_by_role("button", name="플랜 만들기").click()
        await expect(apage.get_by_text(re.compile("'베타 테스터' 플랜을 만들었어요"))).to_be_visible()
        plan_item = apage.locator("li").filter(has=apage.get_by_role("button", name="고치기"))
        await expect(plan_item).to_have_count(1)
        await expect(plan_item.get_by_text("⚡ 100")).to_be_visible()
        await plan_item.get_by_role("button", name="코드 만들기", exact=True).click()
        await apage.get_by_label("기간(일)").fill("7")
        await apage.get_by_role("button", name="'베타 테스터' 코드 만들기").click()
        plan_code_btn = apage.locator("button.font-mono").first
        await expect(plan_code_btn).to_be_visible()
        plan_code = (await plan_code_btn.inner_text()).strip()
        await expect(apage.get_by_text(re.compile("새 코드 · 베타 테스터 7일"))).to_be_visible()
        await shot(apage, "36-admin-plans")
        await no_hscroll(apage, "admin")

        step("test plan: another account redeems the code")
        octx, opage = await new_ctx(browser, "other")
        await opage.goto(BASE + "/plan")
        await opage.get_by_label("쿠폰 번호").fill(plan_code.lower())  # 소문자로 적어도 된다
        await opage.get_by_role("button", name="쿠폰 쓰기").click()
        await expect(opage.get_by_text(re.compile("'베타 테스터' 플랜이 켜졌어요!"))).to_be_visible()
        await expect(opage.get_by_text("테스트 플랜", exact=True)).to_be_visible()
        await expect(opage.get_by_text("⚡ 100 / 100")).to_be_visible()
        await expect(opage.get_by_text("33쪽")).to_be_visible()
        await expect(opage.get_by_text("플랜이 끝나고 7일")).to_be_visible()
        await shot(opage, "37-plan-custom")
        await no_hscroll(opage, "plan (test plan)")
        me = await (await opage.request.get(BASE + "/api/me")).json()
        assert me["planInfo"]["kind"] == "custom" and me["planInfo"]["name"] == "베타 테스터", me["planInfo"]
        assert me["energy"]["period"] == "plan" and me["energy"]["limit"] == 100 and me["energy"]["remaining"] == 100, me["energy"]
        # 원본은 플랜이 끝나고 무료 보관 일수(7일) 뒤에 지운다
        assert me["plan"]["pdfPages"] == 33 and me["canCareful"] is False and me["plan"]["fileDays"] == 7, me
        from datetime import datetime
        span = datetime.fromisoformat(me["planInfo"]["until"].replace("Z", "+00:00")) - datetime.fromisoformat(me["planInfo"]["start"].replace("Z", "+00:00"))
        assert abs(span.total_seconds() / 86400 - 7) < 0.01, span
        await opage.goto(BASE + "/home")
        await expect(opage.get_by_text("플랜 AI 에너지")).to_be_visible()
        await expect(opage.get_by_text(re.compile("^베타 테스터 · .+까지$"))).to_be_visible()
        await shot(opage, "38-home-test-plan", full=False)
        await opage.goto(BASE + "/settings")
        await expect(opage.get_by_text("플랜 남은 에너지 ⚡ 100 / 100")).to_be_visible()

        step("test plan: energy is counted from the plan total")
        psql = lambda sql: subprocess.run(["psql", "-d", "kokapp", "-tAc", sql], capture_output=True, text=True, check=True).stdout.strip()
        other_id = USERS["other"][0]
        subject_id = psql(f"select id from public.subjects where user_id = '{other_id}' order by created_at limit 1")
        import uuid
        sid = str(uuid.uuid4())
        words = "영어 단어 정리. apple 은 사과, banana 는 바나나, cherry 는 체리라는 뜻이다. 과일 이름을 외우자."
        r = await opage.request.post(BASE + "/api/sources", data={"id": sid, "subjectId": subject_id, "kind": "text", "title": "", "text": words})
        assert r.ok, await r.text()
        status = ""
        for _ in range(90):
            status = psql(f"select status from public.sources where id = '{sid}'")
            if status in ("ready", "error"):
                break
            await opage.wait_for_timeout(1000)
        assert status == "ready", status
        assert psql(f"select plan_at_start from public.sources where id = '{sid}'") == "custom"
        assert psql(f"select string_agg(distinct plan, ',') from public.energy_ledger where source_id = '{sid}'") == "custom"
        me = await (await opage.request.get(BASE + "/api/me")).json()
        used = me["energy"]["usedPlan"]
        assert used and used > 0, me["energy"]
        assert abs(me["energy"]["remaining"] - max(0, 100 - used)) < 0.2, me["energy"]

        step("test plan: when the plan total runs out, AI stops with the plan's reason")
        await apage.reload()
        await plan_item.get_by_role("button", name="고치기").click()
        sheet = apage.get_by_role("dialog", name="테스트 플랜 고치기")
        await sheet.get_by_label("번개(⚡) 총량").fill("1")
        await sheet.get_by_role("button", name="고친 내용 저장").click()
        await expect(apage.get_by_text("플랜을 고쳤어요.")).to_be_visible()
        r = await opage.request.post(BASE + "/api/sources", data={"id": str(uuid.uuid4()), "subjectId": subject_id, "kind": "text", "title": "", "text": words})
        assert r.status == 402, (r.status, await r.text())
        body = await r.json()
        assert "'베타 테스터' 플랜 에너지는 기간 동안 다시 채워지지 않아요" in body["message"], body
        await opage.goto(BASE + "/library")
        await opage.get_by_role("button", name="자료 넣기", exact=True).click()
        composer = opage.get_by_role("dialog", name="자료 넣기")
        await expect(composer.get_by_text("영어", exact=True).first).to_be_visible()  # 과목이 골라졌는지
        await composer.get_by_label("공부한 내용").fill(words)
        await composer.get_by_label("공부한 내용").press("Enter")
        await expect(opage.get_by_text(re.compile("플랜 에너지는 기간 동안 다시 채워지지 않아요")).first).to_be_visible()
        await shot(opage, "39-test-plan-empty", full=False)

        step("test plan: a second plan code asks before replacing the running plan")
        await plan_item.get_by_role("button", name="코드 만들기", exact=True).click()
        await apage.get_by_label("기간(일)").fill("3")
        await apage.get_by_role("button", name="'베타 테스터' 코드 만들기").click()
        await expect(apage.get_by_text(re.compile("새 코드 · 베타 테스터 3일"))).to_be_visible()
        code2 = (await apage.locator("button.font-mono").first.inner_text()).strip()
        assert code2 != plan_code
        dialog_msgs = []

        async def accept_dialog(d):
            dialog_msgs.append(d.message)
            await d.accept()

        await opage.goto(BASE + "/plan")
        opage.once("dialog", accept_dialog)
        n0 = len(ERRORS)
        await opage.get_by_label("쿠폰 번호").fill(code2)
        await opage.get_by_role("button", name="쿠폰 쓰기").click()
        await expect(opage.get_by_text(re.compile("'베타 테스터' 플랜이 켜졌어요!"))).to_be_visible()
        assert dialog_msgs and "바뀌어요" in dialog_msgs[0], dialog_msgs
        # 먼저 물어보려고 받은 409 는 오류 목록에서 뺀다
        assert all("/api/coupon" in e or "status of 409" in e for e in ERRORS[n0:]), ERRORS[n0:]
        del ERRORS[n0:]
        me = await (await opage.request.get(BASE + "/api/me")).json()
        # 새 플랜은 번개를 처음부터 센다 (총량 1, 쓴 것 0)
        assert me["energy"]["usedPlan"] == 0 and me["energy"]["remaining"] == 1, me["energy"]
        span = datetime.fromisoformat(me["planInfo"]["until"].replace("Z", "+00:00")) - datetime.fromisoformat(me["planInfo"]["start"].replace("Z", "+00:00"))
        assert abs(span.total_seconds() / 86400 - 3) < 0.01, span

        step("test plan: admin ends it early, then deletes the plan and its codes")
        await apage.get_by_label("사용자 찾기").fill("other@example.com")
        await apage.get_by_role("button", name="찾기", exact=True).click()
        await expect(apage.get_by_text(re.compile("^베타 테스터 ~"))).to_be_visible()
        await apage.reload()
        await expect(plan_item.get_by_text("쓰는 사람 1명")).to_be_visible()
        await apage.get_by_label("사용자 찾기").fill("other@example.com")
        await apage.get_by_role("button", name="찾기", exact=True).click()
        apage.once("dialog", lambda d: d.accept())
        await apage.get_by_role("button", name="테스트 플랜 끝내기").click()
        await expect(apage.get_by_text("테스트 플랜을 끝냈어요.")).to_be_visible()
        await expect(plan_item.get_by_text("쓰는 사람 0명")).to_be_visible()  # 플랜 목록도 다시 읽는다
        me = await (await opage.request.get(BASE + "/api/me")).json()
        assert me["planInfo"]["kind"] == "free" and me["energy"]["period"] == "day", me["planInfo"]
        # 플랜에서 쓴 번개는 무료 오늘 몫에서 빼지 않는다
        assert me["energy"]["usedToday"] == 0 and me["energy"]["remaining"] == me["energy"]["limit"], me["energy"]
        apage.once("dialog", lambda d: d.accept())
        await plan_item.get_by_role("button", name="지우기").click()
        await expect(apage.get_by_text("플랜을 지웠어요.")).to_be_visible()
        await expect(apage.get_by_text("아직 만든 테스트 플랜이 없어요.")).to_be_visible()
        assert psql("select count(*) from public.custom_plans") == "0"
        assert psql("select count(*) from public.coupons where plan_id is not null") == "0"
        assert psql(f"select count(*) from public.coupons where code = '{plan_code}'") == "0"
        await octx.close()
        await actx.close()

        # ---------------- 노트 채팅
        step("note chat: ask about the note, add questions and note text only after [넣기]")
        ctx, page = await new_ctx(browser, "student")
        await page.goto(BASE + "/library")
        await page.get_by_role("tab", name=re.compile("^과학")).click()
        await page.wait_for_url(LIBRARY_SUBJECT)
        await page.get_by_role("link", name=re.compile("광합성")).first.click()
        assert await wait_ready(page), "note not ready"
        note_sid = page.url.rstrip("/").split("/")[-1].split("?")[0]
        live_q = lambda: int(psql(f"select count(*) from public.questions q join public.notes n on n.id = q.note_id where n.source_id = '{note_sid}' and q.status <> 'hidden'"))
        # 앞 단계에서 AI 를 많이 불러서 1분 요청 한도(10번)에 걸리지 않게 비운다
        psql(f"delete from public.rate_hits where user_id = '{USERS['student'][0]}'")
        assert await page.get_by_role("button", name="자료 넣기", exact=True).count() == 0, "+ button becomes the chat button on a note"
        await page.get_by_role("button", name="노트에게 물어보기").click()
        chat = page.get_by_role("dialog", name="노트에게 물어보기")
        await expect(chat).to_be_visible()
        await shot(page, "40-chat-empty", full=False)
        await no_hscroll(page, "chat")
        box = chat.get_by_label("물어볼 내용")
        await box.fill("광합성은 어디서 일어나?")
        await box.press("Enter")
        await expect(chat.get_by_text(re.compile("노트에 따르면 광합성은")).first).to_be_visible(timeout=15000)
        assert "**" not in await chat.inner_text(), "markdown marks are removed from replies"
        await expect(chat.get_by_text(re.compile(r"^⚡ [\d.]+$")).first).to_be_visible()
        n_before = live_q()
        await box.fill("이 노트로 문제 만들어 줘")
        await box.press("Enter")
        await expect(chat.get_by_text("이 문제 2개를 노트에 넣을까요?")).to_be_visible(timeout=15000)
        assert live_q() == n_before, "questions must not be added before [넣기]"
        await shot(page, "41-chat-proposal", full=False)
        await chat.get_by_role("button", name="넣기", exact=True).click()
        await expect(page.get_by_text("문제 2개를 넣었어요.")).to_be_visible()
        await expect(chat.get_by_text("넣었어요 ✓")).to_be_visible()
        assert live_q() == n_before + 2, (n_before, live_q())
        # 두 번 눌러도 한 번만 들어간다 (서버가 먼저 상태를 바꾼다)
        msg_id = psql(f"select m.id from public.chat_messages m join public.notes n on n.id = m.note_id where n.source_id = '{note_sid}' and m.proposal->>'kind' = 'questions'")
        note_id = psql(f"select id from public.notes where source_id = '{note_sid}'")
        r = await page.request.post(BASE + f"/api/notes/{note_id}/chat/apply", headers={"origin": BASE}, data={"messageId": msg_id, "action": "apply"})
        assert r.status == 409, r.status
        assert live_q() == n_before + 2
        await box.fill("엽록체 내용을 노트에 넣어 줘")
        await box.press("Enter")
        await expect(chat.get_by_text("'광합성 장소: 엽록체' 개념에 넣을까요?")).to_be_visible(timeout=15000)
        await expect(chat.get_by_text("노트 밖 설명 포함").first).to_be_visible()
        await chat.get_by_role("button", name="넣기", exact=True).click()
        await expect(page.get_by_text("노트에 넣었어요.")).to_be_visible()
        await box.fill("문제 하나만 더 만들어 줘")
        await box.press("Enter")
        await expect(chat.get_by_role("button", name="취소", exact=True)).to_be_visible(timeout=15000)
        await chat.get_by_role("button", name="취소", exact=True).click()
        await expect(chat.get_by_text("넣지 않았어요")).to_be_visible()
        assert live_q() == n_before + 2
        await shot(page, "42-chat-done", full=False)
        # 모델을 바꾸면 기억한다
        await chat.get_by_role("radio", name=re.compile("^꼼꼼")).click()
        await expect(chat.get_by_role("radio", name=re.compile("^꼼꼼"))).to_have_attribute("aria-checked", "true")
        await page.wait_for_timeout(800)
        await page.keyboard.press("Escape")
        await expect(chat).to_be_hidden()
        await expect(page.get_by_text(re.compile("두 겹의 막으로 싸여 있어요"))).to_be_visible()
        await page.reload()
        assert await wait_ready(page)
        await page.get_by_role("button", name="노트에게 물어보기").click()
        await expect(chat.get_by_text("광합성은 어디서 일어나?")).to_be_visible()  # 대화는 노트마다 남는다
        await expect(chat.get_by_role("radio", name=re.compile("^꼼꼼"))).to_have_attribute("aria-checked", "true")
        # 설정에서 문제 넣기를 끄면 AI 가 문제를 내밀지 않는다
        await page.goto(BASE + "/settings#chat")
        await page.wait_for_timeout(900)  # #chat 으로 부드럽게 내려간 뒤에 누른다
        toggle = page.get_by_label("대화하다가 '문제로 넣어 줘' 하면 문제로 만들어 주기")
        await expect(toggle).to_be_checked()
        await page.get_by_text("대화하다가 '문제로 넣어 줘' 하면 문제로 만들어 주기").click()
        await expect(toggle).not_to_be_checked()
        await expect(page.get_by_text("저장됨")).to_be_visible(timeout=5000)
        await shot(page, "42-settings-chat", full=False)
        await page.goto(BASE + f"/notes/{note_sid}")
        assert await wait_ready(page)
        await page.get_by_role("button", name="노트에게 물어보기").click()
        msgs = chat.get_by_role("log").locator(":scope > ul > li")
        await expect(msgs.first).to_be_visible()
        n_msgs = await msgs.count()
        n_cards = await chat.get_by_text(re.compile("개를 노트에 넣을까요")).count()
        await chat.get_by_label("물어볼 내용").fill("문제 만들어 줘")
        await chat.get_by_label("물어볼 내용").press("Enter")
        await expect(msgs).to_have_count(n_msgs + 2, timeout=15000)  # 내 말 + 답
        assert await chat.get_by_text(re.compile("개를 노트에 넣을까요")).count() == n_cards, "no question proposal when turned off"
        await page.keyboard.press("Escape")

        # ---------------- 노트에 자료 더하기와 버전 (Pro)
        step("add material to a note (Pro): a new version, the old one stays")
        await page.get_by_role("tab", name="원본").click()
        add = page.get_by_role("region", name="이 노트에 자료 더하기")
        await add.get_by_label("더할 내용").fill("광합성과 호흡을 비교해 보자. 호흡은 포도당을 분해해서 에너지를 얻는 과정이고 밤낮없이 일어난다.")
        await expect(add.get_by_text(re.compile(r"⚡ 약 [\d.]+"))).to_be_visible()
        await shot(page, "43-append-form", full=False)
        n_live = live_q()
        await add.get_by_role("button", name="글 더하기").click()
        await expect(page.get_by_text("이 노트에 자료를 더하는 중이에요")).to_be_visible(timeout=20000)
        await shot(page, "44-append-progress", full=False)
        await expect(page.get_by_text("자료를 더해 새 버전을 만들었어요.")).to_be_visible(timeout=90000)
        versions = page.get_by_role("region", name="버전 기록")
        await expect(versions.get_by_text("버전 2 · 더한 자료")).to_be_visible()
        await expect(versions.get_by_text("지금 쓰는 버전")).to_be_visible()
        await shot(page, "45-versions")
        await no_hscroll(page, "versions")
        assert psql(f"select count(*) from public.note_versions v join public.notes n on n.id = v.note_id where n.source_id = '{note_sid}'") == "2"
        assert live_q() == n_live + 2, (n_live, live_q())  # 새 자료 문제만 더한다
        await page.get_by_role("tab", name="정리").click()
        await expect(page.get_by_role("heading", name=re.compile("광합성과 호흡"))).to_be_visible()
        # 자료함에는 더한 자료가 따로 보이지 않는다
        await page.goto(BASE + "/library")
        await page.wait_for_timeout(800)
        assert await page.get_by_text(re.compile("광합성과 호흡을 비교해")).count() == 0

        step("old version: open, edit, use it, delete the other")
        await page.goto(BASE + f"/notes/{note_sid}?tab=original")
        assert await wait_ready(page)
        await versions.locator("li").filter(has_text="버전 1 · 처음 자료").get_by_role("button", name="열기").click()
        await expect(page.get_by_text("지난 버전을 보고 있어요")).to_be_visible()
        assert "v=1" in page.url, page.url
        await expect(page.get_by_role("heading", name=re.compile("광합성과 호흡"))).to_have_count(0)
        await page.get_by_role("button", name="요약 고치기").click()
        await page.get_by_label("요약").fill("버전 1에서 고친 요약이에요.")
        await page.get_by_role("button", name="저장", exact=True).first.click()
        await expect(page.get_by_text("버전 1에서 고친 요약이에요.")).to_be_visible()
        await page.wait_for_timeout(600)
        v1_summary = lambda: psql(f"select v.body->>'summary' from public.note_versions v join public.notes n on n.id = v.note_id where n.source_id = '{note_sid}' and v.number = 1")
        assert v1_summary() == "버전 1에서 고친 요약이에요.", v1_summary()
        assert psql(f"select body->>'summary' from public.notes where source_id = '{note_sid}'") != "버전 1에서 고친 요약이에요."
        await page.get_by_role("tab", name=re.compile("문제")).click()
        await expect(page.get_by_text(re.compile("버전 1의 문제예요"))).to_be_visible()
        await expect(page.get_by_text("식물은 밤에도 호흡을 한다.")).to_have_count(0)
        await page.get_by_role("button", name="직접 만들기").click()
        dlg = page.get_by_role("dialog")
        await dlg.get_by_role("radio", name="OX").click()
        await dlg.get_by_label("문제", exact=True).fill("버전 1에만 있는 문제이다.")
        await dlg.get_by_role("button", name="저장", exact=True).click()
        await expect(page.get_by_text("버전 1에 문제를 만들었어요.")).to_be_visible()
        await expect(page.get_by_text("버전 1에만 있는 문제이다.")).to_be_visible()
        assert psql("select status from public.questions where prompt = '버전 1에만 있는 문제이다.'") == "hidden"
        await shot(page, "46-old-version", full=False)
        page.once("dialog", lambda d: d.accept())
        await page.get_by_role("button", name="이 버전 쓰기").first.click()
        await expect(page.get_by_text("지금 버전을 바꿨어요 (버전 1).")).to_be_visible()
        await expect(page.get_by_text("지난 버전을 보고 있어요")).to_have_count(0)
        assert "v=" not in page.url, page.url
        assert psql(f"select current_version from public.notes where source_id = '{note_sid}'") == "1"
        assert psql("select status from public.questions where prompt = '식물은 밤에도 호흡을 한다.'") == "hidden"
        assert psql("select status from public.questions where prompt = '버전 1에만 있는 문제이다.'") == "active"
        await expect(page.get_by_text("버전 1에만 있는 문제이다.")).to_be_visible()
        await expect(page.get_by_text("식물은 밤에도 호흡을 한다.")).to_have_count(0)
        await page.get_by_role("tab", name="원본").click()
        page.once("dialog", lambda d: d.accept())
        await versions.locator("li").filter(has_text="버전 2 · 더한 자료").get_by_role("button", name="지우기").click()
        await expect(page.get_by_text("버전을 지웠어요.")).to_be_visible()
        await expect(versions.get_by_text("버전 2 · 더한 자료")).to_have_count(0)
        assert psql("select count(*) from public.questions where prompt = '식물은 밤에도 호흡을 한다.'") == "0"
        assert psql(f"select count(*) from public.sources where parent_id = '{note_sid}'") == "0"

        step("dropping a file on a note asks before adding it")
        await drag_files(page, [("메모.txt", "text/plain", "호흡과 광합성의 차이를 정리한 메모예요. 호흡은 에너지를 꺼내 쓴다.".encode())])
        await expect(page.get_by_text("여기에 놓으면 이 노트에 더해요")).to_be_visible()
        await drop_files(page)
        sheet = page.get_by_role("dialog", name="이 노트에 더할까요?")
        await expect(sheet.get_by_text("메모.txt")).to_be_visible()
        await shot(page, "47-append-confirm", full=False)
        await sheet.get_by_role("button", name="취소").click()
        await expect(sheet).to_be_hidden()
        assert await page.get_by_label("넣는 중인 자료").count() == 0, "nothing is added without confirming"
        await ctx.close()

        step("free users cannot add material to a note")
        octx, opage = await new_ctx(browser, "other")
        await opage.goto(BASE + f"/notes/{sid}")
        assert await wait_ready(opage), "other's note not ready"
        await drag_files(opage, [("단어.txt", "text/plain", "orange 는 오렌지, grape 는 포도라는 뜻이다. 과일 단어를 더 외우자.".encode())])
        await drop_files(opage)
        sheet = opage.get_by_role("dialog", name="노트에 더하기는 Pro 기능이에요")
        await expect(sheet.get_by_role("button", name="새 노트로 넣기")).to_be_visible()
        await shot(opage, "47-append-free", full=False)
        await sheet.get_by_role("button", name="취소").click()
        await opage.get_by_role("tab", name="원본").click()
        await expect(opage.get_by_role("region", name="이 노트에 자료 더하기").get_by_role("link", name="요금제 보기")).to_be_visible()
        r = await opage.request.post(BASE + "/api/sources", headers={"origin": BASE}, data={"id": str(uuid.uuid4()), "subjectId": subject_id, "kind": "text", "title": "", "text": words, "parentId": sid})
        assert r.status == 403, (r.status, await r.text())
        await octx.close()

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

        # ---------------- 테마 (Pro)
        step("themes (Pro): colour, font and note paper")
        ctx, page = await new_ctx(browser, "student")
        await page.goto(BASE + "/settings#theme")
        await page.get_by_role("radiogroup", name="테마 색").get_by_role("radio", name="바다").click()
        await expect(page.locator("html")).to_have_attribute("data-theme", "ocean")
        await page.get_by_role("radiogroup", name="테마 글꼴").get_by_role("radio", name=re.compile("둥근 글씨")).click()
        await expect(page.locator("html")).to_have_attribute("data-font", "round")
        await page.get_by_role("radiogroup", name="노트 종이 무늬").get_by_role("radio", name="줄 노트").click()
        await expect(page.locator("html")).to_have_attribute("data-paper", "lined")
        await expect(page.get_by_text("저장됨")).to_be_visible(timeout=5000)
        await page.locator("#theme").scroll_into_view_if_needed()
        await shot(page, "48-settings-theme", full=False)
        await no_hscroll(page, "settings theme")
        await page.goto(BASE + f"/notes/{note_sid}")
        # 다시 열면 화면을 그리기 전에 붙는다
        assert await page.evaluate("document.documentElement.dataset.theme") == "ocean"
        assert await wait_ready(page)
        accent = await page.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()")
        assert accent.lower() == "#1a5fc2", accent
        font = await page.evaluate("getComputedStyle(document.body).fontFamily")
        assert "Gowun Dodum" in font, font
        await shot(page, "49-note-theme")
        await ctx.close()
        ctx, page = await new_ctx(browser, "student", scheme="dark")
        await page.goto(BASE + f"/notes/{note_sid}")
        assert await wait_ready(page)
        await expect(page.locator("html")).to_have_attribute("data-theme", "ocean")
        await shot(page, "49-note-theme-dark", full=False)
        await ctx.close()
        octx, opage = await new_ctx(browser, "other")
        await opage.goto(BASE + "/settings#theme")
        await expect(opage.get_by_role("radiogroup", name="테마 색").get_by_role("radio", name="바다")).to_be_disabled()
        assert await opage.evaluate("document.documentElement.dataset.theme || ''") == ""
        await octx.close()
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
