/**
 * server.js — MERN 백엔드 진입점 (몽고DB + Socket.io + 비콘 위치추정 통합본)
 *
 * ⚠️ 변경 사항 (핵심 파이프라인 수정):
 *  - 가짜 위치추정 스텁(GridPositionEstimator, /beacon, /beacon/:userId)을 제거했습니다.
 *    실제 위치추정은 routes/location.js 의 POST /api/location 하나로 일원화됩니다.
 *  - 인메모리 전용 /chat 엔드포인트를 제거했습니다.
 *    AI 대화는 routes/chat.js 의 POST /api/chat 하나로 일원화됩니다. (DB에 대화이력 저장됨)
 *  - io(Socket.io 서버 인스턴스)를 app.set("io", io) 로 등록해서, 개별 라우터 파일에서
 *    req.app.get("io") 로 꺼내 실시간 브로드캐스트를 할 수 있게 했습니다.
 */

// 1. 최상단에서 환경 변수를 즉시 로드 (라우터들이 import 되기 전에 무조건 실행됨)
import "dotenv/config";

import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import path from "path";
import { fileURLToPath } from "url";
import { createServer } from "http";
import { Server } from "socket.io";

// 2. 라우터 임포트 (기존 몽고DB 기반 라우터들)
import locationRoutes  from "./routes/location.js";
import beaconRoutes    from "./routes/beacons.js";
import mapRoutes       from "./routes/maps.js";
import navRoutes       from "./routes/navigation.js";
import chatRoutes      from "./routes/chat.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

// ==========================================
// 🚀 Socket.io 서버 초기화
// ==========================================
const httpServer = createServer(app);
// 웹소켓 CORS 정책 전면 허용
const io = new Server(httpServer, {
    cors: { origin: '*' }
});

// 3. 미들웨어 설정
app.use(cors());
app.use(express.json());
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// 🔌 라우터들이 req.app.get('io')로 소켓 서버에 접근할 수 있도록 등록
//    (routes/location.js 에서 실시간 위치/혼잡도 브로드캐스트에 사용)
app.set("io", io);

// ==========================================
// 4. REST API 엔드포인트 등록
// ==========================================
app.use("/api/location",   locationRoutes);
app.use("/api/beacons",    beaconRoutes);
app.use("/api/maps",       mapRoutes);
app.use("/api/navigation", navRoutes);
app.use("/api/chat",       chatRoutes);

// 헬스체크 및 인프라 모니터링용 엔드포인트
app.get("/health", (_, res) => res.json({ status: "ok", timestamp: new Date() }));

// ==========================================
// 5. 웹소켓 실시간 커넥션 관리
// ==========================================
io.on('connection', (socket) => {
    console.log('🌐 웹앱 소켓 연결 성공! ID:', socket.id);

    socket.on('disconnect', () => {
        console.log('❌ 웹앱 소켓 연결 종료:', socket.id);
    });
});

// ==========================================
// 6. 서버 초기화 및 데이터베이스 연결
// ==========================================
const PORT = process.env.PORT || 4000;
const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
  console.error("❌ [CRITICAL] 에러: .env 파일에 MONGO_URI가 정의되지 않았습니다.");
  process.exit(1);
}

// 비동기 즉시 실행 함수(IIFE)로 DB 연결과 서버 바인딩 제어
(async () => {
  try {
    await mongoose.connect(MONGO_URI);
    console.log("🍃 [MongoDB] 데이터베이스 연결에 성공하였습니다.");

    // 외부 IP 전면 개방을 위해 '0.0.0.0' 주소 지정하여 httpServer 가동
    httpServer.listen(PORT, '0.0.0.0', () => {
        console.log('==================================================');
        console.log(`🚀 MERN 실시간 위치기반 스마트관광 통합 백엔드 가동 완료`);
        console.log(`👉 포트번호: ${PORT} | 모든 네트워크 인터페이스(0.0.0.0) 개방`);
        console.log(`📱 안드로이드 비콘 스캐너 및 리액트 소켓 동기화 활성화`);
        console.log('==================================================');
    });
  } catch (err) {
    console.error("❌ [CRITICAL] 데이터베이스 연결 실패 또는 서버 가동 에러:", err);
    process.exit(1);
  }
})();