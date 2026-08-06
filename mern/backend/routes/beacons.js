/**
 * routes/beacons.js — 비콘 CRUD + visible toggle
 */
import { Router } from "express";
import { Beacon } from "../models/index.js";
import { adminAuth } from "../middleware/adminAuth.js";

const router = Router();

// 비콘 전체 목록 및 단건 조회
router.get("/", async (req, res) => res.json(await Beacon.find(req.query)));
router.get("/:id", async (req, res) => res.json(await Beacon.findById(req.params.id)));

// 등록/수정/삭제 (관리자 전용)
router.post("/", adminAuth, async (req, res) => res.json(await Beacon.create(req.body)));
router.put("/:id", adminAuth, async (req, res) => res.json(await Beacon.findByIdAndUpdate(req.params.id, req.body, { new: true })));
router.delete("/:id", adminAuth, async (req, res) => { 
  await Beacon.findByIdAndDelete(req.params.id); 
  res.json({ ok: true }); 
});

// 가시성 ON/OFF 토글 (관리자 전용) - 쉼표(,) 추가 수정 완료
router.patch("/:id/visible", adminAuth, async (req, res) => {
  try {
    const b = await Beacon.findById(req.params.id);
    if (!b) {
      return res.status(404).json({ error: "해당 비콘을 찾을 수 없습니다." });
    }
    b.visible = !b.visible;
    await b.save();
    res.json({ beaconId: b.beaconId, visible: b.visible });
  } catch (err) {
    res.status(500).json({ error: "비콘 가시성 토글 실패: " + err.message });
  }
});

export default router;