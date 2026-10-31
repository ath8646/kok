[웹 프로그래밍] 3주차 강의 정리 - HTML 구조와 CSS 선택자

1. HTML 문서의 기본 구조
HTML 은 태그로 문서의 뼈대를 만든다. 대부분의 태그는 `<p>` 로 열고 `</p>` 로 닫지만, `<img>` 와 `<br>` 같은 태그는 닫는 태그가 없다. 문서는 `<!DOCTYPE html>` 로 시작한다. 화면에 보이는 내용은 body 안에, 탭 제목이나 문자 코드처럼 화면 밖의 정보는 head 안에 넣는다.

```html
<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <title>첫 페이지</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <div class="card" id="intro">
    <h1>KOK 소개</h1>
    <p>공부 자료를 넣으면 정리해 줍니다.</p>
  </div>
  <a href="#top">맨 위로</a>
</body>
</html>
```

속성은 여는 태그 안에 이름="값" 형식으로 쓴다. `<div class="card">` 는 class 가 card 인 상자를 만든다. class 는 여러 요소를 같은 이름으로 묶을 때, id 는 페이지에서 한 번만 쓰는 이름을 줄 때 쓴다. `<a href="#top">` 의 # 은 같은 페이지 안의 해당 위치로 이동하라는 뜻이다. 시험에 자주 나온다: 여는 태그와 닫는 태그 짝 맞추기, 그리고 meta charset 을 빠뜨리면 한글이 깨질 수 있다는 점.

2. CSS 를 붙이는 세 가지 방법
CSS 는 style 속성을 쓰는 인라인, head 안의 style 태그를 쓰는 내부, link 로 불러오는 외부 세 가지 방법으로 붙인다. 같은 요소에 규칙이 여럿 겹치면 명시도가 높은 쪽이 이긴다. 명시도가 같으면 문서에서 나중에 나온 규칙이 이긴다. 인라인 스타일(style="color: red" 같은 것)은 보통 명시도 계산에서 가장 앞선다.

3. 선택자
- 태그 선택자: p { ... } 는 모든 p 태그에 적용된다.
- 클래스 선택자: `.card { ... }` 는 class="card" 인 요소를 고른다. 점(.)으로 시작한다.
- 아이디 선택자: `#intro { ... }` 는 id="intro" 인 요소를 고른다. 한 페이지에 같은 id 를 두 번 쓰면 안 된다.
- 자식 선택자: `.card > p { color: #333; }` 처럼 쓰면 .card 의 바로 아래 자식인 p 만 색이 바뀐다.
- 후손 선택자: `.card p` 는 .card 안 어디에 있든 p 를 모두 고른다.
- 가상 클래스: `a:hover` 는 마우스를 올린 a 태그를 고른다.

```css
.card > p {
  color: #333;
}

a:hover {
  text-decoration: underline;
}

#intro {
  background: #f5f5f5;
}
```

시험에 자주 나온다: `.card > p` 와 `.card p` 의 차이를 묻는 문제. 전자는 바로 아래 자식만, 후자는 모든 후손을 고른다.

4. 명시도(specificity)
명시도는 (id 개수, class·속성·가상 클래스 개수, 태그 개수) 세 자리로 센다. 왼쪽 자리부터 비교하고, 같으면 다음 자리를 본다.

- `#intro` 는 (1,0,0)
- `.card` 는 (0,1,0)
- `.card > p` 는 (0,1,1)
- `a:hover` 는 (0,1,1)
- p 는 (0,0,1)
- div p 는 (0,0,2)

(0,1,0) 은 (0,0,9) 보다 크다. 즉 class 하나가 태그 아홉 개보다 강하다. `!important` 를 붙이면 명시도 계산보다 앞서지만 남발하지 않는 것이 원칙이다. 시험에 자주 나온다: 여러 선택자의 명시도를 계산해서 어떤 색이 적용되는지 고르는 문제.

5. 박스 모델
모든 요소는 상자처럼 다뤄진다. 안쪽부터 내용(content), 안쪽 여백(padding), 테두리(border), 바깥 여백(margin) 순서다. 기본값인 box-sizing: content-box 에서는 width 가 내용 영역의 폭만 뜻한다. 그래서 실제 차지하는 폭은 content(width) + padding + border 로 계산하고, margin 은 이 바깥쪽 간격이라 폭에 들어가지 않는다.

    .box {
        width: 200px;
        padding: 10px;
        border: 2px solid #000;
    }
    /* 화면 폭: 200 + 10 + 10 + 2 + 2 = 224px */

`box-sizing: border-box` 를 주면 width 가 padding 과 border 까지 포함한 값이 된다. 위 예제에 이 값을 주면 전체 폭이 200px 로 맞춰진다. 시험에 자주 나온다: width, padding, border 가 주어졌을 때 전체 폭을 계산하는 문제.

6. 화면 폭에 따라 바꾸기: @media
화면 폭에 따라 다른 규칙을 쓰려면 `@media (max-width: 600px) { … }` 형식을 쓴다. 아래 예제는 화면 폭이 600px 이하일 때 .card 의 폭을 화면 전체로 넓힌다.

```css
.card {
  width: 600px;
}

@media (max-width: 600px) {
  .card {
    width: 100%;
  }
}
```

조건이 참일 때만 안쪽 규칙이 적용된다. 모바일 화면에서는 보통 max-width 조건을 쓴다. 시험에 자주 나온다: @media 조건이 참이 되는 화면 폭 범위를 읽는 문제.

※ 시험 포인트: 태그 짝 맞추기, class 와 id 의 차이, 자식 선택자(>)와 후손 선택자의 차이, (0,1,0) 같은 명시도 계산, 박스 모델의 전체 폭 계산, @media 조건 읽기.
