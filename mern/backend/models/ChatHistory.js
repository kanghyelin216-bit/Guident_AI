// models/ChatHistory.js
import mongoose from "mongoose";

const ChatHistorySchema = new mongoose.Schema(
  {
    // 기기 식별자: 위치 조회 및 기기별 기록 구분
    scannerId: {
      type: String,
      required: true,
    },

    // 대화 식별자: 새 대화를 시작할 때마다 다른 ID 사용
    // 기존 기록은 이 필드가 없으므로 null로 취급
    conversationId: {
      type: String,
      default: null,
    },

    role: {
      type: String,
      enum: ["user", "assistant"],
      required: true,
    },

    message: {
      type: String,
      required: true,
    },

    // 메시지 저장 당시 사용자 위치
    zone: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// 기기별 전체 기록 조회
ChatHistorySchema.index({
  scannerId: 1,
  createdAt: 1,
});

// 특정 대화의 기록 조회 및 삭제
ChatHistorySchema.index({
  scannerId: 1,
  conversationId: 1,
  createdAt: 1,
});

export const ChatHistory = mongoose.model(
  "ChatHistory",
  ChatHistorySchema
);
