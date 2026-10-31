# 데이터베이스 3주차 필기: SQL 기초, JOIN, 트랜잭션, 정규화

## 1. 관계형 데이터베이스
관계형 데이터베이스는 데이터를 표(테이블)에 저장한다. 표의 한 줄은 레코드(튜플), 한 열은 속성(attribute)이다. 이번 주 예제는 학생 수강 정보로 한다. (교재 3장)

- enroll(sid, name, dept, cid, grade): 수강 신청 기록
- course(id, title, credit): 과목 정보

## 2. SELECT 기본과 LIKE
SELECT 뒤에 가져올 열, FROM 뒤에 테이블, WHERE 뒤에 조건을 쓴다. 문자열 값은 작은따옴표로 감싼다. 이름 일부로 찾을 때는 LIKE 를 쓴다. %는 글자 여러 개, _는 글자 한 개를 뜻한다. 교수님이 "이름에 kim 이 들어간 사람"을 찾는 예로 `LIKE '%kim%'` 을 쓰셨다. LIKE 의 대소문자 구분은 DBMS마다 달라서 시험 때 조건을 꼭 확인하라고 하셨다.

    SELECT name FROM enroll WHERE name LIKE '%kim%';

## 3. 집계와 GROUP BY, HAVING (★ 시험 자주 나옴)
COUNT, SUM, AVG, MAX, MIN 같은 집계 함수는 여러 행을 한 값으로 줄인다. GROUP BY 로 묶은 다음 그룹에 조건을 걸 때는 HAVING 을 쓴다. WHERE 는 묶기 전의 행을, HAVING 은 묶은 뒤의 그룹을 거른다. 아래 질의는 CS 학과에서 같은 이름이 두 번 이상 나오는 학생을 찾는다.

```sql
SELECT name, COUNT(*) FROM enroll WHERE dept = 'CS' GROUP BY name HAVING COUNT(*) > 1;
```

## 4. JOIN
두 테이블을 공통된 값으로 연결하는 것이 JOIN 이다. enroll 의 cid 와 course 의 id 가 같은 행끼리 붙는다. 별칭 e, c 를 붙이면 열 앞에 테이블 이름을 길게 안 써도 된다.

```sql
SELECT e.name, c.title
FROM enroll e
JOIN course c ON e.cid = c.id;
```

## 5. NULL 처리
NULL 은 0 도 아니고 빈 문자열도 아니다. "값이 아직 없음"을 뜻한다. 그래서 `grade = NULL` 로 비교하면 결과가 unknown 이 되어 한 줄도 안 나온다. 반드시 `grade IS NULL` 이나 `grade IS NOT NULL` 로 써야 한다. 빈 값을 다른 값으로 바꾸고 싶으면 COALESCE(grade, 0) 을 쓴다. COUNT(grade) 는 NULL 을 세지 않고 COUNT(*) 는 센다는 것도 같이 나왔다.

## 6. 트랜잭션
여러 문장을 한 덩어리로 묶어서, 중간에 하나라도 실패하면 전부 되돌리는 것이 트랜잭션이다. 성공하면 COMMIT, 실패하면 ROLLBACK 을 쓴다. 원자성, 일관성, 격리성, 지속성(ACID)이 여기서 나온다.

    BEGIN; UPDATE enroll SET dept = 'AI' WHERE sid = 2021001; COMMIT;

계좌 이체를 예로 들면, 출금은 됐는데 입금이 실패하면 안 되니까 두 문장을 한 트랜잭션에 넣는다고 설명하셨다.

## 7. 키와 정규화
기본키(PRIMARY KEY)는 행을 유일하게 구분하는 열이다. 외래키(FOREIGN KEY)는 다른 테이블의 기본키를 참조하는 열이다. enroll 의 cid 가 course 의 id 를 참조하므로 외래키다. 한 학생이 같은 과목을 두 번 들을 수 없게 하려면 (sid, cid) 를 묶어서 복합키로 잡는다.

정규화는 중복과 삽입·삭제 이상을 줄이려고 테이블을 나누는 과정이다.
- 1NF: 모든 칸은 하나의 값만 가진다. 반복되는 그룹은 행으로 풀어 쓴다.
- 2NF: 1NF 이고, 복합키의 일부에만 종속된 열을 따로 뺀다.
- 3NF: 2NF 이고, 기본키가 아닌 열끼리의 이행 종속을 없앤다. 학번 → 학과 → 학과장 구조라면 학과 테이블을 분리한다.

시험 전에 예제 표 하나를 1NF, 2NF, 3NF 순서로 직접 나눠 보기!
