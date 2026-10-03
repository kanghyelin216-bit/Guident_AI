/**
 * routes/navigation.js
 * POST /api/navigation/path
 * Body: { mapId, fromZone, toFacilityId, avoidCongestion }
 */
import { Router } from "express";
import { Map, ScannerReading } from "../models/index.js";
import { findPath } from "../modules/pathfinder.js";

const router = Router();

router.post("/path", async (req, res) => {
  const { mapId, fromZone, toFacilityId, avoidCongestion = false } = req.body;

  const mapDoc = await Map.findById(mapId);
  if (!mapDoc) return res.status(404).json({ error: "맵 없음" });

  const { wallGrid, facilities, widthM, heightM, cellSizeM } = mapDoc;

  // 목적지 시설 좌표 → 그리드 셀
  const dest = facilities.find(f => f.id === toFacilityId);
  if (!dest) return res.status(404).json({ error: "시설 없음" });

  // zone "R01C02" → [row, col]
  const parseZone = z => {
    const m = z.match(/R(\d+)C(\d+)/);
    return m ? [+m[1], +m[2]] : null;
  };

  const start = parseZone(fromZone);
  const goal  = [Math.floor(dest.y / cellSizeM), Math.floor(dest.x / cellSizeM)];

  if (!start) return res.status(400).json({ error: "fromZone 형식 오류" });

  // 혼잡도 그리드 구성 (최근 5분 ScannerReading 집계)
  let congestionGrid = null;
  if (avoidCongestion) {
    const recent = new Date(Date.now() - 5 * 60 * 1000);
    const agg = await ScannerReading.aggregate([
      { $match: { mapId, ts: { $gte: recent } } },
      { $group: { _id: "$zone", count: { $sum: 1 } } },
    ]);
    const rows = Math.ceil(heightM / cellSizeM);
    const cols = Math.ceil(widthM  / cellSizeM);
    congestionGrid = Array.from({ length: rows }, () => new Array(cols).fill(0));
    for (const { _id, count } of agg) {
      const p = parseZone(_id);
      if (p) congestionGrid[p[0]][p[1]] = count;
    }
  }

  // wallGrid가 없으면 빈 그리드 생성
  const grid = wallGrid?.length ? wallGrid :
    Array.from({ length: Math.ceil(heightM / cellSizeM) },
      () => new Array(Math.ceil(widthM / cellSizeM)).fill(0));

  const pathCells = findPath(grid, congestionGrid, start, goal, avoidCongestion);

  if (!pathCells) return res.json({ found: false, message: "경로 없음" });

  // 셀 좌표 → 미터 좌표 변환 (중심점)
  const pathM = pathCells.map(([r, c]) => ({
    x: (c + 0.5) * cellSizeM,
    y: (r + 0.5) * cellSizeM,
    zone: `R${String(r).padStart(2,"0")}C${String(c).padStart(2,"0")}`,
  }));

  res.json({ found: true, steps: pathM.length, path: pathM });
});

export default router;
