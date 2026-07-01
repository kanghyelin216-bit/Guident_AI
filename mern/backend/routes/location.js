/**
 * routes/location.js
 * POST /api/location  — 스캐너 RSSI 수신 → 위치 추정 → 저장 → 실시간 브로드캐스트
 *
 * Body: {
 *   scannerId: string,
 *   mapId: string,
 *   beacons: [{beaconId, rssi, distance}]  // 최대 5개
 * }
 *
 * ⚠️ 변경 사항 (핵심 파이프라인 수정):
 *  - estimateLocation() 결과가 나오면 io.emit('location_update', ...) 로 즉시 브로드캐스트합니다.
 *    (기존에는 DB 저장만 하고 프론트로 전달하는 경로가 없었습니다)
 *  - 위치가 갱신될 때마다 해당 맵의 혼잡도도 재계산해서 io.emit('congestion_update', ...) 로 함께 보냅니다.
 *  - ScannerReading.mapId 는 스키마상 ObjectId인데 aggregate($match)는 스키마 기반 자동 캐스팅을
 *    하지 않으므로, 문자열로 비교하면 항상 빈 결과가 나오는 버그가 있었습니다. mongoose.Types.ObjectId로
 *    명시적으로 캐스팅하도록 고쳤습니다.
 */
import { Router } from "express";
import mongoose from "mongoose";
import { Beacon, ScannerReading } from "../models/index.js";
import { estimateLocation } from "../modules/location/index.js";

const router = Router();

// 최근 5분간 맵의 zone별 스캐너(방문자) 수를 집계하는 공용 함수
async function getCongestionForMap(mapId) {
  const recent = new Date(Date.now() - 5 * 60 * 1000); // 최근 5분

  const agg = await ScannerReading.aggregate([
    {
      $match: {
        mapId: new mongoose.Types.ObjectId(mapId), // ⚠️ 명시적 ObjectId 캐스팅 (버그 수정)
        ts: { $gte: recent },
      },
    },
    { $group: { _id: "$zone", count: { $sum: 1 } } },
  ]);

  // { "R01C02": 3, "R02C03": 1, ... }
  return Object.fromEntries(agg.map(a => [a._id, a.count]));
}

router.post("/", async (req, res) => {
  const { scannerId, mapId, beacons = [] } = req.body;

  if (!scannerId || !mapId || beacons.length === 0)
    return res.status(400).json({ error: "scannerId, mapId, beacons 필수" });

  // MongoDB에서 비콘 좌표 로드 → Map으로 변환
  const dbBeacons = await Beacon.find({ mapId });
  const beaconMap = new Map(dbBeacons.map(b => [b.beaconId, {
    x: b.x, y: b.y, txPower: b.txPower,
  }]));

  // 위치 추정 (느슨한 결합 모듈 호출 — 알고리즘 교체는 modules/location/index.js 한 곳만 바꾸면 됨)
  const readings = beacons.slice(0, 5).map(b => ({
    beaconId: b.beaconId,
    rssi:     Number(b.rssi),
    distance: Number(b.distance),
  }));

  const result = estimateLocation(readings, beaconMap);

  if (!result)
    return res.json({ status: "insufficient_data", message: "유효 비콘 부족(최소 3개)" });

  // 혼잡도 집계를 위해 저장 (TTL 5분 자동 삭제)
  await ScannerReading.create({ scannerId, mapId, zone: result.zone, x: result.x, y: result.y });

  // 🔌 실시간 브로드캐스트 — 여기가 이번에 새로 추가된 핵심 연결부입니다.
  const io = req.app.get("io");
  if (io) {
    // 1) 이 스캐너의 새 추정 위치를 모든 클라이언트에 전파
    io.emit("location_update", {
      scannerId,
      mapId,
      x: result.x,          // 미터 단위
      y: result.y,          // 미터 단위
      zone: result.zone,    // 그리드 셀, 예: "R01C02"
      confidence: result.confidence,
      usedBeacons: result.usedBeacons,
    });

    // 2) 혼잡도도 같이 갱신해서 전파 (요구사항 #6: 실시간 반영)
    try {
      const congestion = await getCongestionForMap(mapId);
      io.emit("congestion_update", { mapId, congestion });
    } catch (err) {
      console.error("혼잡도 재계산 실패:", err);
    }
  }

  res.json({ status: "ok", scannerId, location: result });
});

// GET /api/location/congestion/:mapId  → 그리드별 스캐너 수 (최초 로드 시 폴백용)
router.get("/congestion/:mapId", async (req, res) => {
  const congestion = await getCongestionForMap(req.params.mapId);
  res.json({ congestion });
});

export default router;