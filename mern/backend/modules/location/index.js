/**
 * modules/location/index.js
 * 느슨한 결합(Loosely Coupled) 위치 추정 인터페이스.
 * 교체 방법: weightedCentroid.js 대신 다른 구현체를 만들고 아래 import 경로만 바꾸면 됩니다.
 */
import WeightedCentroid from "./weightedCentroid.js";

const engine = new WeightedCentroid({ cellSizeM: 1.0 });

/**
 * @param {Array<{beaconId, rssi, distance}>} readings
 * @param {Map<string, {x,y,txPower}>} beaconMap
 * @returns {{ x, y, zone, confidence, usedBeacons } | null}
 */
export function estimateLocation(readings, beaconMap) {
  return engine.calculate(readings, beaconMap);
}