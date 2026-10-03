/**
 * services/proactiveTrigger.js
 * AI가 사용자에게 먼저 말을 거는(선제적 안내) 로직.
 * location.js의 위치 계산과는 완전히 분리되어 있어 조건/모델을 자유롭게 교체 가능.
 */
import Groq from "groq-sdk";
import { ChatHistory } from "../models/ChatHistory.js";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// scannerId별 상태를 메모리에 보관 (추후 Redis로 교체해도 인터페이스 동일하게 유지 가능)
const stateByScanner = new Map();
// { zone, since, lastTriggeredAt, stayHandled, congestionHandled }

const COOLDOWN_MS = 60_000;       // 같은 scannerId에게 최소 이 간격으로만 발화
const STAY_THRESHOLD_MS = 90_000; // 같은 zone에 이 시간 이상 머물면 "괜찮으세요?" 트리거

function canTrigger(prevState) {
  if (!prevState || !prevState.lastTriggeredAt) return true;
  return Date.now() - prevState.lastTriggeredAt > COOLDOWN_MS;
}

async function generateProactiveMessage(reason, zone) {
  const systemPrompt =
    `너는 "Guidant" 전시 안내 AI야. 사용자가 요청하지 않았는데 상황에 맞춰 ` +
    `먼저 말을 거는 중이야. 반드시 한 문장, 20~40자, 친근한 존댓말로 답해.`;

  const userPrompt =
    reason === "enter_zone"
      ? `사용자가 방금 ${zone} 구역에 들어왔어. 자연스럽게 먼저 안내를 건네줘.`
      : reason === "stay_long"
      ? `사용자가 ${zone} 구역에서 90초 넘게 머물고 있어. 도움이 필요한지 물어봐줘.`
      : `사용자가 있는 ${zone} 구역이 방금 혼잡해졌어. 우회 경로를 안내하듯 말 걸어줘.`;

  const completion = await groq.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    max_tokens: 80,
    temperature: 0.7,
  });

  return completion.choices[0].message.content.trim();
}

/**
 * location.js의 setImmediate 후처리 블록에서 호출.
 * @param {object} params
 * @param {import('socket.io').Server} params.io - server.js에서 app.set('io', io) 한 인스턴스
 * @param {string} params.mapId
 * @param {string} params.scannerId
 * @param {string} params.zone - 이번에 계산된 구역(zone)
 * @param {boolean} params.isCongested - 현재 zone이 "혼잡" 상태인지
 */
export async function checkProactiveTrigger({ io, mapId, scannerId, zone, isCongested }) {
  if (!zone || !scannerId) return;

  const prev = stateByScanner.get(scannerId) || {};
  const now = Date.now();

  let reason = null;

  if (prev.zone !== zone) {
    reason = "enter_zone";
  } else if (prev.since && now - prev.since > STAY_THRESHOLD_MS && !prev.stayHandled) {
    reason = "stay_long";
  } else if (isCongested && !prev.congestionHandled) {
    reason = "congestion";
  }

  const nextState = {
    zone,
    since: prev.zone === zone ? (prev.since || now) : now,
    lastTriggeredAt: prev.lastTriggeredAt,
    stayHandled: prev.zone === zone ? prev.stayHandled : false,
    congestionHandled: isCongested ? prev.congestionHandled : false,
  };

  if (reason && canTrigger(prev)) {
    try {
      const message = await generateProactiveMessage(reason, zone);

      await ChatHistory.create({
        scannerId,
        role: "assistant",
        message,
        zone,
      });

      io.to(mapId).emit("proactive_message", { scannerId, message, zone, reason });
      // 룸 join 실패 사례가 있었으므로(과거 버그) 안전망으로 전체 emit도 병행
      io.emit("proactive_message", { scannerId, message, zone, reason });

      nextState.lastTriggeredAt = now;
      if (reason === "stay_long") nextState.stayHandled = true;
      if (reason === "congestion") nextState.congestionHandled = true;
    } catch (err) {
      console.error("⚠️ [proactiveTrigger] 실패:", err.message);
    }
  }

  stateByScanner.set(scannerId, nextState);
}