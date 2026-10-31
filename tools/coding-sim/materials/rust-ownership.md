[시스템프로그래밍] 9주차 강의 정리 - 러스트 소유권과 빌림

1. 소유권 규칙 세 가지
러스트는 가비지 컬렉터 없이도 메모리를 안전하게 관리한다. 그 바탕이 소유권(ownership)이다.
① 값마다 주인(owner) 변수가 딱 하나 있다.
② 주인은 한 번에 하나뿐이다.
③ 주인이 범위(scope)를 벗어나면 값이 사라지고 메모리가 해제된다. 이를 drop 이라고 한다.

예를 들어 String::from("hi") 로 만든 문자열은 힙에 저장되고, 그 값의 주인은 변수 `s` 다. 주인 변수가 선언된 블록을 빠져나올 때, 보통 닫는 중괄호 `}` 를 만나는 순간 값이 `drop` 된다.

```rust
fn main() {
    let s = String::from("hi");
    println!("{}", s);
}   // 여기서 s 의 범위가 끝나고 메모리가 해제된다
```

2. 이동 (Move)
다음 코드는 컴파일되지 않는다.

```rust
fn main() {
    let s1 = String::from("hi");
    let s2 = s1;
    println!("{}", s1);
}
```

let s2 = s1; 은 값을 복사하지 않고 주인을 s2 로 옮긴다. 이것을 이동(move)이라고 한다. 옮긴 뒤의 s1 은 더 이상 쓸 수 없어서 println! 에서 에러가 난다. 컴파일러 메시지는 대략 이런 모양이다.

```
error[E0382]: borrow of moved value: `s1`
 --> src/main.rs:4:20
  |
2 |     let s1 = String::from("hi");
  |         -- move occurs because `s1` has type `String`, which does not implement the `Copy` trait
3 |     let s2 = s1;
  |              -- value moved here
4 |     println!("{}", s1);
  |                    ^^ value borrowed here after move
```

에러 메시지에서 "value moved here" 줄을 찾으면 어디서 옮겨졌는지 바로 알 수 있다. 이 메시지를 해석하는 문제는 시험에 자주 나온다.

정수(i32)나 bool 처럼 Copy 트레이트를 구현한 타입은 대입해도 옮겨지지 않고 복사된다. 그래서 let a = 5; let b = a; 뒤에도 a 를 쓸 수 있다.

3. 빌림 (Borrowing)
매번 값을 옮기면 불편하니 참조로 빌려 쓴다. `&s` 는 불변 빌림, `&mut s` 는 가변 빌림이다. 빌린 쪽은 값의 주인이 되지 않는다. 참조를 만드는 것은 `&` 기호 하나면 된다.

시험에 자주 나오는 규칙 세 가지
- 불변 참조 &는 동시에 여러 개 있어도 된다.
- 가변 참조 &mut 는 같은 값에 대해 동시에 하나만 있어야 한다.
- 가변 참조가 살아 있는 동안에는 불변 참조도 만들 수 없다.

이 규칙 때문에 한 값을 여러 곳에서 동시에 고치는 데이터 레이스가 컴파일 단계에서 막힌다. 아래는 가변 빌림을 두 번 하는 잘못된 예다.

    let mut s = String::from("hi");
    let r1 = &mut s;
    let r2 = &mut s;   // 에러: 같은 값을 두 번 가변으로 빌릴 수 없다
    println!("{}", r1);

가변 빌림을 쓰는 함수는 이렇게 짠다.

```rust
fn add_world(s: &mut String) {
    s.push_str(", world");
}

fn main() {
    let mut s = String::from("hello");
    add_world(&mut s);
    println!("{}", s);
}
```

이 코드는 "hello, world" 를 출력한다. add_world 가 끝나도 s 는 사라지지 않는다. 빌려준 값은 원래 주인인 main 에게 그대로 남아 있기 때문이다.

4. 수명 (Lifetime)
수명은 참조가 가리키는 값이 살아 있는 기간이다. 러스트는 참조가 원래 값보다 오래 살지 않도록 검사한다. 참조를 받아 참조를 돌려주는 함수에서는 돌려주는 참조가 어느 입력의 수명을 따르는지 적어야 한다.

```rust
fn longest<'a>(x: &'a str, y: &'a str) -> &'a str {
    if x.len() > y.len() {
        x
    } else {
        y
    }
}
```

'a 는 수명에 붙이는 이름표다. 돌려주는 참조는 x 와 y 중 더 짧게 사는 쪽만큼만 살 수 있다는 약속이다. 수명 표시는 값의 수명을 늘리거나 줄이지 않는다. 여러 참조 사이의 관계를 컴파일러에게 알려 줄 뿐이다.

시험에 나오는 형태는 fn longest<'a>(x: &'a str, y: &'a str) -> &'a str 이다. 'a 를 빼고 fn longest(x: &str, y: &str) -> &str 로 쓰면 어느 쪽 수명인지 알 수 없어서 컴파일되지 않는다.

5. 댕글링 참조
함수 안에서 만든 String 의 참조를 돌려주면 함수가 끝나는 순간 값이 사라져서 참조가 빈 곳을 가리킨다. 이를 댕글링 참조(dangling reference)라고 하며, 러스트는 이런 코드를 컴파일하지 않는다.

※ 시험 포인트
- 대입은 복사가 아니라 이동이다. String, Vec 처럼 힙을 쓰는 타입은 옮긴 뒤 원래 변수를 쓸 수 없다.
- &mut 는 한 번에 하나만. 두 개를 동시에 살려 두면 에러다.
- 수명 'a 는 값을 오래 살게 하는 장치가 아니다.
