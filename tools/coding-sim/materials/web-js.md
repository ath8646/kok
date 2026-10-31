# 웹 프로그래밍 2주차: HTML·CSS·JavaScript 기초

## 1. 웹 페이지를 만드는 세 가지
웹 페이지는 보통 세 가지 언어가 역할을 나눠 맡는다.
- HTML: 구조와 내용 (제목, 문단, 버튼 같은 요소를 태그로 감싼다)
- CSS: 모양 (색, 크기, 배치)
- JavaScript: 동작 (클릭하면 화면을 바꾼다)

HTML 요소는 시작 태그와 끝 태그로 감싼다. 같은 스타일을 여러 요소에 줄 때는 class 속성을 쓴다. 교수님이 `class="box"` 는 여러 요소에 붙여도 된다고 하셨다.

```html
<div class="box">
  <p id="msg">안녕하세요</p>
</div>
```

## 2. CSS 선택자
CSS 규칙은 선택자 다음에 중괄호로 속성을 쓴다. # 은 id, . 은 class 를 뜻한다. id 는 페이지에 딱 하나만 있어야 한다. 아래 규칙은 id 가 app 인 요소의 글자색을 빨갛게 바꾼다.

    #app { color: red; }

## 3. 변수, 비교, 논리 연산
변수는 let 이나 const 로 선언한다. 바꿀 일이 없으면 const 를 쓰는 게 기본이다.

비교할 때 `==` 와 `===` 차이가 시험에 나온다. `==` 는 타입을 자동으로 바꿔서 비교하고, `===` 는 타입까지 같아야 참이다. 실무에서는 `===` 를 쓰라고 하셨다.

값을 진짜 true/false 로 바꾸고 싶으면 `!!value` 를 쓴다. 빈 문자열, 0, null, undefined 는 모두 false 가 된다.

null 이나 undefined 일 때만 기본값을 주고 싶으면 ?? 를 쓴다. price 가 null 이면 0 이 들어간다. || 는 0 이나 빈 문자열도 거짓으로 보기 때문에 헷갈리지 말 것.

    console.log(0 == "");                 // true
    console.log(0 === "");                // false
    const value = "";
    console.log(!!value);                 // false
    const phone = /^\d{3}-\d{4}$/;
    console.log(phone.test("010-1234"));  // true

정규식 /^\d{3}-\d{4}$/ 는 숫자 세 개, 하이픈, 숫자 네 개가 처음부터 끝까지 맞는지 본다. ^ 와 $ 를 빼면 문자열 중간에 맞는 부분만 있어도 통과하니 주의.

## 4. 함수와 템플릿 리터럴
화살표 함수는 function 키워드 없이 짧게 쓴다.

```js
const add = (a, b) => a + b;
const price = null;
const total = price ?? 0;
const name = '철수';
console.log(`Hello ${name}`);
const app = document.querySelector('#app');
app.textContent = `합계: ${add(total, 10)}`;
```

백틱으로 감싼 템플릿 리터럴 안의 ${ } 는 변수 값으로 바뀐다. 따옴표를 이어 붙이는 것보다 읽기 편하다.

## 5. DOM 조작
document.querySelector 는 CSS 선택자 문법으로 요소를 찾아 준다. 찾은 요소의 textContent 나 classList 를 바꾸면 화면이 바로 바뀐다.

시험 전 체크: 태그와 속성 / id 와 class 선택자 / == 와 === / ?? 와 || / 정규식의 ^ $ 의미
