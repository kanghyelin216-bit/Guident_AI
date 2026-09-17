/**
 * modules/location/weightedCentroid.js
 * 가중 중심(Weighted Centroid) + scannerId 세션 기반 스무딩/이상치 제거
 */
export default class WeightedCentroid {
  constructor({
    cellSizeM = 1.0,
    maxUsedBeacons = 4,       // top-N 비콘 사용 (7개 중 상위 4개)
    minDistance = 0.3,        // 하한선: 너무 가까울 때 가중치 폭주 방지
    maxValidDistance = 13.5,  // 방 대각선(≈12.8m) + 여유. 이 이상은 센티넬/노이즈로 간주해 제외
    minValidRssi = -95,       // 이보다 약하면 신뢰 불가로 제외 (센티넬 -100도 여기서 걸러짐)
    distanceEmaAlpha = 0.35,  // 비콘별 거리 스무딩 계수 (0~1, 클수록 최신값 반영↑)
    maxDistanceJumpM = 3.0,   // 한 틱(1초)에 허용하는 최대 거리 변화 → 튀는 값 클램프
    positionEmaAlpha = 0.45,  // 최종 좌표 스무딩 계수
    sessionTtlMs = 60_000,    // 오래 안 쓰는 세션 정리 주기
  } = {}) {
    Object.assign(this, {
      cellSizeM, maxUsedBeacons, minDistance, maxValidDistance,
      minValidRssi, distanceEmaAlpha, maxDistanceJumpM,
      positionEmaAlpha, sessionTtlMs,
    });

    // scannerId -> { beaconDistanceEma: Map<beaconId, number>, posEma: {x,y}|null, lastSeen }
    this.sessions = new Map();
  }

  _getSession(scannerId) {
    const now = Date.now();
    // 오래된 세션 정리 (메모리 누수 방지, 매 호출마다 다 훑지 않도록 확률적으로 실행)
    if (Math.random() < 0.05) {
      for (const [id, s] of this.sessions) {
        if (now - s.lastSeen > this.sessionTtlMs) this.sessions.delete(id);
      }
    }
    let session = this.sessions.get(scannerId);
    if (!session) {
      session = { beaconDistanceEma: new Map(), posEma: null, lastSeen: now };
      this.sessions.set(scannerId, session);
    }
    session.lastSeen = now;
    return session;
  }

  /**
   * @param {Array<{beaconId, rssi, distance}>} readings
   * @param {Map<string, {x, y, txPower}>} beaconMap
   * @param {string} scannerId - 스캐너별 세션 스무딩용
   */
  calculate(readings, beaconMap, scannerId = "default") {
    const session = this._getSession(scannerId);

    // 1) 센티넬/저신뢰 판독값 제거 → DB 매칭 → 거리 스무딩 + 스파이크 클램프
    const prepared = readings
      .filter(r =>
        r.rssi > this.minValidRssi &&
        r.distance > 0 &&
        r.distance < this.maxValidDistance
      )
      .map(r => {
        const info = beaconMap.get(r.beaconId);
        if (!info) return null;

        const rawDistance = Math.max(r.distance, this.minDistance);
        const prevEma = session.beaconDistanceEma.get(r.beaconId);

        let smoothed;
        if (prevEma == null) {
          smoothed = rawDistance;
        } else {
          // 🟢 튀는 값 클램프: 이전 값 대비 급격한 변화는 일정 폭만 반영
          const delta = rawDistance - prevEma;
          const clampedDelta = Math.max(-this.maxDistanceJumpM, Math.min(this.maxDistanceJumpM, delta));
          const clampedRaw = prevEma + clampedDelta;
          // 지수이동평균(EMA)으로 잔여 노이즈 완화
          smoothed = prevEma + this.distanceEmaAlpha * (clampedRaw - prevEma);
        }
        session.beaconDistanceEma.set(r.beaconId, smoothed);

        return { beaconId: r.beaconId, distance: smoothed, info };
      })
      .filter(Boolean);

    // 2) 가까운 순 정렬 후 상위 N개만 사용
    prepared.sort((a, b) => a.distance - b.distance);
    const used = prepared.slice(0, this.maxUsedBeacons);

    if (used.length < 3) return null;

    // 3) 가중 중심 계산: 가중치 = 1 / distance² (하한선으로 과대가중 방지)
    let wx = 0, wy = 0, wsum = 0;
    for (const r of used) {
      const d = Math.max(r.distance, this.minDistance);
      const w = 1 / (d * d);
      wx += r.info.x * w;
      wy += r.info.y * w;
      wsum += w;
    }
    if (wsum === 0) return null;

    let x = wx / wsum;
    let y = wy / wsum;

    // 4) 최종 좌표 EMA 스무딩 (지도 마커 떨림 완화)
    if (session.posEma) {
      x = session.posEma.x + this.positionEmaAlpha * (x - session.posEma.x);
      y = session.posEma.y + this.positionEmaAlpha * (y - session.posEma.y);
    }
    session.posEma = { x, y };

    // 5) 좌표 → 그리드 셀(zone)
    const col = Math.floor(x / this.cellSizeM);
    const row = Math.floor(y / this.cellSizeM);
    const zone = `R${String(row).padStart(2, "0")}C${String(col).padStart(2, "0")}`;

    // 6) 신뢰도: 사용 비콘 수 비율 + 가중치 편차 기반 (편차가 작을수록 안정적)
    const usedRatio = used.length / this.maxUsedBeacons;
    const avgW = wsum / used.length;
    const variance = used.reduce((acc, r) => {
      const d = Math.max(r.distance, this.minDistance);
      const w = 1 / (d * d);
      return acc + (w - avgW) ** 2;
    }, 0) / used.length;
    const consistency = 1 / (1 + variance);
    const confidence = Math.min(1, usedRatio * 0.6 + consistency * 0.4);

    return {
      x, y, zone, confidence,
      usedBeacons: used.map(r => r.beaconId),
    };
  }
}