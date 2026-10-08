import { Router } from "express";
import Groq from "groq-sdk";
import { ChatHistory, ScannerReading } from "../models/index.js";
import fs from "fs/promises";
import path from "path";
import { fileURLtoPath } from "url";


const router = Router();
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "../data");

let infoCache = { signature: "", text: "" };

async function loadInfo() {
  try {
    const names = (await fs.readdir(DATA_DIR))
      .filter(name => name.endsWith(".txt"))
      .sort();

    const stats = await Promise.all(
      names.map(async name => ({ name, mtimeMs: (await fs.stat(path.join(DATA_DIR, name))).mtimeMs }))
    );
    const signature = stats.map(s => `${s.name}:${s.mtimeMs}`).join("|");

    if (signature !== infoCache.signature) {
      const texts = await Promise.all(
        names.map(async name => {
          const content = await fs.readFile(path.join(DATA_DIR, name), "utf-8");
          return `[${name.replace(".txt", "")}]\n${content.trim()}`;
        })
      );
      infoCache = { signature, text: texts.join("\n\n") };
    }
  } catch (err) {
    console.error("정보 파일 읽기 실패:", err);
  }
  return infoCache.text;
}

function validId(value) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 200;
}

function conversationFilter(scannerId, conversationId) {
  return { scannerId, conversationId: conversationId === "legacy" ? null : conversationId };
}

function systemInstruction(zone, info) {
  return `당신은 스마트 가이드 "Guidant"입니다. 방문객을 위한 다정하고 친근한 챗봇 서비스예요.

[기본 규칙]
1. 다정하고 매끄러운 말투(~해요, ~해볼까요?, ~랍니다)를 사용하세요.
2. 상황에 어울리는 이모지(🧭, 📍, ✨, 😊 등)를 활용하세요.
3. 현재 사용자 위치 구역은 '${zone}'입니다.
4. 답변은 읽기 편하도록 2~3문장 이내로 작성하세요.
5. unknown이거나 구역 의미를 알 수 없으면 위치를 단정하지 마세요.
6. 반드시 아래 [참고 자료]에 있는 내용만 근거로 답하세요.
7. 참고 자료에 없는 내용(운영 시간 변경, 체험 대기 현황 등)은 "안내데스크에 문의해 주세요😊"라고 답하세요.
8. 실제 통로 정보가 없으므로 왼쪽/오른쪽 등 이동 방향을 추측하지 마세요.
9. 작품이나 체험을 물어보면 해당 구역과 팀 번호, 작품 소개를 안내하세요.
10. 굿즈 판매는 없으니, 물어보면 판매하지 않고 관람과 체험만 가능하다고 안내하세요.

[참고 자료]
${info || "(참고 자료를 불러오지 못했어요)"}`;
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
    const info = await loadInfo();
    console.log("읽은 자료 길이:", info.length);
    const pastChats = await ChatHistory.find({ scannerId, conversationId })
      .sort({ createdAt: -1, _id: -1 }).limit(6).lean();
    const history = pastChats.reverse().map(chat => ({ role: chat.role, content: chat.message }));

    await ChatHistory.create({ scannerId, conversationId, role: "user", message: userText, zone });

    const completion = await groq.chat.completions.create({
      messages: [
        { role: "system", content: systemInstruction(zone, info) },
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
