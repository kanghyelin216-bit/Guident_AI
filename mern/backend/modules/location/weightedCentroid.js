/**
 * modules/location/weightedCentroid.js (평활화 포함 버전)
 * index.js 가 넘기는 옵션을 실제로 구현한 가중 중심 위치 추정.
 */
export default class WeightedCentroid {
  constructor({
    cellSizeM = 1.0,
    maxUsedBeacons = 3,
    minBeacons = 3,
    minDistance = 0.3,
    maxValidDistance = 13.5,
    minValidRssi = -95,
    distanceEmaAlpha = 0.3,
    maxDistanceJumpM = 3.0,
    positionEmaAlpha = 0.3,
    holdMs = 2000,
    staleMs = 10000,
    zoneMargin = 0.25,
  } = {}) {
    Object.assign(this, {
      cellSizeM, maxUsedBeacons, minBeacons, minDistance, maxValidDistance,
      minValidRssi, distanceEmaAlpha, maxDistanceJumpM, positionEmaAlpha,
      holdMs, staleMs, zoneMargin,
    });
    this.states = new Map(); // scannerId -> 폰별 상태
    setInterval(() => this.cleanup(), 30000).unref();
  }

  calculate(readings, beaconMap, scannerId = "default") {
    const now = Date.now();
    let st = this.states.get(scannerId);
    if (!st || now - st.ts > this.staleMs) {
      st = { dist: new Map(), pos: null, cell: null, ts: now };
      this.states.set(scannerId, st);
    }
    st.ts = now;

    // 1) 유효한 측정값만 비콘별 거리 EMA 에 반영
    for (const r of readings) {
      if (!beaconMap.has(r.beaconId)) continue;
      if (!(r.rssi > this.minValidRssi)) continue;      // -100(미감지) 등 제외
      let d = Number(r.distance);
      if (!Number.isFinite(d) || d <= 0) continue;
      d = Math.max(d, this.minDistance);
      if (d > this.maxValidDistance) continue;

      const prev = st.dist.get(r.beaconId);
      if (prev) {
        const diff = d - prev.d;
        if (Math.abs(diff) > this.maxDistanceJumpM) d = prev.d + Math.sign(diff) * this.maxDistanceJumpM;
        d = this.distanceEmaAlpha * d + (1 - this.distanceEmaAlpha) * prev.d;
      }
      st.dist.set(r.beaconId, { d, ts: now });
    }

    // 2) 최근(holdMs 이내)에 본 비콘만 후보로 사용
    const cands = [];
    for (const [id, v] of st.dist) {
      const info = beaconMap.get(id);
      if (!info || now - v.ts > this.holdMs) { st.dist.delete(id); continue; }
      cands.push({ id, d: v.d, info });
    }
    if (cands.length < this.minBeacons) return null;
    cands.sort((a, b) => a.d - b.d);
    const used = cands.slice(0, this.maxUsedBeacons);

    // 3) 가중 중심 (가중치 = 1 / d²)
    let wx = 0, wy = 0, wsum = 0;
    for (const c of used) {
      const w = 1 / Math.max(c.d * c.d, 0.0001);
      wx += c.info.x * w; wy += c.info.y * w; wsum += w;
    }
    if (wsum === 0) return null;
    const rx = wx / wsum, ry = wy / wsum;

    // 4) 위치 EMA
    const a = this.positionEmaAlpha;
    const x = st.pos ? a * rx + (1 - a) * st.pos.x : rx;
    const y = st.pos ? a * ry + (1 - a) * st.pos.y : ry;
    st.pos = { x, y };

    // 5) 칸(zone) 변경은 칸 안쪽 깊이 들어왔을 때만 (경계 깜빡임 방지)
    const cs = this.cellSizeM;
    const col = Math.max(0, Math.floor(x / cs));
    const row = Math.max(0, Math.floor(y / cs));
    const fx = x / cs - col, fy = y / cs - row, m = this.zoneMargin;
    const deepInside = fx > m && fx < 1 - m && fy > m && fy < 1 - m;
    const farMove = st.cell && Math.max(Math.abs(col - st.cell.col), Math.abs(row - st.cell.row)) > 1;
    if (!st.cell || deepInside || farMove) st.cell = { row, col };
    const zone = `R${String(st.cell.row).padStart(2, "0")}C${String(st.cell.col).padStart(2, "0")}`;

    return {
      x, y, zone,
      confidence: Math.min(1, used.length / 3),
      usedBeacons: used.map(c => c.id),
    };
  }

  cleanup() {
    const now = Date.now();
    for (const [id, s] of this.states) if (now - s.ts > 60000) this.states.delete(id);
  }
}