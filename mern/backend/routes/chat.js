import { Router } from "express";
import Groq from "groq-sdk";
import { ChatHistory, ScannerReading } from "../models/index.js";

const router = Router();
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

function validId(value) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 200;
}

function conversationFilter(scannerId, conversationId) {
  return { scannerId, conversationId: conversationId === "legacy" ? null : conversationId };
}

function systemInstruction(zone) {
  return `당신은 스마트 가이드 "Guidant"입니다. 방문객을 위한 다정하고 친근한 챗봇 서비스예요.

[기본 규칙]
1. 다정하고 매끄러운 말투(~해요, ~해볼까요?, ~랍니다)를 사용하세요.
2. 상황에 어울리는 이모지(🧭, 📍, ✨, 😊 등)를 활용하세요.
3. 현재 사용자 위치 구역은 '${zone}'입니다.
4. 답변은 읽기 편하도록 2~3문장 이내로 작성하세요.
5. unknown이거나 구역 의미를 알 수 없으면 위치를 단정하지 마세요.

[졸업전시회장 기본 데이터]
- 전시회명: 2026 소프트웨어학과 졸업전시회 (가이던트)
- A구역(입구/안내): 굿즈 판매대, 브로슈어 수령처, 부모님 선물용 굿즈
- B구역(AI/PWA 모듈): 가이던트(Guidant) 부스, 비콘 체험 존
- C구역(웹/앱 서비스): 캡스톤 프로젝트 1~5번 팀
- D구역(휴게/이벤트): 방명록 작성 구역, 포토존, 음료 제공처
- 학생 제작 키링: 5,000원
- 포토북: 15,000원
- 수제 엽서 세트: 3,000원
- 결제 방법: 온누리상품권/카카오페이

[안내 시 참고사항]
- 굿즈나 선물을 물어보면 A구역, 가격, 결제 방법을 안내하세요.
- 실제 통로 정보가 없으므로 왼쪽/오른쪽 등 이동 방향을 추측하지 마세요.
- 데이터에 없는 가격 변동, 재고 등은 "안내데스크에 문의해 주세요😊"라고 답하세요.`;
}

// 메시지 전송: 현재 대화의 기록만 AI에 전달
router.post("/", async (req, res) => {
  try {
    const { message, scannerId, conversationId } = req.body;
    if (typeof message !== "string" || !message.trim() ||
        !validId(scannerId) || !validId(conversationId) || conversationId === "legacy") {
      return res.status(400).json({ error: "message, scannerId, conversationId를 확인해 주세요." });
    }

    const userText = message.trim();
    if (userText.length > 4000) {
      return res.status(400).json({ error: "메시지는 4,000자 이내로 입력해 주세요." });
    }

    const lastReading = await ScannerReading.findOne({ scannerId }).sort({ ts: -1 });
    const zone = lastReading?.zone || "unknown";
    const pastChats = await ChatHistory.find({ scannerId, conversationId })
      .sort({ createdAt: -1, _id: -1 }).limit(6).lean();
    const history = pastChats.reverse().map(chat => ({ role: chat.role, content: chat.message }));

    await ChatHistory.create({ scannerId, conversationId, role: "user", message: userText, zone });

    const completion = await groq.chat.completions.create({
      messages: [
        { role: "system", content: systemInstruction(zone) },
        ...history,
        { role: "user", content: userText },
      ],
      model: "openai/gpt-oss-120b",
      temperature: 0.7,
      max_tokens: 500,
    });

    const reply = completion.choices[0]?.message?.content || "앗, 다시 한번 말씀해 주실 수 있나요? 😅";
    await ChatHistory.create({ scannerId, conversationId, role: "assistant", message: reply, zone });
    res.json({ reply, zone, conversationId });
  } catch (err) {
    console.error("Chat 에러:", err);
    res.status(500).json({ error: "AI 응답 중 오류가 발생했습니다." });
  }
});

// 보관된 대화 목록
router.get("/conversations/:scannerId", async (req, res) => {
  try {
    const { scannerId } = req.params;
    if (!validId(scannerId)) return res.status(400).json({ error: "scannerId를 확인해 주세요." });

    const conversations = await ChatHistory.aggregate([
      { $match: { scannerId } },
      { $sort: { createdAt: 1, _id: 1 } },
      { $group: {
        _id: { $ifNull: ["$conversationId", null] },
        title: { $first: "$message" },
        updatedAt: { $last: "$createdAt" },
        messageCount: { $sum: 1 },
      } },
      { $sort: { updatedAt: -1 } },
      { $project: {
        _id: 0, conversationId: { $ifNull: ["$_id", "legacy"] },
        title: 1, updatedAt: 1, messageCount: 1,
      } },
    ]);
    res.json(conversations);
  } catch (err) {
    console.error("대화 목록 조회 에러:", err);
    res.status(500).json({ error: "대화 목록을 불러오지 못했습니다." });
  }
});

// 특정 대화 조회
router.get("/conversations/:scannerId/:conversationId", async (req, res) => {
  try {
    const { scannerId, conversationId } = req.params;
    if (!validId(scannerId) || !validId(conversationId)) {
      return res.status(400).json({ error: "대화 식별자를 확인해 주세요." });
    }

    const history = await ChatHistory.find(conversationFilter(scannerId, conversationId))
      .sort({ createdAt: 1, _id: 1 }).lean();
    res.json(history);
  } catch (err) {
    console.error("대화 조회 에러:", err);
    res.status(500).json({ error: "대화를 불러오지 못했습니다." });
  }
});

// 특정 대화의 DB 기록 삭제
router.delete("/conversations/:scannerId/:conversationId", async (req, res) => {
  try {
    const { scannerId, conversationId } = req.params;
    if (!validId(scannerId) || !validId(conversationId)) {
      return res.status(400).json({ error: "대화 식별자를 확인해 주세요." });
    }

    const result = await ChatHistory.deleteMany(conversationFilter(scannerId, conversationId));
    res.json({ success: true, deletedCount: result.deletedCount });
  } catch (err) {
    console.error("대화 삭제 에러:", err);
    res.status(500).json({ error: "대화를 삭제하지 못했습니다." });
  }
});

export default router;
