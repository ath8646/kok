5주차 정리: 정렬 알고리즘과 시간 복잡도

■ 1. 정렬과 시간 복잡도
- 정렬: 자료를 작은 값부터 큰 값 순서로 늘어놓는 일
- 시간 복잡도는 입력 크기 n 이 커질 때 실행 시간이 얼마나 늘어나는지를 본다.
- 자주 나오는 표기: O(1), O(n), O(n log n), O(n^2)

■ 2. 삽입 정렬 (Insertion Sort)
- 앞부분은 이미 정렬되어 있다고 보고, 새 원소를 알맞은 자리에 끼워 넣는다.
- 두 번째 원소(인덱스 1)부터 시작하는 것이 핵심이다.

    def insertion_sort(a):
        for i in range(1, len(a)):
            key = a[i]
            j = i - 1
            while j >= 0 and a[j] > key:
                a[j + 1] = a[j]
                j -= 1
            a[j + 1] = key
        return a

- 이미 정렬된 입력이면 O(n), 거꾸로 정렬된 입력이면 O(n^2) 이다.

■ 3. 병합 정렬 (Merge Sort)
- 절반으로 나눠 각각 정렬한 뒤 합친다. 분할 정복 방식이다.
- 구간 [lo, hi) 를 가운데에서 나눈다.

```python
def merge_sort(a):
    def sort(lo, hi):
        if hi - lo <= 1:
            return
        mid = (lo + hi) // 2
        sort(lo, mid)
        sort(mid, hi)
        merged = []
        i, j = lo, mid
        while i < mid and j < hi:
            if a[i] <= a[j]:
                merged.append(a[i])
                i += 1
            else:
                merged.append(a[j])
                j += 1
        merged += a[i:mid] + a[j:hi]
        a[lo:hi] = merged
    sort(0, len(a))
    return a
```

- 한 단계마다 합치는 데 n 개를 본다. 그래서 점화식은 T(n) = 2T(n/2) + n 이고, 이를 풀면 O(n log n) 이다.

■ 4. 퀵 정렬 (Quick Sort)
- 기준값(pivot)보다 작은 것은 왼쪽, 큰 것은 오른쪽으로 옮긴다.
- 의사코드는 다음과 같다.

```
QUICKSORT(A, p, r)
    if p < r then
        q = PARTITION(A, p, r)
        QUICKSORT(A, p, q - 1)
        QUICKSORT(A, q + 1, r)
```

- 파티션 과정에서 `a[i], a[j] = a[j], a[i]` 로 두 값을 맞바꾼다.

    def partition(a, lo, hi):
        pivot = a[hi]
        i = lo - 1
        for j in range(lo, hi):
            if a[j] <= pivot:
                i += 1
                a[i], a[j] = a[j], a[i]
        a[i + 1], a[hi] = a[hi], a[i + 1]
        return i + 1

- 평균은 O(n log n), 최악은 O(n^2) 이다.

■ 5. 한눈에 보기
- 삽입 정렬: 평균 O(n^2), 정렬된 입력이면 O(n)
- 병합 정렬: 항상 O(n log n), 합칠 때 추가 공간이 필요하다.
- 퀵 정렬: 평균 O(n log n), 최악 O(n^2)

※ 시험 포인트: 병합 정렬 점화식 T(n) = 2T(n/2) + n 은 꼭 풀 수 있어야 한다.
※ 퀵 정렬 최악은 pivot 이 계속 한쪽 끝에 몰릴 때다. 정렬된 배열에 맨 끝 pivot 을 쓰면 이런 경우가 된다.
