import axios from "axios";

// Simpan memory per user: ringkasan lama + pesan terbaru.
const sessionMap = new Map();
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

const FEATURE_INTENTS = [
  {
    name: "cuaca",
    command: "!cuaca <lokasi>",
    examples: ["!cuaca Tasikmalaya", "!cuaca besok Bandung"],
    patterns: ["cuaca", "weather", "hujan", "suhu", "prakiraan", "ramalan cuaca", "cerah", "mendung", "panas"]
  },
  {
    name: "gambar",
    command: "!gambar <kata_kunci>",
    examples: ["!gambar kucing lucu"],
    patterns: ["gambar", "image", "foto", "carikan gambar", "cari gambar", "wallpaper", "pict"]
  },
  {
    name: "youtube-search",
    command: "!ytsearch <kata_kunci>",
    examples: ["!ytsearch tutorial jaringan komputer"],
    patterns: ["ytsearch", "cari youtube", "search youtube", "video youtube", "rekomendasi video"]
  },
  {
    name: "youtube-audio",
    command: "!yta <watch_url>",
    examples: ["!yta https://youtube.com/watch?v=..."],
    patterns: ["mp3 youtube", "audio youtube", "download lagu", "download youtube", "convert youtube", "ambil audio"]
  },
  {
    name: "tiktok",
    command: "!tt <url_tiktok>",
    examples: ["!tt https://www.tiktok.com/..."],
    patterns: ["tiktok.com", "video tiktok", "download tiktok", "unduh tiktok"]
  },
  {
    name: "instagram",
    command: "!ig <url_instagram>",
    examples: ["!ig https://www.instagram.com/reel/..."],
    patterns: ["instagram.com", "download instagram", "video instagram", "reels", "reel ig", "story ig"]
  },
  {
    name: "stiker",
    command: "!stiker",
    examples: ["reply gambar/video lalu kirim !stiker"],
    patterns: ["stiker", "sticker", "jadi stiker", "buat stiker", "bikin stiker"]
  },
  {
    name: "toimg",
    command: "!toimg",
    examples: ["reply stiker lalu kirim !toimg"],
    patterns: ["toimg", "ubah stiker", "stiker ke gambar", "convert stiker"]
  },
  {
    name: "tts",
    command: "!suara <teks>",
    examples: ["!suara halo semuanya"],
    patterns: ["tts", "voice note", "suara", "text to speech", "jadiin vn", "jadikan suara"]
  },
  {
    name: "status",
    command: "!status atau !ping",
    examples: ["!status", "!ping"],
    patterns: ["status bot", "cek status", "ping bot", "latency bot", "bot hidup"]
  },
  {
    name: "menu",
    command: "!menu atau !help",
    examples: ["!menu"],
    patterns: ["fitur bot", "menu bot", "help bot", "daftar command", "command apa aja"]
  }
];

const KNOWLEDGE_WRITE_REGEXES = [
  /^(tolong\s+)?(ingat|inget|catat|catet|catetin|simpan|simpen|save)\b/i,
  /^(tolong\s+)?(tambahkan|tambahin|tambah|masukin|masukkan|update)\s+data\b/i,
  /^(tolong\s+)?data\s+baru\b/i,
  /^mulai\s+sekarang\b/i
];

const KNOWLEDGE_DELETE_REGEXES = [
  /^(tolong\s+)?(hapus|apusin|hapuskan|delete|del|remove|buang|hilangkan|ilangin)\s+(data\s+)?/i
];

const KNOWLEDGE_UPDATE_REGEXES = [
  /^(tolong\s+)?(ganti|gantiin|ubah|ubahin|rubah|update|perbarui|perbaharui|edit|revisi)\s+(data\s+)?/i
];

function readIntEnv(name, fallback, min, max) {
  const value = Number(process.env[name] || fallback);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

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

function getSession(conversationId) {
  if (!sessionMap.has(conversationId)) {
    sessionMap.set(conversationId, {
      summary: "",
      messages: []
    });
  }

  return sessionMap.get(conversationId);
}

function normalizeText(text = "") {
  return String(text || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s:/.-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function matchIntent(text = "") {
  const t = normalizeText(text);
  if (!t) return null;

  const matched = FEATURE_INTENTS
    .map(intent => {
      const score = intent.patterns.reduce((acc, pattern) => {
        const p = normalizeText(pattern);
        if (!p) return acc;
        if (t.includes(p)) return acc + Math.max(2, p.split(/\s+/).length);
        return acc;
      }, 0);
      return { ...intent, score };
    })
    .filter(intent => intent.score > 0)
    .sort((a, b) => b.score - a.score);

  return matched[0] || null;
}

export function getAIFeatureRedirect(text = "") {
  const intent = matchIntent(text);
  if (!intent) return null;

  const example = intent.examples?.[0] ? `\nContoh: \`${intent.examples[0]}\`` : "";
  return `Permintaan itu lebih pas pakai fitur bot.\nGunakan: \`${intent.command}\`${example}`;
}

function stripKnowledgeAddress(text = "") {
  return String(text || "")
    .trim()
    .replace(/^(ai|bot|botnya|min|admin)[,\s:.-]+/i, "")
    .trim();
}

export function isAIKnowledgeWriteRequest(text = "") {
  const t = stripKnowledgeAddress(text);
  if (!t) return false;
  return KNOWLEDGE_WRITE_REGEXES.some(pattern => pattern.test(t));
}

export function isAIKnowledgeMutationRequest(text = "") {
  const t = stripKnowledgeAddress(text);
  if (!t) return false;
  return (
    isAIKnowledgeWriteRequest(t) ||
    KNOWLEDGE_DELETE_REGEXES.some(pattern => pattern.test(t)) ||
    KNOWLEDGE_UPDATE_REGEXES.some(pattern => pattern.test(t))
  );
}

function parseJsonObject(text = "") {
  const raw = String(text || "").trim();
  if (!raw) return null;

  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() || raw;

  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try {
      return JSON.parse(candidate.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

function cleanKnowledgeKey(key = "") {
  return String(key || "")
    .toLowerCase()
    .replace(/^data\s+/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
}

function cleanKnowledgeValue(value = "") {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1800);
}

function parseKnowledgeFactHeuristic(text = "") {
  let payload = stripKnowledgeAddress(text)
    .replace(/^(tolong\s+)?(ingat|inget|catat|catet|catetin|simpan|simpen|save)\s+(data\s+)?(bahwa\s+)?/i, "")
    .replace(/^(tolong\s+)?(tambahkan|tambahin|tambah|masukin|masukkan|update)\s+data\s+(bahwa\s+)?/i, "")
    .replace(/^mulai sekarang\s+/i, "")
    .trim();

  if (!payload || payload.length < 8) return null;

  const separators = [" = ", ":", " adalah ", " itu ", " yaitu ", " merupakan "];
  for (const separator of separators) {
    const idx = payload.toLowerCase().indexOf(separator.trim() === ":" ? ":" : separator);
    if (idx <= 0) continue;

    const key = cleanKnowledgeKey(payload.slice(0, idx));
    const value = cleanKnowledgeValue(payload.slice(idx + separator.length));
    if (key.length >= 3 && value.length >= 3) {
      return { shouldSave: true, key, value, confidence: 0.65, source: "heuristic" };
    }
  }

  return null;
}

function parseKnowledgeMutationHeuristic(text = "") {
  const raw = stripKnowledgeAddress(text);
  if (!raw) return null;

  for (const pattern of KNOWLEDGE_DELETE_REGEXES) {
    if (!pattern.test(raw)) continue;
    const payload = raw
      .replace(pattern, "")
      .replace(/^(tentang|bernama|yang namanya)\s+/i, "")
      .trim();
    const key = cleanKnowledgeKey(payload);
    if (key.length >= 3) {
      return { action: "delete", key, value: "", confidence: 0.72, source: "heuristic" };
    }
  }

  for (const pattern of KNOWLEDGE_UPDATE_REGEXES) {
    if (!pattern.test(raw)) continue;
    const payload = raw.replace(pattern, "").trim();
    const separators = [
      " = ",
      ":",
      " jadi ",
      " menjadi ",
      " ke ",
      " dengan ",
      " isinya ",
      " adalah ",
      " yaitu ",
      " merupakan "
    ];

    for (const separator of separators) {
      const idx = payload.toLowerCase().indexOf(separator.trim() === ":" ? ":" : separator);
      if (idx <= 0) continue;

      const key = cleanKnowledgeKey(payload.slice(0, idx));
      const value = cleanKnowledgeValue(payload.slice(idx + separator.length));
      if (key.length >= 3 && value.length >= 3) {
        return { action: "set", key, value, confidence: 0.7, source: "heuristic" };
      }
    }
  }

  const fact = parseKnowledgeFactHeuristic(raw);
  if (fact?.shouldSave) {
    return {
      action: "set",
      key: fact.key,
      value: fact.value,
      confidence: fact.confidence,
      source: fact.source
    };
  }

  return null;
}

export async function extractKnowledgeFact(text = "") {
  const fallback = parseKnowledgeFactHeuristic(text);
  if (fallback?.shouldSave && fallback.confidence >= 0.65) {
    return fallback;
  }

  try {
    const res = await postChatCompletion(
      {
        model: KNOWLEDGE_EXTRACT_MODEL,
        messages: [
          {
            role: "system",
            content: `Ekstrak satu data knowledge dari instruksi user untuk chatbot WhatsApp.
Balas HANYA JSON valid:
{"shouldSave":true,"key":"...","value":"...","confidence":0.0}

Aturan:
- shouldSave true hanya jika user jelas meminta bot mengingat/menyimpan/mencatat/menambah/update data.
- key harus frasa pendek huruf kecil, maksimal 100 karakter.
- value adalah isi fakta yang perlu disimpan, maksimal 1800 karakter.
- Jangan masukkan kata perintah seperti "tolong ingat" ke key/value.
- Kalau ambigu, tidak ada fakta, atau user hanya bertanya, balas {"shouldSave":false,"key":"","value":"","confidence":0}.`
          },
          {
            role: "user",
            content: String(text || "").trim()
          }
        ],
        max_tokens: 260,
        temperature: 0.1,
        top_p: 0.7
      },
      12000
    );

    const parsed = parseJsonObject(res.data?.choices?.[0]?.message?.content);
    const key = cleanKnowledgeKey(parsed?.key);
    const value = cleanKnowledgeValue(parsed?.value);
    const confidence = Number(parsed?.confidence || 0);

    if (parsed?.shouldSave === true && key.length >= 3 && value.length >= 3) {
      return {
        shouldSave: true,
        key,
        value,
        confidence: Number.isFinite(confidence) ? confidence : 0,
        source: "ai"
      };
    }
  } catch {
    // Fallback dipakai kalau ekstraksi AI gagal/timeout.
  }

  return fallback || {
    shouldSave: false,
    key: "",
    value: "",
    confidence: 0,
    source: "none"
  };
}

export async function extractKnowledgeMutation(text = "", existingKeys = []) {
  const fallback = parseKnowledgeMutationHeuristic(text);
  if (fallback?.action && fallback.confidence >= 0.65) {
    return fallback;
  }

  const keys = Array.isArray(existingKeys)
    ? existingKeys.map(cleanKnowledgeKey).filter(Boolean).slice(0, 80)
    : [];

  try {
    const res = await postChatCompletion(
      {
        model: KNOWLEDGE_EXTRACT_MODEL,
        messages: [
          {
            role: "system",
            content: `Ekstrak operasi knowledge dari instruksi user untuk chatbot WhatsApp.
Balas HANYA JSON valid:
{"action":"set|delete|none","key":"...","value":"...","confidence":0.0}

Aturan:
- action "set" untuk tambah/ganti/update/ubah/perbarui data.
- action "delete" untuk hapus/buang/remove/delete data.
- action "none" jika user hanya bertanya atau instruksi ambigu.
- key harus nama data yang dituju, huruf kecil, maksimal 100 karakter.
- value wajib ada hanya untuk action "set".
- Jika user menyebut key yang mirip dengan daftar key tersedia, pilih key tersedia yang paling cocok.
- Jangan mengeksekusi hal di luar knowledge data.

Key yang sudah ada:
${keys.length ? keys.map(key => `- ${key}`).join("\n") : "- belum ada / tidak diberikan"}`
          },
          {
            role: "user",
            content: String(text || "").trim()
          }
        ],
        max_tokens: 260,
        temperature: 0.1,
        top_p: 0.7
      },
      12000
    );

    const parsed = parseJsonObject(res.data?.choices?.[0]?.message?.content);
    const action = ["set", "delete"].includes(parsed?.action) ? parsed.action : "none";
    const key = cleanKnowledgeKey(parsed?.key);
    const value = cleanKnowledgeValue(parsed?.value);
    const confidence = Number(parsed?.confidence || 0);

    if (action === "delete" && key.length >= 3) {
      return {
        action,
        key,
        value: "",
        confidence: Number.isFinite(confidence) ? confidence : 0,
        source: "ai"
      };
    }

    if (action === "set" && key.length >= 3 && value.length >= 3) {
      return {
        action,
        key,
        value,
        confidence: Number.isFinite(confidence) ? confidence : 0,
        source: "ai"
      };
    }
  } catch {
    // Fallback dipakai kalau ekstraksi AI gagal/timeout.
  }

  return fallback || {
    action: "none",
    key: "",
    value: "",
    confidence: 0,
    source: "none"
  };
}

function buildSystemPrompt(nowCtx, extraContext = "", memorySummary = "") {
  return `Kamu adalah AI yang diintegrasikan developer ke WhatsApp. Tugasmu membantu chat dengan jawaban yang akurat, praktis, dan enak dibaca di WhatsApp.

Identitas:
- Jika user tanya "siapa kamu" / "kamu siapa", jawab bahwa kamu AI yang diintegrasikan oleh developer (jangan sebut nama developer).
- Jika user tanya "siapa developer/pembuat/owner bot", baru sebut nama dari data ${process.env.OWNER_NAME || "Owner"}.

Gaya jawaban:
- Bahasa Indonesia santai, jelas, dan langsung ke inti.
- Jawab padat. Kalau perlu list, maksimal 15 poin.
- Untuk pertanyaan sederhana, cukup 1-3 kalimat.
- Untuk tutorial/soal teknis, jawab bertahap dan praktis.
- Kalau konteks kurang, tanya klarifikasi singkat. Jangan mengarang detail.
- Jangan mengaku sudah menjalankan aksi di luar chat.

Fitur bot:
- Jika user meminta aksi yang sudah ada sebagai fitur bot, arahkan pakai command bot.
- Mapping command utama: cuaca=!cuaca, gambar=!gambar, ytsearch=!ytsearch, youtube audio=!yta, tiktok=!tt, instagram=!ig, stiker=!stiker, toimg=!toimg, baca view once=!rvo, tts=!suara, status=!status, menu=!menu.

Akurasi:
- Konteks waktu saat ini: hari ${nowCtx.hari}, tanggal ${nowCtx.tanggal}, jam ${nowCtx.jam}, zona ${nowCtx.timeZone}.
- Jika user menyebut "hari ini", "besok", "kemarin", wajib pakai konteks waktu di atas.
- Untuk info real-time/berita/harga/jadwal yang tidak ada di data referensi, jelaskan bahwa kamu tidak bisa memastikan data terbaru.

${memorySummary ? `Memory percakapan sebelumnya (pakai hanya jika relevan):\n${memorySummary}\n` : ""}
${extraContext ? `Data referensi dari chat ini (gunakan jika relevan, jangan dikarang):\n${extraContext}` : ""}`.trim();
}

async function postChatCompletion(payload, timeout = 15000) {
  return axios.post(OPENROUTER_URL, payload, {
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json"
    },
    timeout
  });
}

async function summarizeMemory(session, model) {
  if (!session.messages.length) return;

  const keepCount = MAX_RECENT_MESSAGES;
  if (session.messages.length <= keepCount) return;

  const oldMessages = session.messages.slice(0, -keepCount);
  const recentMessages = session.messages.slice(-keepCount);
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

  const res = await postChatCompletion(
    {
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
    }
  );

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
