import { KNOWLEDGE_EXTRACT_MODEL } from "./config.js";
import { postChatCompletion } from "./client.js";

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

function stripKnowledgeAddress(text = "") {
  return String(text || "")
    .trim()
    .replace(/^(ai|bot|botnya|min|admin)[,\s:.-]+/i, "")
    .trim();
}

export function isAIKnowledgeWriteRequest(text = "") {
  const normalized = stripKnowledgeAddress(text);
  if (!normalized) return false;
  return KNOWLEDGE_WRITE_REGEXES.some(pattern => pattern.test(normalized));
}

export function isAIKnowledgeMutationRequest(text = "") {
  const normalized = stripKnowledgeAddress(text);
  if (!normalized) return false;
  return (
    isAIKnowledgeWriteRequest(normalized) ||
    KNOWLEDGE_DELETE_REGEXES.some(pattern => pattern.test(normalized)) ||
    KNOWLEDGE_UPDATE_REGEXES.some(pattern => pattern.test(normalized))
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
  const payload = stripKnowledgeAddress(text)
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
    // fallback dipakai kalau ekstraksi AI gagal/timeout
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
    // fallback dipakai kalau ekstraksi AI gagal/timeout
  }

  return fallback || {
    action: "none",
    key: "",
    value: "",
    confidence: 0,
    source: "none"
  };
}
