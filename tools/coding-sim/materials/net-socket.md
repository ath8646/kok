[네트워크프로그래밍] 4주차 강의 정리 - 소켓과 TCP 연결

1. 소켓이란?
소켓은 프로그램이 네트워크로 데이터를 주고받을 때 쓰는 끝점(endpoint)이다. 소켓도 파일처럼 정수 번호(파일 디스크립터)로 다루고, read 와 write 로 데이터를 읽고 쓴다. 하나의 소켓은 IP 주소와 포트 번호의 짝으로 구분된다. 예를 들어 192.168.0.1 의 8080번 포트가 그런 짝이다. 두 프로그램이 통신하려면 양쪽에 소켓이 하나씩 있어야 하고, 그 둘이 연결되어야 한다.

2. IP 주소와 서브넷
IP 주소는 네트워크 부분과 호스트 부분으로 나뉜다. `192.168.0.1/24` 에서 /24 는 앞의 24비트가 네트워크 부분이라는 뜻이다. 그래서 이 네트워크는 192.168.0.0 부터 192.168.0.255 까지이고, 서브넷 마스크는 255.255.255.0 이다. 호스트 부분을 모두 0 으로 두면 네트워크 주소, 모두 1 로 두면 브로드캐스트 주소가 된다.

시험에 자주 나온다: 주소 192.168.0.1/24 의 네트워크 주소와 브로드캐스트 주소 구하기. 답은 각각 192.168.0.0 과 192.168.0.255 다.

3. 포트 번호
포트 번호는 16비트 값이라 0~65535 사이다. 0~1023 은 잘 알려진 포트(well-known port)로, 웹은 HTTP 80, HTTPS 443 을 쓴다. 직접 만든 서버는 보통 1024 이후 번호를 쓰고, 실습에서는 8080 을 많이 쓴다. 같은 IP 의 같은 포트를 두 프로그램이 동시에 열 수는 없다.

4. TCP 와 UDP
TCP 는 연결형(connection-oriented)이라 데이터의 순서와 도착을 보장하고, 잃어버리면 다시 보낸다. UDP 는 비연결형이라 빠르지만 도착을 보장하지 않는다. 소켓 타입으로 구분하는데, `SOCK_STREAM` 이 TCP, `SOCK_DGRAM` 이 UDP 다.

시험에 자주 나온다: TCP 가 "신뢰성 있는 바이트 스트림"을 준다는 설명, 그리고 TCP 는 메시지 경계를 지키지 않는다는 점.

5. TCP 3-way handshake
TCP 연결은 세 번의 메시지로 만든다. 각 메시지는 플래그와 순서 번호를 싣는다.
(1) 클라이언트 → 서버: SYN 플래그를 켠 세그먼트. 연결을 요청하고 클라이언트의 초기 순서 번호 x 를 알린다.
(2) 서버 → 클라이언트: SYN 과 ACK 를 함께 켠 세그먼트. 서버의 초기 순서 번호 y 를 알리고, 확인 번호는 x+1 이다.
(3) 클라이언트 → 서버: ACK 를 켠 세그먼트. 확인 번호는 y+1 이다. 이때부터 양쪽은 연결이 맺어졌다고 본다.

시험에 자주 나온다: SYN 은 데이터가 없어도 순서 번호를 하나 차지한다는 점, 세 번째 ACK 에는 데이터를 실어 보내도 된다는 점, 그리고 SYN 만 대량으로 보내 서버의 대기 공간을 채우는 공격을 SYN flood 라고 부른다는 점.

6. C 소켓 API 로 서버 만들기
서버는 socket → bind → listen → accept 순서로 만든다. `socket(AF_INET, SOCK_STREAM, 0)` 은 소켓을 만들고, `bind` 는 IP 와 포트를 묶고, `listen` 은 연결 요청을 받을 준비를 한다. accept 는 대기 중인 연결 하나를 꺼내는데, 이때 돌려주는 것은 새 소켓 번호다. 듣는 소켓(listen_fd)과 실제로 대화하는 소켓(conn_fd)은 다른 것이다.

    int listen_fd = socket(AF_INET, SOCK_STREAM, 0);
    struct sockaddr_in addr;
    memset(&addr, 0, sizeof(addr));
    addr.sin_family = AF_INET;
    addr.sin_port = htons(8080);
    addr.sin_addr.s_addr = htonl(INADDR_ANY);
    bind(listen_fd, (struct sockaddr *)&addr, sizeof(addr));
    listen(listen_fd, 5);
    int conn_fd = accept(listen_fd, NULL, NULL);
    write(conn_fd, "hi\n", 3);
    close(conn_fd);

socket 의 세 번째 인자 0 은 프로토콜을 자동으로 고르라는 뜻이다. htons 는 포트 번호를 네트워크 바이트 순서로 바꾼다. 이걸 빼먹으면 엉뚱한 포트가 열린다. listen 의 두 번째 인자 5 는 연결 대기 큐의 길이(backlog)다. accept 는 연결이 올 때까지 멈춰 있다(블로킹).

시험 포인트: "listen 이 연결을 받는다"는 틀린 답이다. 연결을 실제로 꺼내는 것은 accept 다. 또 socket 이 만든 소켓은 아직 연결이 없는 빈 소켓이다.

7. 파이썬 클라이언트
파이썬의 socket 모듈도 같은 일을 한다. 아래 코드는 같은 컴퓨터의 8080번 포트에 연결해서 문자열을 보내고 답을 받는다.

```python
import socket

with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
    s.connect(("127.0.0.1", 8080))
    s.sendall(b"hello server\n")
    reply = s.recv(1024)
    print(reply.decode())
```

connect 를 부르는 순간 위에서 본 3-way handshake 가 일어난다. recv(1024) 의 1024 는 한 번에 읽을 최대 바이트 수일 뿐이다. 시험에 자주 나온다: recv 가 요청한 만큼을 항상 다 돌려준다고 보장하지 않는다는 점.

8. 연결 상태 확인하기
서버를 띄운 뒤 다른 터미널에서 `netstat -an | grep 8080` 을 실행한다. -a 는 모든 소켓을, -n 은 이름 대신 숫자로 보여 준다는 뜻이다. LISTEN 은 accept 를 기다리는 듣기 소켓이고, ESTABLISHED 는 연결이 맺어진 상태다. 명령을 치면 대략 아래처럼 나온다.

```bash
$ netstat -an | grep 8080
tcp  0  0  0.0.0.0:8080    0.0.0.0:*         LISTEN
tcp  0  0  127.0.0.1:8080  127.0.0.1:52314  ESTABLISHED
```

9. 자주 하는 실수
bind 가 "Address already in use" 로 실패하면 이전 서버가 아직 포트를 붙잡고 있는 것이다. 이때 `setsockopt` 로 `SO_REUSEADDR` 를 켜면 재시작이 쉬워진다. `close` 를 빼먹으면 소켓 번호가 쌓여서 자원이 샌다.

※ 시험 포인트: 3-way handshake 의 세 메시지와 플래그·순서 번호, socket → bind → listen → accept 순서, listen 과 accept 의 차이, /24 의 네트워크 주소와 브로드캐스트 주소, SOCK_STREAM 과 SOCK_DGRAM 구분, netstat 상태(LISTEN, ESTABLISHED) 읽기.
