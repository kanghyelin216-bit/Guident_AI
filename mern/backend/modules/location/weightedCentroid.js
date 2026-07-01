/**
 * modules/location/weightedCentroid.js
 * 가중 중심(Weighted Centroid) 방식 위치 추정 구현체.
 * 신호가 강한(거리가 가까운) 비콘일수록 더 큰 가중치를 부여해 평균 좌표를 구합니다.
 */
export default class WeightedCentroid {
  constructor({ cellSizeM = 1.0 } = {}) {
    this.cellSizeM = cellSizeM;
  }

  /**
   * @param {Array<{beaconId, rssi, distance}>} readings
   * @param {Map<string, {x, y, txPower}>} beaconMap
   */
  calculate(readings, beaconMap) {
    // 1) beaconMap에 실제로 등록된(DB에 있는) 비콘만 걸러내기
    const matched = readings
      .map(r => ({ ...r, info: beaconMap.get(r.beaconId) }))
      .filter(r => r.info && r.distance > 0);

    // 2) 최소 3개 비콘이 있어야 위치 추정 가능
    if (matched.length < 3) return null;

    // 3) 거리 기준 정렬 후 가까운 순으로 최대 3개만 사용 (노이즈 감소)
    matched.sort((a, b) => a.distance - b.distance);
    const used = matched.slice(0, 3);

    // 4) 가중 중심 계산: 가중치 = 1 / distance^2
    let wx = 0, wy = 0, wsum = 0;
    for (const r of used) {
      const w = 1 / Math.max(r.distance * r.distance, 0.0001);
      wx += r.info.x * w;
      wy += r.info.y * w;
      wsum += w;
    }
    if (wsum === 0) return null;

    const x = wx / wsum;
    const y = wy / wsum;

    // 5) 좌표 → 그리드 셀(zone) 변환, 예: "R01C02"
    const col = Math.floor(x / this.cellSizeM);
    const row = Math.floor(y / this.cellSizeM);
    const zone = `R${String(row).padStart(2, "0")}C${String(col).padStart(2, "0")}`;

    // 6) 신뢰도: 사용된 비콘 수 기준 단순 지표 (3개 다 쓰면 1.0)
    const confidence = used.length / 3;

    return {
      x,
      y,
      zone,
      confidence,
      usedBeacons: used.map(r => r.beaconId),
    };
  }
}