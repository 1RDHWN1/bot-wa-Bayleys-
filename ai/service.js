import { DEFAULT_AI_MODEL, OPENROUTER_URL, getNowContext } from "./config.js";
import { postChatCompletion } from "./client.js";
import { buildSystemPrompt } from "./prompt.js";
import { getSession, summarizeMemory, getAIHistorySize } from "./memory.js";
import { tavilySearch, formatTavilyForPrompt, TAVILY_FUNCTION_SCHEMA } from "../utils.js";

const MAX_TOOL_ROUNDS = 3; // Max 3 putaran tool calling

export async function askAI(text, sender = "default", options = {}) {
  const model = process.env.AI_MODEL || DEFAULT_AI_MODEL;
  const nowCtx = getNowContext();
  const extraContext =
    typeof options.knowledgeContext === "string"
      ? options.knowledgeContext.trim()
      : "";
  const enableSearch = options.enableSearch !== false; // Default true

  const session = getSession(sender);
  session.messages.push({ role: "user", content: text });
  await summarizeMemory(session, model);

  // Function calling loop
  let messages = [
    {
      role: "system",
      content: buildSystemPrompt(nowCtx, extraContext, session.summary)
    },
    ...session.messages
  ];

  let rounds = 0;

  while (rounds < MAX_TOOL_ROUNDS) {
    const res = await postChatCompletion({
      model,
      messages,
      max_tokens: 480,
      temperature: 0.6,
      top_p: 0.9,
      // Enable function calling (fallback if model doesn't support)
      tools: enableSearch ? [TAVILY_FUNCTION_SCHEMA] : undefined,
      tool_choice: enableSearch ? "auto" : "none"
    }).catch(async (err) => {
      // If function calling not supported (400), retry without tools
      if (err?.response?.status === 400 && enableSearch) {
        console.warn("[AI] Function calling not supported, retrying without tools...");
        return postChatCompletion({
          model,
          messages,
          max_tokens: 480,
          temperature: 0.6,
          top_p: 0.9
        });
      }
      throw err;
    });

    const choice = res.data?.choices?.[0];
    const message = choice?.message;

    if (!message) {
      throw new Error("AI tidak mengembalikan jawaban.");
    }

    // Add assistant message to conversation
    messages.push(message);

    // Check for tool calls
    const toolCalls = message.tool_calls;
    if (!toolCalls?.length) {
      // No tool calls - final answer
      const content = message.content?.trim();
      if (!content) {
        throw new Error("AI tidak mengembalikan konten.");
      }

      session.messages.push({ role: "assistant", content });
      await summarizeMemory(session, model);

      return {
        content,
        model,
        historySize: getAIHistorySize(sender),
        hasMemorySummary: Boolean(session.summary),
        usedSearch: rounds > 0
      };
    }

    // Execute tool calls
    for (const toolCall of toolCalls) {
      if (toolCall.type === "function" && toolCall.function?.name === "web_search") {
        try {
          const args = JSON.parse(toolCall.function.arguments || "{}");
          const searchResult = await tavilySearch(args.query, {
            maxResults: args.maxResults,
            searchDepth: args.searchDepth,
            topic: args.topic,
            timeRange: args.timeRange
          });

          const formatted = formatTavilyForPrompt(searchResult);

          // Add tool result to messages
          messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            name: "web_search",
            content: formatted
          });
        } catch (err) {
          // Tool error - add error message
          messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            name: "web_search",
            content: `Error searching: ${err?.message || err}`
          });
        }
      }
    }

    rounds++;
  }

  // Max rounds reached - get final answer without tools
  const finalRes = await postChatCompletion({
    model,
    messages,
    max_tokens: 480,
    temperature: 0.6,
    top_p: 0.9,
    tools: undefined
  }).catch(async (err) => {
    if (err?.response?.status === 400) {
      console.warn("[AI] Final call failed, retrying without tools...");
      return postChatCompletion({
        model,
        messages,
        max_tokens: 480,
        temperature: 0.6,
        top_p: 0.9
      });
    }
    throw err;
  });

  const finalContent = finalRes.data?.choices?.[0]?.message?.content?.trim();
  if (!finalContent) {
    throw new Error("AI tidak mengembalikan jawaban final.");
  }

  session.messages.push({ role: "assistant", content: finalContent });
  await summarizeMemory(session, model);

  return {
    content: finalContent,
    model,
    historySize: getAIHistorySize(sender),
    hasMemorySummary: Boolean(session.summary),
    usedSearch: true
  };
}

// Non-streaming version for simple use
export async function askAISimple(text, sender = "default", options = {}) {
  return askAI(text, sender, options);
}
