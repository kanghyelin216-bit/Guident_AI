/**
 * routes/beacons.js  — 비콘 CRUD + visible toggle
 */
import { Router } from "express";
import { Beacon } from "../models/index.js";

const router = Router();

router.get("/",            async (req, res) => res.json(await Beacon.find(req.query)));
router.get("/:id",         async (req, res) => res.json(await Beacon.findById(req.params.id)));
router.post("/",           async (req, res) => res.json(await Beacon.create(req.body)));
router.put("/:id",         async (req, res) => res.json(await Beacon.findByIdAndUpdate(req.params.id, req.body, { new: true })));
router.delete("/:id",      async (req, res) => { await Beacon.findByIdAndDelete(req.params.id); res.json({ ok: true }); });


// 가시성 on/off 토글
router.patch("/:id/visible", async (req, res) => {
  const b = await Beacon.findById(req.params.id);
  b.visible = !b.visible;
  await b.save();
  res.json({ beaconId: b.beaconId, visible: b.visible });
});

export default router;
