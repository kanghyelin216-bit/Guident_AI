// models/ChatHistory.js
import mongoose from "mongoose";

const ChatHistorySchema = new mongoose.Schema({
  scannerId: { type: String, required: true },   // 위치 추정과 동일한 식별자 재사용
  role:      { type: String, enum: ["user", "assistant"], required: true },
  message:   { type: String, required: true },
  zone:      { type: String, default: null },     // 질문 당시 사용자 위치(그리드)
}, { timestamps: true });

ChatHistorySchema.index({ scannerId: 1, createdAt: 1 });

export const ChatHistory = mongoose.model("ChatHistory", ChatHistorySchema);