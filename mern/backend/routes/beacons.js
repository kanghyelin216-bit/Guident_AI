/**
 * routes/beacons.js — 비콘 CRUD, 좌표 직접 입력(Upsert), 가시성 토글
 */
import { Router } from "express";
import { Beacon } from "../models/index.js";
import { adminAuth } from "../middleware/adminAuth.js";

const router = Router();

/**
 * 1. 비콘 목록 조회 (Query 필터 지원, 예: ?mapId=...)
 */
router.get("/", async (req, res) => {
  try {
    const filter = {};
    if (req.query.mapId) filter.mapId = req.query.mapId;
    const beacons = await Beacon.find(filter);
    res.json(beacons);
  } catch (err) {
    res.status(500).json({ error: "비콘 목록 조회 실패: " + err.message });
  }
});

/**
 * 2. 특정 맵 기준 비콘 조회 (직관적인 엔드포인트)
 */
router.get("/map/:mapId", async (req, res) => {
  try {
    const beacons = await Beacon.find({ mapId: req.params.mapId });
    res.json(beacons);
  } catch (err) {
    res.status(500).json({ error: "맵 별 비콘 조회 실패: " + err.message });
  }
});

/**
 * 3. 단건 비콘 조회
 */
router.get("/:id", async (req, res) => {
  try {
    const beacon = await Beacon.findById(req.params.id);
    if (!beacon) {
      return res.status(404).json({ error: "해당 비콘을 찾을 수 없습니다." });
    }
    res.json(beacon);
  } catch (err) {
    res.status(500).json({ error: "비콘 조회 실패: " + err.message });
  }
});

/**
 * 4. 비콘 등록 및 수정 (Upsert 방식) — 관리자 전용
 * - beaconId가 이미 존재하면 좌표(x, y), txPower, label 등을 업데이트하고, 없으면 새로 생성합니다.
 * - 관리자 페이지에서 텍스트 입력 후 저장할 때 중복 에러 없이 안전하게 반영됩니다.
 */
router.post("/", adminAuth, async (req, res) => {
  try {
    const { beaconId, x, y, txPower = -59, mapId, label, visible = true } = req.body;

    if (!beaconId || x === undefined || y === undefined || !mapId) {
      return res.status(400).json({ error: "beaconId, x, y, mapId는 필수 입력 항목입니다." });
    }

    const normalizedBeaconId = String(beaconId).trim().toUpperCase();

    const updatedBeacon = await Beacon.findOneAndUpdate(
      { beaconId: normalizedBeaconId },
      {
        x: Number(x),
        y: Number(y),
        txPower: Number(txPower),
        mapId,
        label: label || "",
        visible: Boolean(visible),
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    res.json({ ok: true, beacon: updatedBeacon });
  } catch (err) {
    res.status(500).json({ error: "비콘 저장/수정 실패: " + err.message });
  }
});

/**
 * 5. 비콘 정보 수정 (ID 기반 PUT) — 관리자 전용
 */
router.put("/:id", adminAuth, async (req, res) => {
  try {
    const { beaconId, x, y, txPower, mapId, label, visible } = req.body;
    const updateData = {};

    if (beaconId !== undefined) updateData.beaconId = String(beaconId).trim().toUpperCase();
    if (x !== undefined) updateData.x = Number(x);
    if (y !== undefined) updateData.y = Number(y);
    if (txPower !== undefined) updateData.txPower = Number(txPower);
    if (mapId !== undefined) updateData.mapId = mapId;
    if (label !== undefined) updateData.label = label;
    if (visible !== undefined) updateData.visible = Boolean(visible);

    const beacon = await Beacon.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true }
    );

    if (!beacon) {
      return res.status(404).json({ error: "수정할 비콘을 찾을 수 없습니다." });
    }

    res.json({ ok: true, beacon });
  } catch (err) {
    res.status(500).json({ error: "비콘 수정 실패: " + err.message });
  }
});

/**
 * 6. 비콘 삭제 — 관리자 전용
 */
router.delete("/:id", adminAuth, async (req, res) => {
  try {
    const deleted = await Beacon.findByIdAndDelete(req.params.id);
    if (!deleted) {
      return res.status(404).json({ error: "삭제할 비콘을 찾을 수 없습니다." });
    }
    res.json({ ok: true, message: "비콘이 삭제되었습니다." });
  } catch (err) {
    res.status(500).json({ error: "비콘 삭제 실패: " + err.message });
  }
});

/**
 * 7. 비콘 가시성 ON/OFF 토글 — 관리자 전용
 */
router.patch("/:id/visible", adminAuth, async (req, res) => {
  try {
    const b = await Beacon.findById(req.params.id);
    if (!b) {
      return res.status(404).json({ error: "해당 비콘을 찾을 수 없습니다." });
    }
    b.visible = !b.visible;
    await b.save();
    res.json({ ok: true, beaconId: b.beaconId, visible: b.visible });
  } catch (err) {
    res.status(500).json({ error: "비콘 가시성 토글 실패: " + err.message });
  }
});

export default router;