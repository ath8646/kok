# 다시 그린 그림 미리보기 화면 찍기: 폰(360px, 밝은·어두운 화면이 위아래로)과 넓은 화면(1280px, 나란히)
# 먼저: npx vitest run --config tools/art-lab/vitest.config.ts
import asyncio, pathlib
from playwright.async_api import async_playwright

here = pathlib.Path(__file__).parent


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        # 지난번 화면(쪽 수가 더 많았을 때 남은 것)은 지운다
        for old in (here / "out").glob("art-*.png"):
            old.unlink()
        for width in (360, 1280):
            pg = await b.new_page(viewport={"width": width, "height": 900}, device_scale_factor=2 if width == 360 else 1)
            await pg.goto((here / "out" / "arts.html").as_uri())
            await pg.wait_for_timeout(400)
            h = await pg.evaluate("document.body.scrollHeight")
            step = 1600
            n = 0
            for top in range(0, h, step):
                await pg.screenshot(path=str(here / "out" / f"art-{width}-{n}.png"), clip={"x": 0, "y": top, "width": width, "height": min(step, h - top)}, full_page=True)
                n += 1
            print(width, "pages", n, "height", h)
            await pg.close()
        await b.close()


asyncio.run(main())
