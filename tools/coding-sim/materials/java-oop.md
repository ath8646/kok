[자바프로그래밍] 7주차 정리 - 인터페이스, 제네릭, 람다

1. 인터페이스와 implements
인터페이스는 "이 메서드들은 반드시 구현해야 한다"는 약속이다. 클래스가 인터페이스를 따르려면 implements 를 쓰고, 인터페이스의 메서드를 모두 구현해야 한다. 구현한 메서드 위에는 @Override 를 붙이는 습관을 들이자. 메서드 이름에 오타가 나도 컴파일러가 바로 잡아 준다. 인터페이스는 여러 개를 동시에 implements 할 수 있지만, 클래스는 extends 로 부모를 하나만 가질 수 있다.

```java
interface Shape {
    double area();
}

class Circle implements Shape {
    private final double r;
    Circle(double r) { this.r = r; }

    @Override
    public double area() {
        return Math.PI * r * r;
    }
}
```

2. 프로그램 시작점과 배열
main 메서드의 모양은 항상 같다. 배열은 중괄호로 초기값을 줄 수 있고, 길이는 `arr.length` 로 알 수 있다. 배열은 크기가 고정이라서 늘리고 싶으면 ArrayList 같은 컬렉션을 쓴다.

    public static void main(String[] args) {
        int[] arr = {1, 2, 3};
        int sum = 0;
        for (int v : arr) sum += v;
        System.out.println("합계: " + sum);
    }

3. 제네릭 컬렉션
List<Integer> 는 Integer 만 담는 리스트다. 제네릭 자리에는 기본형 int 를 쓸 수 없어서 Integer 로 감싸서 넣는다(오토박싱). Map<String, List<Integer>> 는 "문자열 키 → 정수 리스트" 구조를 뜻한다. 안쪽 리스트를 꺼낼 때마다 타입이 맞는지 생각해 보자.

```java
List<Integer> nums = new ArrayList<>();
Map<String, List<Integer>> groups = new HashMap<>();
nums.stream().map(x -> x * 2).forEach(System.out::println);
```

x -> x * 2 는 람다식이다. 매개변수 x 를 받아 x * 2 를 돌려주는 짧은 함수라고 생각하면 된다.

4. == 과 .equals()
    String a = new String("hi");
    String b = "hi";
    System.out.println(a == b);        // false: 같은 객체인지 비교
    System.out.println(a.equals(b));   // true: 내용이 같은지 비교

교수님 말씀: 문자열이나 객체를 비교할 때는 거의 항상 .equals() 를 쓴다. == 은 참조(주소)가 같은지만 본다. 같은 글자라도 new 로 새로 만든 문자열은 주소가 달라서 == 이 false 가 된다.

※ 시험 포인트: implements 와 extends 의 차이, 제네릭에 int 를 못 쓰는 이유, == 과 equals 의 차이
