/**
 * routes/location.js
 * POST /api/location  — 스캐너 RSSI 수신 → 위치 추정 → 저장 → 실시간 브로드캐스트
 *
 * Body: {
 * scannerId: string,
 * mapId: string,
 * beacons: [{beaconId, rssi, distance}]  // 최대 5개
 * }
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

  // 📍 [디버깅 로그] 원인 A 및 원인 B 분석을 위한 서버 콘솔 출력 (개발 환경용)
  if (process.env.NODE_ENV !== "production") {
    console.log("========================================");
    console.log("📍 [수신] 요청 mapId:", mapId);
    console.log("📡 [DB] 조회된 비콘 수:", dbBeacons.length);
    console.log("📡 [DB] 등록된 비콘 ID 리스트:", dbBeacons.map(b => b.beaconId));
    console.log("📶 [안드로이드] 전송된 readings ID 리스트:", beacons.map(b => b.beaconId));
    console.log("========================================");
  }

  // 원인 A 예방: DB에 해당 mapId로 등록된 비콘이 하나도 없는 경우 처리
  if (dbBeacons.length === 0) {
    return res.json({
      status: "insufficient_data",
      message: "해당 mapId로 등록된 비cons가 DB에 존재하지 않습니다 (mapId 불일치 의심)",
      debug: { reason: "mapId_mismatch", requestedMapId: mapId }
    });
  }

  const beaconMap = new Map(dbBeacons.map(b => [
    String(b.beaconId).trim().toUpperCase(),
    { x: b.x, y: b.y, txPower: b.txPower },
  ]));

  const readings = beacons.slice(0, 6).map(b => ({
    beaconId: String(b.beaconId).trim().toUpperCase(),
    rssi:     Number(b.rssi),
    distance: Number(b.distance),
  }));

  // 원인 B 검증: 안드로이드에서 보낸 비콘 ID가 DB에 등록된 비콘 ID Map에 존재하는지 사전 체크
  const matchedTest = readings.filter(r => beaconMap.has(r.beaconId));
  if (matchedTest.length < 3) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(`⚠️ 경고: 매칭된 비콘 부족 (${matchedTest.length}개). 안드로이드 ID와 관리자 등록 ID(A1~A6)를 확인하세요.`);
    }
  }

  const result = estimateLocation(readings, beaconMap);

  // 위치 추정이 실패하거나 유효 비콘이 부족한 경우 상세 원인을 프론트 및 로그에 남김
  if (!result) {
    return res.json({ 
      status: "insufficient_data", 
      message: "유효 비콘 부족(최소 3개 매칭 필요)",
      debug: {
        reason: "beaconId_mismatch_or_insufficient",
        dbBeaconCount: dbBeacons.length,
        receivedCount: readings.length,
        matchedCount: matchedTest.length,
        receivedIds: readings.map(r => r.beaconId),
        dbIds: Array.from(beaconMap.keys())
      }
    });
  }

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
  try {
    const congestion = await getCongestionForMap(req.params.mapId);
    res.json({ congestion });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;