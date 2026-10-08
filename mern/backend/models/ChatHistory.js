import mongoose from "mongoose";

// 기기 ID와 대화 ID를 함께 저장하여 같은 기기의 여러 대화를 구분
const ChatHistorySchema = new mongoose.Schema({
  scannerId: { type: String, required: true },       // 기기·위치 조회용 ID
  conversationId: { type: String, default: null },   // 대화 묶음 ID, 기존 기록은 null
  role: { type: String, enum: ["user", "assistant"], required: true },
  message: { type: String, required: true },         // 질문 또는 AI 답변
  zone: { type: String, default: null },             // 저장 당시 사용자 위치
}, { timestamps: true }); // createdAt, updatedAt 자동 생성

// 기기별 기록 및 특정 대화의 시간순 조회를 위한 인덱스
ChatHistorySchema.index({ scannerId: 1, createdAt: 1 });
ChatHistorySchema.index({ scannerId: 1, conversationId: 1, createdAt: 1 });

export const ChatHistory = mongoose.model("ChatHistory", ChatHistorySchema);
