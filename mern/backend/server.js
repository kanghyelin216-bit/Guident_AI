/**
 * server.js — MERN 백엔드 진입점 (Render 배포 대응 최종본)
 *
 * 이번 수정 요약
 * 1) DNS 강제 지정(8.8.8.8 / 1.1.1.1)은 로컬·Render 모두 항상 적용 (기존 동작 유지)
 * 2) process.chdir(__dirname) + uploads 폴더 자동 생성
 *    → 어디서 `node backend/server.js` 로 실행해도 업로드 경로가 어긋나지 않음
 * 3) 프론트 dist 경로를 여러 후보에서 자동 탐색 + /health 에 빌드 여부 표시
 * 4) index.html / sw.js 는 캐시 금지 (PWA가 옛 빌드에 갇히는 문제 방지)
 * 5) CORS 에 PATCH 추가 (비콘 표시 토글)
 * 6) /api 로 시작하는 없는 주소는 JSON 404 (SPA index.html 로 새지 않음)
 * 7) DB 최초 연결 실패 시 서버는 살아있고 자동 재시도
 * 8) 처리되지 않은 예외로 서버가 죽지 않도록 보호, SIGTERM 정상 종료
 */

// ==========================================
// 1. 환경 변수 및 DNS
// ==========================================
import "dotenv/config";
import dns from "dns";

// ⚠️ 삭제 금지: Node 의 DNS 서버가 127.0.0.1 로 잡혀 있으면
//    MongoDB Atlas SRV 조회가 `querySrv ECONNREFUSED` 로 실패하고,
//    그 결과 `buffering timed out` 이 발생함. (nslookup 은 정상이어도 Node 만 실패)
//    로컬/Render 모두 항상 적용해서 동작이 확인된 설정이므로 그대로 유지.
dns.setServers(["8.8.8.8", "1.1.1.1"]);
console.log("🌐 Node DNS:", dns.getServers());

import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { createServer } from "http";
import { Server } from "socket.io";

import locationRoutes  from "./routes/location.js";
import beaconRoutes    from "./routes/beacons.js";
import mapRoutes       from "./routes/maps.js";
import navRoutes       from "./routes/navigation.js";
import chatRoutes      from "./routes/chat.js";
import authRoutes      from "./routes/auth.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// multer 가 상대경로 "uploads/" 를 쓰므로 작업 디렉터리를 backend 로 고정
process.chdir(__dirname);
const UPLOAD_DIR = path.join(__dirname, "uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const app = express();
app.set("trust proxy", 1); // Render 프록시 뒤에서 동작

// ==========================================
// 2. Socket.io
// ==========================================
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "*", methods: ["GET", "POST"] },
});

// ==========================================
// 3. 미들웨어
// ==========================================
app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
}));
app.use(express.json({ limit: "2mb" }));
app.use("/uploads", express.static(UPLOAD_DIR));

app.set("io", io);

// ==========================================
// 4. REST API
// ==========================================
app.get("/api/maps/active", async (req, res) => {
  try {
    const activeMap = await mongoose.connection.db
      .collection("maps")
      .findOne({}, { sort: { createdAt: -1 } });

    if (!activeMap) {
      return res.status(404).json({
        error: "등록된 지도가 존재하지 않습니다. 관리자 화면에서 최초 지도를 업로드하세요.",
      });
    }
    res.json({
      mapId: activeMap._id.toString(),
      name: activeMap.name,
      imageUrl: activeMap.imageUrl,
      widthM: activeMap.widthM,
      heightM: activeMap.heightM,
    });
  } catch (error) {
    res.status(500).json({ error: "활성 맵 로드 중 서버 에러: " + error.message });
  }
});

app.use("/api/location",   locationRoutes);
app.use("/api/beacons",    beaconRoutes);
app.use("/api/maps",       mapRoutes);
app.use("/api/navigation", navRoutes);
app.use("/api/chat",       chatRoutes);
app.use("/api/auth",       authRoutes);

// 존재하지 않는 API 는 JSON 404 (아래 SPA 폴백으로 새지 않게)
app.use("/api", (req, res) => {
  res.status(404).json({ error: `API 없음: ${req.method} ${req.originalUrl}` });
});

// ==========================================
// 4-1. 프론트엔드 정적 서빙 + SPA 폴백 (API 라우트 "뒤")
// ==========================================
const clientCandidates = [
  path.join(__dirname, "../frontend/dist"),
  path.join(__dirname, "../dist"),
  path.join(__dirname, "dist"),
  path.join(__dirname, "public"),
];
const clientDist =
  clientCandidates.find((d) => fs.existsSync(path.join(d, "index.html"))) ||
  clientCandidates[0];
const indexHtml = path.join(clientDist, "index.html");
const clientBuilt = fs.existsSync(indexHtml);

console.log("📁 clientDist 경로:", clientDist);
console.log("📁 index.html 존재?:", clientBuilt);
if (!clientBuilt) {
  console.warn("⚠️ 프론트 빌드 결과물이 없습니다. Render Build Command 에 frontend 빌드가 포함됐는지 확인하세요.");
}

// 헬스체크 (Render Health Check Path 를 /health 로 지정)
app.get("/health", (_, res) => {
  const states = ["disconnected", "connected", "connecting", "disconnecting"];
  res.json({
    status: "ok",
    db: states[mongoose.connection.readyState] ?? "unknown",
    clientBuilt,
    timestamp: new Date(),
  });
});

const NO_CACHE_FILES = new Set([
  "index.html", "sw.js", "service-worker.js", "registerSW.js",
  "manifest.webmanifest", "manifest.json",
]);

app.use(express.static(clientDist, {
  setHeaders: (res, filePath) => {
    if (NO_CACHE_FILES.has(path.basename(filePath))) {
      res.setHeader("Cache-Control", "no-cache");
    }
  },
}));

app.get(/^\/(?!api\/|uploads\/|socket\.io\/|health).*/, (req, res) => {
  if (!clientBuilt) {
    return res
      .status(500)
      .send(`프론트엔드 빌드 결과물이 없습니다: ${indexHtml}\n\nBuild Command 에서 frontend 를 빌드(npm run build)하세요.`);
  }
  res.setHeader("Cache-Control", "no-cache");
  res.sendFile(indexHtml);
});

// 마지막 안전망: 라우터에서 던진 에러
app.use((err, req, res, next) => {
  console.error("❌ 처리되지 않은 라우트 에러:", err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: "내부 서버 오류가 발생했습니다." });
});

// ==========================================
// 5. 웹소켓
// ==========================================
io.on("connection", (socket) => {
  console.log("🌐 웹앱 소켓 연결 성공! ID:", socket.id);

  socket.on("join_map", (data) => {
    if (data && data.mapId) {
      socket.join(data.mapId);
      console.log(`📡 소켓 [${socket.id}]이 지도 룸 [${data.mapId}]에 입장했습니다.`);
    }
  });

  socket.on("disconnect", () => {
    console.log("❌ 웹앱 소켓 연결 종료:", socket.id);
  });
});

// ==========================================
// 6. 서버 기동 → DB 연결(실패 시 자동 재시도)
// ==========================================
const PORT = process.env.PORT || 4000;
const MONGO_URI = process.env.MONGO_URI;

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log("==================================================");
  console.log("🚀 MERN 실시간 위치기반 스마트관광 통합 백엔드 가동 완료");
  console.log(`👉 포트 ${PORT} (0.0.0.0 전체 인터페이스 개방)`);
  console.log("==================================================");
});

async function connectDB(attempt = 1) {
  if (!MONGO_URI) {
    console.error("❌ [CRITICAL] MONGO_URI 환경변수가 없습니다. Render > Environment 에 추가하세요. (서버/화면만 동작 중)");
    return;
  }
  try {
    await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 5000 });
  } catch (err) {
    const wait = Math.min(30000, 5000 * attempt);
    console.error(`⚠️ [WARN] DB 연결 실패(시도 ${attempt}): ${err.message} — ${wait / 1000}초 후 재시도`);
    setTimeout(() => connectDB(attempt + 1), wait);
  }
}
connectDB();

mongoose.connection.on("connected",    () => console.log("🍃 [MongoDB] connected"));
mongoose.connection.on("disconnected", () => console.warn("⚠️ [MongoDB] disconnected"));
mongoose.connection.on("error",        (e) => console.error("⚠️ [MongoDB] error:", e.message));

// ==========================================
// 7. 프로세스 보호
// ==========================================
process.on("unhandledRejection", (reason) => {
  console.error("⚠️ unhandledRejection:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("⚠️ uncaughtException:", err);
});

// Render 재배포 시 SIGTERM → 정상 종료
process.on("SIGTERM", () => {
  console.log("🛑 SIGTERM 수신, 종료합니다.");
  io.close();
  httpServer.close(() => {
    mongoose.connection.close().finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(0), 8000).unref();
});