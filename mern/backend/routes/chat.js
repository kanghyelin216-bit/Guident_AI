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

    // 1. 가장 최근 위치 추정 기록에서 zone 가져오기
    const lastReading = await ScannerReading.findOne({ scannerId }).sort({ ts: -1 });
    const zone = lastReading?.zone || "unknown";

    // 2. 사용자의 메시지 DB 저장
    await ChatHistory.create({ scannerId, role: "user", message, zone });

    // 3. 최근 6개의 대화 기록을 불러와 연속적인 대화 맥락 유지
    const pastChats = await ChatHistory.find({ scannerId })
      .sort({ createdAt: -1 })
      .limit(6);

    // Groq 메시지 포맷에 맞게 정렬 (오래된 순)
    const formattedHistory = pastChats.reverse().map(chat => ({
      role: chat.role === "assistant" ? "assistant" : "user",
      content: chat.message
    }));

    // 4. 친근하고 상냥한 페르소나 설정 (System Instruction)
    const systemInstruction = `당신은 스마트 가이드 "Guidant"입니다. 방문객을 위한 다정하고 친근한 챗봇 서비스예요.

[기본 규칙]
1. 말투: 딱딱한 안내문 대신 다정하고 매끄러운 톤(~해요, ~해볼까요?, ~랍니다)으로 말해주세요.
2. 표현: 상황에 어울리는 귀여운 이모지(🧭, 📍, ✨, 😊 등)를 적극 활용하세요.
3. 위치 기반 안내: 현재 사용자의 위치 구역은 '${zone}'입니다. 이 정보를 자연스럽게 참고해 안내하세요.
4. 답변 길이: 읽기 편하도록 2~3문장 이내로 명확하고 짧게 작성하세요.

[졸업전시회장 기본 데이터]
- 전시회명: 2026 소프트웨어학과 졸업전시회 (가이던트)
- 전시 공간: A~F 총 6개 구역, 구역당 캡스톤 프로젝트 1팀씩 전시

[전시 구역별 프로젝트 안내]
- A구역: 모락(Morak) — AI가 냉장고 속 재료 사진을 인식해서 맞춤 레시피를 추천해주는 앱이에요.
- B구역: 가이던트(Guidant) — 비콘 기반 실내 위치 추정 기술로 방문객의 현재 구역을 파악해 맞춤 안내를 제공하는 AI 챗봇이에요.
- C구역: 캠퍼스메이트 — 시간표, 동아리, 학식 정보를 한 곳에 모은 학생 생활 PWA예요.
- D구역: 트래블노트AI — 여행 사진을 올리면 AI가 자동으로 감성 여행 일지를 작성해줘요.
- E구역: 핏로그 — 카메라로 운동 자세를 분석하고 실시간으로 교정해주는 헬스케어 앱이에요.
- F구역: 북적북적 — 취향 기반으로 독서 모임을 매칭하고 실시간 토론까지 가능한 커뮤니티 서비스예요.

[안내 시 참고사항]
- 방문객이 특정 프로젝트나 구역을 물어보면 위 데이터를 바탕으로 정확히 안내해주세요.
- 방문객의 현재 구역(zone)과 목적지 구역이 다르면 간단한 이동 안내를 해주세요 (예: "○○구역에서 옆으로 이동하시면 돼요").
- 위 데이터에 없는 정보(수상 결과, 세부 기술 스택, 팀원 명단 등)는 추측하지 말고 "안내데스크에 문의해 주세요😊"라고 답해주세요.`;

    // 5. Groq AI 요청 생성
    const completion = await groq.chat.completions.create({
      messages: [
        { role: "system", content: systemInstruction },
        ...formattedHistory
      ],
      model: "openai/gpt-oss-120b",
      temperature: 0.7, // 친근하고 풍부한 표현을 위해 약간 올림
      max_tokens: 500,
    });

    const reply = completion.choices[0]?.message?.content
      || "앗, 잠시 생각이 엉켰어요! 다시 한번 말씀해 주실래요? 😅";

    // 6. AI 답변 DB 저장
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