import axios from "axios";

// Simpan history per user biar ada konteks tapi tetap singkat
const historyMap = new Map();
const AI_TIMEZONE = process.env.AI_TIMEZONE || "Asia/Jakarta";

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
    historyMap.clear();
    return;
  }

  historyMap.delete(conversationId);
}

export function getAIHistorySize(conversationId) {
  if (!conversationId) return 0;
  return historyMap.get(conversationId)?.length || 0;
}

export async function askAI(text, sender = "default", options = {}) {
  const model = process.env.AI_MODEL || "deepseek/deepseek-chat-v3-0324";
  const nowCtx = getNowContext();
  const extraContext =
    typeof options.knowledgeContext === "string"
      ? options.knowledgeContext.trim()
      : "";

  // Inisialisasi history kalau belum ada
  if (!historyMap.has(sender)) {
    historyMap.set(sender, []);
  }

  const history = historyMap.get(sender);
  history.push({ role: "user", content: text });

  // Batasi history 6 pesan terakhir biar tidak lambat
  if (history.length > 6) {
    historyMap.set(sender, history.slice(-6));
  }

  const res = await axios.post(
    "https://openrouter.ai/api/v1/chat/completions",
    {
      model,
      messages: [
        {
          role: "system",
          content: `Kamu adalah ai yang diintegrasikan oleh fachri ke dalam whatsapp yang cerdas dan helpful.
Aturan WAJIB:
- Jawab PADAT
- Tidak perlu basa-basi atau salam panjang
- Gunakan bahasa Indonesia santai
- Kalau butuh list, maksimal 15 point
- Langsung ke inti jawaban
- Jika user meminta aksi yang sudah ada sebagai fitur bot, arahkan pakai command bot (jangan pura-pura mengeksekusi)
- Mapping command utama: cuaca=!cuaca, gambar=!gambar, ytsearch=!ytsearch, youtube audio=!yta, tiktok=!tt, instagram=!ig, stiker=!stiker, toimg=!toimg, tts=!suara, status=!status
- Konteks waktu saat ini: hari ${nowCtx.hari}, tanggal ${nowCtx.tanggal}, jam ${nowCtx.jam}, zona ${nowCtx.timeZone}
- Jika user menyebut "hari ini", "besok", "kemarin", wajib pakai konteks waktu di atas (jangan menebak hari)
${
  extraContext
    ? `\n\nData referensi dari user (gunakan jika relevan, jangan dikarang):\n${extraContext}`
    : ""
}`
        },
        ...historyMap.get(sender)
      ],
      max_tokens: 480,
      temperature: 0.6,
      top_p: 0.9
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json"
      },
      timeout: 15000
    }
  );

  const content = res.data?.choices?.[0]?.message?.content?.trim();

  if (!content) {
    throw new Error("AI tidak mengembalikan jawaban.");
  }

  // Simpan balasan AI ke history
  historyMap.get(sender).push({ role: "assistant", content });

  return {
    content,
    model,
    historySize: historyMap.get(sender)?.length || 0
  };
}
