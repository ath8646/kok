# 알고리즘 8주차 강의 정리: 동적 계획법과 그래프 탐색

## 1. 동적 계획법(DP)

- 큰 문제를 같은 모양의 작은 문제로 나눈다.
- 작은 문제의 답은 한 번만 구해서 저장해 두고 다시 쓴다.
- 같은 계산이 반복되는 문제(겹치는 부분 문제)에 효과가 크다.

설계할 때는 항상 이 세 가지를 먼저 정한다.
1) 상태 정의: dp[i][j]가 무엇을 뜻하는지
2) 점화식: 상태끼리 어떤 관계인지
3) 초깃값과 답이 있는 칸

## 2. 격자 최소 비용 경로

n x m 격자에서 왼쪽 위에서 오른쪽 아래까지 오른쪽과 아래로만 움직인다. 지나간 칸의 비용 합이 가장 작은 경로를 찾는 문제다.

dp[i][j]를 (i, j) 칸까지 오는 최소 비용이라고 정의하면 점화식은 이렇다.

dp[i][j] = min(dp[i-1][j], dp[i][j-1]) + cost[i][j]

위에서 오는 경우와 왼쪽에서 오는 경우 중 작은 값을 고르고 현재 칸 비용을 더한다. 바깥 칸은 `INF`로 채우면 min에서 알아서 밀려난다.

```python
INF = float('inf')

def min_cost(cost):
    n, m = len(cost), len(cost[0])
    dp = [[INF] * (m + 1) for _ in range(n + 1)]
    dp[0][1] = 0  # 시작점 바로 위의 가상 칸
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            dp[i][j] = min(dp[i-1][j], dp[i][j-1]) + cost[i-1][j-1]
    return dp[n][m]
```

칸 수만큼 한 번씩 계산하므로 시간 복잡도는 O(nm)이다.

## 3. 그래프 표현: 인접 리스트

간선이 적은 그래프는 인접 리스트로 저장한다. 정점 u에서 나가는 간선 (v, w)를 graph[u]에 넣는다.

    n, m = map(int, input().split())
    graph = [[] for _ in range(n)]
    for _ in range(m):
        u, v, w = map(int, input().split())
        graph[u].append((v, w))

무방향 그래프라면 graph[v]에도 같은 간선을 넣어야 한다.

## 4. BFS (너비 우선 탐색)

시작점에서 가까운 정점부터 층 단위로 방문한다. 큐를 쓰고, 간선에 가중치가 없을 때 최단 거리를 구할 수 있다.

    from collections import deque

    def bfs(graph, start):
        dist = {start: 0}
        q = deque([start])
        while q:
            u = q.popleft()
            for v, _ in graph[u]:
                if v not in dist:
                    dist[v] = dist[u] + 1
                    q.append(v)
        return dist

리스트 맨 앞을 pop(0)으로 빼면 O(n)이 걸리니, 앞에서 뺄 때는 q.popleft()를 쓴다. 전체 시간 복잡도는 O(V + E)다.

## 5. 다익스트라 (가중치가 음수가 아닐 때)

간선에 가중치가 있으면 BFS로는 최단 거리를 보장할 수 없다. 확정되지 않은 정점 중 거리가 가장 짧은 것을 우선순위 큐에서 꺼낸다. 파이썬에서는 `heapq`를 쓰고, 아래 코드는 위에서 정의한 INF를 그대로 쓴다.

```python
import heapq

def dijkstra(graph, src, n):
    dist = [INF] * n
    dist[src] = 0
    pq = [(0, src)]
    while pq:
        cur, u = heapq.heappop(pq)
        if cur > dist[u]:  # 더 짧은 거리로 이미 처리한 정점
            continue
        for v, w in graph[u]:
            d = cur + w
            if d < dist[v]:
                dist[v] = d
                heapq.heappush(pq, (d, v))
    return dist
```

- 우선순위 큐에 넣는 것은 (거리, 정점) 쌍이다.
- 힙 연산 한 번은 O(log V)이고, 간선을 볼 때마다 push가 최대 한 번 일어난다.
- 그래서 전체 시간 복잡도는 O((V+E) log V)다.

## 시험 포인트

- 점화식을 말로 먼저 쓸 수 있어야 한다. 상태 정의가 틀리면 식도 틀린다.
- BFS는 큐, DFS는 스택(재귀). 둘 다 O(V + E).
- 다익스트라는 음수 간선이 있으면 안 된다(벨만-포드는 다음 주).
