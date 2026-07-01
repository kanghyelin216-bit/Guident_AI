/**
 * modules/pathfinder.js
 * ──────────────────────────────────────────────────────────────
 * 알고리즘: A* (A-star)
 * 출처: Hart, Nilsson, Raphael (1968) "A Formal Basis for the
 *       Heuristic Determination of Minimum Cost Paths", IEEE TSSC
 *
 * - avoidCongestion=true → 혼잡 셀에 높은 비용(가중치) 부여, 우회 유도
 * - avoidCongestion=false → 순수 최단거리 (유클리드 휴리스틱)
 */

const CONGESTION_WEIGHT = 8;   // 혼잡 셀 통과 비용 배율
const DIRS = [                  // 8방향 이동
  [0,1],[0,-1],[1,0],[-1,0],
  [1,1],[1,-1],[-1,1],[-1,-1],
];

function heuristic(a, b) {
  return Math.hypot(a[0]-b[0], a[1]-b[1]);
}

/**
 * @param {number[][]} grid         grid[row][col] = 0(통행) / 1(벽)
 * @param {number[][]} congestion   grid[row][col] = 스캐너 수
 * @param {[number,number]} start   [row, col]
 * @param {[number,number]} goal    [row, col]
 * @param {boolean} avoidCongestion
 * @returns {[number,number][]|null}  경로 배열 or null(경로 없음)
 */
export function findPath(grid, congestion, start, goal, avoidCongestion = false) {
  const rows = grid.length, cols = grid[0].length;
  const key  = (r, c) => `${r},${c}`;

  const open   = new Map();   // key → {f,g,pos,prev}
  const closed = new Set();

  const startNode = { f: 0, g: 0, pos: start, prev: null };
  open.set(key(...start), startNode);

  while (open.size > 0) {
    // 최소 f 노드 추출
    let cur = null;
    for (const node of open.values()) {
      if (!cur || node.f < cur.f) cur = node;
    }
    open.delete(key(...cur.pos));
    closed.add(key(...cur.pos));

    const [r, c] = cur.pos;
    if (r === goal[0] && c === goal[1]) return reconstruct(cur);

    for (const [dr, dc] of DIRS) {
      const nr = r + dr, nc = c + dc;
      if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
      if (grid[nr][nc] === 1) continue;       // 벽
      const k = key(nr, nc);
      if (closed.has(k)) continue;

      const moveCost = Math.hypot(dr, dc);    // 대각선 = √2
      let cellCost = 1;
      if (avoidCongestion && congestion?.[nr]?.[nc] > 0) {
        cellCost = 1 + (congestion[nr][nc] * CONGESTION_WEIGHT);
      }
      const g = cur.g + moveCost * cellCost;
      const existing = open.get(k);
      if (!existing || g < existing.g) {
        open.set(k, {
          f: g + heuristic([nr, nc], goal),
          g,
          pos: [nr, nc],
          prev: cur,
        });
      }
    }
  }
  return null; // 경로 없음
}

function reconstruct(node) {
  const path = [];
  let cur = node;
  while (cur) { path.unshift(cur.pos); cur = cur.prev; }
  return path;
}
