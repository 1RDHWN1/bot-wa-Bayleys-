import { DEFAULT_AI_MODEL, getNowContext } from "./config.js";
import { postChatCompletion } from "./client.js";
import { buildSystemPrompt } from "./prompt.js";
import { getSession, summarizeMemory, getAIHistorySize } from "./memory.js";

export async function askAI(text, sender = "default", options = {}) {
  const model = process.env.AI_MODEL || DEFAULT_AI_MODEL;
  const nowCtx = getNowContext();
  const extraContext =
    typeof options.knowledgeContext === "string"
      ? options.knowledgeContext.trim()
      : "";

  const session = getSession(sender);
  session.messages.push({ role: "user", content: text });
  await summarizeMemory(session, model);

  const res = await postChatCompletion({
    model,
    messages: [
      {
        role: "system",
        content: buildSystemPrompt(nowCtx, extraContext, session.summary)
      },
      ...session.messages
    ],
    max_tokens: 480,
    temperature: 0.6,
    top_p: 0.9
  });

  const content = res.data?.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new Error("AI tidak mengembalikan jawaban.");
  }

  session.messages.push({ role: "assistant", content });
  await summarizeMemory(session, model);

  return {
    content,
    model,
    historySize: getAIHistorySize(sender),
    hasMemorySummary: Boolean(session.summary)
  };
}
