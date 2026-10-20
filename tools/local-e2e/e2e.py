"""KOK v0.1 끝-끝 시험 (가짜 Supabase·Claude + 로컬 Postgres).
사용: python3 e2e.py  (앱: localhost:3000, 가짜 백엔드: localhost:54321)
"""
import asyncio, base64, json, os, pathlib, sys, time, io, re, urllib.parse, urllib.request
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


def make_figure_pdf() -> bytes:
    """자료 그림 시험용 PDF 한 쪽: 글과 빨간 네모(지도 자리). 네모는 (100,400)~(495,700)pt = 0~1000 으로 (168,169)~(832,525)"""
    stream = "BT /F1 20 Tf 72 780 Td (Goguryeo map) Tj ET\n1 0 0 rg 100 400 395 300 re f\n0 0 1 rg 120 650 40 30 re f"
    objs = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
        f"<< /Length {len(stream)} >>\nstream\n{stream}\nendstream",
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
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


def make_tilted_jpeg() -> bytes:
    """비스듬히 찍은 사진: 흰 바탕에 파란 사각형 (네 모서리 (400,200)(1300,300)(1200,1000)(300,900) = 0~1000 으로 (250,167)(813,250)(750,833)(188,750)),
    왼쪽 위 모서리 가까이 노란 점 (반듯하게 편 뒤에도 왼쪽 위에 있어야 한다)"""
    from PIL import Image, ImageDraw
    im = Image.new("RGB", (1600, 1200), (255, 255, 255))
    d = ImageDraw.Draw(im)
    d.polygon([(400, 200), (1300, 300), (1200, 1000), (300, 900)], fill=(30, 60, 220))
    d.ellipse([(430, 240), (500, 310)], fill=(255, 220, 0))
    b = io.BytesIO()
    im.save(b, "JPEG", quality=90)
    return b.getvalue()


def jpeg_look(path):
    """저장된 자른 그림: (너비, 높이, 가운데 색, 왼쪽 위 1/5 자리의 노란 점 수)"""
    from PIL import Image
    im = Image.open(path).convert("RGB")
    w, h = im.size
    mid = im.getpixel((w // 2, h // 2))
    corner = im.crop((0, 0, w // 4, h // 4))
    raw = corner.tobytes()
    yellow = sum(1 for i in range(0, len(raw), 3) if raw[i] > 200 and raw[i + 1] > 180 and raw[i + 2] < 120)
    return w, h, mid, yellow


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


# 화면 바탕(카드 밖) 위에 바로 놓인 글자 중 본문(--ink)·흐린 글자(--muted) 색이 아닌 것.
# 화면 위·아래 빛(themes/fx.ts)은 이 두 색이 읽히는 만큼만 진해서, 포인트·초록·빨강 글자는 알약·카드 안에 둔다
ON_BG_JS = r"""
() => {
  const probe = (v) => { const e = document.createElement('span'); e.style.color = `var(${v})`; document.body.appendChild(e); const c = getComputedStyle(e).color; e.remove(); return c; };
  const ok = new Set([probe('--ink'), probe('--muted')]);
  const alphaOf = (c) => {
    if (!c || c === 'transparent') return 0;
    let m = c.match(/^rgba?\(([^)]+)\)$/);
    if (m) { const p = m[1].split(/[ ,/]+/).filter(Boolean); return p.length >= 4 ? parseFloat(p[3]) : 1; }
    m = c.match(/\/\s*([\d.]+)\s*\)$/);
    return m ? parseFloat(m[1]) : 1;
  };
  const out = [];
  const seen = new Set();
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (w.nextNode()) {
    const n = w.currentNode;
    if (!n.textContent.trim()) continue;
    const el = n.parentElement;
    if (!el || seen.has(el) || el.closest('[role=dialog], .kok-toasts, svg')) continue;
    seen.add(el);
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden') continue;
    let o = el, hidden = false;
    while (o) { if (parseFloat(getComputedStyle(o).opacity) < 0.05) { hidden = true; break; } o = o.parentElement; }
    if (hidden) continue;
    const r = document.createRange(); r.selectNodeContents(n);
    if (![...r.getClientRects()].some((x) => x.width >= 2 && x.height >= 2)) continue;
    let a = el, backed = false;
    while (a && a !== document.body) {
      const s = getComputedStyle(a);
      if (alphaOf(s.backgroundColor) >= 0.5 || (s.backgroundImage && s.backgroundImage !== 'none')) { backed = true; break; }
      a = a.parentElement;
    }
    if (!backed && !ok.has(cs.color)) out.push(`${n.textContent.trim().slice(0, 30)} (${cs.color})`);
  }
  return out;
}
"""


async def css_var(page, name):
    return (await page.evaluate("(n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim()", name)).lower()


async def wait_css(page, name, want, timeout=6000):
    t0 = time.time()
    got = None
    while (time.time() - t0) * 1000 < timeout:
        got = await css_var(page, name)
        if got == want:
            return
        await page.wait_for_timeout(100)
    raise AssertionError(f"{name}: {got!r} != {want!r}")


async def wait_js(page, script, timeout=6000):
    t0 = time.time()
    while (time.time() - t0) * 1000 < timeout:
        if await page.evaluate(script):
            return
        await page.wait_for_timeout(100)
    raise AssertionError(f"timed out: {script}")


def db(q):
    """로컬 앱 DB 에 한 줄 묻기 (글로 돌려준다)"""
    import subprocess
    return subprocess.run(["psql", "-d", "kokapp", "-Atc", q], check=True, capture_output=True, text=True).stdout.strip()


async def poll_db(q, want, timeout=8):
    t0 = time.time()
    got = None
    while time.time() - t0 < timeout:
        got = db(q)
        if got == want:
            return
        await asyncio.sleep(0.15)
    raise AssertionError(f"{q}: {got!r} != {want!r}")


async def mouse_drag(page, src, dst):
    """마우스로 끌어서 옮기기 (조금씩 움직여 끌기를 시작하게 한다)"""
    a = await src.bounding_box()
    b = await dst.bounding_box()
    x0, y0 = a["x"] + a["width"] / 2, a["y"] + a["height"] / 2
    x1, y1 = b["x"] + b["width"] / 2, b["y"] + b["height"] / 2
    await page.mouse.move(x0, y0)
    await page.mouse.down()
    for i in range(1, 13):
        await page.mouse.move(x0 + (x1 - x0) * i / 12, y0 + (y1 - y0) * i / 12)
        await page.wait_for_timeout(30)
    await page.wait_for_timeout(200)
    await page.mouse.up()
    await page.wait_for_timeout(400)


async def touch_drag(page, src, dst, hold_ms=450):
    """손가락으로 꾹 누른 채 끌기 (Chromium 터치 이벤트)"""
    cdp = await page.context.new_cdp_session(page)
    a = await src.bounding_box()
    b = await dst.bounding_box()
    x0, y0 = a["x"] + a["width"] / 2, a["y"] + a["height"] / 2
    x1, y1 = b["x"] + b["width"] / 2, b["y"] + b["height"] / 2
    await cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": x0, "y": y0}]})
    await page.wait_for_timeout(hold_ms)
    for i in range(1, 13):
        await cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [{"x": x0 + (x1 - x0) * i / 12, "y": y0 + (y1 - y0) * i / 12}]})
        await page.wait_for_timeout(30)
    await page.wait_for_timeout(200)
    await cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
    await page.wait_for_timeout(500)
    await cdp.detach()


def luminance(hexv):
    h = hexv.lstrip("#")
    def f(c):
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = (int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)


def make_png(w=900, h=600) -> bytes:
    from PIL import Image, ImageDraw
    im = Image.new("RGB", (w, h), (200, 220, 240))
    d = ImageDraw.Draw(im)
    for x in range(0, w, 60):
        d.ellipse([x, h // 3, x + 40, h // 3 + 40], fill=(90, 130, 200))
    b = io.BytesIO()
    im.save(b, "PNG")
    return b.getvalue()


async def figure_steps(browser):
    """자료 그림 (따로 돌리기: python3 e2e_figs.py)"""
    step("source figures: a figure in a PDF is cut out, put on its concept and asked about (Pro also gets a redraw)")
    me_id = USERS["student"][0]
    files_root = pathlib.Path(__file__).parent / "fakebase" / "files" / "sources"

    async def add_one(page, uid, name, mime, data, kind, title=None):
        """자료 하나를 넣고 정리가 끝날 때까지 기다린다 (자료 번호).
        title 이 없으면 화면에 끌어다 놓고, 있으면 입력창에 붙이고 짧은 글(제목)과 함께 보낸다"""
        since = db(f"select coalesce(max(created_at), now() - interval '1 day')::text from public.sources where user_id = '{uid}'")
        await page.goto(BASE + "/library")
        # 화면이 끌어다 놓기를 받을 준비가 된 뒤에 놓는다
        await expect(page.get_by_role("button", name="자료 넣기", exact=True)).to_be_visible()
        if title is None:
            await drag_files(page, [(name, mime, data)])
            await expect(page.get_by_text("여기에 놓으면 KOK이 정리해요")).to_be_visible()
            await drop_files(page)
        else:
            await page.get_by_role("button", name="자료 넣기", exact=True).click()
            composer = page.get_by_role("dialog", name="자료 넣기")
            await composer.locator("input[type=file][multiple]").set_input_files(files=[{"name": name, "mimeType": mime, "buffer": data}])
            await expect(composer.get_by_role("list", name="붙인 파일").locator("li")).to_have_count(1)
            await composer.get_by_label("공부한 내용").fill(title)
            await composer.get_by_label("공부한 내용").press("Enter")
            await expect(composer).to_be_hidden()
        q = f"from public.sources where user_id = '{uid}' and kind = '{kind}' and parent_id is null and created_at > '{since}'"
        await poll_db(f"select count(*) {q}", "1", timeout=30)
        sid_ = db(f"select id {q}")
        await poll_db(f"select status from public.sources where id = '{sid_}'", "ready", timeout=120)
        return sid_

    ctx, page = await new_ctx(browser, "student")
    fsid = await add_one(page, me_id, "고구려 지도.pdf", "application/pdf", make_figure_pdf(), "pdf")
    figs = json.loads(db(f"select coalesce(body->'figures', '[]'::jsonb)::text from public.notes where source_id = '{fsid}'"))
    # 너무 작은 그림(장식)은 빼고 지도 하나: 개념(이름으로 찾은 k2)에 붙는다
    assert len(figs) == 1, figs
    fig = figs[0]
    assert (fig["id"], fig["kind"], fig["key_point_id"], fig["page"]) == ("f1", "map", "k2", 1), fig
    assert fig["crop"] == f"{me_id}/figs/{fsid}/f1.jpg", fig
    crop_file = files_root / fig["crop"]
    assert crop_file.exists(), crop_file
    w, h, mid, _ = jpeg_look(crop_file)
    assert abs(w / h - 395 / 300) < 0.15, (w, h)
    assert mid[0] > 180 and mid[1] < 90 and mid[2] < 90, mid
    # Pro: 지도를 KOK 스타일로 다시 그렸다 (원본 그림은 그대로)
    assert fig.get("art"), fig
    assert db(f"select step from public.sources where id = '{fsid}'") == "done"
    # 그림 문제: 그림을 그대로 남긴다
    fq = f"from public.questions q join public.notes n on n.id = q.note_id where n.source_id = '{fsid}' and q.source_figure->>'id' = 'f1'"
    assert db(f"select count(*) {fq}") == "1", db(f"select count(*) {fq}")
    assert db(f"select q.source_figure->>'crop' {fq}") == fig["crop"]

    # 노트: 개념 카드 안의 그림 (다시 그린 그림이 먼저, 원본으로 바꿔 보기, 크게 보기)
    await page.goto(BASE + f"/notes/{fsid}")
    assert await wait_ready(page)
    fig_el = page.locator("#kp-k2 figure")
    await expect(fig_el).to_contain_text("5세기 고구려 영토")
    await expect(fig_el).to_contain_text("1쪽")
    views = fig_el.get_by_role("radiogroup", name=re.compile("보기$"))
    await expect(views.get_by_role("radio", name="다시 그린 그림")).to_have_attribute("aria-checked", "true")
    # 다시 그린 지도: 그림 이름(화면 읽기)에 지도 속 글이 들어 있다
    await expect(fig_el.get_by_role("img", name=re.compile("고구려"))).to_be_visible()
    await fig_el.scroll_into_view_if_needed()
    await shot(page, "96-figure-redraw", full=False)
    await views.get_by_role("radio", name="원본").click()
    img = fig_el.locator("img")
    await expect(img).to_be_visible()
    await page.wait_for_function("(el) => el.complete && el.naturalWidth > 0", arg=await img.element_handle(), timeout=10000)
    await fig_el.scroll_into_view_if_needed()
    await shot(page, "96-figure-original", full=False)
    await no_hscroll(page, "note with figure")
    await fig_el.get_by_role("button", name="크게 보기").click()
    zoom = page.get_by_role("dialog", name="5세기 고구려 영토")
    await expect(zoom).to_be_visible()
    await expect(zoom.locator("img")).to_be_visible()
    await shot(page, "97-figure-zoom", full=False)
    await page.keyboard.press("Escape")
    await expect(zoom).to_have_count(0)

    # 설정: 원본 그림 먼저 보기
    await page.goto(BASE + "/settings")
    toggle = page.get_by_label("자료 그림은 원본으로 먼저 보기")
    await expect(toggle).not_to_be_checked()
    await page.get_by_text("자료 그림은 원본으로 먼저 보기", exact=True).click()
    await expect(toggle).to_be_checked()
    await poll_db(f"select settings->'visual'->>'originalFirst' from public.profiles where id = '{me_id}'", "true")
    await page.goto(BASE + f"/notes/{fsid}")
    assert await wait_ready(page)
    await expect(page.locator("#kp-k2 figure").get_by_role("radio", name="원본")).to_have_attribute("aria-checked", "true")
    await page.goto(BASE + "/settings")
    await expect(page.get_by_label("자료 그림은 원본으로 먼저 보기")).to_be_checked()
    await page.get_by_text("자료 그림은 원본으로 먼저 보기", exact=True).click()
    await poll_db(f"select settings->'visual'->>'originalFirst' from public.profiles where id = '{me_id}'", "false")

    # 이 노트 문제 풀기: 그림 문제는 문제 위에 그림 (제목은 풀고 나서)
    await page.goto(BASE + f"/notes/{fsid}/practice")
    seen = False
    for _ in range(12):
        await expect(page.get_by_role("button", name="모르겠어요")).to_be_visible(timeout=15000)
        q_fig = page.locator("main figure")
        if await q_fig.count():
            seen = True
            await expect(q_fig).to_contain_text("자료 그림")
            await expect(page.locator("main")).not_to_contain_text("5세기 고구려 영토")
            # 다시 그린 그림 속 제목도 문제 위에서는 숨긴다
            await expect(page.locator("main")).not_to_contain_text("고구려의 전성기")
            await expect(q_fig.get_by_role("radio", name="다시 그린 그림")).to_have_attribute("aria-checked", "true")
            await shot(page, "98-figure-question", full=False)
            # 그림의 크게 보기 창이 열려 있으면 숫자 키로 뒤의 문제에 답하지 않는다
            await q_fig.get_by_role("button", name="크게 보기").click()
            zoom_q = page.get_by_role("dialog", name="자료 그림")
            await expect(zoom_q).to_be_visible()
            await page.keyboard.press("1")
            await page.wait_for_timeout(300)
            await expect(page.get_by_role("button", name="모르겠어요")).to_be_visible()
            await page.keyboard.press("Escape")
            await expect(zoom_q).to_have_count(0)
        await page.get_by_role("button", name="모르겠어요").click()
        await expect(page.get_by_role("button", name="다음", exact=True)).to_be_visible(timeout=15000)
        if seen:
            await expect(page.locator("main")).to_contain_text("5세기 고구려 영토")
            await shot(page, "98-figure-question-result", full=False)
            break
        await page.get_by_role("button", name="다음", exact=True).click()
    assert seen, "figure question did not show up"
    await ctx.close()

    # 넓은 화면·어두운 화면에서도 그림 카드 (가로로 넘치지 않게)
    dctx, dpage = await new_ctx(browser, "student", width=1280, scheme="dark")
    await dpage.goto(BASE + f"/notes/{fsid}")
    assert await wait_ready(dpage)
    dfig = dpage.locator("#kp-k2 figure")
    await expect(dfig.get_by_role("img", name=re.compile("고구려"))).to_be_visible()
    await dfig.scroll_into_view_if_needed()
    await dpage.wait_for_timeout(400)
    await shot(dpage, "96-figure-desktop-dark", full=False)
    await no_hscroll(dpage, "note with figure (desktop)")
    await dctx.close()

    step("source figures: a free account gets the original only, a tilted photo comes out straight, deleting the note removes the cut-outs")
    other_id = USERS["other"][0]
    db(f"delete from public.energy_ledger where user_id = '{other_id}'")
    octx, opage = await new_ctx(browser, "other")
    # 사진 파일 이름은 제목이 되지 않아서(IMG_… 처럼 뜻 없는 이름이 많다) 입력창의 짧은 글로 제목을 붙인다
    psid = await add_one(opage, other_id, "IMG_2041.jpg", "image/jpeg", make_tilted_jpeg(), "image", title="기울어진 지도")
    figs = json.loads(db(f"select coalesce(body->'figures', '[]'::jsonb)::text from public.notes where source_id = '{psid}'"))
    assert len(figs) == 1 and figs[0]["kind"] == "photo" and not figs[0].get("art"), figs
    crop_file = files_root / figs[0]["crop"]
    w, h, mid, yellow = jpeg_look(crop_file)
    # 사다리꼴로 찍힌 파란 네모가 반듯한 네모로 (가로·세로 비율 약 905:707), 노란 점은 왼쪽 위에 그대로
    assert abs(w / h - 905 / 707) < 0.15, (w, h)
    assert mid[2] > 150 and mid[0] < 100, mid
    assert yellow > 20, yellow
    await opage.goto(BASE + f"/notes/{psid}")
    assert await wait_ready(opage)
    ofig = opage.locator("article figure").first
    await expect(ofig).to_contain_text("비스듬히 찍은 유물 사진")
    await expect(ofig.get_by_role("radiogroup")).to_have_count(0)
    await expect(ofig.locator("img")).to_be_visible()
    await ofig.scroll_into_view_if_needed()
    await shot(opage, "99-figure-free", full=False)
    # 노트를 지우면 잘라 둔 그림도 지운다
    r = await opage.request.delete(BASE + f"/api/sources/{psid}", headers={"origin": BASE})
    assert r.ok, (r.status, await r.text())
    assert not (files_root / other_id / "figs" / psid).exists() or not any((files_root / other_id / "figs" / psid).iterdir())
    await octx.close()


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
        # 카카오 버튼 (NEXT_PUBLIC_KAKAO_LOGIN=1 로 빌드). Apple 은 꺼져 있다
        await expect(page.get_by_role("button", name="카카오 로그인")).to_be_visible()
        assert await page.get_by_role("button", name="Apple로 계속하기").count() == 0
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
        await expect(page.get_by_text("카카오로 로그인하면")).to_be_visible()
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
        await page.get_by_label(re.compile("KOK에서 쓸 이름")).fill("공부하는 고래")
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
        # 탭 띠는 위에 붙기 전에는 칠하지 않는다 (테마 배경이 띠 뒤에서 끊기지 않게)
        sub = page.locator(".kok-subbar")
        await page.evaluate("window.scrollTo(0, 0)")
        await page.wait_for_timeout(200)
        assert "is-stuck" not in (await sub.get_attribute("class")), "tab bar painted before it sticks"
        await page.evaluate("window.scrollTo(0, 700)")
        await expect(sub).to_have_class(re.compile("is-stuck"))
        await page.evaluate("window.scrollTo(0, 0)")
        await expect(sub).not_to_have_class(re.compile("is-stuck"))
        # 요약 고치기
        await page.get_by_role("button", name="요약 고치기").click()
        await page.get_by_label("요약", exact=True).fill("광합성은 엽록체에서 빛으로 포도당을 만드는 과정이다.")
        await page.get_by_role("button", name="저장", exact=True).first.click()
        await expect(page.get_by_text("엽록체에서 빛으로 포도당을")).to_be_visible()

        step("note editing: easy marks, stars on top, examples, formulas, order")
        sid = page.url.rstrip("/").split("/")[-1].split("?")[0]
        nbody = lambda path: db(f"select body #>> '{path}' from public.notes where source_id = '{sid}'")
        # 요약: 고른 글을 형광펜 버튼으로 꾸미면 기호가 붙고 미리보기에 보인다
        await page.get_by_role("button", name="요약 고치기").click()
        box = page.get_by_label("요약", exact=True)
        await box.fill("광합성은 빛으로 포도당을 만든다")
        await box.evaluate("(el) => { el.focus(); el.setSelectionRange(9, 12); }")
        await page.get_by_role("toolbar", name="요약 꾸미기").get_by_role("button", name="형광펜").click()
        await expect(box).to_have_value("광합성은 빛으로 ==포도당==을 만든다")
        await expect(page.locator("mark.kok-mark", has_text="포도당")).to_be_visible()
        # 꾸미는 법
        await page.get_by_role("toolbar", name="요약 꾸미기").get_by_role("button", name="꾸미는 법").click()
        await expect(page.get_by_text("쉽게 꾸미는 법")).to_be_visible()
        await shot(page, "08-note-edit-marks", full=False)
        await page.get_by_role("button", name="저장", exact=True).first.click()
        await expect(page.locator("section mark.kok-mark", has_text="포도당")).to_be_visible()
        assert nbody("{summary}") == "광합성은 빛으로 ==포도당==을 만든다"
        # 별표: 별이 켜지고 그 개념이 맨 위로 (나머지는 원래 순서)
        stars = page.get_by_role("button", name=re.compile(" 별표$"))
        assert await stars.count() == 4, await stars.count()
        await stars.nth(2).click()
        await expect(page.get_by_role("button", name="광합성의 결과물 별표", exact=True)).to_have_attribute("aria-pressed", "true")
        cards = page.locator("article[data-flip]")
        await expect(cards.first).to_contain_text("광합성의 결과물")
        await expect(cards.nth(1)).to_contain_text("광합성의 재료")
        # 별표한 카드에만 별표 빛, 번호는 별표 빛 색
        await expect(page.locator("article.kok-glow.is-starred")).to_have_count(1)
        await expect(cards.first.locator(".kok-star-badge")).to_have_count(1)
        await page.wait_for_timeout(400)
        await shot(page, "08-note-starred", full=False)
        await poll_db(f"select string_agg(k->>'id', ',') from public.notes n, jsonb_array_elements(n.body->'key_points') k where n.source_id = '{sid}' and k->>'starred' = 'true'", "k3")
        # 두 번째 별표는 별표끼리 원래 순서대로 (k1 이 k3 앞)
        await page.get_by_role("button", name="광합성의 재료 별표", exact=True).click()
        await expect(cards.first).to_contain_text("광합성의 재료")
        await expect(cards.nth(1)).to_contain_text("광합성의 결과물")
        await expect(cards.nth(2)).to_contain_text("광합성 장소")
        # 키보드로 별표를 빼면 카드가 제자리로 옮겨 가도 초점은 그 별에 남는다 (다시 별표해 되돌린다)
        kp_star = page.get_by_role("button", name="광합성의 재료 별표", exact=True)
        await page.get_by_role("button", name="광합성의 재료 고치기", exact=True).focus()
        await page.keyboard.press("Tab")
        await expect(kp_star).to_be_focused()
        await page.keyboard.press("Enter")
        await expect(kp_star).to_have_attribute("aria-pressed", "false")
        await expect(cards.first).to_contain_text("광합성의 결과물")
        await expect(kp_star).to_be_focused()
        await page.keyboard.press("Enter")
        await expect(kp_star).to_have_attribute("aria-pressed", "true")
        await expect(cards.first).to_contain_text("광합성의 재료")
        await expect(kp_star).to_be_focused()
        # 고치던 내용이 있으면 다른 칸을 열기 전에 한 번 묻는다 (아니요 → 그대로), 닫으면 연 버튼으로 초점이 돌아온다
        await page.get_by_role("button", name="요약 고치기").click()
        await page.get_by_label("요약", exact=True).fill("고치던 요약")
        asked = []

        async def say_no(d):
            asked.append(d.message)
            await d.dismiss()

        page.once("dialog", lambda d: asyncio.ensure_future(say_no(d)))
        await page.locator("#kp-k4").get_by_role("button", name=re.compile("고치기$")).click()
        await expect(page.get_by_label("요약", exact=True)).to_have_value("고치던 요약")
        assert asked and "저장되지 않았어요" in asked[0], asked
        await page.get_by_role("button", name="취소").first.click()
        await expect(page.get_by_role("button", name="요약 고치기")).to_be_focused()
        assert nbody("{summary}") == "광합성은 빛으로 ==포도당==을 만든다"
        # 개념 고치기: 중요도, 함정 빼기, 예시 더하기 (목록 기호로)
        kp2 = page.locator("#kp-k2")
        await kp2.get_by_role("button", name=re.compile("고치기$")).click()
        await kp2.get_by_role("radio", name="참고").click()
        await kp2.get_by_role("button", name="함정 빼기").click()
        await kp2.get_by_role("button", name="예시 추가").click()
        await kp2.get_by_role("textbox", name=re.compile("^예시")).last.fill("- 잎을 잘라 보면 초록색 알갱이가 보인다\n- 알갱이 속에 !!엽록소!!가 있다")
        await kp2.get_by_role("button", name="저장", exact=True).click()
        await expect(kp2.locator(".kok-li")).to_have_count(2)
        await expect(kp2.locator(".kok-red", has_text="엽록소")).to_be_visible()
        await expect(kp2.get_by_text("참고", exact=True)).to_be_visible()
        assert db(f"select count(*) from public.notes n, jsonb_array_elements(n.body->'pitfalls') p where n.source_id = '{sid}' and p->>'key_point_id' = 'k2'") == "0"
        assert db(f"select count(*) from public.notes n, jsonb_array_elements(n.body->'examples') p where n.source_id = '{sid}' and p->>'key_point_id' = 'k2'") == "1"
        # 공식 더하기: 기호 버튼과 미리보기
        await page.get_by_role("button", name="공식 추가").click()
        fe = page.locator(".kok-card", has=page.get_by_role("toolbar", name="공식 기호"))
        await fe.get_by_label("공식 이름 (없어도 돼요)").fill("원의 넓이")
        tex = fe.get_by_role("textbox", name="공식", exact=True)
        await tex.fill("S = ")
        await tex.press("End")
        await fe.get_by_role("button", name="파이").click()
        await tex.press("End")
        await tex.press_sequentially("r")
        await fe.get_by_role("button", name="거듭제곱").click()
        await page.keyboard.type("2")
        await expect(tex).to_have_value("S = \\pi r^{2}")
        await expect(fe.locator(".katex-display")).to_be_visible()
        await shot(page, "08-note-formula", full=False)
        await fe.get_by_role("button", name="저장", exact=True).click()
        assert nbody("{formulas,1,latex}") == "S = \\pi r^{2}", nbody("{formulas,1,latex}")
        # 순서 바꾸기 (키보드): 별표하지 않은 개념끼리
        kp_sec = page.locator("section", has=page.get_by_role("heading", name=re.compile("^핵심 개념")))
        await kp_sec.get_by_role("button", name="순서 바꾸기").click()
        rows = kp_sec.get_by_role("list", name="개념 순서", exact=True).locator("li")
        await expect(rows).to_have_count(2)
        await expect(rows.first).to_contain_text("광합성 장소")
        await shot(page, "08-note-sort", full=False)
        await rows.first.get_by_role("button").focus()
        await page.keyboard.press("Space")
        await page.wait_for_timeout(200)
        await page.keyboard.press("ArrowDown")
        await page.wait_for_timeout(300)
        await page.keyboard.press("Space")
        await expect(rows.first).to_contain_text("빛의 세기")
        await poll_db(f"select string_agg(k->>'id', ',' order by o) from public.notes n, jsonb_array_elements(n.body->'key_points') with ordinality as t(k, o) where n.source_id = '{sid}'", "k1,k4,k3,k2")
        await kp_sec.get_by_role("button", name="완료").click()
        await expect(cards.nth(2)).to_contain_text("빛의 세기")
        await expect(cards.nth(3)).to_contain_text("광합성 장소")
        # 순서 바꾸기 (마우스로 끌기): 용어
        term_sec = page.locator("section", has=page.get_by_role("heading", name=re.compile("^용어")))
        await term_sec.get_by_role("button", name="순서 바꾸기").click()
        trows = term_sec.get_by_role("list", name="용어 순서").locator("li")
        await expect(trows).to_have_count(3)
        a = await trows.nth(0).bounding_box()
        b = await trows.nth(1).bounding_box()
        await page.mouse.move(a["x"] + 60, a["y"] + a["height"] / 2)
        await page.mouse.down()
        await page.mouse.move(a["x"] + 60, a["y"] + a["height"] / 2 + 8, steps=4)
        await page.mouse.move(b["x"] + 60, b["y"] + b["height"] / 2 + 10, steps=10)
        await page.wait_for_timeout(250)
        await page.mouse.up()
        await expect(trows.first).to_contain_text("기공")
        await poll_db(f"select string_agg(t->>'term', ',' order by o) from public.notes n, jsonb_array_elements(n.body->'terms') with ordinality as x(t, o) where n.source_id = '{sid}'", "기공,엽록체,엽록소")
        await term_sec.get_by_role("button", name="완료").click()
        await page.evaluate("window.scrollTo(0, 0)")

        step("visual tab: overview + branch cards, branch details, big map")
        await page.get_by_role("tab", name="그림").click()
        mm_view = page.get_by_role("radiogroup", name="마인드맵 보기")
        # 폰은 카드 보기로 시작한다: 한눈 지도 + 가지 카드 (외우기 한 줄, 기억 상태)
        await expect(mm_view.get_by_role("radio", name="카드")).to_have_attribute("aria-checked", "true")
        atlas = page.get_by_role("group", name="한눈 지도: 광합성, 가지 4개")
        await expect(atlas).to_be_visible()
        branch_cards = page.get_by_role("list", name="가지 카드").get_by_role("button")
        await expect(branch_cards).to_have_count(4)
        await expect(branch_cards.first).to_contain_text("물은 뿌리로, 이산화탄소는 기공으로")
        await expect(branch_cards.first).to_contain_text("아직 안 풀었어요")
        await page.wait_for_timeout(400)
        await shot(page, "09-mindmap")
        await no_hscroll(page, "mindmap")
        # 한눈 지도의 가지를 누르면 그 카드로 내려가 테두리가 잠깐 빛난다
        await atlas.get_by_role("button", name=re.compile("^빛의 세기")).click()
        await expect(page.locator("#branch-n4 > button")).to_have_class(re.compile("kok-branch-flash"))
        await expect(page.locator("#branch-n4")).to_be_in_viewport()
        await expect(page.locator("#branch-n4 > button")).not_to_have_class(re.compile("kok-branch-flash"), timeout=3000)
        # 가지 자세히: 외우기 한 줄·노트 설명·이 개념 문제 풀기, 아래에서 다음 가지로
        await branch_cards.first.click()
        sheet = page.get_by_role("dialog", name=re.compile("재료$"))
        await expect(sheet.get_by_text("노트 설명")).to_be_visible()
        await expect(sheet.get_by_text("물은 뿌리로, 이산화탄소는 기공으로")).to_be_visible()
        await expect(sheet.get_by_role("link", name="이 개념 문제 풀기")).to_have_attribute("href", re.compile(r"^/review\?kp="))
        await expect(sheet.get_by_text("1 / 4")).to_be_visible()
        await shot(page, "09-branch-sheet", full=False)
        await sheet.get_by_role("button", name="장소", exact=True).click()
        sheet = page.get_by_role("dialog", name=re.compile("장소$"))
        await expect(sheet.get_by_text("2 / 4")).to_be_visible()
        await expect(sheet.get_by_label("아래 가지").get_by_text("엽록소", exact=True)).to_be_visible()  # 가지 아래의 아래도 보인다
        await expect(sheet.get_by_label("예").locator(".kok-red", has_text="엽록소")).to_be_visible()  # 노트에서 고친 예시도 (꾸미기 그대로)
        # 정리에서 보기 → 정리 탭의 그 개념, 그림 탭으로 돌아오면 그 가지 카드가 표시돼 있다
        await sheet.get_by_role("button", name="정리에서 보기").click()
        await expect(page.get_by_role("tab", name="정리")).to_have_attribute("aria-selected", "true")
        await expect(page.locator("#kp-k2")).to_have_class(re.compile(r"shadow-\[0_0_0_3px_var\(--hl\)\]"))
        await expect(page.locator("#kp-k2")).to_be_in_viewport()
        await page.locator("#kp-k2").click(position={"x": 8, "y": 8})  # 한 번 더 누르면 표시를 끈다
        await expect(page.locator("#kp-k2")).not_to_have_class(re.compile(r"shadow-\[0_0_0_3px"))
        await page.locator("#kp-k2").click(position={"x": 8, "y": 8})
        await page.get_by_role("tab", name="그림").click()
        await expect(page.locator("#branch-n2 > button")).to_have_class(re.compile(r"shadow-\[0_0_0_3px_var\(--hl\)\]"))
        # 큰 지도: 고른 보기는 이 기기에 기억한다
        await mm_view.get_by_role("radio", name="지도").click()
        big = page.get_by_role("img", name="마인드맵: 광합성")
        await expect(big).to_be_visible()
        assert await page.evaluate("localStorage.getItem('kok.mindmap.mode')") == "map"
        await expect(big.get_by_role("button", name="재료, 아직 안 풀었어요")).to_be_visible()
        await page.wait_for_timeout(300)
        await shot(page, "09-mindmap-map", full=False)
        # 지도에서 가지를 눌러도 가지 자세히
        await big.get_by_role("button", name=re.compile("^결과물")).first.click()
        await expect(page.get_by_role("dialog", name=re.compile("결과물$")).get_by_text("노트 설명")).to_be_visible()
        await page.keyboard.press("Escape")
        await expect(page.get_by_role("dialog", name=re.compile("결과물$"))).to_be_hidden()
        await page.get_by_role("button", name="가리기", exact=True).click()
        await expect(mm_view).to_be_hidden()  # 가리기·고치기는 큰 지도에서만
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
        await page.get_by_role("button", name="가리기 끝", exact=True).click()
        # 고치기
        await page.get_by_role("button", name="고치기", exact=True).click()
        await page.get_by_role("button", name=re.compile("^재료")).first.click()
        await page.get_by_label("가지 글자").fill("재료(원료)")
        await page.get_by_role("button", name="저장", exact=True).click()
        await expect(page.get_by_role("button", name=re.compile(r"^재료\(원료\)")).first).to_be_visible()
        await page.get_by_role("button", name="가지 추가").click()
        await expect(page.get_by_text("저장됨")).to_be_visible()
        await shot(page, "11-mindmap-edit", full=False)
        await page.get_by_role("button", name="고치기 끝", exact=True).click()
        await expect(mm_view.get_by_role("radio", name="지도")).to_have_attribute("aria-checked", "true")
        # 다시 그리기
        await page.get_by_role("button", name="그림 더보기").click()
        await page.get_by_role("button", name=re.compile("AI로 다시 그리기")).click()
        await expect(page.get_by_role("heading", name="새 그림 미리보기")).to_be_visible()
        await page.get_by_role("button", name="적용").click()
        await expect(page.get_by_text("새 그림으로 바꿨어요.")).to_be_visible()
        await page.wait_for_timeout(600)
        assert await page.get_by_role("button", name=re.compile(r"^재료\(원료\)")).count() >= 1, "edited node should survive regenerate"
        # 표로 만들기
        await page.get_by_role("button", name="그림 더보기").click()
        await page.get_by_role("button", name=re.compile("^표로 만들기")).click()
        await page.get_by_role("button", name="적용").click()
        await expect(page.get_by_role("radio", name="표")).to_be_visible()
        await page.get_by_role("radio", name="표").click()
        await expect(page.get_by_role("heading", name="광합성 정리표")).to_be_visible()
        await shot(page, "12-table", full=False)
        await no_hscroll(page, "table")
        # 지도 모양 (더보기 안)
        await page.get_by_role("radio", name="마인드맵").click()
        for layout in ["오른쪽으로", "아래로", "가운데서 퍼지기"]:
            await page.get_by_role("button", name="그림 더보기").click()
            more = page.get_by_role("dialog", name="그림 더보기")
            await more.get_by_role("radio", name=layout).click()
            await expect(more.get_by_role("radio", name=layout)).to_have_attribute("aria-checked", "true")
            await page.keyboard.press("Escape")
            await expect(more).to_be_hidden()
            await page.wait_for_timeout(250)
            await shot(page, f"13-layout-{layout}", full=False)
        # 다음 시험들을 위해 카드 보기로 되돌린다
        await mm_view.get_by_role("radio", name="카드").click()

        step("questions tab")
        await page.get_by_role("tab", name=re.compile("문제")).click()
        await expect(page.get_by_text("광합성이 일어나는 세포 소기관은?")).to_be_visible()
        await page.get_by_role("button", name="직접 만들기").click()
        await page.get_by_role("dialog").get_by_role("radio", name="OX").click()
        dlg = page.get_by_role("dialog")
        await dlg.get_by_label("문제", exact=True).fill("엽록소는 초록색 색소이다.")
        # 연결할 개념: 앱 디자인의 고르기 칸 (시트 안). Esc·밖을 누르면 목록만 닫히고 시트는 그대로
        kp = dlg.get_by_role("button", name=re.compile("^연결할 개념"))
        listbox = page.get_by_role("listbox", name="연결할 개념")
        await kp.click()
        await expect(listbox).to_be_visible()
        await expect(listbox.get_by_role("option", name="없음")).to_have_attribute("aria-selected", "true")
        await shot(page, "14-select-in-sheet", full=False)
        await page.keyboard.press("Escape")
        await expect(listbox).to_be_hidden()
        await expect(dlg).to_be_visible()
        await expect(kp).to_be_focused()
        await page.keyboard.press("ArrowDown")  # 키보드로 열고 한 칸 내려 Enter
        await expect(listbox).to_be_visible()
        await page.keyboard.press("ArrowDown")
        await page.keyboard.press("Enter")
        await expect(listbox).to_be_hidden()
        await expect(kp).to_have_text("광합성의 재료")
        await expect(kp).to_be_focused()
        await kp.click()
        await page.mouse.click(195, 30)  # 시트 바깥(어두운 곳)을 눌러도 목록만 닫힌다
        await expect(listbox).to_be_hidden()
        await expect(dlg).to_be_visible()
        await kp.click()
        await listbox.get_by_role("option", name="광합성 장소: 엽록체").click()
        await expect(kp).to_have_text("광합성 장소: 엽록체")
        await dlg.get_by_role("button", name="저장", exact=True).click()
        await expect(page.get_by_text("문제를 만들었어요.")).to_be_visible()
        linked = subprocess.run(
            ["psql", "-d", "kokapp", "-tAc", "select k->>'title' from public.questions q join public.notes n on n.id = q.note_id, jsonb_array_elements(n.body->'key_points') k "
             "where q.prompt = '엽록소는 초록색 색소이다.' and k->>'id' = q.key_point_id"],
            capture_output=True, text=True, check=True,
        ).stdout.strip()
        assert linked == "광합성 장소: 엽록체", linked
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

        step("review session: pick a period and a time, core questions first, no hard stop")
        await page.goto(BASE + "/review")
        await expect(page.get_by_role("heading", name="복습", exact=True)).to_be_visible()
        periods = page.get_by_role("radiogroup", name="언제 공부한 문제를 풀까요?")
        await expect(periods).to_be_visible()
        # 방금 만든 문제는 모두 복습할 차례 (처음 보는 문제는 바로 나온다)
        await expect(periods.get_by_role("radio", name=re.compile("^복습할 차례"))).to_have_attribute("aria-checked", "true")
        start_btn = page.get_by_role("button", name=re.compile(r"^\d+문제 시작$"))
        await expect(start_btn).to_be_visible()
        await expect(page.get_by_role("list", name="고른 문제")).to_be_visible()
        assert await page.get_by_text("세션 길이").count() == 0
        await shot(page, "16-review-start", full=False)
        await no_hscroll(page, "review start")
        # 오늘 넣은 문제로 바꾸고, 시간을 고를 수 있으면 30분 (5분은 핵심 문제만)
        today_chip = periods.get_by_role("radio", name=re.compile("^오늘"))
        await today_chip.click()
        await expect(today_chip).to_have_attribute("aria-checked", "true")
        times = page.get_by_role("radiogroup", name="얼마나 풀까요?")
        if await times.count():
            await expect(times.get_by_role("radio", name=re.compile("^5분"))).to_contain_text(re.compile("핵심|전부"))
            await times.get_by_role("radio", name=re.compile("^30분")).click()
            print("   time cards:", await times.inner_text())
        else:
            await expect(page.get_by_text(re.compile(r"전부 \d+문제 · 약 \d+분이면 다 풀어요"))).to_be_visible()
            print("   all questions fit in 5 minutes")
        await shot(page, "16a-review-today", full=False)
        await start_btn.click()
        # 남은 시간은 안내만 (시계 아이콘 + 분:초)
        await expect(page.get_by_text(re.compile(r"남은 시간 \d+:\d{2}"))).to_be_visible()
        # 고른 기간은 다음에 그대로 (설정에 저장)
        await poll_db(f"select settings->'review'->>'period' from public.profiles where id = '{USERS['student'][0]}'", "today")
        seen = 0
        answered_types = set()
        for i in range(30):
            if await page.get_by_role("heading", name=re.compile("오늘 할 일 끝|다 풀었어요|다음에 또")).count():
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
        if not await page.get_by_role("heading", name=re.compile("오늘 할 일 끝|다 풀었어요|다음에 또")).count():
            await shot(page, "debug-review")
        await expect(page.get_by_role("heading", name=re.compile("오늘 할 일 끝|다 풀었어요|다음에 또"))).to_be_visible(timeout=10000)
        end_text = await page.locator("main").inner_text()
        assert not re.search("[\U0001F300-\U0001FAFF\u2600-\u27BF]", end_text), end_text
        await shot(page, "19-review-end", full=False)
        print("   answered:", seen, sorted(answered_types))
        # 다시 열면 고른 기간(오늘)이 그대로 (복습할 차례가 남아 있으면 그것이 먼저)
        await page.goto(BASE + "/review")
        await expect(page.get_by_role("radiogroup", name="언제 공부한 문제를 풀까요?")).to_be_visible()
        print("   reopened with:", await page.get_by_role("radio", checked=True).first.inner_text())

        step("wrong note")
        await page.goto(BASE + "/wrong")
        await expect(page.get_by_role("heading", name="오답노트")).to_be_visible()
        await page.wait_for_timeout(600)
        await shot(page, "20-wrong")
        await no_hscroll(page, "wrong")

        step("links from other screens open what they say (review modes, note tab)")
        # 눌러서 들어가면(화면 안 이동) 그리는 동안 주소가 아직 앞 화면이다. 그래도 주소대로 열려야 한다
        await page.get_by_role("link", name="전부 다시 풀기").click()
        await page.wait_for_url(re.compile(r"/review\?mode=wrong$"))
        await expect(page.get_by_role("heading", name="오답 다시 풀기")).to_be_visible()
        await page.go_back()
        await page.wait_for_url(re.compile(r"/wrong$"))
        await expect(page.get_by_role("link", name="전부 다시 풀기")).to_be_visible()
        weak_try = page.get_by_role("link", name="이 개념 풀기").first
        if await weak_try.count():
            await weak_try.click()
            await page.wait_for_url(re.compile(r"/review\?kp="))
            await expect(page.get_by_role("heading", name="약점 개념 풀기")).to_be_visible()
            await page.go_back()
            await page.wait_for_url(re.compile(r"/wrong$"))
            await page.get_by_role("link", name="마인드맵에서 보기").first.click()
            await page.wait_for_url(re.compile(r"/notes/[0-9a-f-]{36}\?tab=visual&kp="))
            await expect(page.get_by_role("tab", name="그림")).to_have_attribute("aria-selected", "true")
            print("   weak concept links ok")

        step("note practice: '이 노트 문제 풀기' solves that note's questions right there")
        note_title = db(f"select title from public.notes where source_id = '{sid}'")
        n_active = int(db(f"select count(*) from public.questions q join public.notes n on n.id = q.note_id where n.source_id = '{sid}' and q.status = 'active'"))
        assert n_active >= 3, n_active

        async def answer_current():
            """보이는 문제에 답하고 다음으로 (쓰는 답은 맞혀서 AI 채점을 부르지 않는다: AI 요청은 1분에 10번까지)"""
            if await page.get_by_role("button", name="O 맞다").count():
                await page.get_by_role("button", name="O 맞다").click()
            elif await page.get_by_label("답").count():
                card_text = await page.locator("main").inner_text()
                await page.get_by_label("답").fill("기공" if "기체가 드나드는" in card_text else "녹말")
                await page.get_by_role("button", name="확인").click()
            else:
                await page.locator("main button:has-text('1')").first.click()
            await expect(page.get_by_role("button", name="다음")).to_be_visible(timeout=15000)
            await page.get_by_role("button", name="다음").click()
            await page.wait_for_timeout(150)

        # 문제 탭에서: 고르는 화면 없이 바로 그 노트의 첫 문제. 시간 제한·아래 메뉴 없이, 위에 노트 이름
        await page.goto(BASE + "/library")
        await page.goto(BASE + f"/notes/{sid}")
        await page.get_by_role("tab", name=re.compile("문제")).click()
        await page.wait_for_url(re.compile(r"\?tab=questions$"))
        logs0 = int(db("select count(*) from public.review_logs"))
        await page.get_by_role("link", name="이 노트 문제 풀기").click()
        await page.wait_for_url(re.compile(rf"/notes/{sid}/practice\?from=note$"))
        await expect(page.get_by_text(re.compile(rf"^1 / {n_active}$"))).to_be_visible()
        assert await page.get_by_role("button", name="시작").count() == 0
        assert await page.get_by_label("남은 시간").count() == 0
        await expect(page.get_by_role("navigation", name="주 메뉴")).to_have_count(0)
        await expect(page.get_by_role("heading", name=note_title, exact=True)).to_be_visible()
        await shot(page, "19a-practice", full=False)
        await answer_current()
        await answer_current()
        await expect(page.get_by_text(re.compile(r"^3 / \d+$"))).to_be_visible()
        await page.get_by_role("button", name="그만하기").click()
        await expect(page.get_by_role("heading", name="여기까지 풀었어요")).to_be_visible()
        await expect(page.locator("main").get_by_text("푼 문제")).to_be_visible()
        await poll_db("select count(*) from public.review_logs", str(logs0 + 2))
        await shot(page, "19b-practice-end", full=False)
        await no_hscroll(page, "practice end")
        # 노트로 돌아가기 = 뒤로 가기: 보던 문제 탭 그대로, 노트가 방문 기록에 두 번 쌓이지 않는다.
        # 두 번 눌러도 한 번만 뒤로 간다
        await page.evaluate("""() => {
          const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === '노트로 돌아가기');
          b.click();
          b.click();
        }""")
        await page.wait_for_url(re.compile(rf"/notes/{sid}\?tab=questions$"))
        await expect(page.get_by_role("tab", name=re.compile("문제"))).to_have_attribute("aria-selected", "true")
        await expect(page.get_by_role("navigation", name="주 메뉴").first).to_be_attached()
        await page.go_back()
        await page.wait_for_url(re.compile(r"/library$"))

        # 정리 탭의 메뉴에서: 끝까지 풀면 '다 풀었어요', 한 번 더 풀기는 바로 다시 시작, 하나도 안 풀고 그만두면 바로 노트로
        await page.goto(BASE + f"/notes/{sid}")
        await page.get_by_role("button", name="노트 메뉴").click()
        await page.get_by_role("menuitem", name="이 노트 문제 풀기").click()
        await page.wait_for_url(re.compile(rf"/notes/{sid}/practice\?from=note$"))
        done = page.get_by_role("heading", name="다 풀었어요!")
        for _ in range(60):
            await expect(page.get_by_role("button", name="그만하기").or_(done)).to_be_visible()
            if await done.count():
                break
            await answer_current()
        await expect(done).to_be_visible()
        await shot(page, "19c-practice-done", full=False)
        await page.get_by_role("button", name="한 번 더 풀기").click()
        await expect(page.get_by_text(re.compile(r"^1 / \d+$"))).to_be_visible()
        await page.get_by_role("button", name="그만하기").click()
        await page.wait_for_url(re.compile(rf"/notes/{sid}$"))
        await expect(page.get_by_role("tab", name="정리")).to_have_attribute("aria-selected", "true")

        # 주소로 바로 열어도(새로 고침) 된다. 예전 주소(/review?note=)도 노트 문제 풀기로
        await page.goto(BASE + f"/notes/{sid}/practice")
        await expect(page.get_by_text(re.compile(r"^1 / \d+$"))).to_be_visible()
        await expect(page.get_by_role("heading", name=note_title, exact=True)).to_be_visible()
        await page.get_by_role("button", name="그만하기").click()
        await page.wait_for_url(re.compile(rf"/notes/{sid}$"))
        nid = db(f"select id from public.notes where source_id = '{sid}'")
        await page.goto(BASE + f"/review?note={nid}")
        await expect(page.get_by_text(re.compile(r"^1 / \d+$"))).to_be_visible()
        await page.get_by_role("button", name="그만하기").click()
        await page.wait_for_url(re.compile(rf"/notes/{sid}$"))

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
        # 과목 메뉴에서 눌러 들어가도 그 과목으로 (예전에는 오늘 복습·모든 과목이 열렸다)
        await page.get_by_role("button", name="과목 메뉴").click()
        await page.get_by_role("menuitem", name="이 과목만 복습").click()
        await page.wait_for_url(re.compile(r"/review\?subject="))
        await expect(page.get_by_role("heading", name="복습", exact=True)).to_be_visible()
        await expect(page.get_by_role("radiogroup", name="언제 공부한 문제를 풀까요?")).to_be_visible()
        subject_radio = page.get_by_role("radiogroup", name="과목").get_by_role("radio", name=re.compile("^과학"))
        if await subject_radio.count():
            await expect(subject_radio).to_have_attribute("aria-checked", "true")
        await page.go_back()
        await page.wait_for_url(LIBRARY_SUBJECT)
        await page.get_by_role("button", name="과목 메뉴").click()
        await page.get_by_role("menuitem", name="문제 모아 보기").click()
        await page.wait_for_url(re.compile(r"/questions\?subject="))
        await expect(page.get_by_role("button", name=re.compile("^과목"))).to_have_text("과학")
        await page.go_back()
        await page.wait_for_url(LIBRARY_SUBJECT)
        await page.get_by_role("tab", name=re.compile("^전체")).click()
        await page.wait_for_url(re.compile(r"/library$"))
        await page.goto(BASE + "/questions")
        await page.wait_for_timeout(800)
        await shot(page, "24-questions-all")
        subject_pick = page.get_by_role("button", name=re.compile("^과목"))
        await expect(subject_pick).to_have_text("모든 과목")
        await subject_pick.click()
        await page.get_by_role("listbox", name="과목").get_by_role("option", name="과학").click()
        await expect(subject_pick).to_have_text("과학")
        await expect(page.get_by_text("광합성이 일어나는 세포 소기관은?").first).to_be_visible()

        step("screen glow: text right on the page background is only body or muted text (phone + desktop)")
        await page.goto(BASE + "/library")
        await page.wait_for_timeout(800)
        glow_note = await page.evaluate("(() => { const a = document.querySelector('a[href^=\"/notes/\"]'); return a ? a.getAttribute('href') : null; })()")
        assert glow_note, "a note card in the library"
        for width in (390, 1280):
            gctx, gpage = await new_ctx(browser, "student", width=width)
            for path in ["/home", "/library", "/review", "/wrong", "/questions", "/settings", glow_note, glow_note + "?tab=visual", glow_note + "?tab=questions"]:
                await gpage.goto(BASE + path)
                await gpage.wait_for_timeout(1200)
                bad = await gpage.evaluate(ON_BG_JS)
                assert not bad, f"{width} {path}: coloured text on the page background {bad}"
            # 화면 빛은 하나 (집중 모드·첫 화면 밖), 아래 메뉴는 꾸미기 메뉴
            await expect(gpage.locator(".kok-aura")).to_have_count(1)
            if width == 390:
                await expect(gpage.locator("nav.kok-tabbar")).to_be_visible()
            await gctx.close()

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
        await expect(page.get_by_text("여기에 놓으면 KOK이 정리해요")).to_be_visible()
        await shot(page, "25-drop-overlay", full=False)
        await drop_files(page)
        await expect(page.get_by_text("여기에 놓으면 KOK이 정리해요")).to_be_hidden()
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
        # 입력칸에 커서가 들어간 뒤(= Esc 를 듣기 시작한 뒤)에 누른다
        await expect(page.get_by_role("dialog", name="자료 넣기").locator("textarea")).to_be_focused()
        await page.keyboard.press("Escape")
        await expect(page.get_by_role("dialog", name="자료 넣기")).to_be_hidden()

        step("blank note: no AI, I fill it myself")
        await page.get_by_role("button", name="자료 넣기", exact=True).click()
        composer = page.get_by_role("dialog", name="자료 넣기")
        await expect(composer).to_be_visible()
        await composer.get_by_label("공부한 내용").fill("세포 호흡")
        await composer.get_by_role("button", name="빈 노트").click()
        await expect(composer.get_by_label("노트 이름")).to_have_value("세포 호흡")
        await shot(page, "28-composer-blank", full=False)
        ledger_before = db(f"select count(*) from public.energy_ledger where user_id = '{USERS['student'][0]}'")
        await composer.get_by_role("button", name="만들기").click()
        await page.wait_for_url("**/notes/*")
        assert await wait_ready(page), "blank note did not open"
        await expect(page.get_by_role("heading", name="세포 호흡", exact=True)).to_be_visible()
        await expect(page.get_by_text("직접 만든 노트").first).to_be_visible()
        await expect(page.get_by_text("아직 개념이 없어요")).to_be_visible()
        await shot(page, "28-blank-note", full=False)
        bsid = page.url.rstrip("/").split("/")[-1].split("?")[0]
        assert db(f"select status || ' ' || step || ' ' || kind from public.sources where id = '{bsid}'") == "ready done text"
        assert db(f"select body->>'manual' from public.notes where source_id = '{bsid}'") == "true"
        # 빈 노트로는 AI 문제·그림을 만들지 않는다 (에너지를 쓰기 전에 알려 준다)
        bnid = db(f"select id from public.notes where source_id = '{bsid}'")
        r = await page.request.post(BASE + f"/api/notes/{bnid}/quiz", headers={"origin": BASE}, data={"action": "preview"})
        assert r.status == 400 and (await r.json())["error"] == "empty_note", (r.status, await r.text())
        await page.get_by_role("button", name="첫 개념 적기").click()
        await page.get_by_label("개념 이름").fill("세포 호흡")
        await page.get_by_label("설명", exact=True).fill("포도당을 분해해 **에너지**를 얻는 과정")
        await page.get_by_role("button", name="저장", exact=True).click()
        await expect(page.locator("article strong", has_text="에너지")).to_be_visible()
        await page.get_by_role("button", name="용어 추가").click()
        await page.get_by_label("용어", exact=True).fill("미토콘드리아")
        await page.get_by_label("뜻", exact=True).fill("세포 호흡이 일어나는 곳")
        await page.get_by_role("button", name="저장", exact=True).click()
        await expect(page.get_by_text("세포 호흡이 일어나는 곳")).to_be_visible()
        assert db(f"select count(*) from public.energy_ledger where user_id = '{USERS['student'][0]}'") == ledger_before, "a blank note uses no energy"
        await page.get_by_role("tab", name="원본").click()
        await expect(page.get_by_text("직접 만든 노트라 원본이 없어요")).to_be_visible()
        await page.get_by_role("tab", name="정리").click()
        # 이름 바꾸기 (노트와 자료함 이름이 같이)
        await page.get_by_role("button", name="노트 메뉴").click()
        await page.get_by_role("menuitem", name="이름 바꾸기").click()
        rename = page.get_by_role("dialog", name="노트 이름")
        await rename.get_by_label("노트 이름").fill("세포 호흡 노트")
        await rename.get_by_role("button", name="저장").click()
        await expect(page.get_by_role("heading", name="세포 호흡 노트", exact=True)).to_be_visible()
        assert db(f"select title from public.sources where id = '{bsid}'") == "세포 호흡 노트"
        assert db(f"select title from public.notes where source_id = '{bsid}'") == "세포 호흡 노트"
        await page.goto(BASE + "/library")
        blank_card = page.get_by_role("link", name="세포 호흡 노트", exact=True)
        await expect(blank_card).to_be_visible()
        await expect(blank_card).to_contain_text("직접 만든 노트")

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
        await page.get_by_label(re.compile("KOK에서 쓸 이름")).fill("운영자")
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
        await page.get_by_label(re.compile("KOK에서 쓸 이름")).fill("다른학생")
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
        await sheet.get_by_label("에너지 총량").fill("100")
        await sheet.get_by_label("PDF 쪽수 (한 번에)").fill("33")
        await sheet.get_by_text("꼼꼼 모델 쓰기").click()  # 끈다
        await shot(apage, "35-admin-plan-form", full=False)
        await sheet.get_by_role("button", name="플랜 만들기").click()
        await expect(apage.get_by_text(re.compile("'베타 테스터' 플랜을 만들었어요"))).to_be_visible()
        plan_item = apage.locator("li").filter(has=apage.get_by_role("button", name="고치기"))
        await expect(plan_item).to_have_count(1)
        await expect(plan_item.get_by_text("에너지 100", exact=True)).to_be_visible()
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
        await expect(opage.get_by_text("에너지 100 / 100", exact=True)).to_be_visible()
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
        await expect(opage.get_by_text("플랜 남은 에너지 100 / 100")).to_be_visible()

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
        await sheet.get_by_label("에너지 총량").fill("1")
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
        await expect(chat.get_by_text(re.compile(r"^에너지 [\d.]+$")).first).to_be_visible()
        n_before = live_q()
        await box.fill("이 노트로 문제 만들어 줘")
        await box.press("Enter")
        await expect(chat.get_by_text("이 문제 2개를 노트에 넣을까요?")).to_be_visible(timeout=15000)
        assert live_q() == n_before, "questions must not be added before [넣기]"
        await shot(page, "41-chat-proposal", full=False)
        await chat.get_by_role("button", name="넣기", exact=True).click()
        await expect(page.get_by_text("문제 2개를 넣었어요.")).to_be_visible()
        await expect(chat.get_by_text("넣었어요", exact=True)).to_be_visible()
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
        await expect(add.get_by_text(re.compile(r"에너지 약 [\d.]+"))).to_be_visible()
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
        await page.get_by_label("요약", exact=True).fill("버전 1에서 고친 요약이에요.")
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

        # ---------------- 고친 버그: 실패한 자료 다시 하기, 예전 탭, 쉬는 문제, 긴 채팅, 노트마다 줄
        student_id = USERS["student"][0]
        # 앞 단계에서 AI 를 많이 불러서 하루 에너지·1분 요청 한도에 걸리지 않게 비운다
        psql(f"delete from public.energy_ledger where user_id = '{student_id}'; delete from public.rate_hits where user_id = '{student_id}'")
        kp_titles = lambda: psql(
            f"select coalesce(string_agg(k->>'title', '|'), '') from public.notes n, jsonb_array_elements(n.body->'key_points') k where n.source_id = '{note_sid}'"
        )
        cur_version = lambda: int(psql(f"select current_version from public.notes where source_id = '{note_sid}'"))
        child_of = lambda prefix: psql(f"select id from public.sources where parent_id = '{note_sid}' and text_content like '{prefix}%'")

        async def wait_db(page, sql, want, timeout=120):
            t0 = time.time()
            while time.time() - t0 < timeout:
                if psql(sql) == want:
                    return True
                await page.wait_for_timeout(700)
            return False

        step("a failed addition retried after another one merges into the newest version")
        ctx, page = await new_ctx(browser, "student")
        await page.goto(BASE + f"/notes/{note_sid}?tab=original")
        assert await wait_ready(page)
        add = page.get_by_role("region", name="이 노트에 자료 더하기")
        v_start = cur_version()
        urllib.request.urlopen("http://localhost:54321/__fail?task=quiz")
        try:
            await add.get_by_label("더할 내용").fill("B 자료예요. 표시:베타 직렬 회로와 병렬 회로를 정리해 보자.")
            await add.get_by_role("button", name="글 더하기").click()
            await expect(page.get_by_text("자료를 더하지 못했어요")).to_be_visible(timeout=120000)
        finally:
            urllib.request.urlopen("http://localhost:54321/__fail?task=")
        b_id = child_of("B 자료예요")
        assert psql(f"select status from public.sources where id = '{b_id}'") == "error"
        assert cur_version() == v_start, "a failed addition makes no version"
        # B 가 멈춘 사이 C 를 더해 새 버전이 생긴다
        await add.get_by_label("더할 내용").fill("C 자료예요. 표시:감마 전류와 전압의 관계를 정리해 보자.")
        await add.get_by_role("button", name="글 더하기").click()
        assert await wait_db(page, f"select status from public.sources where parent_id = '{note_sid}' and text_content like 'C 자료예요%'", "ready")
        v_c = cur_version()
        assert v_c != v_start and "표시 감마" in kp_titles() and "표시 베타" not in kp_titles(), kp_titles()
        await expect(page.get_by_text("자료를 더하지 못했어요")).to_be_visible()
        await shot(page, "50-append-failed", full=False)
        # B 를 다시 하면 B 를 합쳐 둔 옛 버전이 아니라 지금 버전(C 까지 든 것)에 다시 합친다
        await page.get_by_role("region", name="노트에 더하는 자료").get_by_role("button", name="다시 하기").click()
        assert await wait_db(page, f"select status from public.sources where id = '{b_id}'", "ready")
        titles = kp_titles()
        assert "표시 감마" in titles and "표시 베타" in titles, titles
        v_b = cur_version()
        assert v_b not in (v_start, v_c), (v_start, v_c, v_b)
        mats = psql(
            f"select string_agg(m->>'source_id', ',') from public.note_versions v join public.notes n on n.id = v.note_id, jsonb_array_elements(v.materials) m "
            f"where n.source_id = '{note_sid}' and v.number = {v_b}"
        )
        assert b_id in mats and child_of("C 자료예요") in mats, mats
        await page.get_by_role("tab", name="정리").click()
        await expect(page.get_by_role("heading", name=re.compile("표시 베타"))).to_be_visible(timeout=15000)
        await expect(page.get_by_role("heading", name=re.compile("표시 감마"))).to_be_visible()

        step("an old tab cannot overwrite a newer version, and a rested question stays rested")
        # 지금 버전에만 있는 문제 하나를 쉬게 한다
        only_cur = psql(
            f"select q.id from public.questions q join public.notes n on n.id = q.note_id where n.source_id = '{note_sid}' and q.status = 'active' "
            f"and not exists (select 1 from public.note_versions v where v.note_id = n.id and v.number <> n.current_version and q.id = any(v.question_ids)) "
            f"order by q.created_at desc limit 1"
        )
        assert only_cur, "a question only in the current version"
        psql(f"update public.questions set status = 'suspended' where id = '{only_cur}'")
        page2 = await ctx.new_page()
        await page2.goto(BASE + f"/notes/{note_sid}?tab=original")
        assert await wait_ready(page2)
        versions2 = page2.get_by_role("region", name="버전 기록")
        await versions2.locator("li").filter(has_text=f"버전 {v_c} ·").get_by_role("button", name="열기").click()
        await expect(page2.get_by_text("지난 버전을 보고 있어요")).to_be_visible()
        page2.once("dialog", lambda d: d.accept())
        await page2.get_by_role("button", name="이 버전 쓰기").first.click()
        await expect(page2.get_by_text(f"지금 버전을 바꿨어요 (버전 {v_c}).")).to_be_visible()
        assert cur_version() == v_c
        assert psql(f"select status || ',' || rested_hidden::text from public.questions where id = '{only_cur}'") == "hidden,true"
        # 첫 탭은 아직 예전(버전 {v_b}) 화면이다: 여기서 고쳐도 지금 버전을 덮어쓰지 않는다
        summary_before = psql(f"select body->>'summary' from public.notes where source_id = '{note_sid}'")
        await page.get_by_role("button", name="요약 고치기").click()
        await page.get_by_label("요약", exact=True).fill("예전 탭에서 고친 요약이에요.")
        await page.get_by_role("button", name="저장", exact=True).first.click()
        await expect(page.get_by_text("그사이 다른 곳에서 노트가 바뀌어서 방금 고친 것은 저장하지 못했어요.")).to_be_visible(timeout=10000)
        await page.wait_for_timeout(600)
        assert psql(f"select body->>'summary' from public.notes where source_id = '{note_sid}'") == summary_before
        assert psql(f"select count(*) from public.note_versions v join public.notes n on n.id = v.note_id where n.source_id = '{note_sid}' and v.body->>'summary' = '예전 탭에서 고친 요약이에요.'") == "0"
        await shot(page, "51-stale-tab", full=False)
        # 새로 불러온 화면은 지금 버전이라 고칠 수 있다
        await expect(page.get_by_text(f"버전 {v_c}").first).to_be_visible(timeout=10000)
        # 같은 버전이어도 다른 탭에서 먼저 고쳤으면 덮어쓰지 않는다
        await page.wait_for_timeout(4500)  # 앞 알림이 사라지고 같은 알림이 다시 뜰 수 있게
        await page2.goto(BASE + f"/notes/{note_sid}")
        assert await wait_ready(page2)
        await page2.get_by_role("button", name="요약 고치기").click()
        await page2.get_by_label("요약", exact=True).fill("다른 탭에서 먼저 고친 요약이에요.")
        await page2.get_by_role("button", name="저장", exact=True).first.click()
        await expect(page2.get_by_text("다른 탭에서 먼저 고친 요약이에요.")).to_be_visible()
        await page2.wait_for_timeout(800)
        assert psql(f"select body->>'summary' from public.notes where source_id = '{note_sid}'") == "다른 탭에서 먼저 고친 요약이에요."
        await page.get_by_role("button", name="요약 고치기").click()
        await page.get_by_label("요약", exact=True).fill("늦게 고친 요약이에요.")
        await page.get_by_role("button", name="저장", exact=True).first.click()
        await expect(page.get_by_text("그사이 다른 곳에서 노트가 바뀌어서 방금 고친 것은 저장하지 못했어요.")).to_be_visible(timeout=10000)
        await page.wait_for_timeout(600)
        assert psql(f"select body->>'summary' from public.notes where source_id = '{note_sid}'") == "다른 탭에서 먼저 고친 요약이에요."
        await expect(page.get_by_text("다른 탭에서 먼저 고친 요약이에요.")).to_be_visible(timeout=10000)
        # 쉬게 한 문제는 그 버전으로 돌아와도 쉬는 중이다 (복습에 다시 나오지 않는다)
        await page2.goto(BASE + f"/notes/{note_sid}?tab=original")
        assert await wait_ready(page2)
        await versions2.locator("li").filter(has_text=f"버전 {v_b} ·").get_by_role("button", name="열기").click()
        page2.once("dialog", lambda d: d.accept())
        await page2.get_by_role("button", name="이 버전 쓰기").first.click()
        await expect(page2.get_by_text(f"지금 버전을 바꿨어요 (버전 {v_b}).")).to_be_visible()
        assert psql(f"select status || ',' || rested_hidden::text from public.questions where id = '{only_cur}'") == "suspended,false"
        await page2.close()

        step("note chat opens at the newest messages even with a long history")
        note_id = psql(f"select id from public.notes where source_id = '{note_sid}'")
        psql(
            f"insert into public.chat_messages (user_id, note_id, role, content, created_at) "
            f"select '{student_id}', '{note_id}', case when i % 2 = 0 then 'assistant' else 'user' end, '긴 대화 ' || i, now() + make_interval(secs => i) "
            f"from generate_series(1, 230) i"
        )
        await page.goto(BASE + f"/notes/{note_sid}")
        assert await wait_ready(page)
        await page.get_by_role("button", name="노트에게 물어보기").click()
        chat = page.get_by_role("dialog", name="노트에게 물어보기")
        await expect(chat.get_by_text("긴 대화 230", exact=True)).to_be_visible()
        await expect(chat.get_by_text("긴 대화 31", exact=True)).to_be_visible()
        assert await chat.get_by_text("긴 대화 30", exact=True).count() == 0, "only the newest 200 are shown"
        await page.keyboard.press("Escape")
        psql(f"delete from public.chat_messages where note_id = '{note_id}' and content like '긴 대화 %'")

        step("material waiting for its note does not hold up other uploads")
        # 이 노트에 더하는 자료가 정리 중인 것처럼 둔다 (서버가 가져가지 않게 잠가 둔다)
        blocker = str(uuid.uuid4())
        sub_id = psql(f"select subject_id from public.sources where id = '{note_sid}'")
        psql(
            f"insert into public.sources (id, user_id, subject_id, kind, title, status, step, parent_id, locked_until) "
            f"values ('{blocker}', '{student_id}', '{sub_id}', 'text', '막는 자료', 'processing', 'organize', '{note_sid}', now() + interval '1 hour')"
        )
        await page.goto(BASE + f"/notes/{note_sid}?tab=original")
        assert await wait_ready(page)
        add = page.get_by_role("region", name="이 노트에 자료 더하기")
        await add.get_by_label("더할 내용").fill("D 자료예요. 표시:델타 저항과 전류의 관계를 정리해 보자.")
        await add.get_by_role("button", name="글 더하기").click()
        queue = page.get_by_label("넣는 중인 자료")
        await expect(queue.get_by_text("이 노트에 먼저 더하는 자료가 끝나면 시작해요")).to_be_visible(timeout=20000)
        # 자료를 더하는 동안에는 정리·그림을 고칠 수 없다 (합치는 바탕이 바뀌지 않게)
        await page.get_by_role("tab", name="정리").click()
        await expect(page.get_by_text("한 줄 요약")).to_be_visible()
        assert await page.get_by_role("button", name="요약 고치기").count() == 0, "note editing is locked while adding material"
        await page.get_by_role("tab", name="그림").click()
        await expect(page.get_by_role("button", name="고치기", exact=True)).to_be_disabled()
        await expect(page.get_by_text("이 노트에 자료를 더하는 중이에요. 끝나면 고칠 수 있어요.").first).to_be_visible()
        # 화면을 새로 열지 않고 자료함으로 옮겨 + 버튼으로 새 자료를 넣는다: 앞 줄을 기다리지 않고 바로 시작한다
        await page.get_by_role("link", name="자료함으로").first.click()
        await page.wait_for_url(LIBRARY_SUBJECT)
        await page.get_by_role("button", name="자료 넣기", exact=True).click()
        composer = page.get_by_role("dialog", name="자료 넣기")
        await composer.get_by_label("공부한 내용").fill("E 자료예요. 노트에 더하는 자료를 기다리지 않고 바로 정리를 시작하는지 보는 글이에요.")
        await composer.get_by_label("공부한 내용").press("Enter")
        assert await wait_db(page, "select count(*) from public.sources where parent_id is null and text_content like 'E 자료예요%'", "1", timeout=30)
        await expect(queue.get_by_text("이 노트에 먼저 더하는 자료가 끝나면 시작해요")).to_be_visible()
        assert child_of("D 자료예요") == "", "the addition still waits for the earlier one"
        await shot(page, "52-queue-per-note", full=False)
        # 앞 자료가 끝나면 기다리던 자료도 더한다
        psql(f"delete from public.sources where id = '{blocker}'")
        assert await wait_db(page, f"select status from public.sources where parent_id = '{note_sid}' and text_content like 'D 자료예요%'", "ready")
        assert "표시 델타" in kp_titles(), kp_titles()
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

        # ---------------- 그림 풀이·AI 채팅
        step("Pro: a new note's questions come with figures and step-by-step solutions")
        psql(f"delete from public.energy_ledger where user_id = '{student_id}'; delete from public.rate_hits where user_id = '{student_id}'")
        ctx, page = await new_ctx(browser, "student")
        await page.goto(BASE + "/library")
        await page.get_by_role("button", name="자료 넣기", exact=True).click()
        composer = page.get_by_role("dialog", name="자료 넣기")
        await composer.get_by_label("공부한 내용").fill("그림 풀이 시험 자료. 광합성은 빛 에너지로 물과 이산화탄소에서 포도당과 산소를 만든다. 빛이 셀수록 광합성량이 늘다가 일정해진다.")
        await composer.get_by_label("공부한 내용").press("Enter")
        assert await wait_db(page, "select count(*) from public.sources where text_content like '그림 풀이 시험 자료%'", "1", timeout=30)
        fig_sid = psql("select id from public.sources where text_content like '그림 풀이 시험 자료%'")
        await page.goto(BASE + f"/notes/{fig_sid}")
        assert await wait_ready(page, 120), "figure note not ready"
        fig_q = lambda cond: int(psql(f"select count(*) from public.questions q join public.notes n on n.id = q.note_id where n.source_id = '{fig_sid}' and {cond}"))
        n_fig, n_steps, n_all = fig_q("q.figure is not null"), fig_q("q.steps is not null"), fig_q("true")
        print("   questions:", n_all, "with figure:", n_fig, "with steps:", n_steps)
        assert n_fig >= 2 and n_steps >= 4, (n_fig, n_steps)
        # 그림 풀이는 단계(solve)로 따로 받고, 단계마다 문제 몇 개씩
        assert int(psql(f"select count(*) from public.energy_ledger where source_id = '{fig_sid}' and task = 'solve'")) == 2
        # 문제 탭: 그림 풀이 표시, 펼치면 문제 그림과 단계별 풀이
        await page.get_by_role("tab", name=re.compile("문제")).click()
        await expect(page.get_by_text("그림 풀이", exact=True).first).to_be_visible()
        first_fig = page.locator(".kok-card", has=page.get_by_text("그림 풀이", exact=True)).first
        await first_fig.get_by_role("button", name=re.compile("보기$")).click()
        await expect(first_fig.get_by_role("img", name="문제 그림")).to_be_visible()
        await first_fig.get_by_role("button", name=re.compile("그림으로 보는 단계별 풀이")).click()
        player = first_fig.get_by_role("region", name="단계별 풀이")
        await expect(player.get_by_role("button", name="1단계")).to_have_attribute("aria-current", "step")
        await player.get_by_role("button", name="3단계").click()
        await expect(player.get_by_text("3단계")).to_be_visible()
        await shot(page, "55-question-figure", full=False)
        await no_hscroll(page, "question figure")
        # 문제 풀기: 그림이 있는 문제는 문제 아래에 그림이 보이고, 틀리면 단계별 풀이가 처음부터 펼쳐져 있다
        await page.goto(BASE + f"/notes/{fig_sid}/practice")
        seen_fig = False
        for _ in range(8):
            await expect(page.get_by_role("button", name="그만하기")).to_be_visible()
            card_text = await page.locator("main").inner_text()
            has_fig = await page.get_by_role("img", name="문제 그림").count() > 0
            if await page.get_by_role("button", name="O 맞다").count():
                await page.get_by_role("button", name="O 맞다" if has_fig else "X 틀리다").click()  # (가짜 OX 답은 모두 X)
            elif await page.get_by_label("답").count():
                await page.get_by_label("답").fill("녹말" if "포도당은" in card_text else "기공")
                await page.get_by_role("button", name="확인").click()
            else:
                await page.locator("main button:has-text('1')").first.click()  # 가짜 객관식 답은 2번
            await expect(page.get_by_role("button", name="다음", exact=True)).to_be_visible(timeout=15000)
            if has_fig:
                steps_btn = page.get_by_role("button", name=re.compile("그림으로 보는 단계별 풀이"))
                await expect(steps_btn).to_have_attribute("aria-expanded", "true")
                await expect(page.get_by_role("region", name="단계별 풀이")).to_be_visible()
                await page.get_by_role("region", name="단계별 풀이").focus()
                await page.keyboard.press("ArrowRight")  # 풀이 안의 화살표 키는 풀이 단계를 넘긴다 (다음 문제로 가지 않는다)
                await expect(page.get_by_role("button", name="2단계")).to_have_attribute("aria-current", "step")
                await expect(page.get_by_role("button", name="다음", exact=True)).to_be_visible()
                await shot(page, "56-practice-figure-wrong", full=False)
                await no_hscroll(page, "practice figure")
                seen_fig = True
                break
            await page.get_by_role("button", name="다음", exact=True).click()
        assert seen_fig, "no question with a figure in practice"
        await page.get_by_role("button", name="다음", exact=True).click()
        await page.get_by_role("button", name="그만하기").click()

        step("Pro: '그림 풀이 만들기' adds a step-by-step solution to one question")
        own_q = psql("select q.id || '|' || s.id from public.questions q join public.notes n on n.id = q.note_id join public.sources s on s.id = n.source_id where q.prompt = '엽록소는 초록색 색소이다.'")
        own_qid, own_sid = own_q.split("|")
        assert psql(f"select steps is null from public.questions where id = '{own_qid}'") == "t"
        await page.goto(BASE + f"/notes/{own_sid}?tab=questions")
        own_card = page.locator(".kok-card", has_text="엽록소는 초록색 색소이다.").first
        await own_card.get_by_role("button", name=re.compile("보기$")).click()
        await own_card.get_by_role("button", name=re.compile("^그림 풀이 만들기 에너지")).click()
        await expect(page.get_by_text("그림 풀이를 만들었어요.")).to_be_visible(timeout=30000)
        assert psql(f"select (steps is not null)::text || (figure is not null)::text from public.questions where id = '{own_qid}'") == "truetrue"
        await expect(own_card.get_by_text("그림 풀이", exact=True)).to_be_visible()
        assert int(psql(f"select count(*) from public.energy_ledger where user_id = '{student_id}' and task = 'solve' and source_id is null")) >= 1
        # 이미 풀이가 있으면 다시 만들지 않는다 (에너지를 쓰기 전에 거절)
        r = await page.request.post(BASE + f"/api/questions/{own_qid}/solve", headers={"origin": BASE}, data={})
        assert r.status in (400, 409), (r.status, await r.text())
        # 정답을 바꾸면 예전 풀이는 지운다
        was_o = psql(f"select answer::text from public.questions where id = '{own_qid}'") == "true"
        await own_card.get_by_role("button", name="고치기", exact=True).click()
        dlg = page.get_by_role("dialog")
        await dlg.get_by_role("radiogroup", name="OX 정답").get_by_role("radio", name="X (틀리다)" if was_o else "O (맞다)").click()
        await dlg.get_by_role("button", name="저장", exact=True).click()
        await poll_db(f"select (steps is null)::text || (figure is null)::text from public.questions where id = '{own_qid}'", "truetrue")

        step("note chat (Pro): a photo of a problem → steps with a figure → this note's question")
        psql(f"delete from public.rate_hits where user_id = '{student_id}'")
        await page.goto(BASE + f"/notes/{fig_sid}")
        assert await wait_ready(page)
        await page.get_by_role("button", name="노트에게 물어보기").click()
        chat = page.get_by_role("dialog", name="노트에게 물어보기")
        await expect(chat.get_by_role("button", name="사진 찍기")).to_be_visible()
        await chat.locator("input[type=file]").first.set_input_files(str(tmp / "p1.jpg"))
        await expect(chat.get_by_role("list", name="붙인 파일").get_by_role("listitem")).to_have_count(1)
        await chat.get_by_label("물어볼 내용").fill("이 문제 풀어 줘")
        await chat.get_by_label("물어볼 내용").press("Enter")
        await expect(chat.get_by_text("읽은 문제")).to_be_visible(timeout=20000)
        await expect(chat.get_by_role("region", name="단계별 풀이").get_by_role("img")).to_be_visible()
        await shot(page, "57-note-chat-solution", full=False)
        n_before = fig_q("true")
        await chat.get_by_role("button", name="이 노트 문제로 넣기").click()
        await expect(chat.get_by_text("이 노트 문제로 넣었어요")).to_be_visible()
        assert fig_q("true") == n_before + 1
        assert fig_q("q.locked and q.created_by = 'ai' and q.figure is not null and q.steps is not null and q.prompt like '∠A = 90°%'") == 1
        # 두 번 눌러도 한 번만 들어간다
        msg_id = psql(f"select m.id from public.chat_messages m join public.notes n on n.id = m.note_id where n.source_id = '{fig_sid}' and m.solution is not null")
        fig_note = psql(f"select id from public.notes where source_id = '{fig_sid}'")
        r = await page.request.post(BASE + f"/api/notes/{fig_note}/chat/apply", headers={"origin": BASE}, data={"messageId": msg_id, "action": "save_problem"})
        assert r.status == 409, r.status
        assert fig_q("true") == n_before + 1
        # Pro 는 보낸 사진을 보관한다: 다시 열어도 사진이 보인다
        path = psql(f"select m.attachments->0->>'path' from public.chat_messages m join public.notes n on n.id = m.note_id where n.source_id = '{fig_sid}' and m.role = 'user' and m.attachments is not null")
        assert path.startswith(f"{student_id}/chat/{fig_sid}/"), path
        await page.keyboard.press("Escape")
        await page.reload()
        assert await wait_ready(page)
        await page.get_by_role("button", name="노트에게 물어보기").click()
        thumb = chat.get_by_role("button", name="p1.jpg 크게 보기").locator("img")
        await expect(thumb).to_be_visible()
        await wait_js(page, "() => [...document.querySelectorAll('[aria-label=\"p1.jpg 크게 보기\"] img')].some((i) => i.complete && i.naturalWidth > 0)")
        # 대화를 지우면 보관한 사진도 지운다
        assert psql(f"select count(*) from storage.objects where name like '{student_id}/chat/{fig_sid}/%'") == "1"
        page.once("dialog", lambda d: asyncio.ensure_future(d.accept()))
        await chat.get_by_role("button", name="채팅 메뉴").click()
        await page.get_by_role("menuitem", name="대화 모두 지우기").click()
        await poll_db(f"select count(*) from public.chat_messages m join public.notes n on n.id = m.note_id where n.source_id = '{fig_sid}'", "0")
        await poll_db(f"select count(*) from storage.objects where name like '{student_id}/chat/{fig_sid}/%'", "0")
        await page.keyboard.press("Escape")

        step("home: AI에게 물어보기 → photo problem → steps with a figure → a new subject, unit and note")
        await page.goto(BASE + "/home")
        await page.get_by_role("button", name="AI에게 물어보기").click()
        ask = page.get_by_role("dialog", name="AI에게 물어보기")
        await expect(ask.get_by_role("radiogroup", name="AI 모델")).to_be_visible()
        await expect(ask.get_by_text("무엇이든 물어보세요")).to_be_visible()
        await shot(page, "60-home-ask", full=False)
        await no_hscroll(page, "home ask")
        await ask.locator("input[type=file]").first.set_input_files(str(tmp / "p2.jpg"))
        await ask.get_by_label("물어볼 내용").press("Enter")  # 사진만 보내도 된다
        await expect(ask.get_by_role("button", name="노트에 넣기")).to_be_visible(timeout=20000)
        await expect(ask.get_by_role("region", name="단계별 풀이").get_by_role("img")).to_be_visible()
        await expect(ask.get_by_text("수학 · 피타고라스 정리")).to_be_visible()
        await shot(page, "61-home-ask-solution", full=False)
        await ask.get_by_role("button", name="노트에 넣기").click()
        save = page.get_by_role("dialog", name="노트에 넣기")
        # 없는 과목(수학)이면 그 이름으로 새 과목, 단원·노트 이름도 AI 가 짐작한 것으로
        await expect(save.get_by_role("radio", name="새 과목")).to_have_attribute("aria-checked", "true")
        await expect(save.get_by_label("새 과목 이름")).to_have_value("수학")
        await expect(save.get_by_label("새 단원 이름")).to_have_value("피타고라스 정리")
        await expect(save.get_by_label("새 노트 이름")).to_have_value("피타고라스 정리 문제")
        await shot(page, "62-save-problem", full=False)
        await save.get_by_role("button", name="새 노트를 만들어 넣기").click()
        await expect(ask.get_by_text(re.compile("피타고라스 정리 문제.에 넣었어요"))).to_be_visible()
        math_sid = psql(f"select s.id from public.sources s join public.subjects j on j.id = s.subject_id where j.name = '수학' and j.user_id = '{student_id}' and s.unit = '피타고라스 정리' and s.title = '피타고라스 정리 문제'")
        assert math_sid, "new note in the new subject and unit"
        math_q = lambda: psql(f"select count(*) from public.questions q join public.notes n on n.id = q.note_id where n.source_id = '{math_sid}' and q.locked and q.figure is not null")
        assert math_q() == "1", math_q()
        # 두 번째 문제는 그 노트로: 이번에는 과목·단원·노트가 이미 있어서 그것을 고른다
        await ask.get_by_label("물어볼 내용").fill("이것도 풀어 줘")
        await ask.get_by_label("물어볼 내용").press("Enter")
        await expect(ask.get_by_role("button", name="노트에 넣기")).to_be_visible(timeout=20000)
        await ask.get_by_role("button", name="노트에 넣기").click()
        await expect(save.get_by_role("radio", name="수학")).to_have_attribute("aria-checked", "true")
        await expect(save.get_by_role("radiogroup", name="단원").get_by_role("radio", name="피타고라스 정리")).to_have_attribute("aria-checked", "true")
        await expect(save.get_by_role("radiogroup", name="노트").get_by_role("radio", name=re.compile("^피타고라스 정리 문제"))).to_have_attribute("aria-checked", "true")
        await save.get_by_role("button", name="이 노트에 넣기").click()
        await expect(save).to_be_hidden()
        await poll_db(f"select count(*) from public.questions q join public.notes n on n.id = q.note_id where n.source_id = '{math_sid}'", "2")
        # 홈을 떠나면 대화가 사라진다
        await page.keyboard.press("Escape")
        await expect(ask).to_be_hidden()
        await expect(page.get_by_role("button", name="AI에게 물어보기")).to_contain_text("이어서 물어보기")
        nav = page.get_by_role("navigation", name="주 메뉴")
        await nav.get_by_role("link", name="자료함").first.click()
        await page.wait_for_url(re.compile(r"/library"))
        await nav.get_by_role("link", name="홈").first.click()
        await page.wait_for_url(re.compile(r"/home$"))
        await expect(page.get_by_role("button", name="AI에게 물어보기")).to_contain_text("모든 과목 · 사진으로 문제 풀이")
        # 넣은 문제는 노트에서 바로 풀 수 있다
        await page.goto(BASE + f"/notes/{math_sid}/practice")
        await expect(page.get_by_role("img", name="문제 그림")).to_be_visible()
        await page.get_by_label("답").fill("5")
        await page.get_by_role("button", name="확인").click()
        await expect(page.get_by_role("button", name=re.compile("그림으로 보는 단계별 풀이"))).to_have_attribute("aria-expanded", "false")
        await ctx.close()

        step("free: AI에게 물어보기 gives text steps (no figure), careful model is Pro")
        psql(f"delete from public.energy_ledger where user_id = '{other_id}'; delete from public.rate_hits where user_id = '{other_id}'")
        octx, opage = await new_ctx(browser, "other")
        await opage.goto(BASE + "/home")
        await opage.get_by_role("button", name="AI에게 물어보기").click()
        ask = opage.get_by_role("dialog", name="AI에게 물어보기")
        await ask.get_by_role("radio", name=re.compile("^꼼꼼")).click()
        await expect(opage.get_by_text("꼼꼼 모델은 Pro에서 쓸 수 있어요.")).to_be_visible()
        await expect(ask.get_by_role("radio", name=re.compile("^빠름"))).to_have_attribute("aria-checked", "true")
        await ask.get_by_role("button", name="이차방정식 풀어 줘").click()
        await expect(ask.get_by_role("region", name="단계별 풀이")).to_be_visible(timeout=20000)
        await expect(ask.get_by_role("region", name="단계별 풀이").get_by_role("img")).to_have_count(0)
        await expect(ask.get_by_role("region", name="단계별 풀이").get_by_text("직각을 낀 두 변이")).to_be_visible()
        await shot(opage, "63-home-ask-free", full=False)
        await ask.get_by_role("button", name="노트에 넣기").click()
        save = opage.get_by_role("dialog", name="노트에 넣기")
        await save.get_by_role("button", name="새 노트를 만들어 넣기").click()
        await expect(ask.get_by_text("에 넣었어요")).to_be_visible()
        assert psql(f"select (q.figure is null)::text || (jsonb_array_length(q.steps) = 3)::text from public.questions q where q.user_id = '{other_id}' and q.prompt like '∠A = 90°%'") == "truetrue"
        await octx.close()

        # 다크 모드 폰 한 장
        step("dark phone note")
        ctx, page = await new_ctx(browser, "student", scheme="dark")
        await page.goto(BASE + "/library")
        await page.wait_for_timeout(500)
        await shot(page, "32-library-dark")
        await page.get_by_role("tab", name=re.compile("^과학")).click()
        await page.wait_for_url(LIBRARY_SUBJECT)
        await page.locator(f"main a[href='/notes/{note_sid}']").first.click()
        await wait_ready(page)
        await shot(page, "32-note-dark")
        await page.locator("article[data-flip]").first.get_by_role("button", name=re.compile("고치기$")).click()
        await page.wait_for_timeout(300)
        await shot(page, "32-note-edit-dark", full=False)
        await page.get_by_role("button", name="취소").first.click()
        kp_sec = page.locator("section", has=page.get_by_role("heading", name=re.compile("^핵심 개념")))
        await kp_sec.get_by_role("button", name="순서 바꾸기").click()
        await page.wait_for_timeout(300)
        await shot(page, "32-note-sort-dark", full=False)
        await kp_sec.get_by_role("button", name="완료").click()
        await page.get_by_role("tab", name="그림").click()
        await page.wait_for_timeout(500)
        await shot(page, "33-mindmap-dark", full=False)
        await page.get_by_role("list", name="가지 카드").get_by_role("button").nth(2).click()
        await page.wait_for_timeout(350)
        await shot(page, "33-branch-sheet-dark", full=False)
        await page.keyboard.press("Escape")
        await page.get_by_role("radiogroup", name="마인드맵 보기").get_by_role("radio", name="지도").click()
        await page.wait_for_timeout(400)
        await shot(page, "33-mindmap-map-dark", full=False)

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
        # 큰 지도 (앞에서 고른 '지도' 보기를 기억한다)
        await expect(page.get_by_role("radiogroup", name="마인드맵 보기").get_by_role("radio", name="지도")).to_have_attribute("aria-checked", "true")
        await page.wait_for_timeout(2500)
        centers = await page.evaluate(
            "() => [...document.querySelectorAll('svg[aria-label^=\"마인드맵:\"] g.mm-step')].map((g) => { const r = g.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })"
        )
        xs = [c[0] for c in centers]
        ys = [c[1] for c in centers]
        assert len(centers) > 3 and (max(xs) - min(xs)) + (max(ys) - min(ys)) > 150, centers
        await shot(page, "34-mindmap-step", full=False)
        await ctx.close()

        # ---------------- 테마 (Pro)
        student_id = USERS["student"][0]

        def sql(q):
            return subprocess.run(["psql", "-d", "kokapp", "-Atc", q], check=True, capture_output=True, text=True).stdout.strip()

        def saved_theme():
            return json.loads(sql(f"select settings->'theme' from public.profiles where id = '{student_id}'") or "{}")

        async def wait_saved(want, timeout=8):
            t0 = time.time()
            got = None
            while time.time() - t0 < timeout:
                got = saved_theme()
                if all(got.get(k) == v for k, v in want.items()):
                    return got
                await asyncio.sleep(0.2)
            raise AssertionError(f"theme settings {got} != {want}")

        def image_id(css):
            m = re.search(r"/api/themes/images/([0-9a-f-]{36})", css)
            assert m, css[:200]
            return m.group(1)

        step("themes (Pro): light/dark mode and a theme for each")
        ctx, page = await new_ctx(browser, "student")
        await page.goto(BASE + "/settings#theme")
        brightness = page.get_by_role("radiogroup", name="화면 밝기")
        await page.get_by_role("radiogroup", name="테마", exact=True).get_by_role("radio", name="블루", exact=True).click()
        await wait_css(page, "--accent", "#0168db")
        await brightness.get_by_role("radio", name="어둡게").click()
        await expect(page.locator("html")).to_have_attribute("data-mode", "dark")
        await wait_css(page, "--accent", "#4da3ff")
        await wait_css(page, "--bg", "#000000")
        # 밝은 기기에서도 어둡게 (Tailwind dark: 와 브라우저 기본 색도 같이)
        await wait_js(page, "getComputedStyle(document.documentElement).colorScheme === 'dark'")
        await page.locator("#theme").scroll_into_view_if_needed()
        await shot(page, "48-settings-theme-dark", full=False)
        await page.get_by_text("밝을 때와 어두울 때 테마를 따로 고르기").click()
        await page.get_by_role("radiogroup", name="어두울 때 테마").get_by_role("radio", name="미드나잇", exact=True).click()
        await wait_css(page, "--accent", "#90aff8")
        await wait_css(page, "--bg", "#05070f")
        await brightness.get_by_role("radio", name="밝게").click()
        await expect(page.locator("html")).to_have_attribute("data-mode", "light")
        await wait_css(page, "--accent", "#0168db")
        await page.get_by_role("radiogroup", name="밝을 때 테마").get_by_role("radio", name="핑크", exact=True).click()
        await wait_css(page, "--accent", "#d5005b")
        await brightness.get_by_role("radio", name="기기 설정").click()
        await wait_js(page, "!document.documentElement.hasAttribute('data-mode')")
        await wait_css(page, "--accent", "#d5005b")
        await page.get_by_role("radiogroup", name="테마 글꼴").get_by_role("radio", name=re.compile("둥근 글씨")).click()
        await expect(page.locator("html")).to_have_attribute("data-font", "round")
        await page.get_by_role("radiogroup", name="노트 종이 무늬").get_by_role("radio", name="줄 노트").click()
        await expect(page.locator("html")).to_have_attribute("data-paper", "lined")
        await wait_saved({"mode": "system", "light": "preset:cherry", "dark": "preset:night", "font": "round", "paper": "lined"})
        await page.locator("#theme").scroll_into_view_if_needed()
        await shot(page, "48-settings-theme", full=False)
        await no_hscroll(page, "settings theme")

        step("themes (Pro): star glow — colour and strength, with light and dark previews")
        glow_tones = page.get_by_role("radiogroup", name="별표 빛 색")
        await glow_tones.get_by_role("radio", name="오로라", exact=True).click()
        await wait_css(page, "--glow-star-1", "#52e5c4")
        await wait_css(page, "--glow-star-2", "#8d7bff")
        strength = page.get_by_role("slider", name="별표 빛 세기")
        await strength.focus()
        await page.keyboard.press("End")
        await wait_css(page, "--glow-ring-1", "rgba(82, 229, 196, 1)")
        await wait_saved({"glow": {"tone": "aurora", "strength": 100}})
        # 미리보기 (밝을 때·어두울 때): 별을 누르면 빛이 오므라들고 다시 누르면 번진다
        preview = page.get_by_role("button", name="어두울 때 미리보기 별표")
        await expect(preview).to_have_attribute("aria-pressed", "true")
        await preview.scroll_into_view_if_needed()
        await page.evaluate("window.scrollBy(0, 120)")
        await shot(page, "48-settings-star-glow", full=False)
        await preview.click()
        await expect(preview).to_have_attribute("aria-pressed", "false")
        await preview.click()
        await expect(preview).to_have_attribute("aria-pressed", "true")
        await strength.focus()
        await page.keyboard.press("Home")
        await expect(page.get_by_text("빛 없이 별만", exact=True)).to_be_visible()
        await wait_css(page, "--glow-halo", "rgba(141, 123, 255, 0)")
        await wait_saved({"glow": {"tone": "aurora", "strength": 0}})
        # 기본으로 (골드, 60): 기본 색·기본 빛이면 테마 CSS 를 넣지 않는다 (아래 시험이 기대한다)
        await glow_tones.get_by_role("radio", name="골드", exact=True).click()
        await strength.focus()
        for _ in range(12):
            await page.keyboard.press("ArrowRight")
        await wait_saved({"glow": {"tone": "gold", "strength": 60}})
        await wait_css(page, "--glow-star-1", "#ffd60a")

        step("themes (Pro): the saved look is on before the app loads")

        async def slow_me(route):
            await asyncio.sleep(3)
            await route.continue_()

        await page.route("**/api/me", slow_me)
        await page.goto(BASE + f"/notes/{note_sid}", wait_until="domcontentloaded")
        assert await page.evaluate("!!document.getElementById('kok-theme')"), "THEME_BOOT did not add the theme style"
        assert await css_var(page, "--accent") == "#d5005b"
        assert await page.evaluate("[document.documentElement.dataset.font, document.documentElement.dataset.paper].join()") == "round,lined"
        assert await wait_ready(page)
        font = await page.evaluate("getComputedStyle(document.body).fontFamily")
        assert "Gowun Dodum" in font, font
        await shot(page, "49-note-theme")
        await ctx.close()
        ctx, page = await new_ctx(browser, "student", scheme="dark")
        await page.goto(BASE + f"/notes/{note_sid}")
        assert await wait_ready(page)
        await wait_css(page, "--bg", "#05070f")
        assert await css_var(page, "--accent") == "#90aff8"
        await shot(page, "49-note-theme-dark", full=False)
        await ctx.close()

        step("themes (Pro): AI theme with a background picture")
        ctx, page = await new_ctx(browser, "student")
        await page.goto(BASE + "/settings#theme")
        brightness = page.get_by_role("radiogroup", name="화면 밝기")
        maker = page.get_by_role("dialog", name="AI로 테마 만들기")
        chooser = page.get_by_role("dialog", name="새 테마 만들기")
        # 앞 단계에서 밝을 때·어두울 때를 따로 골랐다: 같게 쓰기로 돌리면 테마 칸이 하나 (따로 고르는 중이면 '+'를 누른 쪽에만 새 테마를 쓴다)
        separate = page.get_by_label("밝을 때와 어두울 때 테마를 따로 고르기")
        if await separate.is_checked():
            await page.get_by_text("밝을 때와 어두울 때 테마를 따로 고르기", exact=True).click()
            await expect(separate).not_to_be_checked()
        # 테마 칸의 마지막 '+' → 새 테마 고르는 창 → AI로 만들기
        await page.get_by_role("button", name="새 테마 만들기").click()
        await chooser.get_by_role("button", name=re.compile("^AI로 만들기")).click()
        await expect(chooser).to_be_hidden()
        await maker.locator("#theme-prompt").fill("비 오는 날 카페")
        await maker.get_by_role("button", name=re.compile("^만들기")).click()
        await expect(page.get_by_text(re.compile("테마를 만들어 썼어요"))).to_be_visible(timeout=30000)
        await expect(maker).to_be_hidden()
        await expect(page.locator("html")).to_have_attribute("data-bg", "1")
        await expect(page.locator("html")).to_have_attribute("data-paper", "dots")
        ai_image = image_id(await css_var(page, "--theme-image"))
        r = await page.request.get(BASE + f"/api/themes/images/{ai_image}")
        assert r.ok and r.headers.get("content-type", "").startswith("image/"), (r.status, r.headers)
        assert sql(f"select kind || ' ' || coalesce(prompt, '') from public.theme_images where id = '{ai_image}'").startswith("ai soft watercolor"), "AI picture row"
        ai_theme = sql(f"select id from public.user_themes where user_id = '{student_id}' order by created_at desc limit 1")
        await wait_saved({"light": f"custom:{ai_theme}", "dark": f"custom:{ai_theme}", "font": "round", "paper": "dots"})
        # AI 가 그린 그림은 표시해 둔다 (설명 없이 다시 그리기), 사진은 무엇이 그려졌는지 몰라 글자가 잘 보이게 0.7 넘게 덮는다
        assert sql(f"select spec->'image'->>'ai' from public.user_themes where id = '{ai_theme}'") == "true"
        assert float(await css_var(page, "--theme-dim")) >= 0.7, await css_var(page, "--theme-dim")
        # 화살표로 테마 고르기 (지금 고른 칸만 Tab 으로 들어가고, → 로 다음 칸)
        ai_radio = page.get_by_role("radiogroup", name="테마", exact=True).get_by_role("radio", checked=True)
        assert await ai_radio.get_attribute("tabindex") == "0"
        # 내가 만든 테마에서 바꾼 글꼴은 그 테마에 남는다 (다른 테마에 갔다가 돌아와도)
        ai_name = sql(f"select name from public.user_themes where id = '{ai_theme}'")
        fonts = page.get_by_role("radiogroup", name="테마 글꼴")
        await fonts.get_by_role("radio", name=re.compile("손글씨")).click()
        await expect(page.locator("html")).to_have_attribute("data-font", "hand")
        await poll_db(f"select spec->>'font' from public.user_themes where id = '{ai_theme}'", "hand")
        theme_radios = page.get_by_role("radiogroup", name="테마", exact=True)
        await theme_radios.get_by_role("radio", name="블루", exact=True).click()
        await fonts.get_by_role("radio", name=re.compile("기본$")).click()
        await wait_js(page, "!document.documentElement.hasAttribute('data-font')")
        await theme_radios.get_by_role("radio", name=ai_name, exact=True).click()
        await expect(page.locator("html")).to_have_attribute("data-font", "hand")
        await wait_saved({"light": f"custom:{ai_theme}", "dark": f"custom:{ai_theme}", "font": "hand"})
        # 어두울 때 바탕: AI 가 밝은 색을 보내도 서버가 어둡게 맞춘다
        await brightness.get_by_role("radio", name="어둡게").click()
        await expect(page.locator("html")).to_have_attribute("data-mode", "dark")
        dark_bg = await css_var(page, "--bg")
        assert luminance(dark_bg) < 0.05, dark_bg
        await page.evaluate("window.scrollTo(0, 0)")
        await shot(page, "50-theme-ai-dark", full=False)
        await brightness.get_by_role("radio", name="기기 설정").click()
        await wait_js(page, "!document.documentElement.hasAttribute('data-mode')")
        await page.goto(BASE + "/home")
        await page.wait_for_timeout(1200)
        await shot(page, "50-home-ai-picture", full=False)
        await no_hscroll(page, "home with a theme picture")

        step("themes (Pro): a pattern when the free pictures run out")
        await page.goto(BASE + "/settings#theme")
        urllib.request.urlopen("http://localhost:54321/__cf?mode=quota")
        try:
            await page.get_by_role("button", name="새 테마 만들기").click()
            await chooser.get_by_role("button", name=re.compile("^AI로 만들기")).click()
            await maker.locator("#theme-prompt").fill("밤하늘 별빛")
            await maker.get_by_role("button", name=re.compile("^만들기")).click()
            await expect(page.get_by_text(re.compile("무늬를 대신 넣었어요"))).to_be_visible(timeout=30000)
        finally:
            urllib.request.urlopen("http://localhost:54321/__cf?mode=ok")
        await wait_js(page, "getComputedStyle(document.documentElement).getPropertyValue('--theme-image').includes('data:image/svg+xml')")
        await expect(page.locator("html")).to_have_attribute("data-bg", "1")
        assert sql(f"select count(*) from public.theme_images where user_id = '{student_id}'") == "1", "no picture for the pattern theme"
        # Cloudflare 가 오늘 몫을 다 썼다고 하면 오늘은 더 부르지 않는다 (서비스 전체 수를 채운다)
        assert sql("select n from public.app_counters where kind = 'cf_image'") == "150"
        # 그림을 그릴 수 없는 날에는 '다시 그리기'가 AI(에너지)를 부르기 전에 알려 준다
        ledger_before = sql(f"select count(*) from public.energy_ledger where user_id = '{student_id}'")
        r = await page.request.post(BASE + f"/api/themes/{ai_theme}/image", headers={"origin": BASE}, data={"prompt": "푸른 바다"})
        assert r.status == 429, (r.status, await r.text())
        assert "몫" in (await r.json())["message"]
        assert sql(f"select count(*) from public.energy_ledger where user_id = '{student_id}'") == ledger_before, "no energy for a refused picture"
        sql("update public.app_counters set n = 2 where kind = 'cf_image'")

        step("themes (Pro): edit a theme — name, pattern, photo — then delete it")
        editor = page.get_by_role("dialog", name="테마 고치기")
        # 고른 내 테마 칸의 연필 (방금 만든 무늬 테마를 쓰는 중). 연필은 고른 칸에만 하나
        pencil = page.get_by_role("button", name=re.compile("' 테마 고치기$"))
        await expect(pencil).to_have_count(1)
        await pencil.click()
        await expect(editor).to_be_visible()
        await editor.locator("#theme-name").fill("물결 테마")
        await editor.get_by_role("radiogroup", name="배경 그림").get_by_role("radio", name="무늬").click()
        await editor.get_by_role("radiogroup", name="무늬", exact=True).get_by_role("radio", name="물결").click()
        await editor.get_by_role("button", name="저장하고 쓰기").click()
        await expect(editor).to_be_hidden()
        await expect(page.get_by_role("radiogroup", name="테마", exact=True).get_by_role("radio", name="물결 테마", exact=True)).to_be_visible()
        wave_svg = sql(f"select spec->'image'->>'svg' from public.user_themes where user_id = '{student_id}' and name = '물결 테마'")
        assert wave_svg.startswith("<svg"), wave_svg[:80]
        want = ('url("data:image/svg+xml,' + urllib.parse.quote(wave_svg, safe="-_.!~*'()") + '")').lower()
        await wait_js(page, f"getComputedStyle(document.documentElement).getPropertyValue('--theme-image').trim().toLowerCase() === {json.dumps(want)}")
        await page.get_by_role("button", name="'물결 테마' 테마 고치기").click()
        await expect(editor).to_be_visible()
        await editor.get_by_role("radiogroup", name="배경 그림").get_by_role("radio", name="사진").click()
        await editor.get_by_label("배경 사진 고르기").set_input_files(files=[{"name": "bg.png", "mimeType": "image/png", "buffer": make_png()}])
        await expect(editor.locator('[style*="/api/themes/images/"]').first).to_be_attached(timeout=15000)
        await shot(page, "51-theme-editor", full=False)
        await editor.get_by_role("button", name="저장하고 쓰기").click()
        await expect(editor).to_be_hidden()
        await wait_js(page, "getComputedStyle(document.documentElement).getPropertyValue('--theme-image').includes('/api/themes/images/')")
        photo = image_id(await css_var(page, "--theme-image"))
        assert photo != ai_image
        row = sql(f"select concat_ws(' ', kind, mime, width, height) from public.theme_images where id = '{photo}'")
        assert row == "upload image/jpeg 900 600", row
        await page.goto(BASE + "/library")
        await page.wait_for_timeout(1200)
        await shot(page, "51-library-photo", full=False)
        await page.goto(BASE + "/settings#theme")
        await page.get_by_role("button", name="'물결 테마' 테마 고치기").click()
        await expect(editor).to_be_visible()
        page.once("dialog", lambda d: asyncio.ensure_future(d.accept()))
        await editor.get_by_role("button", name="지우기").click()
        await expect(editor).to_be_hidden()
        await wait_js(page, "!document.documentElement.hasAttribute('data-bg') && !document.getElementById('kok-theme')")
        await wait_css(page, "--accent", "#6057e7")
        await wait_saved({"light": "preset:default", "dark": "preset:default"})
        assert sql(f"select count(*) from public.user_themes where user_id = '{student_id}' and name = '물결 테마'") == "0"

        step("themes (Pro): a new theme from a preset with its own decorations (floating menu, small-card sparkle, glass)")
        await page.goto(BASE + "/settings#theme")
        grid = page.get_by_role("radiogroup", name="테마", exact=True)
        # 기본 테마는 고칠 수 없다 (연필 없음)
        await grid.get_by_role("radio", name="블루", exact=True).click()
        await expect(page.get_by_role("button", name=re.compile("' 테마 고치기$"))).to_have_count(0)
        await page.get_by_role("button", name="새 테마 만들기").click()
        await chooser.get_by_role("button", name="민트에서 시작하기").click()
        fx_editor = page.get_by_role("dialog", name="새 테마 · 민트에서 시작")
        await expect(fx_editor).to_be_visible()
        await fx_editor.locator("#theme-name").fill("떠 있는 민트")
        # 처음에는 A·B·C·D1 만 켜져 있다
        for label, on in (("화면 위에 은은한 빛", True), ("중요한 카드가 빛나요", True), ("버튼을 두 가지 색으로", True), ("화면 아래에도 은은한 빛", True), ("작은 카드에도 반짝이는 포인트", False), ("아래 메뉴를 띄우기", False)):
            if on:
                await expect(fx_editor.get_by_label(label, exact=True)).to_be_checked()
            else:
                await expect(fx_editor.get_by_label(label, exact=True)).not_to_be_checked()
        for label in ("아래 메뉴를 띄우기", "작은 카드에도 반짝이는 포인트", "화면 위에 은은한 빛"):
            await fx_editor.get_by_text(label, exact=True).click()
        await fx_editor.get_by_role("slider", name="아래 메뉴가 비치는 정도").fill("40")
        await fx_editor.get_by_role("radiogroup", name="꾸미기 빛 색").get_by_role("radio", name="오로라").click()
        await shot(page, "52-theme-fx-editor", full=False)
        await fx_editor.get_by_role("button", name="저장하고 쓰기").click()
        await expect(fx_editor).to_be_hidden()
        mint = sql(f"select id from public.user_themes where user_id = '{student_id}' and name = '떠 있는 민트'")
        fx_saved = json.loads(sql(f"select spec->'fx' from public.user_themes where id = '{mint}'"))
        assert fx_saved == {"top": False, "hero": True, "buttons": True, "bottom": True, "details": True, "floatTab": True, "tabSeeThrough": 40, "aura": "aurora"}, fx_saved
        await wait_saved({"light": f"custom:{mint}", "dark": f"custom:{mint}"})
        await wait_css(page, "--tab-float", "1")
        await wait_css(page, "--fx-detail", "1")
        assert (await css_var(page, "--aura-1")).endswith(", 0)"), await css_var(page, "--aura-1")
        assert (await css_var(page, "--tab-bg")).endswith(", 0.6)"), await css_var(page, "--tab-bg")
        await expect(page.get_by_role("button", name="'떠 있는 민트' 테마 고치기")).to_be_visible()
        await page.goto(BASE + "/home")
        await page.wait_for_timeout(1000)
        tabbar = await page.locator("nav.kok-tabbar").bounding_box()
        assert tabbar and tabbar["x"] >= 10 and 860 - (tabbar["y"] + tabbar["height"]) >= 8, tabbar  # 양옆·아래가 떠 있다
        fab_box = await page.locator(".kok-fab").bounding_box()
        assert fab_box and fab_box["y"] + fab_box["height"] <= tabbar["y"] - 8, (fab_box, tabbar)  # + 버튼은 메뉴 위에
        await shot(page, "52-home-floating-menu", full=False)
        # 지우면 기본 모양으로 (메뉴도 다시 아래에 붙는다)
        await page.goto(BASE + "/settings#theme")
        await page.get_by_role("button", name="'떠 있는 민트' 테마 고치기").click()
        await expect(editor).to_be_visible()
        page.once("dialog", lambda d: asyncio.ensure_future(d.accept()))
        await editor.get_by_role("button", name="지우기").click()
        await expect(editor).to_be_hidden()
        await wait_saved({"light": "preset:default", "dark": "preset:default"})
        await wait_css(page, "--tab-float", "0")

        step("themes (Pro): unused pictures are cleaned up after a day")
        sql(f"update public.theme_images set created_at = now() - interval '2 days' where user_id = '{student_id}'")
        req = urllib.request.Request(BASE + "/api/cron/cleanup", headers={"Authorization": "Bearer " + os.environ["CRON_SECRET"]})
        out = json.loads(urllib.request.urlopen(req).read())
        assert out.get("themeImages") == 1, out
        assert sql(f"select string_agg(id::text, ',') from public.theme_images where user_id = '{student_id}'") == ai_image
        assert sql("select count(*) from storage.objects where bucket_id = 'theme-images'") == "1"

        step("themes (Pro): a theme deleted on another device falls back to the default look")
        sql(
            "update public.profiles set settings = jsonb_set(jsonb_set(settings, '{theme,light}', '\"custom:00000000-0000-4000-8000-000000000000\"'), '{theme,dark}', to_jsonb('custom:' || "
            f"'{ai_theme}'::text)) where id = '{student_id}'"
        )
        await page.goto(BASE + "/home")
        await wait_js(page, "getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() === '#6057e7'", timeout=10000)
        await expect(page.locator("html")).to_have_attribute("data-bg", "1")
        await ctx.close()

        step("themes: server checks — clean patterns, own pictures only, Pro only")
        ctx, page = await new_ctx(browser, "student")
        await page.goto(BASE + "/home")
        spec = {"light": {"bg": "#f4f1ea", "surface": "#ffffff", "accent": "#3a7d5c"}, "dark": {"bg": "#101412", "surface": "#1a201c", "accent": "#7fd1a8"}, "dim": 0.4}
        evil = (
            '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" onload="alert(1)"><script>alert(2)</script>'
            '<circle cx="5" cy="5" r="3" fill="#3a7d5c"/><a href="https://evil.example"><rect width="2" height="2"/></a>'
            '<image href="https://evil.example/x.png"/><rect width="1" height="1" fill="url(https://evil.example/#x)"/>'
            '<style>@import url(https://evil.example/a.css)</style></svg>'
        )
        r = await page.request.post(BASE + "/api/themes", headers={"origin": BASE}, data={"name": "무늬 시험", "spec": {**spec, "image": {"kind": "pattern", "svg": evil}}})
        assert r.ok, (r.status, await r.text())
        made = (await r.json())["theme"]
        clean = made["spec"]["image"]["svg"]
        for bad in ("script", "onload", "evil", "<a", "<image", "href", "style", "@import"):
            assert bad not in clean, (bad, clean)
        assert "<circle" in clean, clean
        r = await page.request.get(BASE + "/api/themes/images/00000000-0000-4000-8000-000000000000")
        assert r.status == 404, r.status
        # 그림 주소는 로그인한 사람(쿠키)마다 따로 기억한다 (같은 기기의 다음 사람에게 보이지 않게)
        r = await page.request.get(BASE + f"/api/themes/images/{ai_image}", max_redirects=0)
        assert r.status == 302 and "cookie" in (r.headers.get("vary") or "").lower(), (r.status, r.headers)
        # 다른 곳에서 먼저 바뀐 테마는 덮어쓰지 않는다
        r = await page.request.patch(BASE + f"/api/themes/{made['id']}", headers={"origin": BASE}, data={"name": "옛 화면", "updatedAt": "2000-01-01T00:00:00+00:00"})
        assert r.status == 409, (r.status, await r.text())
        r = await page.request.patch(BASE + f"/api/themes/{made['id']}", headers={"origin": BASE}, data={"name": "새 이름", "updatedAt": made["updated_at"]})
        assert r.ok, (r.status, await r.text())
        r = await page.request.post(BASE + "/api/themes/images", headers={"origin": BASE, "content-type": "image/jpeg"}, data=b"<svg onload=alert(1)>")
        assert r.status == 400, r.status
        actx, apage = await new_ctx(browser, "admin")
        r = await apage.request.post(BASE + "/api/themes", headers={"origin": BASE}, data={"name": "남의 그림", "spec": {**spec, "image": {"kind": "file", "id": ai_image}}})
        assert r.status == 404, (r.status, await r.text())
        r = await apage.request.get(BASE + f"/api/themes/images/{ai_image}")
        assert r.status == 404, r.status
        r = await apage.request.patch(BASE + f"/api/themes/{made['id']}", headers={"origin": BASE}, data={"name": "뺏기"})
        assert r.status == 404, r.status
        await apage.request.delete(BASE + f"/api/themes/{made['id']}", headers={"origin": BASE})
        assert sql(f"select name from public.user_themes where id = '{made['id']}'") == "새 이름"
        r = await apage.request.post(BASE + "/api/themes", headers={"origin": "https://evil.example"}, data={"name": "x", "spec": spec})
        assert r.status == 403, r.status
        await actx.close()
        await ctx.close()
        other_id = USERS["other"][0]
        sql(f"insert into public.user_themes (user_id, name, spec) values ('{other_id}', 'Pro 때 테마', '{json.dumps(spec)}'::jsonb)")
        octx, opage = await new_ctx(browser, "other")
        await opage.goto(BASE + "/settings#theme")
        await expect(opage.get_by_role("radiogroup", name="테마", exact=True).get_by_role("radio", name="블루", exact=True)).to_be_disabled()
        await expect(opage.get_by_role("slider", name="별표 빛 세기")).to_be_disabled()
        await expect(opage.get_by_role("radiogroup", name="화면 밝기").get_by_role("radio", name="어둡게")).to_be_disabled()
        assert await opage.evaluate("document.documentElement.hasAttribute('data-mode') || !!document.getElementById('kok-theme')") is False
        # Pro 가 끝나도 내 테마는 보이고 지울 수 있다 (고치기는 없다)
        await expect(opage.get_by_role("listitem").get_by_text("Pro 때 테마", exact=True)).to_be_visible()
        await expect(opage.get_by_role("button", name="고치기", exact=True)).to_have_count(0)
        opage.once("dialog", lambda d: asyncio.ensure_future(d.accept()))
        await opage.get_by_role("button", name="지우기", exact=True).click()
        await expect(opage.get_by_text("Pro 때 테마", exact=True)).to_have_count(0)
        assert sql(f"select count(*) from public.user_themes where user_id = '{other_id}'") == "0"
        r = await opage.request.post(BASE + "/api/themes", headers={"origin": BASE}, data={"name": "x", "spec": spec})
        assert r.status == 403, r.status
        r = await opage.request.post(BASE + "/api/themes/generate", headers={"origin": BASE}, data={"prompt": "비 오는 날", "image": True})
        assert r.status == 403, r.status
        await octx.close()

        step("library: star, review on/off for each note, long-press to pick several, reorder in a subject")
        me_id = USERS["student"][0]
        ctx, page = await new_ctx(browser, "student")
        # 문제가 가장 많은 노트: 복습에서 빼 본다
        qsrc = db(
            "select n.source_id from public.cards c join public.questions q on q.id = c.question_id join public.notes n on n.id = q.note_id "
            f"join public.sources s on s.id = n.source_id where c.user_id = '{me_id}' and q.status = 'active' and s.parent_id is null "
            "group by n.source_id order by count(*) desc, n.source_id limit 1"
        )
        assert qsrc, "no note with questions"

        async def review_total():
            """복습 시작 화면의 '전체' 문제 수"""
            await page.goto(BASE + "/review")
            periods = page.get_by_role("radiogroup", name="언제 공부한 문제를 풀까요?")
            await expect(periods).to_be_visible()
            txt = await periods.get_by_role("radio", name=re.compile("^전체")).inner_text()
            return int(re.search(r"(\d+)\s*$", txt).group(1))

        def card(sid_):
            return page.locator(f'main [data-flip="{sid_}"]')

        before = await review_total()
        # 카드 메뉴로 복습에서 빼기 → 복습 문제 수가 준다 (노트에서 직접 푸는 것은 그대로)
        await page.goto(BASE + "/library")
        await expect(card(qsrc)).to_be_visible()
        await card(qsrc).get_by_role("button", name=re.compile(" 메뉴$")).click()
        await page.get_by_role("menuitem", name="복습에서 빼기").click()
        await expect(page.get_by_text("복습에서 뺐어요.", exact=True)).to_be_visible()
        await expect(card(qsrc)).to_contain_text("복습 끔")
        await poll_db(f"select in_review from public.sources where id = '{qsrc}'", "f")
        await shot(page, "90-library-review-off", full=False)
        off_total = await review_total()
        assert off_total < before, (off_total, before)
        wrong_off = int(db(
            "select count(*) from public.cards c join public.questions q on q.id = c.question_id join public.notes n on n.id = q.note_id "
            f"where n.source_id = '{qsrc}' and c.in_wrong_note and q.status = 'active'"
        ))
        if wrong_off:
            await page.goto(BASE + "/wrong")
            await expect(page.get_by_text(f"복습을 끈 노트의 틀린 문제 {wrong_off}개는 빼고 보여 줘요.")).to_be_visible()
        # 노트 화면: 알림 줄의 '다시 넣기', 노트 메뉴로 끄고 켜기
        await page.goto(BASE + f"/notes/{qsrc}")
        assert await wait_ready(page)
        banner = page.get_by_text("복습에서 뺀 노트예요.")
        await expect(banner).to_be_visible()
        await shot(page, "91-note-review-off", full=False)
        await page.get_by_role("button", name="다시 넣기").click()
        await expect(banner).to_have_count(0)
        await poll_db(f"select in_review from public.sources where id = '{qsrc}'", "t")
        await page.get_by_role("button", name="노트 메뉴").click()
        await page.get_by_role("menuitem", name="복습에서 빼기").click()
        await expect(banner).to_be_visible()
        await poll_db(f"select in_review from public.sources where id = '{qsrc}'", "f")
        await page.get_by_role("button", name="노트 메뉴").click()
        await page.get_by_role("menuitem", name="복습에 다시 넣기").click()
        await expect(banner).to_have_count(0)
        await poll_db(f"select in_review from public.sources where id = '{qsrc}'", "t")
        assert await review_total() == before

        # 별표: 가장 오래된 자료가 맨 위로 미끄러진다
        ready = db(f"select string_agg(id::text, ',' order by created_at, id) from public.sources where user_id = '{me_id}' and parent_id is null and status = 'ready'").split(",")
        assert len(ready) >= 4, ready
        oldest = ready[0]
        await page.goto(BASE + "/library")
        cards = page.locator("main [data-flip]")
        await expect(card(oldest)).to_be_visible()
        assert await cards.first.get_attribute("data-flip") != oldest
        await card(oldest).get_by_role("button", name=re.compile(" 메뉴$")).click()
        await page.get_by_role("menuitem", name="별표", exact=True).click()
        await expect(cards.first).to_have_attribute("data-flip", oldest)
        # 별표는 별과 빛으로 보여서 아래 알림을 띄우지 않는다
        await expect(page.locator(".kok-toast", has_text="별표")).to_have_count(0)
        await expect(card(oldest).get_by_role("link")).to_have_accessible_name(re.compile(r"\(별표\)$"))
        await poll_db(f"select starred from public.sources where id = '{oldest}'", "t")
        # 다시 들어와도 맨 위 (저장된 별표)
        await page.reload()
        await expect(cards.first).to_have_attribute("data-flip", oldest)
        await expect(card(oldest).locator("a.kok-glow.is-starred")).to_have_count(1)
        # 카드의 별 버튼: 누르면 별이 튀고(자리는 잠깐 그대로) 맨 위로 미끄러지며 별표 빛이 번진다. 노트로 가지 않는다
        second = ready[1]
        star_btn = card(second).get_by_role("button", name=re.compile(" 별표$"))
        await expect(star_btn).to_have_attribute("aria-pressed", "false")
        before_star = [await cards.nth(i).get_attribute("data-flip") for i in range(await cards.count())]
        assert before_star.index(second) > 1, before_star
        await star_btn.click()
        await expect(star_btn).to_have_attribute("aria-pressed", "true")
        assert page.url.endswith("/library"), page.url
        await expect(card(second).locator("a.kok-glow.is-starred")).to_have_count(1)
        await expect(page.locator(".kok-toast", has_text="별표")).to_have_count(0)
        # 별표한 자료끼리는 내가 정한 순서·새 자료 먼저: 둘 다 맨 위 두 자리
        await expect(cards.nth(0)).to_have_attribute("data-flip", re.compile(f"^({oldest}|{second})$"))
        await expect(cards.nth(1)).to_have_attribute("data-flip", re.compile(f"^({oldest}|{second})$"))
        await poll_db(f"select starred from public.sources where id = '{second}'", "t")
        await page.evaluate("window.scrollTo(0, 0)")
        await page.wait_for_timeout(400)
        await shot(page, "92-library-star-glow", full=False)
        # 키보드로 다시 누르면 별표를 빼고 제자리로 (카드가 옮겨 가도 초점은 그 카드의 별 버튼에 남는다)
        await card(second).get_by_role("link").focus()
        await page.keyboard.press("Tab")
        await expect(star_btn).to_be_focused()
        await page.keyboard.press("Enter")
        await expect(star_btn).to_have_attribute("aria-pressed", "false")
        await expect(card(second).locator("a.kok-glow.is-starred")).to_have_count(0)
        await poll_db(f"select starred from public.sources where id = '{second}'", "f")
        await expect(cards.first).to_have_attribute("data-flip", oldest)
        await expect(star_btn).to_be_focused()

        # 꾹 누르기(마우스 0.45초)로 고르기 시작 → 눌러서 더 고르기 → 스페이스로 고르고 풀기
        order = [await cards.nth(i).get_attribute("data-flip") for i in range(await cards.count())]
        a_id, b_id, c_id = order[1], order[2], order[3]
        await card(a_id).hover()
        await page.mouse.down()
        await page.wait_for_timeout(650)
        await page.mouse.up()
        await expect(page.get_by_role("heading", name="1개 선택", exact=True)).to_be_visible()
        assert page.url.endswith("/library"), page.url
        bar = page.get_by_role("toolbar", name=re.compile("^고른 자료"))
        await expect(bar).to_be_visible()
        await expect(page.get_by_role("button", name="자료 넣기", exact=True)).to_have_count(0)
        await expect(card(a_id).get_by_role("checkbox")).to_have_attribute("aria-checked", "true")
        await card(b_id).click()
        await expect(page.get_by_role("heading", name="2개 선택", exact=True)).to_be_visible()
        await card(c_id).get_by_role("checkbox").focus()
        await page.keyboard.press("Space")
        await expect(page.get_by_role("heading", name="3개 선택", exact=True)).to_be_visible()
        await page.keyboard.press("Space")
        await expect(page.get_by_role("heading", name="2개 선택", exact=True)).to_be_visible()
        await shot(page, "92-library-select", full=False)
        await no_hscroll(page, "library selecting")
        # 하나라도 별표가 없으면 '별표'
        await bar.get_by_role("button", name="별표", exact=True).click()
        await expect(bar).to_have_count(0)
        await expect(page.locator(".kok-toast", has_text="별표")).to_have_count(0)
        await poll_db(f"select count(*) from public.sources where id in ('{a_id}', '{b_id}') and starred", "2")
        await expect(page.get_by_role("button", name="자료 넣기", exact=True)).to_be_visible()
        # 별표한 둘을 고르면 '별표 빼기'
        await card(a_id).hover()
        await page.mouse.down()
        await page.wait_for_timeout(650)
        await page.mouse.up()
        await card(b_id).click()
        await bar.get_by_role("button", name="별표 빼기").click()
        await poll_db(f"select count(*) from public.sources where id in ('{a_id}', '{b_id}') and starred", "0")
        # 복습 끄기 → 다시 고르면 '복습 켜기'
        await card(a_id).hover()
        await page.mouse.down()
        await page.wait_for_timeout(650)
        await page.mouse.up()
        await card(b_id).click()
        await bar.get_by_role("button", name="복습 끄기").click()
        await expect(page.get_by_text("2개 노트를 복습에서 뺐어요.")).to_be_visible()
        await poll_db(f"select count(*) from public.sources where id in ('{a_id}', '{b_id}') and not in_review", "2")
        await expect(card(a_id)).to_contain_text("복습 끔")
        await card(a_id).get_by_role("button", name=re.compile(" 메뉴$")).click()
        await page.get_by_role("menuitem", name="여러 개 고르기").click()
        await expect(page.get_by_role("heading", name="1개 선택", exact=True)).to_be_visible()
        await card(b_id).click()
        await bar.get_by_role("button", name="복습 켜기").click()
        await poll_db(f"select count(*) from public.sources where id in ('{a_id}', '{b_id}') and in_review", "2")
        # 모두 고르기 · 모두 풀기 · Esc
        await page.get_by_role("button", name="자료함 메뉴").click()
        await page.get_by_role("menuitem", name="여러 개 고르기").click()
        await expect(page.get_by_role("heading", name="자료 고르기", exact=True)).to_be_visible()
        await expect(bar.get_by_role("button", name="지우기")).to_be_disabled()
        await page.get_by_role("button", name="모두 고르기").click()
        n_all = await cards.count()
        await expect(page.get_by_role("heading", name=f"{n_all}개 선택", exact=True)).to_be_visible()
        await page.get_by_role("button", name="모두 풀기").click()
        await expect(page.get_by_role("heading", name="자료 고르기", exact=True)).to_be_visible()
        await page.keyboard.press("Escape")
        await expect(page.get_by_role("heading", name="자료함", exact=True)).to_be_visible()
        await expect(bar).to_have_count(0)

        # 손가락으로 꾹: 폰의 링크 메뉴를 막고, 손을 뗀 뒤의 누르기로 노트가 열리지 않는다
        got = await card(c_id).get_by_role("link").evaluate(
            """(a) => new Promise((done) => {
              const r = a.getBoundingClientRect();
              const at = { bubbles: true, cancelable: true, clientX: r.left + 30, clientY: r.top + 50 };
              const p = { ...at, pointerType: 'touch', pointerId: 7, isPrimary: true, button: 0 };
              a.dispatchEvent(new PointerEvent('pointerdown', p));
              setTimeout(() => {
                const menu = new MouseEvent('contextmenu', at);
                a.dispatchEvent(menu);
                a.dispatchEvent(new PointerEvent('pointerup', p));
                const click = new MouseEvent('click', at);
                a.dispatchEvent(click);
                done({ menu: menu.defaultPrevented, click: click.defaultPrevented });
              }, 650);
            })"""
        )
        assert got == {"menu": True, "click": True}, got
        await expect(page.get_by_role("heading", name="1개 선택", exact=True)).to_be_visible()
        assert page.url.endswith("/library"), page.url
        # 손가락으로 움직이면(스크롤) 고르지 않는다
        await page.keyboard.press("Escape")
        moved = await card(c_id).get_by_role("link").evaluate(
            """(a) => new Promise((done) => {
              const r = a.getBoundingClientRect();
              const p = { bubbles: true, cancelable: true, clientX: r.left + 30, clientY: r.top + 50, pointerType: 'touch', pointerId: 8, isPrimary: true, button: 0 };
              a.dispatchEvent(new PointerEvent('pointerdown', p));
              a.dispatchEvent(new PointerEvent('pointermove', { ...p, clientY: p.clientY + 30 }));
              setTimeout(() => done(document.querySelector('main h1')?.textContent), 650);
            })"""
        )
        assert moved == "자료함", moved

        # 여러 개 지우기 (노트·문제도 같이)
        r = await page.request.post(BASE + "/api/notes/blank", headers={"origin": BASE}, data={"subjectId": db(f"select subject_id from public.sources where id = '{oldest}'"), "title": "지울 노트 1"})
        assert r.ok, (r.status, await r.text())
        r = await page.request.post(BASE + "/api/notes/blank", headers={"origin": BASE}, data={"subjectId": db(f"select subject_id from public.sources where id = '{oldest}'"), "title": "지울 노트 2"})
        assert r.ok, (r.status, await r.text())
        gone = db(f"select string_agg(id::text, ',' order by title) from public.sources where user_id = '{me_id}' and title like '지울 노트 %'").split(",")
        await page.reload()
        await expect(card(gone[0])).to_be_visible()
        await card(gone[0]).hover()
        await page.mouse.down()
        await page.wait_for_timeout(650)
        await page.mouse.up()
        await card(gone[1]).click()
        await expect(page.get_by_role("heading", name="2개 선택", exact=True)).to_be_visible()
        page.once("dialog", lambda d: asyncio.ensure_future(d.accept()))
        await bar.get_by_role("button", name="지우기").click()
        await expect(page.get_by_text("2개를 지웠어요.")).to_be_visible()
        await expect(card(gone[0])).to_have_count(0)
        await expect(card(gone[1])).to_have_count(0)
        assert db(f"select count(*) from public.sources where id in ('{gone[0]}', '{gone[1]}')") == "0"
        assert db(f"select count(*) from public.notes where source_id in ('{gone[0]}', '{gone[1]}')") == "0"
        # 남의 자료는 지우지 않는다
        r = await page.request.post(BASE + "/api/sources/delete", headers={"origin": BASE}, data={"ids": [db(f"select id from public.sources where user_id <> '{me_id}' limit 1") or "00000000-0000-4000-8000-000000000000"]})
        assert r.status == 404, (r.status, await r.text())

        # 과목 안에서 순서 바꾸기 (키보드): 별표하지 않은 자료끼리
        sci_id = db(f"select subject_id from public.sources where id = '{oldest}'")
        await page.goto(BASE + f"/library/{sci_id}")
        await page.get_by_role("button", name="과목 메뉴").click()
        await page.get_by_role("menuitem", name="순서 바꾸기").click()
        sheet = page.get_by_role("dialog", name=re.compile("순서 바꾸기$"))
        await expect(sheet).to_be_visible()
        # 별표하지 않은 자료가 둘 이상인 목록 (단원마다 목록이 따로다)
        lists = sheet.get_by_role("list", name=re.compile("(^| · )자료 순서$"))
        rows_ = None
        for i in range(await lists.count()):
            if await lists.nth(i).locator("li").count() >= 2:
                rows_ = lists.nth(i).locator("li")
                break
        assert rows_ is not None, "no list with two rows"
        first_id = await rows_.nth(0).locator("[data-source]").get_attribute("data-source")
        second_id = await rows_.nth(1).locator("[data-source]").get_attribute("data-source")
        await shot(page, "93-library-reorder", full=False)
        await rows_.first.get_by_role("button").focus()
        await page.keyboard.press("Space")
        await page.wait_for_timeout(200)
        await page.keyboard.press("ArrowDown")
        await page.wait_for_timeout(300)
        await page.keyboard.press("Space")
        await expect(rows_.nth(0).locator("[data-source]")).to_have_attribute("data-source", second_id)
        await expect(rows_.nth(1).locator("[data-source]")).to_have_attribute("data-source", first_id)
        await poll_db(f"select (select position from public.sources where id = '{second_id}') < (select position from public.sources where id = '{first_id}')", "t")
        # 과목의 모든 자료에 번호가 붙는다 (보이는 차례대로 0, 1, 2 …)
        assert db(f"select count(*) from public.sources where subject_id = '{sci_id}' and parent_id is null and position is null") == "0"
        await page.keyboard.press("Escape")
        await expect(sheet).to_have_count(0)
        # 자료함 카드도 같은 순서 (다시 읽어도)
        await page.reload()
        await expect(card(first_id)).to_be_visible()
        flips = [await c.get_attribute("data-flip") for c in await page.locator("main [data-flip]").all()]
        assert flips.index(second_id) < flips.index(first_id), flips
        # 전체 보기에서 고르면 자료가 둘 이상인 과목으로 가서 연다 (순서는 과목 안에서 정한다)
        await page.goto(BASE + "/library")
        await expect(page.locator("main [data-flip]").first).to_be_visible()
        await page.get_by_role("button", name="자료함 메뉴").click()
        await page.get_by_role("menuitem", name="순서 바꾸기").click()
        await expect(page.get_by_role("dialog", name=re.compile("순서 바꾸기$"))).to_be_visible()
        assert re.search(r"/library/[0-9a-f-]{36}$", page.url), page.url
        await page.keyboard.press("Escape")

        # 새 자료: 입력창에서 복습 끄기 (빈 노트·AI 정리 모두)
        await page.goto(BASE + "/library")
        await page.get_by_role("button", name="자료 넣기", exact=True).click()
        composer = page.get_by_role("dialog", name="자료 넣기")
        await composer.get_by_label("공부한 내용").fill("복습 안 할 노트")
        await composer.get_by_role("button", name="빈 노트").click()
        toggle = composer.get_by_role("switch", name="복습에 넣기")
        await expect(toggle).to_have_attribute("aria-checked", "true")
        await expect(toggle).to_have_text("복습 켬")
        await toggle.click()
        await expect(toggle).to_have_attribute("aria-checked", "false")
        await expect(toggle).to_have_text("복습 끔")
        await expect(composer.get_by_text("이 노트는 복습에 나오지 않아요.", exact=False)).to_be_visible()
        await shot(page, "94-composer-review-off", full=False)
        await composer.get_by_role("button", name="만들기").click()
        await page.wait_for_url("**/notes/*")
        assert await wait_ready(page)
        nsid = page.url.rstrip("/").split("/")[-1].split("?")[0]
        await expect(page.get_by_text("복습에서 뺀 노트예요.")).to_be_visible()
        assert db(f"select in_review from public.sources where id = '{nsid}'") == "f"
        # 입력창을 다시 열면 복습에 넣기로 돌아와 있다
        await page.goto(BASE + "/library")
        await page.get_by_role("button", name="자료 넣기", exact=True).click()
        await expect(composer.get_by_role("switch", name="복습에 넣기")).to_have_attribute("aria-checked", "true")
        await composer.get_by_label("공부한 내용").fill("이 글은 복습에 넣지 않을 자료예요. 광합성은 빛에너지를 화학 에너지로 바꾸는 과정이에요.")
        await composer.get_by_role("switch", name="복습에 넣기").click()
        await composer.get_by_label("공부한 내용").press("Enter")
        await expect(composer).to_be_hidden()
        await poll_db(f"select count(*) from public.sources where user_id = '{me_id}' and title is distinct from '복습 안 할 노트' and not in_review and created_at > now() - interval '1 minute'", "1", timeout=15)
        await ctx.close()

        # 넓은 화면·어두운 화면: 고르기 띠
        ctx, page = await new_ctx(browser, "student", width=1280, scheme="dark")
        await page.goto(BASE + "/library")
        cards = page.locator("main [data-flip]")
        await expect(cards.first).to_be_visible()
        await cards.nth(1).hover()
        await page.mouse.down()
        await page.wait_for_timeout(650)
        await page.mouse.up()
        await cards.nth(2).click()
        await expect(page.get_by_role("heading", name="2개 선택", exact=True)).to_be_visible()
        await shot(page, "95-library-select-desktop", full=False)
        await ctx.close()

        step("library: many subjects — chips show pinned and recent ones, the rest in '모든 과목' (find by first consonants, pin, keep aside); kept-aside subjects leave the lists but keep their review")
        extra = ["국어", "영어", "사회", "음악", "미술", "체육", "기술", "정보"]
        for i, name in enumerate(extra):
            db(f"insert into public.subjects (user_id, name, color, position, created_at, used_at) values ('{me_id}', '{name}', 'blue', {100 + i}, now() - interval '{60 + i} days', now() - interval '{30 + i} days')")
        n_subjects = int(db(f"select count(*) from public.subjects where user_id = '{me_id}'"))
        ctx, page = await new_ctx(browser, "student")
        await page.goto(BASE + "/library")
        chips = page.get_by_role("tablist", name="과목")
        # 칩 줄: 전체 + 최근 쓴 다섯 과목, 나머지는 '모든 과목'
        await expect(chips.get_by_role("tab")).to_have_count(6)
        await expect(chips.get_by_role("tab", name=re.compile("^미술"))).to_have_count(0)
        more = chips.get_by_role("button", name=re.compile("^모든 과목"))
        await expect(more).to_contain_text(str(n_subjects))
        await more.click()
        # 서랍은 목록 → 과목 관리 → 과목 합치기로 이름이 바뀐다
        DRAWER = re.compile("^(모든 과목|과목 관리|과목 합치기)$")
        drawer = page.get_by_role("dialog", name=DRAWER)
        await expect(drawer).to_have_attribute("aria-label", "모든 과목")
        # 첫 자음으로 찾기 (ㅁㅅ → 미술)
        await drawer.get_by_label("과목 찾기").fill("ㅁㅅ")
        await expect(drawer.get_by_role("button", name=re.compile("^미술"))).to_be_visible()
        await expect(drawer.get_by_role("button", name=re.compile("^음악"))).to_have_count(0)
        await shot(page, "96-subject-drawer-search", full=False)
        await drawer.get_by_label("과목 찾기").fill("")
        # 과목 관리(⋯): 설명이 붙은 줄을 눌러 위에 고정 → '고정한 과목' 묶음, 칩 줄 맨 앞
        await drawer.get_by_role("button", name="'미술' 과목 관리").click()
        await expect(drawer).to_have_attribute("aria-label", "과목 관리")
        await expect(drawer.get_by_role("heading", name="미술")).to_be_visible()
        await expect(drawer.get_by_text("과목 칩 줄 맨 앞에 늘 보여요")).to_be_visible()
        await drawer.get_by_role("button", name=re.compile("^위에 고정")).click()
        await poll_db(f"select pinned from public.subjects where user_id = '{me_id}' and name = '미술'", "t")
        await expect(drawer.get_by_role("button", name=re.compile("^고정 풀기"))).to_be_visible()
        await drawer.get_by_role("button", name="모든 과목", exact=True).click()
        await expect(drawer.get_by_role("heading", name="고정한 과목")).to_be_visible()
        await shot(page, "96-subject-drawer", full=False)
        await drawer.get_by_role("button", name=re.compile("^미술")).click()
        await expect(drawer).to_be_hidden()
        await page.wait_for_url(LIBRARY_SUBJECT)
        await expect(page.get_by_role("heading", name="미술", exact=True)).to_be_visible()
        await expect(chips.get_by_role("tab").nth(1)).to_contain_text("미술")
        await expect(chips.get_by_role("tab")).to_have_count(6)

        # 보관하기: 자료함 '전체'·과목 칩·자료 넣기·복습 고르기에서 빠지고, 복습 문제 수는 그대로
        sci = db(f"select id from public.subjects where user_id = '{me_id}' and name = '과학'")
        before = await review_total()
        await page.goto(BASE + f"/library/{sci}")
        await page.get_by_role("button", name="과목 메뉴").click()
        await page.get_by_role("menuitem", name="보관하기").click()
        await expect(page.get_by_text("보관한 과목이에요.", exact=False)).to_be_visible()
        await poll_db(f"select archived from public.subjects where id = '{sci}'", "t")
        await page.get_by_role("tab", name=re.compile("^전체")).click()
        await page.wait_for_url(re.compile(r"/library$"))
        left = int(db(f"select count(*) from public.sources where user_id = '{me_id}' and parent_id is null and subject_id <> '{sci}'"))
        await expect(page.locator("main [data-flip]")).to_have_count(left)
        await expect(chips.get_by_role("tab", name=re.compile("^과학"))).to_have_count(0)
        assert await review_total() == before, "kept-aside subjects keep their review"
        await expect(page.get_by_role("radiogroup", name="과목").get_by_role("radio", name=re.compile("^과학"))).to_have_count(0)
        await page.goto(BASE + "/library")
        await page.get_by_role("button", name="자료 넣기", exact=True).click()
        composer = page.get_by_role("dialog", name="자료 넣기")
        await composer.locator('button[aria-haspopup="listbox"]').click()
        subject_list = composer.get_by_role("listbox", name="과목")
        await expect(subject_list.get_by_role("option", name=re.compile("^미술"))).to_be_visible()
        await expect(subject_list.get_by_role("option", name=re.compile("^과학"))).to_have_count(0)
        await composer.get_by_label("과목 찾기").fill("ㅈㅂ")
        await expect(subject_list.get_by_role("option")).to_have_count(1)
        await page.keyboard.press("Escape")
        # 서랍의 '보관한 과목'에서 다시 꺼낸다
        await chips.get_by_role("button", name=re.compile("^모든 과목")).click()
        await drawer.get_by_role("button", name=re.compile("^보관한 과목 1개")).click()
        await drawer.get_by_role("button", name="'과학' 과목 관리").click()
        await drawer.get_by_role("button", name=re.compile("^보관 풀기")).click()
        await poll_db(f"select archived from public.subjects where id = '{sci}'", "f")
        # Esc 는 한 단계씩: 과목 관리 → 목록 → 닫기
        await page.keyboard.press("Escape")
        await expect(drawer).to_have_attribute("aria-label", "모든 과목")
        await page.keyboard.press("Escape")
        await expect(drawer).to_be_hidden()
        await ctx.close()

        # ---------- 자료함 정리 2: 고정한 과목 순서, 과목 합치기, 노트 옮기기, 노트 합치기, AI로 다시 정리 ----------
        pinned_sql = f"select string_agg(name, ',' order by position, created_at) from public.subjects where user_id = '{me_id}' and pinned and not archived"
        other_id = USERS["other"][0]
        other_subject = db(f"select id from public.subjects where user_id = '{other_id}' limit 1") or db(
            f"insert into public.subjects (user_id, name) values ('{other_id}', '남의 과목') returning id"
        ).splitlines()[0]

        step("library: pinned subjects — long-press drag (finger) or mouse drag reorders them, and 과목 관리 has 앞으로·뒤로 for the keyboard")
        db(f"update public.subjects set pinned = false where user_id = '{me_id}'")
        for i, name in enumerate(["체육", "국어", "미술"]):
            db(f"update public.subjects set pinned = true, position = {300 + i} where user_id = '{me_id}' and name = '{name}'")
        ctx, phone = await new_ctx(browser, "student")
        await phone.goto(BASE + "/library")
        await phone.get_by_role("tablist", name="과목").get_by_role("button", name=re.compile("^모든 과목")).click()
        drawer = phone.get_by_role("dialog", name=DRAWER)
        tiles = drawer.locator('section[aria-labelledby="drawer-pinned"] [data-tile]')
        await expect(tiles).to_have_count(3)
        await expect(drawer.get_by_text("꾹 눌러 끌면 순서가 바뀌어요")).to_be_visible()
        # 손가락으로 꾹 눌러 첫 과목을 끝으로 (놓은 뒤 따라오는 누르기로 과목이 열리지 않는다)
        await touch_drag(phone, tiles.nth(0), tiles.nth(2))
        await poll_db(pinned_sql, "국어,미술,체육")
        await expect(drawer).to_have_attribute("aria-label", "모든 과목")
        # 키보드로는 과목 관리의 앞으로·뒤로
        await drawer.get_by_role("button", name="'체육' 과목 관리").click()
        await expect(drawer.get_by_text("고정한 과목 3개 중 3번째")).to_be_visible()
        await expect(drawer.get_by_role("button", name="뒤로 옮기기")).to_be_disabled()
        await drawer.get_by_role("button", name="앞으로 옮기기").click()
        await expect(drawer.get_by_text("고정한 과목 3개 중 2번째")).to_be_visible()
        await poll_db(pinned_sql, "국어,체육,미술")
        await shot(phone, "97-subject-panel", full=False)
        await phone.keyboard.press("Escape")
        await expect(drawer).to_have_attribute("aria-label", "모든 과목")
        await expect(drawer.get_by_role("button", name="'체육' 과목 관리")).to_be_focused()
        await phone.keyboard.press("Escape")
        await expect(drawer).to_be_hidden()
        chips = phone.get_by_role("tablist", name="과목")
        await expect(chips.get_by_role("tab").nth(1)).to_contain_text("국어")
        await expect(chips.get_by_role("tab").nth(2)).to_contain_text("체육")
        await ctx.close()
        ctx, page = await new_ctx(browser, "student", width=1280)
        await page.goto(BASE + "/library")
        await page.get_by_role("tablist", name="과목").get_by_role("button", name=re.compile("^모든 과목")).click()
        drawer = page.get_by_role("dialog", name=DRAWER)
        tiles = drawer.locator('section[aria-labelledby="drawer-pinned"] [data-tile]')
        await mouse_drag(page, tiles.nth(2), tiles.nth(0))
        await poll_db(pinned_sql, "미술,국어,체육")
        await expect(drawer).to_have_attribute("aria-label", "모든 과목")
        await ctx.close()

        step("library: merge one subject into another (drawer, subject menu) — notes, questions, cards and review records move, the subject is gone")
        music = db(f"select id from public.subjects where user_id = '{me_id}' and name = '음악'")
        social = db(f"select id from public.subjects where user_id = '{me_id}' and name = '사회'")
        art = db(f"select id from public.subjects where user_id = '{me_id}' and name = '미술'")
        ctx, page = await new_ctx(browser, "student")
        page.on("dialog", lambda d: asyncio.ensure_future(d.accept()))
        r = await page.request.post(BASE + "/api/notes/blank", headers={"origin": BASE}, data={"subjectId": music, "title": "음악 노트"})
        assert r.ok, await r.text()
        made = await r.json()
        music_src, music_note = made["id"], made["noteId"]
        mq = db(
            f"insert into public.questions (user_id, note_id, subject_id, type, prompt, answer) values ('{me_id}', '{music_note}', '{music}', 'ox', '음표는 소리의 길이를 나타낸다.', 'true') returning id"
        ).splitlines()[0]
        db(f"insert into public.cards (question_id, user_id, subject_id) values ('{mq}', '{me_id}', '{music}')")
        db(f"insert into public.review_logs (user_id, question_id, subject_id, rating, correct) values ('{me_id}', '{mq}', '{music}', 3, true)")
        await page.goto(BASE + "/library")
        await page.get_by_role("tablist", name="과목").get_by_role("button", name=re.compile("^모든 과목")).click()
        drawer = page.get_by_role("dialog", name=DRAWER)
        await drawer.get_by_role("button", name="'음악' 과목 관리").click()
        await drawer.get_by_role("button", name=re.compile("^다른 과목과 합치기")).click()
        await expect(drawer).to_have_attribute("aria-label", "과목 합치기")
        await expect(drawer.get_by_text("‘음악’ 과목을 어느 과목으로 합칠까요?")).to_be_visible()
        await expect(drawer.get_by_role("button", name="합칠 과목을 골라 주세요")).to_be_disabled()
        await expect(drawer.get_by_role("radio", name=re.compile("^음악"))).to_have_count(0)
        await drawer.get_by_role("radio", name=re.compile("^미술")).click()
        await shot(page, "97-subject-merge", full=False)
        await drawer.get_by_role("button", name="'미술' 과목으로 합치기").click()
        await expect(drawer).to_be_hidden()
        await page.wait_for_url(re.compile(rf"/library/{art}$"))
        await poll_db(f"select count(*) from public.subjects where id = '{music}'", "0")
        assert db(f"select subject_id from public.sources where id = '{music_src}'") == art
        assert db(f"select subject_id from public.notes where id = '{music_note}'") == art
        assert db(f"select subject_id from public.questions where id = '{mq}'") == art
        assert db(f"select subject_id from public.cards where question_id = '{mq}'") == art
        assert db(f"select subject_id from public.review_logs where question_id = '{mq}'") == art
        await expect(page.locator("main [data-flip]")).to_have_count(1)
        # 과목 메뉴에서도 (사회 → 미술)
        await page.goto(BASE + f"/library/{social}")
        await page.get_by_role("button", name="과목 메뉴").click()
        await page.get_by_role("menuitem", name="다른 과목과 합치기").click()
        sheet = page.get_by_role("dialog", name="다른 과목과 합치기")
        await sheet.get_by_role("radio", name=re.compile("^미술")).click()
        await sheet.get_by_role("button", name="'미술' 과목으로 합치기").click()
        await expect(sheet).to_be_hidden()
        await poll_db(f"select count(*) from public.subjects where id = '{social}'", "0")
        await page.wait_for_url(re.compile(rf"/library/{art}$"))
        # 남의 과목과는 합칠 수 없다 (서버)
        r = await page.request.post(BASE + "/api/subjects/merge", headers={"origin": BASE}, data={"from": art, "into": other_subject})
        assert r.status == 404, r.status
        await ctx.close()

        step("library: move notes to another subject (card menu, several at once into a new subject) — questions and cards follow")
        math = db(f"select id from public.subjects where user_id = '{me_id}' and name = '수학'")
        ctx, page = await new_ctx(browser, "student")
        await page.goto(BASE + f"/library/{sci}")
        cards = page.locator("main [data-flip]")
        sid = await cards.first.get_attribute("data-flip")
        await cards.first.get_by_role("button", name=re.compile("메뉴$")).click()
        await page.get_by_role("menuitem", name="다른 과목으로 옮기기").click()
        sheet = page.get_by_role("dialog", name="다른 과목으로 옮기기")
        await expect(sheet.get_by_role("radio", name=re.compile("^과학"))).to_have_count(0)
        await sheet.get_by_role("radio", name=re.compile("^수학")).click()
        await sheet.get_by_role("button", name="'수학' 과목으로 옮기기").click()
        await expect(sheet).to_be_hidden()
        await poll_db(f"select subject_id from public.sources where id = '{sid}'", math)
        moved_q = f"from public.questions q join public.notes n on n.id = q.note_id where n.source_id = '{sid}'"
        assert db(f"select count(*) {moved_q} and q.subject_id <> '{math}'") == "0"
        assert db(f"select count(*) from public.cards c where c.question_id in (select q.id {moved_q}) and c.subject_id <> '{math}'") == "0"
        await expect(page.locator(f'main [data-flip="{sid}"]')).to_have_count(0)
        # 여러 개 골라 새 과목으로
        await cards.first.get_by_role("button", name=re.compile("메뉴$")).click()
        await page.get_by_role("menuitem", name="여러 개 고르기").click()
        await cards.nth(1).click()
        two = [await cards.nth(i).get_attribute("data-flip") for i in range(2)]
        bar = page.get_by_role("toolbar", name=re.compile("^고른 자료"))
        await bar.get_by_role("button", name="옮기기").click()
        sheet = page.get_by_role("dialog", name="다른 과목으로 옮기기")
        await expect(sheet.get_by_text("고른 노트 2개를", exact=False)).to_be_visible()
        await sheet.get_by_role("button", name="새 과목 만들기").click()
        await sheet.get_by_label("새 과목 이름").fill("생명과학")
        await sheet.get_by_role("button", name="만들기", exact=True).click()
        await expect(sheet.get_by_role("radio", name=re.compile("^생명과학"))).to_have_attribute("aria-checked", "true")
        await shot(page, "97-move", full=False)
        await sheet.get_by_role("button", name="'생명과학' 과목으로 옮기기").click()
        await expect(sheet).to_be_hidden()
        bio = db(f"select id from public.subjects where user_id = '{me_id}' and name = '생명과학'")
        await poll_db(f"select count(*) from public.sources where id in ('{two[0]}', '{two[1]}') and subject_id = '{bio}'", "2")
        await expect(page.get_by_role("toolbar", name=re.compile("^고른 자료"))).to_have_count(0)
        # 남의 과목으로는 옮길 수 없다 (서버)
        r = await page.request.post(BASE + "/api/sources/move", headers={"origin": BASE}, data={"ids": [two[0]], "subject": other_subject})
        assert r.status == 404, r.status
        await ctx.close()

        step("library: merge notes without AI (no energy) — new concept numbers, questions and records follow, originals stay in the 원본 tab")
        ctx, page = await new_ctx(browser, "student")
        page.on("dialog", lambda d: asyncio.ensure_future(d.accept()))
        spent = lambda: db(f"select coalesce(sum(energy), 0) from public.energy_ledger where user_id = '{me_id}'")  # noqa: E731
        energy_before = spent()
        await page.goto(BASE + f"/library/{bio}")
        cards = page.locator("main [data-flip]")
        await expect(cards).to_have_count(2)
        ids = [await cards.nth(i).get_attribute("data-flip") for i in range(2)]
        await cards.first.get_by_role("button", name=re.compile("메뉴$")).click()
        await page.get_by_role("menuitem", name="여러 개 고르기").click()
        bar = page.get_by_role("toolbar", name=re.compile("^고른 자료"))
        await expect(bar.get_by_role("button", name="합치기")).to_be_disabled()
        await cards.nth(1).click()
        await bar.get_by_role("button", name="합치기").click()
        msheet = page.get_by_role("dialog", name="노트 합치기")
        radios = msheet.get_by_role("radio")
        await expect(radios).to_have_count(2)
        await expect(radios.nth(0)).to_have_attribute("aria-checked", "true")
        await radios.nth(1).click()
        await expect(radios.nth(1)).to_have_attribute("aria-checked", "true")
        keep, gone = ids[1], ids[0]
        keep_note = db(f"select id from public.notes where source_id = '{keep}'")
        gone_note = db(f"select id from public.notes where source_id = '{gone}'")
        want_q = int(db(f"select count(*) from public.questions where note_id in ('{keep_note}', '{gone_note}') and status <> 'hidden'"))
        gone_q = db(f"select id from public.questions where note_id = '{gone_note}' and key_point_id is not null and status <> 'hidden' limit 1")
        await shot(page, "97-merge-notes", full=False)
        await msheet.get_by_role("button", name="노트 2개 합치기").click()
        await page.wait_for_url(re.compile(rf"/notes/{keep}"))
        await expect(page.get_by_text("노트 2개를 합친 노트예요")).to_be_visible()
        assert db(f"select count(*) from public.notes where id = '{gone_note}'") == "0"
        assert db(f"select parent_id from public.sources where id = '{gone}'") == keep
        assert int(db(f"select count(*) from public.questions where note_id = '{keep_note}' and status <> 'hidden'")) == want_q
        kp_ids = db(f"select string_agg(k->>'id', ',') from public.notes n, jsonb_array_elements(n.body->'key_points') k where n.id = '{keep_note}'").split(",")
        assert len(kp_ids) == len(set(kp_ids)), kp_ids
        if gone_q:
            assert db(f"select key_point_id from public.questions where id = '{gone_q}'") in kp_ids, "moved question points at a concept of the merged note"
            assert db(f"select cardinality(pages) from public.questions where id = '{gone_q}'") == "0"
        assert spent() == energy_before, "merging notes uses no energy"
        await shot(page, "97-merged-note", full=False)
        await page.get_by_role("tab", name="원본").click()
        await expect(page.get_by_text("원본 자료 2개")).to_be_visible()
        # 자료함에는 남긴 노트 하나만
        await page.goto(BASE + f"/library/{bio}")
        await expect(page.locator("main [data-flip]")).to_have_count(1)
        # 남의 노트와는 합칠 수 없다 (서버)
        other_src = db(f"select id from public.sources where user_id = '{other_id}' and parent_id is null and status = 'ready' limit 1")
        if other_src:
            r = await page.request.post(BASE + "/api/notes/merge", headers={"origin": BASE}, data={"into": keep, "from": [other_src]})
            assert r.status == 404, r.status
        await ctx.close()

        step("Pro: 'AI로 다시 정리' on a merged note (also from the menu after closing the tip) makes a new version; the note before stays in the version list")
        ctx, page = await new_ctx(browser, "student")
        page.on("dialog", lambda d: asyncio.ensure_future(d.accept()))
        await page.goto(BASE + f"/notes/{keep}")
        tip = page.get_by_role("region", name="합친 노트")
        await expect(tip.get_by_role("button", name=re.compile("^AI로 다시 정리"))).to_contain_text("약")
        # 안내를 닫아도 메뉴에 남는다
        await tip.get_by_role("button", name="합친 노트 안내 닫기").click()
        await expect(tip).to_be_hidden()
        await poll_db(f"select body->'merged'->>'hide' from public.notes where id = '{keep_note}'", "true")
        kp_before = int(db(f"select jsonb_array_length(body->'key_points') from public.notes where id = '{keep_note}'"))
        await page.get_by_role("button", name="노트 메뉴").click()
        await page.get_by_role("menuitem", name="AI로 다시 정리").click()
        await expect(page.get_by_text("AI가 노트를 다시 정리하고 있어요", exact=False)).to_be_visible()
        await poll_db(f"select current_version from public.notes where id = '{keep_note}'", "2", timeout=40)
        await expect(page.get_by_text("AI로 다시 정리했어요.", exact=False)).to_be_visible(timeout=40000)
        assert db(f"select string_agg(number || ':' || kind, ',' order by number) from public.note_versions where note_id = '{keep_note}'") == "1:first,2:reorganize"
        assert db(f"select body ? 'merged' from public.notes where id = '{keep_note}'") == "f"
        assert int(db(f"select jsonb_array_length(body->'key_points') from public.notes where id = '{keep_note}'")) == min(kp_before - 1, 12)
        # 문제는 남은 개념만 가리킨다 (합쳐진 개념의 문제는 합친 개념으로)
        live = db(f"select string_agg(k->>'id', ',') from public.notes n, jsonb_array_elements(n.body->'key_points') k where n.id = '{keep_note}'").split(",")
        stray = db(f"select count(*) from public.questions where note_id = '{keep_note}' and status <> 'hidden' and key_point_id is not null and not (key_point_id = any(string_to_array('{','.join(live)}', ',')))")
        assert stray == "0", stray
        await page.get_by_role("tab", name="원본").click()
        await expect(page.get_by_text("버전 2 · AI로 다시 정리")).to_be_visible()
        await expect(page.get_by_text("겹치는 개념을 하나로 다듬었어요")).to_be_visible()
        await shot(page, "97-reorganized-versions")
        # 다시 정리한 노트는 더 이상 합친 노트가 아니다 (서버도 거절), 무료 계정은 Pro 안내
        r = await page.request.post(BASE + f"/api/notes/{keep_note}/reorganize", headers={"origin": BASE}, data={})
        assert r.status == 400, r.status
        octx, opage = await new_ctx(browser, "other")
        r = await opage.request.post(BASE + f"/api/notes/{keep_note}/reorganize", headers={"origin": BASE}, data={})
        assert r.status in (403, 404), r.status
        await octx.close()
        await ctx.close()
        db(f"delete from public.subjects where user_id = '{me_id}' and name in ({', '.join(repr(x) for x in extra)})")

        await figure_steps(browser)
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
