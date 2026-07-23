/**
 * routes/location.js
 * POST /api/location — 스캐너 RSSI 수신 → 위치 추정 → 즉시 브로드캐스트 → 비동기 DB 적재
 */
import { Router } from "express";
import mongoose from "mongoose";
import { Beacon, ScannerReading } from "../models/index.js";
import BeaconLog from "../models/BeaconLog.js";
import { estimateLocation } from "../modules/location/index.js";

const router = Router();

// 최근 5분간 맵의 zone별 스캐너(방문자) 수를 집계하는 공용 함수
async function getCongestionForMap(mapId) {
  const recent = new Date(Date.now() - 5 * 60 * 1000); // 최근 5분

  const agg = await ScannerReading.aggregate([
    {
      $match: {
        mapId: new mongoose.Types.ObjectId(mapId),
        ts: { $gte: recent },
      },
    },
    { $group: { _id: "$zone", count: { $sum: 1 } } },
  ]);

  return Object.fromEntries(agg.map(a => [a._id, a.count]));
}

router.post("/", async (req, res) => {
  try {
    const { scannerId, mapId, beacons = [] } = req.body;

    if (!scannerId || !mapId || beacons.length === 0) {
      return res.status(400).json({ error: "scannerId, mapId, beacons 필수" });
    }

    // 1. DB에서 비콘 정보 조회 (.lean()을 통한 쿼리 오버헤드 최소화)
    const dbBeacons = await Beacon.find({ mapId }).lean();

    if (process.env.NODE_ENV !== "production") {
      console.log("========================================");
      console.log("📍 [수신] 요청 mapId:", mapId);
      console.log("📡 [DB] 조회된 비콘 수:", dbBeacons.length);
      console.log("📡 [DB] 등록된 비콘 ID 리스트:", dbBeacons.map(b => b.beaconId));
      console.log("📶 [안드로이드] 전송된 readings ID 리스트:", beacons.map(b => b.beaconId));
      console.log("========================================");
    }

    if (dbBeacons.length === 0) {
      return res.json({
        status: "insufficient_data",
        message: "해당 mapId로 등록된 비콘이 DB에 존재하지 않습니다.",
        debug: { reason: "mapId_mismatch", requestedMapId: mapId }
      });
    }

    // 2. Beacon Map 생성 (대소문자/공백 제거 정규화)
    const beaconMap = new Map(dbBeacons.map(b => [
      String(b.beaconId).trim().toUpperCase(),
      { x: b.x, y: b.y, txPower: b.txPower },
    ]));

    const readings = beacons.slice(0, 6).map(b => ({
      beaconId: String(b.beaconId).trim().toUpperCase(),
      rssi: Number(b.rssi),
      distance: Number(b.distance),
    }));

    const matchedTest = readings.filter(r => beaconMap.has(r.beaconId));

    // 3. Loose-Coupled 위치 추정 모듈 실행 (scannerId 파라미터 추가로 EMA 세션 추적 보장)
    const result = estimateLocation(readings, beaconMap, String(scannerId));

    if (!result) {
      return res.json({ 
        status: "insufficient_data", 
        message: "유효 비콘 부족(최소 매칭 수 미달)",
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

    // 4. ⚡ [최우선 처리] Socket.io 실시간 위치 전파 (대기시간 0ms 지향)
    const io = req.app.get("io");
    if (io) {
      const payload = {
        scannerId,
        mapId,
        x: result.x,
        y: result.y,
        zone: result.zone,
        confidence: result.confidence,
        usedBeacons: result.usedBeacons,
      };

      // Room 단절 대비: mapId Room과 전역 io에 모두 즉시 발송
      io.to(mapId).emit("location_update", payload);
      io.emit("location_update", payload);
    }

    // 🎯 디버그용 콘솔 출력
    console.log("🎯 [계산된 위치]", result.x, result.y, result.zone);

    // 5. ⚡ [즉시 응답] 안드로이드 앱으로 HTTP OK 응답 반환하여 Network Latency 최소화
    res.json({ status: "ok", scannerId, location: result });

    // 6. 🟢 [Non-blocking 백그라운드 처리] DB 적재 및 무거운 혼잡도 연산은 응답 후 비동기 처리
    setImmediate(async () => {
      // (1) 비콘 로그 적재
      const logEntries = readings
        .filter(r => beaconMap.has(r.beaconId) && r.rssi > -100)
        .map(r => {
          const info = beaconMap.get(r.beaconId);
          return {
            beaconId: r.beaconId,
            x: info.x,
            y: info.y,
            rssi: r.rssi,
            sessionId: String(scannerId),
          };
        });

      if (logEntries.length > 0) {
        BeaconLog.insertMany(logEntries).catch(err => {
          console.error("❌ BeaconLog 적재 실패:", err.message);
        });
      }

      // (2) ScannerReading 적재
      try {
        await ScannerReading.create({ 
          scannerId: String(scannerId), 
          mapId, 
          zone: result.zone, 
          x: result.x, 
          y: result.y 
        });
      } catch (dbErr) {
        console.error("⚠️ ScannerReading 백그라운드 저장 실패:", dbErr.message);
      }

      // (3) 혼잡도 재계산 및 발송
      if (io) {
        try {
          const congestion = await getCongestionForMap(mapId);
          io.to(mapId).emit("congestion_update", { mapId, congestion });
          io.emit("congestion_update", { mapId, congestion });
        } catch (err) {
          console.error("⚠️ 혼잡도 재계산 실패:", err.message);
        }
      }
    });

  } catch (err) {
    console.error("❌ /api/location 라우터 치명적 에러:", err);
    return res.status(500).json({ error: "내부 서버 오류가 발생했습니다." });
  }
});

// GET /api/location/congestion/:mapId
router.get("/congestion/:mapId", async (req, res) => {
  try {
    const congestion = await getCongestionForMap(req.params.mapId);
    res.json({ congestion });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;