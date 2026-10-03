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

// 🆕 지도 메타데이터(이름 / 가로·세로 크기 / 셀 크기) 수정 — 이미지 재업로드는 선택사항 — 관리자만
// 기존엔 이 라우트 자체가 없어서 지도 크기를 한 번 잘못 입력하면 삭제 후 재업로드밖에 방법이 없었음
router.put("/:id", adminAuth, upload.single("image"), async (req, res) => {
  try {
    const { name, widthM, heightM, cellSizeM } = req.body;
    const update = {};

    if (name !== undefined && name !== "") update.name = name;
    if (widthM !== undefined && widthM !== "") update.widthM = Number(widthM);
    if (heightM !== undefined && heightM !== "") update.heightM = Number(heightM);
    if (cellSizeM !== undefined && cellSizeM !== "") update.cellSizeM = Number(cellSizeM);

    // 새 이미지 파일을 같이 올렸을 때만 imageUrl 교체 (안 올리면 기존 이미지 유지)
    if (req.file) update.imageUrl = `/uploads/${req.file.filename}`;

    if (Object.keys(update).length === 0) {
      return res.status(400).json({ error: "수정할 값이 없습니다." });
    }

    const doc = await Map.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!doc) return res.status(404).json({ error: "해당 지도를 찾을 수 없습니다." });

    res.json(doc);
  } catch (err) {
    res.status(500).json({ error: "지도 수정 실패: " + err.message });
  }
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