import { describe, expect, it } from 'vitest';
import { texToText } from '@/lib/tex-text';

const cases = (rows: Array<[string, string]>) => {
  for (const [tex, want] of rows) expect([tex, texToText(tex)]).toEqual([tex, want]);
};

describe('texToText: 분수', () => {
  it('묶어야 할 분자·분모에 괄호를 친다', () => {
    cases([
      ['\\frac{b^2-4ac}{4a}', '(b²-4ac)/(4a)'],
      ['y=ax^2+bx+c=a\\left(x+\\frac{b}{2a}\\right)^2-\\frac{b^2-4ac}{4a}', 'y=ax²+bx+c=a(x+b/(2a))²-(b²-4ac)/(4a)'],
      ['x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}', 'x = (-b ± √(b²-4ac))/(2a)'],
      ['\\left(-\\frac{b}{2a}, -\\frac{b^2-4ac}{4a}\\right)', '(-b/(2a), -(b²-4ac)/(4a))'],
      ['\\frac{1}{x+1}', '1/(x+1)'],
      ['\\frac{a+b}{2} \\geq \\sqrt{ab}', '(a+b)/2 ≥ √(ab)'],
      ['a = \\frac{v - v_0}{t}', 'a = (v - v₀)/t'],
      ['\\frac{f(x+h) - f(x)}{h}', '(f(x+h) - f(x))/h'],
      ['\\frac{\\sin x}{x}', '(sin x)/x'],
    ]);
  });

  it('한 덩어리면 그대로 둔다', () => {
    cases([
      ['\\frac{1}{2}', '1/2'],
      ['\\frac{\\pi}{2}', 'π/2'],
      ['\\frac{x^{2}}{2}', 'x²/2'],
      ['\\dfrac{x^{2}}{2}', 'x²/2'],
      ['\\tfrac12', '1/2'],
      ['\\frac{1}{\\sqrt{2}}', '1/√2'],
      ['\\frac{\\sqrt{3}}{2}', '√3/2'],
      ['\\frac{dy}{dx}', 'dy/dx'],
      ['v = \\frac{\\Delta x}{\\Delta t}', 'v = Δx/Δt'],
      ['\\frac{\\text{거리}}{\\text{시간}}', '거리/시간'],
      ['\\frac{\\text{g}}{\\text{cm}^3}', 'g/cm³'],
      ['P(A|B) = \\frac{P(A \\cap B)}{P(B)}', 'P(A|B) = P(A ∩ B)/P(B)'],
      ['S_n = \\frac{n(a_1 + a_n)}{2}', 'Sₙ = n(a₁ + aₙ)/2'],
      ['\\frac{1}{(x+1)}', '1/(x+1)'],
      ['{a \\over b}', 'a/b'],
    ]);
  });

  it('곱해지는 분수는 통째로 묶는다', () => {
    cases([
      ['E = \\frac{1}{2}mv^2', 'E = (1/2)mv²'],
      ['V = \\frac{4}{3}\\pi r^3', 'V = (4/3)πr³'],
      ['\\frac{1}{2}(a+b)h', '(1/2)(a+b)h'],
      ['x\\frac{1}{2}', 'x(1/2)'],
      ['\\frac{a}{b}\\frac{c}{d}', '(a/b)(c/d)'],
      ['\\sin\\frac{\\pi}{2}', 'sin(π/2)'],
      ['F = G\\frac{m_1 m_2}{r^2}', 'F = G(m₁ m₂)/r²'],
      ['2\\frac{x}{3}', '2x/3'],
      ['\\frac{1}{2} \\times 3', '1/2 × 3'],
      ['\\int \\frac{1}{x} dx', '∫ (1/x) dx'],
      ['\\left(\\frac{1}{2}\\right)^2', '(1/2)²'],
    ]);
  });

  it('대분수는 2¹⁄₃ 처럼', () => {
    cases([
      ['2\\frac{1}{3}', '2¹⁄₃'],
      ['3 \\frac{5}{12} - 1\\frac{1}{4}', '3⁵⁄₁₂ - 1¹⁄₄'],
      ['\\begin{pmatrix} 1 & \\frac{1}{2} \\\\ 3 & 4 \\end{pmatrix}', '(1 1/2; 3 4)'],
      ['x = 1 \\quad \\frac{1}{2}', 'x = 1 1/2'],
    ]);
  });
});

describe('texToText: 첨자·근호', () => {
  it('첨자로 못 바꾸면 괄호로 묶는다', () => {
    cases([
      ['a_{k+1} = 2a_k', 'aₖ₊₁ = 2aₖ'],
      ['x^{k+1}', 'xᵏ⁺¹'],
      ['a^{m+n} = a^m a^n', 'aᵐ⁺ⁿ = aᵐ aⁿ'],
      ['10^{-3}', '10⁻³'],
      ['e^{i\\pi} + 1 = 0', 'e^(iπ) + 1 = 0'],
      ['e^{-x^2}', 'e^(-x²)'],
      ['a^{\\frac{1}{2}}', 'a^(1/2)'],
      ['x_{i,j}', 'x_(i,j)'],
      ['T_{1/2}', 'T_(1/2)'],
      ['v_{\\text{max}}', 'vₘₐₓ'],
      ['E_{\\text{운동}} = \\frac{1}{2}mv^2', 'E운동 = (1/2)mv²'],
      ['{a+b}^2', '(a+b)²'],
      ['A^{T}', 'Aᵀ'],
      ['f^{\\prime}(x)', 'f′(x)'],
      ['{}_n\\mathrm{C}_r', 'ₙCᵣ'],
      ['\\binom{5}{2}', '₅C₂'],
    ]);
  });

  it('근호', () => {
    cases([
      ['\\sqrt{2}', '√2'],
      ['2\\sqrt{3}', '2√3'],
      ['\\sqrt{x^2+y^2}', '√(x²+y²)'],
      ['\\sqrt[3]{8} = 2', '³√8 = 2'],
      ['\\sqrt{2}x', '√(2)x'],
      ['\\sqrt{2}^3', '(√2)³'],
    ]);
  });
});

describe('texToText: 함수·기호', () => {
  it('함수 이름을 지우지 않는다', () => {
    cases([
      ['\\sin^2\\theta + \\cos^2\\theta = 1', 'sin²θ + cos²θ = 1'],
      ['\\sin x', 'sin x'],
      ['\\sin\\theta = \\frac{1}{2}', 'sin θ = 1/2'],
      ['\\log_2 8 = 3', 'log₂ 8 = 3'],
      ['\\lim_{x \\to 0} \\frac{\\sin x}{x} = 1', 'lim(x → 0) (sin x)/x = 1'],
      ['\\lim\\limits_{n\\to\\infty} a_n', 'lim(n→∞) aₙ'],
      ['\\max(a, b)', 'max(a, b)'],
      ['\\operatorname{sgn}(x)', 'sgn(x)'],
      ['a \\equiv b \\pmod{n}', 'a ≡ b (mod n)'],
    ]);
  });

  it('기호·글자', () => {
    cases([
      ['50\\%', '50%'],
      ['A=\\{1, 2, 3\\}', 'A={1, 2, 3}'],
      ['\\{ x \\mid x > 0 \\}', '{x | x > 0}'],
      ['\\Delta H < 0', 'ΔH < 0'],
      ['\\pi r^2', 'πr²'],
      ['N_2 + 3H_2 \\rightleftharpoons 2NH_3', 'N₂ + 3H₂ ⇌ 2NH₃'],
      ['\\theta = 30^\\circ', 'θ = 30°'],
      ['\\angle ABC = 90^{\\circ}', '∠ABC = 90°'],
      ['\\triangle ABC \\equiv \\triangle DEF', '△ABC ≡ △DEF'],
      ['\\overline{AB} = 5', 'AB = 5'],
      ['\\bar{x}', 'x̄'],
      ['\\vec{F} = m\\vec{a}', 'F⃗ = ma⃗'],
      ['\\overset{\\frown}{AB}', '⌒AB'],
      ['a \\not= b', 'a ≠ b'],
      ['x \\not\\in A', 'x ∉ A'],
      ['f(x)=\\begin{cases} x & (x \\ge 0) \\\\ -x & (x<0) \\end{cases}', 'f(x)=x (x ≥ 0), -x (x<0)'],
      ['\\begin{pmatrix} 1 & 2 \\\\ 3 & 4 \\end{pmatrix}', '(1 2; 3 4)'],
      ['2H_2O \\xrightarrow{\\text{전기 분해}} 2H_2 + O_2', '2H₂O →(전기 분해) 2H₂ + O₂'],
      ['\\int_0^1 x^2\\,dx = \\frac{1}{3}', '∫₀¹ x² dx = 1/3'],
      ['\\sum_{k=1}^{n} k = \\frac{n(n+1)}{2}', '∑ₖ₌₁ⁿ k = n(n+1)/2'],
      ['5\\text{ cm}^2', '5 cm²'],
      ['f(x); g(x)', 'f(x); g(x)'],
      ['\\constructor \\toString x', 'x'],
    ]);
  });

  it('깨진 수식에도 멈추지 않는다', () => {
    cases([
      ['\\frac{1}{', '1/'],
      ['\\frac', ''],
      ['x^', 'x'],
      ['}{', ''],
      ['\\sqrt', '√'],
      ['\\left(x', '(x'],
    ]);
    expect(texToText('{'.repeat(40) + 'x' + '}'.repeat(40))).toBe('x');
  });
});
