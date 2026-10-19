import asyncio, sys, pathlib
from playwright.async_api import async_playwright
here = pathlib.Path(__file__).parent
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await b.new_page(viewport={"width": 1300, "height": 900}, device_scale_factor=1)
        await pg.goto((here / "out" / "figures.html").as_uri())
        await pg.wait_for_timeout(300)
        h = await pg.evaluate("document.body.scrollHeight")
        n = 0
        for top in range(0, h, 1800):
            await pg.screenshot(path=str(here / "out" / f"fig-{n}.png"), clip={"x": 0, "y": top, "width": 1300, "height": min(1800, h - top)}, full_page=True)
            n += 1
        print("pages", n, "height", h)
        await b.close()
asyncio.run(main())
