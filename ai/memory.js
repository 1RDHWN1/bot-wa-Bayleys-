import {
  MAX_RECENT_MESSAGES,
  MAX_SUMMARY_CHARS,
  SUMMARY_MODEL
} from "./config.js";
import { postChatCompletion } from "./client.js";

const sessionMap = new Map();

export function clearAIHistory(conversationId) {
  if (!conversationId) {
    sessionMap.clear();
    return;
  }

  sessionMap.delete(conversationId);
}

export function getAIHistorySize(conversationId) {
  if (!conversationId) return 0;
  const session = sessionMap.get(conversationId);
  if (!session) return 0;
  return (session.summary ? 2 : 0) + (session.messages?.length || 0);
}

export function getSession(conversationId) {
  if (!sessionMap.has(conversationId)) {
    sessionMap.set(conversationId, {
      summary: "",
      messages: []
    });
  }

  return sessionMap.get(conversationId);
}

export async function summarizeMemory(session, model) {
  if (!session.messages.length) return;
  if (session.messages.length <= MAX_RECENT_MESSAGES) return;

  const oldMessages = session.messages.slice(0, -MAX_RECENT_MESSAGES);
  const recentMessages = session.messages.slice(-MAX_RECENT_MESSAGES);
  const transcript = oldMessages
    .map(item => `${item.role === "assistant" ? "AI" : "User"}: ${item.content}`)
    .join("\n");

  try {
    const res = await postChatCompletion(
      {
        model: SUMMARY_MODEL || model,
        messages: [
          {
            role: "system",
            content: `Ringkas percakapan untuk memory chatbot WhatsApp.
Aturan:
- Bahasa Indonesia.
- Maksimal ${MAX_SUMMARY_CHARS} karakter.
- Simpan fakta/preferensi user, konteks tugas berjalan, keputusan penting, dan hal yang harus diingat.
- Jangan simpan basa-basi atau hal tidak relevan.
- Jika ada ringkasan lama, gabungkan dan perbarui.`
          },
          {
            role: "user",
            content: `Ringkasan lama:\n${session.summary || "-"}\n\nPercakapan yang perlu diringkas:\n${transcript}`
          }
        ],
        max_tokens: 320,
        temperature: 0.2,
        top_p: 0.8
      },
      12000
    );

    const summary = res.data?.choices?.[0]?.message?.content?.trim();
    if (summary) {
      session.summary = summary.slice(0, MAX_SUMMARY_CHARS);
    }
  } catch {
    const fallback = oldMessages
      .slice(-4)
      .map(item => `${item.role}: ${String(item.content || "").slice(0, 180)}`)
      .join("\n");
    session.summary = [session.summary, fallback]
      .filter(Boolean)
      .join("\n")
      .slice(-MAX_SUMMARY_CHARS);
  }

  session.messages = recentMessages;
}
