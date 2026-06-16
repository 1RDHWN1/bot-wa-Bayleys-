function readIntEnv(name, fallback, min, max) {
  const value = Number(process.env[name] || fallback);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

const AI_TIMEZONE = process.env.AI_TIMEZONE || "Asia/Jakarta";
const DEFAULT_AI_MODEL = "deepseek/deepseek-chat-v3-0324";
const MAX_RECENT_MESSAGES = readIntEnv("AI_HISTORY_MESSAGES", 8, 4, 20);
const MAX_SUMMARY_CHARS = readIntEnv("AI_MEMORY_SUMMARY_CHARS", 1200, 400, 4000);
const SUMMARY_MODEL = process.env.AI_SUMMARY_MODEL || process.env.AI_MODEL || DEFAULT_AI_MODEL;
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const KNOWLEDGE_EXTRACT_MODEL =
  process.env.AI_KNOWLEDGE_EXTRACT_MODEL ||
  process.env.AI_MODEL ||
  DEFAULT_AI_MODEL;

const TAVILY_API_KEY = process.env.TAVILY_API_KEY || "";

function getNowContext(timeZone = AI_TIMEZONE) {
  const now = new Date();
  const hari = new Intl.DateTimeFormat("id-ID", {
    weekday: "long",
    timeZone
  }).format(now);

  const tanggal = new Intl.DateTimeFormat("id-ID", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone
  }).format(now);

  const jam = new Intl.DateTimeFormat("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone
  }).format(now);

  return { hari, tanggal, jam, timeZone };
}

export {
  AI_TIMEZONE,
  DEFAULT_AI_MODEL,
  MAX_RECENT_MESSAGES,
  MAX_SUMMARY_CHARS,
  SUMMARY_MODEL,
  OPENROUTER_URL,
  KNOWLEDGE_EXTRACT_MODEL,
  TAVILY_API_KEY,
  readIntEnv,
  getNowContext
};
