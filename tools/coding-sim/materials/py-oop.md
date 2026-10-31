[객체지향프로그래밍] 6주차 강의자료 - 파이썬 클래스 기초

이번 주는 파이썬에서 클래스를 만드는 방법을 배웠다. 자바와 비슷하지만 메서드의 첫 번째 인자로 self 를 직접 적어야 한다는 점이 다르다고 하셨다.

1. 클래스와 생성자

클래스는 객체를 찍어 내는 설계도다. 객체가 만들어질 때 가장 먼저 실행되는 메서드가 `__init__` 이고, 첫 번째 인자 self 는 지금 만들어지는 객체 자기 자신을 가리킨다.

```python
class Student:
    school = "동성중"                          # 클래스 변수: 모든 학생이 공유

    def __init__(self, name, *scores, **options):
        self.name = name                        # 공개 속성
        self.__secret = options.get("pin", 0)   # 비공개 속성
        self.scores = list(scores)
```

*scores 는 남는 위치 인자를 튜플로 모으고, **options 는 남는 키워드 인자를 딕셔너리로 모은다. Student("민수", 90, 85, pin=1234) 로 부르면 scores 는 (90, 85), options 는 {"pin": 1234} 가 된다.

2. 비공개 속성, @property, 타입 힌트

self.__secret 처럼 이름 앞에 밑줄 두 개를 붙이면 바깥에서 바로 꺼내기 어렵다. 파이썬은 이름을 _Student__secret 으로 바꿔 저장하는데(이름 맹글링), 완전히 막는 게 아니라 건드리지 말라는 약속에 가깝다고 하셨다.

값을 읽기만 하게 하고 싶으면 `@property` 를 쓴다. 메서드를 속성처럼 괄호 없이 읽는다. 아래는 강의 슬라이드에 있던 코드 그대로다.

    def avg(xs: list[float]) -> float:
        return sum(xs) / len(xs)

    @property
    def average(self):
        return avg(self.scores)

    @staticmethod
    def is_valid(score: float) -> bool:
        return 0 <= score <= 100

xs: list[float] 와 -> float 는 인자와 반환값의 자료형을 적어 둔 표시다. 실행할 때 파이썬이 검사하지는 않는다. s.average 처럼 쓰면 평균이 나오고, s.average() 처럼 괄호를 붙이면 오류가 난다.

@staticmethod 는 self 를 받지 않는 함수를 클래스 안에 둘 때 쓴다. 객체를 만들지 않고 Student.is_valid(95) 처럼 클래스 이름으로 부른다.

3. 상속과 super()

클래스가 다른 클래스를 물려받는 것을 상속이라고 한다. Dog(Animal) 처럼 괄호 안에 부모 클래스를 적는다. 자식의 `__init__` 안에서 super().__init__() 을 부르면 부모의 생성자가 먼저 실행된다.

```python
class Animal:
    def __init__(self):
        print("동물 생성")

class Dog(Animal):
    def __init__(self):
        super().__init__()
        print("강아지 생성")
```

위 코드를 실행하면 "동물 생성" 이 먼저 찍힌 뒤 "강아지 생성" 이 찍힌다. 순서를 바꿔서 쓰면 결과가 어떻게 달라지는지 직접 해 보라고 하셨다.

4. 던더 메서드

__str__ 과 __eq__ 처럼 앞뒤에 밑줄 두 개가 붙은 메서드를 던더(dunder) 메서드라고 부른다. __str__ 은 print(객체) 를 했을 때 보일 글을 정하고, __eq__ 는 == 비교의 기준을 정한다.

    def __str__(self):
        return f"{self.name} ({len(self.scores)}과목)"

    def __eq__(self, other):
        return isinstance(other, Student) and self.name == other.name

__eq__ 를 정의하면 __hash__ 도 같이 봐야 한다고 하셨는데 자세한 건 다음 주에 한다. self 를 빼고 메서드를 쓰는 실수는 시험에 나온다고 강조하셨다.

과제: Student 클래스에 점수 입력 메서드와 평균 구하기를 추가해서 제출. 마감은 다음 주 수요일 자정.
