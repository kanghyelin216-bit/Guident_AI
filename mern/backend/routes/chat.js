/**
 * routes/chat.js
 * POST /api/chat — AI 관광 안내 대화 (Groq)
 * Body: { message: string, scannerId: string }
 */
import { Router } from "express";
import Groq from "groq-sdk";
import { ChatHistory, ScannerReading } from "../models/index.js";

const router = Router();
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

router.post("/", async (req, res) => {
  try {
    const { message, scannerId } = req.body;
    if (!message || !scannerId) {
      return res.status(400).json({ error: "message, scannerId 필수" });
    }

    // 가장 최근 위치 추정 기록에서 zone 가져오기 (ScannerReading 재사용)
    const lastReading = await ScannerReading.findOne({ scannerId }).sort({ ts: -1 });
    const zone = lastReading?.zone || "unknown";

    await ChatHistory.create({ scannerId, role: "user", message, zone });

    const systemInstruction = `당신은 스마트 관광 안내 AI "Guidant"입니다. 
사용자의 현재 위치는 그리드 구역 ${zone} 입니다. 
상점 정보, 운영시간, 혼잡도, 사용자의 위치를 고려해 친절하고 간결하게 한국어로 답변하세요.`;

    const completion = await groq.chat.completions.create({
      messages: [
        { role: "system", content: systemInstruction },
        { role: "user", content: message },
      ],
      model: "llama-3.3-70b-versatile",
      temperature: 0.6,
      max_tokens: 500,
    });

    const reply = completion.choices[0]?.message?.content
      || "죄송합니다, 답변을 생성하지 못했습니다.";

    await ChatHistory.create({ scannerId, role: "assistant", message: reply, zone });

    res.json({ reply, zone });
  } catch (err) {
    console.error("Chat 에러:", err);
    res.status(500).json({ error: "AI 응답 중 오류가 발생했습니다." });
  }
});

// GET /api/chat/:scannerId — 과거 대화 이력 조회
router.get("/:scannerId", async (req, res) => {
  const history = await ChatHistory.find({ scannerId: req.params.scannerId })
    .sort({ createdAt: 1 })
    .limit(50);
  res.json(history);
});

export default router;