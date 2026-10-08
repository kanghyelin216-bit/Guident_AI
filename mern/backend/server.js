/**
 * server.js — MERN 백엔드 진입점 (몽고DB + Socket.io + 비콘 위치추정 통합본)
 *
 * ⚠️ 변경 사항 (핵심 파이프라인 수정):
 * - 가짜 위치추정 스텁(GridPositionEstimator, /beacon, /beacon/:userId)을 제거했습니다.
 *   실제 위치추정은 routes/location.js 의 POST /api/location 하나로 일원화됩니다.
 * - 인메모리 전용 /chat 엔드포인트를 제거했습니다.
 *   AI 대화는 routes/chat.js 의 POST /api/chat 하나로 일원화됩니다. (DB에 대화이력 저장됨)
 * - io(Socket.io 서버 인스턴스)를 app.set("io", io) 로 등록해서, 개별 라우터 파일에서
 *   req.app.get("io") 로 꺼내 실시간 브로드캐스트를 할 수 있게 했습니다.
 * - [추가 및 보완]: 안드로이드와 프론트엔드의 mapId 싱크 불일치 문제를 해결하기 위한
 *   활성 맵 폴백 API(/api/maps/active) 라우트 호환성을 완벽히 조율했습니다.
 *
 * ✅ 2026-10-08 배포 대응 수정:
 * - [Cannot GET / 해결] 프론트엔드(React/Vite) 빌드 결과물 정적 서빙 + SPA 폴백 추가
 * - [기동 블로킹 해결] httpServer.listen() 을 DB 연결보다 먼저 실행.
 *   DB가 안 붙는 네트워크(27017 차단)에서도 서버와 화면은 즉시 동작합니다.
 * - [무한 대기 방지] serverSelectionTimeoutMS 5초 적용, DB 실패 시 process.exit 하지 않음
 * - [로컬 DNS 우회] 공용 DNS 강제는 로컬에서만 적용, Render에서는 미적용
 */

// ==========================================
// 1. 환경 변수 및 DNS (최상단에서 즉시 실행)
// ==========================================
import "dotenv/config";
import dns from "dns";

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

// ==========================================
// 2. 라우터 임포트
// ==========================================
import locationRoutes  from "./routes/location.js";
import beaconRoutes    from "./routes/beacons.js";
import mapRoutes       from "./routes/maps.js";
import navRoutes       from "./routes/navigation.js";
import chatRoutes      from "./routes/chat.js";
import authRoutes      from "./routes/auth.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

// ==========================================
// 🚀 Socket.io 서버 초기화
// ==========================================
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

// ==========================================
// 3. 미들웨어 설정
// ==========================================
app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "PUT", "DELETE"],
  credentials: true,
}));
app.use(express.json());
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// 🔌 라우터들이 req.app.get('io')로 소켓 서버에 접근할 수 있도록 등록
app.set("io", io);

// ==========================================
// 4. REST API 엔드포인트 등록
// ==========================================

// 📍 활성 맵 폴백 API — 안드로이드/프론트 mapId 싱크 불일치 대응
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

// 헬스체크 (DB 연결 상태까지 함께 보고)
app.get("/health", (_, res) => {
  const states = ["disconnected", "connected", "connecting", "disconnecting"];
  res.json({
    status: "ok",
    db: states[mongoose.connection.readyState] ?? "unknown",
    timestamp: new Date(),
  });
});

// ==========================================
// 4-1. 프론트엔드(React/Vite) 정적 서빙 + SPA 폴백
//      ⚠️ 반드시 모든 API 라우트 "뒤"에 위치해야 합니다.
// ==========================================
const clientDist = path.join(__dirname, "../frontend/dist");
const indexHtml  = path.join(clientDist, "index.html");

console.log("📁 clientDist 경로:", clientDist);
console.log("📁 index.html 존재?:", fs.existsSync(indexHtml));

app.use(express.static(clientDist));

// api / uploads / socket.io / health 를 제외한 모든 GET → index.html (SPA 라우팅)
app.get(/^\/(?!api\/|uploads\/|socket\.io\/|health).*/, (req, res) => {
  if (!fs.existsSync(indexHtml)) {
    return res
      .status(500)
      .send(`프론트엔드 빌드 결과물이 없습니다: ${indexHtml}\n\nfrontend 폴더에서 'npm run build' 를 먼저 실행하세요.`);
  }
  res.sendFile(indexHtml);
});

// ==========================================
// 5. 웹소켓 실시간 커넥션 관리
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
// 6. 서버 기동 → 그 다음 DB 연결
//    ⚠️ 순서가 핵심입니다. DB를 기다리지 않고 포트를 먼저 엽니다.
// ==========================================
const PORT = process.env.PORT || 4000;
const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
  console.error("❌ [CRITICAL] 에러: .env 파일에 MONGO_URI가 정의되지 않았습니다.");
  process.exit(1);
}

// (1) 서버 먼저 기동 — DB 상태와 무관하게 화면은 즉시 동작
httpServer.listen(PORT, "0.0.0.0", () => {
  console.log("==================================================");
  console.log("🚀 MERN 실시간 위치기반 스마트관광 통합 백엔드 가동 완료");
  console.log(`👉 http://localhost:${PORT}  (0.0.0.0 전체 인터페이스 개방)`);
  console.log("📱 안드로이드 비콘 스캐너 및 리액트 소켓 동기화 활성화");
  console.log("==================================================");
});

// (2) DB는 뒤에서 비동기로 연결 — 실패해도 서버는 죽지 않음
mongoose
  .connect(MONGO_URI, { serverSelectionTimeoutMS: 5000 })
  .then(() => {
    console.log("🍃 [MongoDB] 데이터베이스 연결에 성공하였습니다.");
  })
  .catch((err) => {
    console.error("⚠️ [WARN] DB 연결 실패 — 서버/화면은 정상 동작합니다:", err.message);
    console.error("   (현재 네트워크가 27017 포트를 차단했을 가능성이 높습니다. Render 배포 환경에서는 정상 연결됩니다.)");
  });

// 연결이 끊겼다 붙을 때 로그로 확인 가능하도록
mongoose.connection.on("connected",    () => console.log("🍃 [MongoDB] connected"));
mongoose.connection.on("disconnected", () => console.warn("⚠️ [MongoDB] disconnected"));
mongoose.connection.on("error",        (e) => console.error("⚠️ [MongoDB] error:", e.message));
