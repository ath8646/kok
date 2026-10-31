[C++ 프로그래밍] 9주차 강의 정리 - 템플릿과 연산자 오버로딩

1. 템플릿이란?
같은 모양의 함수나 클래스를 자료형만 바꿔 가며 여러 번 쓰고 싶을 때 템플릿을 쓴다. 자료형 자리에 `T` 같은 자리 표시자를 적어 두면, 실제로 호출될 때 컴파일러가 T 를 정해서 코드를 찍어 낸다. 이것을 템플릿의 인스턴스화(instantiation)라고 부른다.

```cpp
template <typename T>
T maxOf(T a, T b) {
    return (a > b) ? a : b;
}
```

maxOf(3, 7) 은 T 가 int 로, maxOf(2.5, 1.0) 은 T 가 double 로 찍힌다. 함수 템플릿은 인자를 보고 T 를 스스로 알아내지만, `maxOf<double>(1, 2.5)` 처럼 꺾쇠 안에 직접 적을 수도 있다.

시험에 자주 나온다: `template <class T>` 처럼 typename 대신 class 를 써도 뜻은 같다. 템플릿은 설계도이고, 실제 코드는 호출될 때 생긴다는 점을 기억하자.

2. 클래스 템플릿과 std::vector<int>
클래스도 템플릿으로 만들 수 있다. `std::vector<int>` 는 int 를 원소로 가지는 동적 배열이고, 꺾쇠 안의 int 가 T 자리에 들어간 것이다. 표준 라이브러리의 vector, map 같은 컨테이너가 모두 이 방식으로 만들어져 있다. 함수 템플릿과 달리 클래스 템플릿은 자료형을 알아서 맞춰 주는 것이 기본이 아니라서, `Box b;` 처럼 쓰면 오류가 나고 `Box<double> b;` 처럼 꺾쇠를 꼭 적어야 한다(C++17 부터 일부 경우에는 추론도 된다).

    template <typename T>
    class Box {
    public:
        T value;
    };

    Box<int> a;       // T 가 int 로 찍힌다
    Box<double> b;    // T 가 double 로 찍힌다, a 와는 다른 자료형이다

아래 예제는 vector 를 채우고 한 줄씩 출력한다.

```cpp
#include <iostream>
#include <vector>

int main() {
    std::vector<int> v = {3, 1, 4};
    v.push_back(1);
    for (int x : v) {
        std::cout << x << '\n';
    }
    return 0;
}
```

std::cout << x << '\n'; 에서 '\n' 은 글자 한 개짜리 문자이고 "\n" 은 문자열이다. 둘 다 줄바꿈이지만 자료형이 다르다. std::endl 도 줄을 바꾸지만 출력 버퍼를 비우는 일까지 해서 느릴 수 있다.

3. 연산자 오버로딩
연산자도 함수처럼 다시 정의할 수 있다. 이름은 operator 뒤에 기호를 붙여서 만든다.

```cpp
struct Point {
    int x, y;
    Point operator+(const Point &other) const {
        return Point{x + other.x, y + other.y};
    }
};
```

위 코드는 멤버 함수 형태다. 이 경우 왼쪽 피연산자가 this 가 되어서 a + b 는 a.operator+(b) 로 풀린다. 함수 이름 뒤의 const 는 이 연산이 왼쪽 객체를 바꾸지 않는다는 약속이다.

<< 연산자는 조금 다르다. std::cout 이 왼쪽에 와야 하는데, 멤버 함수로 만들면 왼쪽이 Point 여야 하므로 std::cout << p 를 쓸 수 없다. 그래서 << 는 전역 함수(또는 friend)로 만든다. 반환형이 `std::ostream &` 인 이유는 std::cout << a << b 처럼 이어서 쓸 수 있게 하기 위해서다.

```cpp
std::ostream &operator<<(std::ostream &os, const Point &p) {
    return os << "(" << p.x << ", " << p.y << ")";
}
```

4. 컴파일 오류 예
템플릿은 실제로 쓰일 때 검사되므로, 연산이 안 되는 자료형을 넣으면 템플릿 정의가 아니라 호출한 곳에서 오류가 난다.

```cpp
template <typename T>
T twice(T x) {
    return x * 2;
}

int main() {
    std::cout << twice("hi") << '\n';   // 오류
    return 0;
}
```

컴파일러는 const char * 와 int 사이에 * 를 쓸 수 없다고 알려 준다. 오류 메시지가 길게 나와도 "invalid operands" 라는 말이 있으면 두 자료형이 그 연산자와 맞지 않는다는 뜻이다.

5. 시험 포인트
※ 시험에 자주 나온다: 템플릿 정의는 보통 헤더 파일에 둔다. 인스턴스화는 호출 시점에 일어나므로, 정의가 보이지 않는 곳에서 부르면 링크 오류가 난다.
※ 시험에 자주 나온다: << 를 멤버 함수로 만들면 std::cout << p 가 안 된다. 전역 함수나 friend 로 만들어야 한다.
※ 시험에 자주 나온다: 왼쪽 피연산자가 int 인 2 * p 같은 식은 멤버 함수로 만들 수 없다. 이때도 전역 함수로 만들면 된다.
※ maxOf(1, 2.5) 는 int 와 double 이 섞여서 T 를 하나로 정하지 못해 오류가 난다. 이때는 maxOf<double>(1, 2.5) 처럼 직접 적어야 한다.
※ Box<int> 와 Box<double> 은 서로 다른 자료형이라 대입할 수 없다.
