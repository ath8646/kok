#!/usr/bin/env python3
"""PDF 요약 정리의 수식 글꼴 두 개를 DejaVu Sans 에서 뽑는다 (src/lib/server/note-pdf.ts 가 쓴다).

본문 글꼴(고운돋움)·제목 글꼴(주아)에 없는 글자를 이 글꼴들로 그린다:
- DejaVuSans-Greek.sub.woff2: 그리스 문자 (ExtraLight: 고운돋움의 가는 획과 굵기가 비슷하다)
- DejaVuSans-Math.sub.woff2: 나머지 수식 글자 (위아래 첨자·연산 기호·화살표, Book)

쓰는 법: python3 tools/pdf-fonts/math-font.py [/usr/share/fonts/truetype/dejavu]
  (DejaVu Sans 2.37, https://dejavu-fonts.github.io/ · 라이선스는 src/lib/server/pdf-fonts/LICENSE-DejaVu.txt)
- pdf-lib 의 부분 글꼴 만들기가 홀수 길이 글리프를 깨뜨려서 글리프 길이를 4바이트로 맞춘다
- WOFF2 는 glyf 변환 없이 (fontkit 이 변환된 glyf 로는 부분 글꼴을 못 만든다)
"""
import os
import sys

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.ttLib.woff2 import WOFF2FlavorData

OUT_DIR = 'src/lib/server/pdf-fonts'

GREEK = [(0x0370, 0x03FF)]
MATH = [
    (0x0300, 0x036F),  # 위에 붙는 표시 (x̄ 의 막대)
    (0x0370, 0x03FF),  # 그리스 문자 (Greek 글꼴에 없는 것: ϑ)
    (0x02B0, 0x02FF),  # 위 첨자 글자 (ʰ ʲ ʳ ˢ ˣ …)
    (0x1D00, 0x1DBF),  # 위아래 첨자 글자 (ᵃ ᵇ ᵢ ᵣ …)
    (0x2000, 0x206F),  # 문장 부호 (′ ″ ‖ ⁄ …)
    (0x2070, 0x209F),  # 위아래 첨자 (⁺ ⁻ ₙ ₖ …)
    (0x20D0, 0x20FF),  # 기호 위 표시 (⃗)
    (0x2100, 0x214F),  # 글자 모양 기호 (ℝ ℏ ℓ …)
    (0x2150, 0x218F),  # 분수 글자 (⅓ …)
    (0x2190, 0x21FF),  # 화살표 (⇌ ⇒ ↦ …)
    (0x2200, 0x22FF),  # 수학 연산 기호
    (0x2300, 0x23FF),  # 바닥·천장·지름 (⌊ ⌈ ⌀ …)
    (0x25A0, 0x25FF),  # 도형 (△ ○ …)
    (0x2713, 0x2717),  # 확인 표시
    (0x27C0, 0x27FF),  # 수학 기호 (⟨ ⟩ ⟶ …)
    (0x2C60, 0x2C7F),  # ⱼ
]


def build(src: str, ranges: list[tuple[int, int]], out: str) -> None:
    font = TTFont(src)
    cmap = font.getBestCmap()
    wanted = [cp for a, b in ranges for cp in range(a, b + 1) if cp in cmap]
    opts = subset.Options()
    opts.layout_features = []  # 글자 바꾸기(GSUB)·자간(GPOS) 없이: PDF 는 한 글자씩 그린다
    opts.hinting = False
    opts.glyph_names = False
    opts.name_IDs = ['*']
    opts.notdef_outline = True
    opts.drop_tables += ['FFTM']
    sub = subset.Subsetter(opts)
    sub.populate(unicodes=wanted)
    sub.subset(font)
    font['glyf'].padding = 4
    font.flavor = 'woff2'
    font.flavorData = WOFF2FlavorData(transformedTables=set())
    font.save(out)
    print(f'{out}: {len(wanted)} 글자')


def main() -> None:
    src = sys.argv[1] if len(sys.argv) > 1 else '/usr/share/fonts/truetype/dejavu'
    build(os.path.join(src, 'DejaVuSans-ExtraLight.ttf'), GREEK, os.path.join(OUT_DIR, 'DejaVuSans-Greek.sub.woff2'))
    build(os.path.join(src, 'DejaVuSans.ttf'), MATH, os.path.join(OUT_DIR, 'DejaVuSans-Math.sub.woff2'))


if __name__ == '__main__':
    main()
