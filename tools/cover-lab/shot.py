# 표지 그림 미리보기 화면 찍기 (밝은 화면 다음 어두운 화면, 1600px 씩 나눠 찍는다)
# 먼저: npx vitest run --config tools/cover-lab/vitest.config.ts
import asyncio, pathlib
from playwright.async_api import async_playwright

here = pathlib.Path(__file__).parent


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        for old in (here / "out").glob("cover-*.png"):
            old.unlink()
        pg = await b.new_page(viewport={"width": 1010, "height": 900}, device_scale_factor=2)
        await pg.goto((here / "out" / "covers.html").as_uri())
        await pg.evaluate("document.fonts.ready")
        await pg.wait_for_timeout(300)
        h = await pg.evaluate("document.body.scrollHeight")
        step = 1500
        n = 0
        for top in range(0, h, step):
            await pg.screenshot(path=str(here / "out" / f"cover-{n}.png"), clip={"x": 0, "y": top, "width": 1010, "height": min(step, h - top)}, full_page=True)
            n += 1
        print("pages", n, "height", h)
        await b.close()


asyncio.run(main())
