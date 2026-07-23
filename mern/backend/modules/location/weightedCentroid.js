/**
 * modules/location/weightedCentroid.js (개선 버전)
 */
export default class WeightedCentroid {
  constructor({ cellSizeM = 1.0 } = {}) {
    this.cellSizeM = cellSizeM;
    // 세션(scannerId)별 이전 위치 좌표 보관 (EMA 필터용)
    this.lastPositions = new Map();
    // EMA 가중치 (alpha): 0.1 ~ 0.3 사이 권장 (작을수록 부드럽지만 반응 지연 증가, 크면 빠르지만 튐)
    this.alpha = 0.25;
  }

  /**
   * @param {Array<{beaconId, rssi, distance}>} readings
   * @param {Map<string, {x, y, txPower}>} beaconMap
   * @param {string} scannerId - 이동평균 상태 추적을 위한 스캐너 식별자
   */
  calculate(readings, beaconMap, scannerId = 'default') {
    // 1) DB에 등록된 비콘 수신 데이터만 필터링
    const matched = readings
      .map(r => ({ ...r, info: beaconMap.get(r.beaconId) }))
      .filter(r => r.info && r.distance > 0);

    if (matched.length < 3) return null;

    // 2) 가까운 거리 순으로 top 3 선택
    matched.sort((a, b) => a.distance - b.distance);
    const used = matched.slice(0, 3);

    // 3) Raw 가중 중심 위치 계산
    let wx = 0, wy = 0, wsum = 0;
    for (const r of used) {
      // 0.1m 이하 0 나눔 방지 및 튀는 현상 완화
      const safeDist = Math.max(r.distance, 0.5);
      const w = 1 / (safeDist * safeDist);
      wx += r.info.x * w;
      wy += r.info.y * w;
      wsum += w;
    }
    if (wsum === 0) return null;

    let rawX = wx / wsum;
    let rawY = wy / wsum;

    // 4) 🟢 Exponential Moving Average (EMA) 적용으로 좌표 튀는 현상 원천 차단
    let finalX = rawX;
    let finalY = rawY;

    if (this.lastPositions.has(scannerId)) {
      const prev = this.lastPositions.get(scannerId);
      finalX = this.alpha * rawX + (1 - this.alpha) * prev.x;
      finalY = this.alpha * rawY + (1 - this.alpha) * prev.y;
    }

    // 상태 업데이트
    this.lastPositions.set(scannerId, { x: finalX, y: finalY });

    // 5) 그리드 셀 구역 계산
    const col = Math.floor(finalX / this.cellSizeM);
    const row = Math.floor(finalY / this.cellSizeM);
    const zone = `R${String(row).padStart(2, "0")}C${String(col).padStart(2, "0")}`;

    return {
      x: finalX,
      y: finalY,
      zone,
      confidence: used.length / 3,
      usedBeacons: used.map(r => r.beaconId),
    };
  }
}