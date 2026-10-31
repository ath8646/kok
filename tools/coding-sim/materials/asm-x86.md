[컴퓨터구조] 7주차 강의 정리 - x86 레지스터와 함수 호출

1. 레지스터란?
레지스터는 CPU 안에 있는 아주 빠른 기억 공간이다. 32비트 x86 에서 자주 쓰는 범용 레지스터는 eax, ebx, ecx, edx 이고, 64비트에서는 같은 이름에 r 을 붙인 rax, rbx, rcx, rdx 가 된다. eax 는 rax 의 하위 32비트이고, al 은 eax 의 하위 8비트다.

특수 목적 레지스터도 있다. rsp 는 스택의 맨 위(가장 낮은 주소)를 가리키는 스택 포인터다. rbp 는 현재 함수의 스택 프레임 기준점인 베이스 포인터다. rip 는 다음에 실행할 명령의 주소를 담는다.

시험에 자주 나온다: eax 가 rax 의 하위 32비트라는 점, 함수의 반환값은 eax(또는 rax)에 넣는다는 점, rsp 와 rbp 의 역할 차이.

2. Intel 문법과 AT&T 문법
같은 기계어를 두 가지 문법으로 적을 수 있다. 교재와 강의 자료에 두 문법이 섞여 나오므로 헷갈리기 쉽다.

Intel 문법은 목적지가 앞에 온다. AT&T 문법은 출처가 앞에 온다. 또 AT&T 에서는 레지스터 이름 앞에 % 를 붙이고, 숫자 상수 앞에 $ 를 붙인다. 크기는 명령 뒤 접미사로 나타내는데 l 은 32비트, q 는 64비트다. 예를 들어 `movl $1, %eax` 는 eax 에 1 을 넣는 AT&T 명령이고, 같은 뜻의 Intel 명령은 mov eax, 1 이다.

    Intel:  mov eax, 1      AT&T:  movl $1, %eax
    Intel:  mov eax, ebx    AT&T:  movl %ebx, %eax
    Intel:  mov rbp, rsp    AT&T:  movq %rsp, %rbp

시험 포인트: 줄에 $ 나 % 가 있으면 AT&T, 목적지가 앞에 있으면 Intel 이라고 먼저 판단한다. 두 번째 줄처럼 AT&T 에서는 출처인 %ebx 가 맨 앞에 와야 하는데, 이걸 뒤집어 쓰는 실수가 자주 나온다.

3. 스택과 push, pop
스택은 함수 호출과 지역 변수를 위해 쓰는 메모리 영역이다. 스택은 높은 주소에서 낮은 주소 쪽으로 자란다. push 는 rsp 를 줄인 뒤 그 자리에 값을 쓰고, pop 은 값을 읽은 뒤 rsp 를 늘린다. 예를 들어 `push rbp` 는 64비트에서 rsp 를 8 줄이고 rbp 값을 그 주소에 저장한다. `pop rbp` 는 반대 순서다.

4. call 과 ret
`call add` 는 다음 명령의 주소, 즉 반환 주소를 스택에 push 한 뒤 add 로 점프한다. `ret` 는 스택 맨 위의 반환 주소를 pop 해서 그 자리로 돌아간다.

시험에 자주 나온다: call 은 push 와 jump 두 가지를 한다는 것, ret 은 pop 과 jump 를 한다는 것. 함수 안에서 push 한 것을 pop 하지 않고 ret 하면 반환 주소가 틀려서 엉뚱한 곳으로 간다.

5. 스택 프레임
함수가 시작할 때 보통 다음 순서로 스택 프레임을 만든다.
(1) `push rbp` 로 호출한 쪽의 베이스 포인터를 저장한다.
(2) mov rbp, rsp 로 rbp 를 현재 rsp 에 맞춘다. 이제 rbp 는 이 함수의 기준점이다.
(3) 지역 변수는 rbp 에서 음수 방향에 둔다. `[rbp-4]` 는 rbp 보다 4바이트 아래 칸이다.
(4) 끝날 때 pop rbp 로 원래 rbp 를 되돌리고 ret 로 돌아간다.

시험 포인트: 스택 프레임의 순서(push rbp → mov rbp, rsp → 지역 변수 → pop rbp → ret)를 빈칸으로 묻는 문제가 자주 나온다.

6. 인자와 반환값
리눅스의 x86-64 에서 정수 인자는 rdi, rsi, rdx, rcx, r8, r9 순서로 받는다. int 인자 하나는 edi, esi 처럼 32비트 이름으로 쓴다. 반환값은 rax(또는 eax)에 넣는다.

함수가 쓰고 나서 원래 값으로 돌려놓아야 하는 레지스터(callee-saved)도 있다. rbx 가 그렇다. 함수 안에서 rbx 를 쓰려면 먼저 push rbx 로 저장해 두고, 끝나기 전에 pop rbx 로 되돌려야 한다.

시험에 자주 나온다: 첫 번째 인자 레지스터가 rdi 라는 점, 반환값이 rax 라는 점.

7. 예제: C 함수와 어셈블리
아래는 C 함수 add 와 main 이다. 이것을 gcc -O0 -S 로 컴파일하면 AT&T 문법의 어셈블리가 나온다. 주석과 여러 지시어는 지웠다.

```c
int add(int a, int b) {
    int c = a + b;
    return c;
}

int main(void) {
    return add(2, 3);
}
```

```asm
add:
    pushq   %rbp
    movq    %rsp, %rbp
    movl    %edi, -20(%rbp)
    movl    %esi, -24(%rbp)
    movl    -20(%rbp), %edx
    movl    -24(%rbp), %eax
    addl    %edx, %eax
    movl    %eax, -4(%rbp)
    movl    -4(%rbp), %eax
    popq    %rbp
    ret
main:
    pushq   %rbp
    movq    %rsp, %rbp
    movl    $3, %esi
    movl    $2, %edi
    call    add
    popq    %rbp
    ret
```

main 에서 call add 가 실행되면 반환 주소가 스택에 쌓이고 add 로 점프한다. add 는 edi 의 2 와 esi 의 3 을 받아서 더한 값을 eax 에 두고 ret 로 돌아간다. main 은 eax 값을 그대로 돌려주므로 5 가 종료 코드가 된다.

시험에 자주 나온다: movl -4(%rbp), %eax 가 지역 변수 c 의 값을 eax 로 옮기는 줄이라는 것, 그리고 같은 C 코드라도 -O2 로 컴파일하면 어셈블리 모양이 크게 달라진다는 것.

8. 자주 하는 실수
- AT&T 와 Intel 을 섞어 읽기: 목적지 위치가 반대라서 값이 거꾸로 옮겨졌다고 착각하기 쉽다.
- eax 에 쓰면 rax 의 상위 32비트는 0 이 된다. 64비트 레지스터로 생각하면 틀린다.
- push 와 pop 의 개수가 안 맞거나 rsp 를 임의로 바꾸면 스택이 깨져서 ret 가 엉뚱한 주소로 간다.

※ 시험 포인트: eax·ebx·rsp 의 역할, AT&T 의 $ 와 % 표기와 접미사 l·q, push rbp → mov rbp, rsp → pop rbp → ret 순서, call 이 반환 주소를 push 한다는 점, 반환값은 eax 에 넣는다는 점, C 함수 하나를 어셈블리로 읽는 문제.
