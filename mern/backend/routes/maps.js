/**
 * routes/maps.js  — 지도 이미지 업로드 + CRUD
 */
import { Router } from "express";
import multer from "multer";
import path from "path";
import { Map } from "../models/index.js";
import { adminAuth } from "../middleware/adminAuth.js";


const storage = multer.diskStorage({
  destination: "uploads/",
  filename: (_, file, cb) => cb(null, `map_${Date.now()}${path.extname(file.originalname)}`),
});
const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } }); // 20MB

const router = Router();

// 지도 목록
router.get("/", async (_, res) => res.json(await Map.find({}, "-wallGrid")));

// 지도 상세 (wallGrid 포함)
router.get("/:id", async (req, res) => res.json(await Map.findById(req.params.id)));

// 지도 생성 (이미지 업로드 포함) - 관리자만 
router.post("/", adminAuth, upload.single("image"), async (req, res) => {
  const { name, widthM, heightM, cellSizeM = 1 } = req.body;
  if (!req.file) return res.status(400).json({ error: "이미지 파일 필요" });

  const doc = await Map.create({
    name,
    imageUrl: `/uploads/${req.file.filename}`,
    widthM:   Number(widthM),
    heightM:  Number(heightM),
    cellSizeM:Number(cellSizeM),
    wallGrid: [],
    facilities: [],
  });
  res.json(doc);
});

// wallGrid 업데이트 — 관리자만
router.put("/:id/walls", adminAuth, async (req, res) => {

  const { wallGrid } = req.body;
  const doc = await Map.findByIdAndUpdate(req.params.id, { wallGrid }, { new: true });
  res.json({ ok: true, rows: doc.wallGrid.length });
});

// 시설 포인트 추가/수정 — 관리자만
router.put("/:id/facilities", adminAuth, async (req, res) => {
  const doc = await Map.findByIdAndUpdate(
    req.params.id, { facilities: req.body.facilities }, { new: true }
  );
  res.json(doc.facilities);
});

router.delete("/:id", adminAuth, async (req, res) => {
  await Map.findByIdAndDelete(req.params.id);
  res.json({ ok: true });
});

export default router;
