/**
 * congestion.js — 혼잡도 공용 모듈 (App.jsx 와 MapSketch.jsx 가 함께 사용)
 *
 * 서버가 주는 데이터:  { "R01C02": 2, "R03C01": 1 }   (칸 이름 → 그 칸에 있는 폰 수)
 * 이 파일이 하는 일:
 *   1) 혼잡 단계(여유/보통/혼잡) 기준을 "한 곳"에서 정의
 *   2) 칸 이름("R01C02")을 지도 좌표로 바꾸는 계산
 *   3) 전시물 주변(반경 2m) 인원 세기
 *   4) 서버에서 혼잡도를 주기적으로 받아오는 React 훅(useCongestion)
 */
import { useState, useEffect } from 'react';
import { io } from 'socket.io-client';

/* ── 지도 규격 ───────────────────────────────────────────── */
export const PIXEL_SCALE = 75;      // 1미터 = 75픽셀 (캔버스 600×750 = 8m × 10m)
export const CELL_SIZE_M = 1.0;     // 격자 한 칸 = 1m (서버 weightedCentroid.js 의 cellSizeM 과 같아야 함)

/* ── 혼잡 기준 (여기만 고치면 목록·지도가 함께 바뀜) ─────────────
 * 0명 = 여유 / 1명 = 보통 / 2명 이상 = 혼잡
 * ⚠️ 서버 routes/location.js 의  `(congestion[result.zone] || 0) >= 2`  의 숫자와 맞춰 두세요.
 */
export const MID_MIN = 1;
export const HIGH_MIN = 2;

/* ── 전시물 주변 인원 계산 범위 / 새로고침 주기 ───────────────── */
export const NEARBY_RADIUS_M = 2.0; // 전시물 중심에서 반경 2m 안의 칸을 합산
export const REFRESH_MS = 3000;     // 3초마다 서버에 다시 물어봄

/* ── 부스(전시물) 위치: 픽셀 단위 (MapSketch 의 부스 그림과 같은 값) ──
 * 부스는 벽에 붙어 있어서, "부스가 있는 칸"만 세면 항상 0명이 나옵니다.
 * 그래서 부스 중심에서 반경 NEARBY_RADIUS_M 안의 칸들을 합산합니다.
 */
export const BOOTH_RECT = {
  A1: { x: 0,   y: 80,  w: 50, h: 110 },
  A2: { x: 0,   y: 320, w: 50, h: 110 },
  A3: { x: 0,   y: 560, w: 50, h: 110 },
  A5: { x: 550, y: 560, w: 50, h: 110 },
  A6: { x: 550, y: 320, w: 50, h: 110 },
  A7: { x: 550, y: 80,  w: 50, h: 110 },
};

/* ── 혼잡 단계 정의 (색상 포함) ─────────────────────────────── */
const LEVELS = {
  low:  { key: 'low',  label: '여유', emoji: '🟢', color: '#74C476', bg: '#EDF7EE', fill: [237, 247, 238], stroke: [116, 196, 118], text: [47, 158, 68] },
  mid:  { key: 'mid',  label: '보통', emoji: '🟡', color: '#FDAE6B', bg: '#FEF9EC', fill: [254, 249, 236], stroke: [253, 174, 107], text: [230, 119, 0] },
  high: { key: 'high', label: '혼잡', emoji: '🔴', color: '#F768A1', bg: '#FEF0F5', fill: [254, 240, 245], stroke: [247, 104, 161], text: [224, 49, 49] },
};

/** 사람 수 → 혼잡 단계 */
export function getCongestionLevel(count) {
  if (!count || count < MID_MIN) return LEVELS.low;
  if (count < HIGH_MIN) return LEVELS.mid;
  return LEVELS.high;
}

/** 범례(지도 아래쪽 안내)에 쓸 문구 */
export const LEGEND_ITEMS = [
  { level: LEVELS.low,  text: `여유 ${MID_MIN - 1}명` },
  { level: LEVELS.mid,  text: HIGH_MIN - 1 === MID_MIN ? `보통 ${MID_MIN}명` : `보통 ${MID_MIN}~${HIGH_MIN - 1}명` },
  { level: LEVELS.high, text: `혼잡 ${HIGH_MIN}명+` },
];

/* ── 칸 이름 ↔ 좌표 변환 ─────────────────────────────────────── */

/** "R03C02" → { row: 3, col: 2 }   (형식이 틀리면 null) */
export function parseZone(zone) {
  const m = /^R(\d+)C(\d+)$/.exec(String(zone));
  return m ? { row: Number(m[1]), col: Number(m[2]) } : null;
}

/** 칸 → 지도 위 사각형(픽셀).  x = col × 칸크기 × 75,  y = row × 칸크기 × 75 */
export function zoneToRectPx(zone) {
  const z = parseZone(zone);
  if (!z) return null;
  const size = CELL_SIZE_M * PIXEL_SCALE;
  return { x: z.col * size, y: z.row * size, w: size, h: size };
}

/** 칸의 중심 좌표(미터) */
function zoneCenterM(zone) {
  const z = parseZone(zone);
  if (!z) return null;
  return { x: (z.col + 0.5) * CELL_SIZE_M, y: (z.row + 0.5) * CELL_SIZE_M };
}

/** 부스 중심 좌표(미터) */
export function boothCenterM(beaconId) {
  const r = BOOTH_RECT[beaconId];
  if (!r) return null;
  return { x: (r.x + r.w / 2) / PIXEL_SCALE, y: (r.y + r.h / 2) / PIXEL_SCALE };
}

/**
 * 전시물 주변 인원 = 부스 중심에서 반경 radiusM 안에 "칸 중심"이 들어오는 칸들의 사람 수 합계
 * @param {Object} congestion  { "R01C02": 2, ... }
 * @param {string} beaconId    "A1" ~ "A7"
 */
export function countNearExhibit(congestion, beaconId, radiusM = NEARBY_RADIUS_M) {
  const center = boothCenterM(beaconId);
  if (!center || !congestion) return 0;
  let total = 0;
  for (const [zone, count] of Object.entries(congestion)) {
    const c = zoneCenterM(zone);
    if (!c) continue;
    if (Math.hypot(c.x - center.x, c.y - center.y) <= radiusM) total += Number(count) || 0;
  }
  return total;
}

/* ── 서버에서 혼잡도 받아오기 (React 훅) ──────────────────────────
 * - 3초마다 REST 로 새로 받아옴 → 폰이 모두 떠나면 서버가 빈 값을 주므로 "유령 혼잡"이 사라짐
 * - 동시에 Socket.io 의 congestion_update 도 받아서 즉시 반영
 */
export function useCongestion(mapId, serverBaseUrl) {
  const [congestion, setCongestion] = useState({});

  useEffect(() => {
    if (!mapId) return undefined;
    let cancelled = false;

    const load = async () => {
      try {
        const res = await fetch(`${serverBaseUrl}/api/location/congestion/${mapId}`);
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setCongestion(data?.congestion || {});
      } catch {
        // 네트워크 오류는 무시하고 다음 주기에 다시 시도
      }
    };

    load();
    const timer = setInterval(load, REFRESH_MS);

    // 서버가 congestion_update 를 전체에도 보내므로 별도 방 입장 없이 수신 가능
    const socket = io(serverBaseUrl, { transports: ['websocket'] });
    socket.on('congestion_update', (payload) => {
      if (!cancelled && payload?.mapId === mapId) setCongestion(payload.congestion || {});
    });

    return () => {
      cancelled = true;
      clearInterval(timer);
      socket.disconnect();
    };
  }, [mapId, serverBaseUrl]);

  return congestion;
}
