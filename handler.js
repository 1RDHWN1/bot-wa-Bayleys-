import {
  getContentType,
  downloadMediaMessage
} from "@whiskeysockets/baileys";

import fs from "fs";
import path from "path";
import sharp from "sharp";
import { createCommandRouter } from "./core/router.js";
import { createAbuseGuard } from "./core/abuse-guard.js";
import { appConfig } from "./core/config.js";
import { createReplyHelper } from "./core/reply.js";
import { createRuntimeToolkit } from "./core/runtime-toolkit.js";
import { createModularCommands, createModularPassiveHandlers } from "./commands/modular/index.js";

import { makeSticker } from "./sticker.js";
import {
  askAI,
  clearAIHistory,
  getAIHistorySize,
  getAIFeatureRedirect,
  isAIKnowledgeMutationRequest,
  extractKnowledgeFact,
  extractKnowledgeMutation
} from "./ai.js";
import {
  setStoredFact,
  getStoredFact,
  getStoredFactMeta,
  deleteStoredFact,
  listStoredFacts,
  listKnowledgeScopes,
  exportKnowledgeSnapshot,
  buildFactsContext,
  isKnowledgeEditor,
  addKnowledgeEditor,
  removeKnowledgeEditor,
  listKnowledgeEditors,
  clearKnowledgeEditors,
  appendKnowledgeAudit,
  readKnowledgeAudit
} from "./knowledge.js";
import { tts } from "./tts.js";
import { tagAll, tagAdmin } from "./group.js";

import {
  formatUptime,
  formatBytes,
  pingUrl,
  searchImage,
  getText,
  downloadImage,
  stickerToImage,
  ytSearch,
  searchYouTubeMusic,
  downloadTikTok,
  downloadInstagram,
  downloadYouTubeAudio,
  downloadYouTubeVideo,
  normalizeYouTubeUrl,
  getWeatherBMKG, 
  getWeatherIcon,
  getWeatherTomorrow
} from "./utils.js";



function logInfo(msg) {
  console.log(`\x1b[36m[INFO]\x1b[0m ${msg}`);
}

function logWarn(msg) {
  console.warn(`\x1b[33m[WARN]\x1b[0m ${msg}`);
}

function logError(msg, err) {
  console.error(`\x1b[31m[ERROR]\x1b[0m ${msg}`);

  if (Buffer.isBuffer(err)) {
    console.error(err.toString());
  } else if (err?.message) {
    console.error(err.message);
  } else if (err?.response?.data) {
    console.error(JSON.stringify(err.response.data, null, 2));
  } else {
    console.error(err);
  }
}



/* ===============================
   GLOBAL CACHE (WAJIB DI LUAR)
================================ */
const ytSearchCache = new Map();
const ytChoiceCache = new Map();
const YT_CHOICE_TTL_MS = 2 * 60 * 1000;
const YT_SEARCH_TTL_MS = 5 * 60 * 1000;
const BOT_FOOTER = "> *pesan otomatis dari bot*";
const BOT_STATE_FILE = path.resolve("./data/bot_state.json");
const REMINDERS_FILE = path.resolve("./data/reminders.json");
const KNOWLEDGE_ALIAS_FILE = path.resolve("./data/knowledge_aliases.json");
const AI_CONFIRM_TTL_MS = 2 * 60 * 1000;
const MAINTENANCE_ALLOWED_COMMANDS = new Set([
  "maintenance",
  "help",
  "menu",
  "ping",
  "status",
  "stats",
  "antrian",
  "queue",
  "jadwal"
]);

function defaultBotState() {
  return {
    maintenance: {
      enabled: false,
      enabledAt: null,
      enabledBy: "",
      reason: ""
    }
  };
}

function loadBotState() {
  try {
    if (!fs.existsSync(BOT_STATE_FILE)) return defaultBotState();
    const raw = fs.readFileSync(BOT_STATE_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return {
      ...defaultBotState(),
      ...parsed,
      maintenance: {
        ...defaultBotState().maintenance,
        ...(parsed?.maintenance || {})
      }
    };
  } catch {
    return defaultBotState();
  }
}

function saveBotState() {
  try {
    const dir = path.dirname(BOT_STATE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(BOT_STATE_FILE, JSON.stringify(botState, null, 2), "utf8");
  } catch (err) {
    logWarn(`Gagal simpan bot state: ${err?.message || err}`);
  }
}

const botState = loadBotState();
let activeSockForJobs = null;

function loadReminders() {
  try {
    if (!fs.existsSync(REMINDERS_FILE)) return [];
    const raw = fs.readFileSync(REMINDERS_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

let reminders = loadReminders();
const aiConfirmations = new Map();

function loadKnowledgeAliases() {
  try {
    if (!fs.existsSync(KNOWLEDGE_ALIAS_FILE)) return {};
    const raw = fs.readFileSync(KNOWLEDGE_ALIAS_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

let knowledgeAliases = loadKnowledgeAliases();

function saveKnowledgeAliases() {
  try {
    const dir = path.dirname(KNOWLEDGE_ALIAS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(KNOWLEDGE_ALIAS_FILE, JSON.stringify(knowledgeAliases, null, 2), "utf8");
  } catch (err) {
    logWarn(`Gagal simpan knowledge aliases: ${err?.message || err}`);
  }
}

function saveReminders() {
  try {
    const dir = path.dirname(REMINDERS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(REMINDERS_FILE, JSON.stringify(reminders, null, 2), "utf8");
  } catch (err) {
    logWarn(`Gagal simpan reminders: ${err?.message || err}`);
  }
}

function getJakartaNowParts() {
  const now = new Date();
  const date = now.toLocaleDateString("sv-SE", { timeZone: "Asia/Jakarta" });

  // Pakai formatToParts agar separator jam selalu stabil ":".
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jakarta",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(now);
  const hh = parts.find(p => p.type === "hour")?.value || "00";
  const mm = parts.find(p => p.type === "minute")?.value || "00";
  const time = `${hh}:${mm}`;

  return { date, time };
}

function normalizeReminderTime(input = "") {
  const v = String(input || "").trim();
  const m = v.match(/^([01]?\d|2[0-3])[:.]([0-5]\d)$/);
  if (!m) return null;
  const hh = String(Number(m[1])).padStart(2, "0");
  const mm = String(Number(m[2])).padStart(2, "0");
  return `${hh}:${mm}`;
}

function formatReminderListItem(r) {
  const state = r.enabled === false ? "off" : "on";
  return `• [${r.id}] ${r.time} (${state}) - ${r.message}`;
}

async function processReminderJobs() {
  if (!activeSockForJobs) return;
  const { date, time } = getJakartaNowParts();
  let changed = false;

  for (const item of reminders) {
    if (!item || item.enabled === false) continue;
    if (!item.jid || !item.time || !item.message) continue;
    if (item.time !== time) continue;
    if (item.lastTriggeredDate === date) continue;

    try {
      const reminderText = addBotFooter(`⏰ *Pengingat Jadwal*\n${item.message}`);
      const payload = { text: reminderText };

      if (String(item.jid).endsWith("@g.us")) {
        try {
          const meta = await activeSockForJobs.groupMetadata(item.jid);
          const mentions = Array.from(
            new Set((meta?.participants || []).map(p => p?.id).filter(Boolean))
          );
          if (mentions.length) payload.mentions = mentions;
        } catch (metaErr) {
          logWarn(
            `REMINDER TAGALL SKIP | id=${item.id} | gagal ambil metadata grup: ${metaErr?.message || metaErr}`
          );
        }
      }

      await activeSockForJobs.sendMessage(item.jid, payload);
      item.lastTriggeredDate = date;
      changed = true;
      logInfo(`REMINDER SENT | id=${item.id} | jid=${item.jid} | ${date} ${time}`);
    } catch (err) {
      logWarn(`REMINDER FAIL | id=${item.id} | ${err?.message || err}`);
    }
  }

  if (changed) saveReminders();
}

setInterval(() => {
  processReminderJobs().catch(() => {});
}, 15 * 1000).unref?.();

function escapeXml(text = "") {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function wrapText(text = "", maxLen = 34, maxLines = 8) {
  const words = String(text || "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];

  const lines = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length <= maxLen) {
      line = next;
      continue;
    }
    if (line) lines.push(line);
    line = word;
    if (lines.length >= maxLines) break;
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (words.length && lines.length >= maxLines) {
    lines[maxLines - 1] = `${lines[maxLines - 1].slice(0, Math.max(0, maxLen - 3))}...`;
  }
  return lines;
}

async function createQuoteImageBuffer(text, author = "") {
  const cleanText = String(text || "").trim();
  const cleanAuthor = String(author || "").trim();
  const lines = wrapText(cleanText || "-", 34, 8);
  const width = 1080;
  const top = 170;
  const lineGap = 82;
  const height = Math.max(720, top + lines.length * lineGap + 230);

  const textSvg = lines
    .map((line, i) => {
      const y = top + (i * lineGap);
      return `<text x="96" y="${y}" font-size="56" font-family="Arial, sans-serif" fill="#111827">${escapeXml(line)}</text>`;
    })
    .join("");

  const authorSvg = cleanAuthor
    ? `<text x="96" y="${height - 88}" font-size="38" font-family="Arial, sans-serif" fill="#374151">- ${escapeXml(cleanAuthor)}</text>`
    : "";

  const svg = `
<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#f8fafc"/>
      <stop offset="100%" stop-color="#e2e8f0"/>
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="${width}" height="${height}" fill="url(#bg)"/>
  <rect x="62" y="58" width="${width - 124}" height="${height - 116}" rx="30" fill="#ffffff"/>
  <text x="96" y="110" font-size="74" font-family="Georgia, serif" fill="#111827">“</text>
  ${textSvg}
  ${authorSvg}
</svg>`;

  return sharp(Buffer.from(svg)).png().toBuffer();
}

function addBotFooter(text) {
  if (typeof text !== "string" || !text.trim()) return text;
  if (text.includes(BOT_FOOTER)) return text;
  return `${text}\n\n${BOT_FOOTER}`;
}
const reply = createReplyHelper(BOT_FOOTER);

/* ===============================
   HELPER
================================ */
function parseImageFlags(text) {
  let safeMode = true;
  if (text.includes("--unsafe")) safeMode = false;
  if (text.includes("--safe")) safeMode = true;

  const cleanQuery = text
    .replace("--unsafe", "")
    .replace("--safe", "")
    .trim();

  return { safeMode, query: cleanQuery };
}

function normalizeJid(jid = "") {
  const raw = String(jid || "").trim();
  if (!raw) return "";

  // Format JID MD bisa seperti: 62812xxxx:12@s.whatsapp.net
  // Ambil hanya nomor utama sebelum ":" dan sebelum "@"
  const base = raw.split("@")[0].split(":")[0];
  return base.replace(/[^0-9]/g, "");
}

function parseOwnerIds(sock) {
  const ids = new Set();
  const envOwnerRaw = [
    process.env.OWNER_NUMBER || "",
    process.env.OWNER_ID || "",
    process.env.OWNER_JID || ""
  ].join(",");

  envOwnerRaw
    .split(/[,\s]+/)
    .map(normalizeJid)
    .filter(Boolean)
    .forEach(id => ids.add(id));

  const botPn = normalizeJid(sock?.user?.id || "");
  const botLid = normalizeJid(sock?.user?.lid || "");

  if (botPn && ids.has(botPn) && botLid) {
    ids.add(botLid);
  }

  return ids;
}

function getSenderRawJids(msg) {
  const candidates = [
    msg?.key?.participant,
    msg?.key?.participantPn,
    msg?.key?.participantLid,
    msg?.key?.remoteJid,
    msg?.participant,
    msg?.message?.extendedTextMessage?.contextInfo?.participant,
    msg?.message?.extendedTextMessage?.contextInfo?.participantPn,
    msg?.message?.extendedTextMessage?.contextInfo?.remoteJid
  ];

  return Array.from(
    new Set(
      candidates
        .map(v => String(v || "").trim())
        .filter(Boolean)
    )
  );
}

async function getSenderIds(sock, msg) {
  const rawJids = getSenderRawJids(msg);
  const ids = new Set(rawJids.map(normalizeJid).filter(Boolean));

  const lidMapping = sock?.signalRepository?.lidMapping;
  if (lidMapping?.getPNForLID) {
    for (const jid of rawJids) {
      if (!jid.includes("@lid")) continue;
      try {
        const pnJid = await lidMapping.getPNForLID(jid);
        const pn = normalizeJid(pnJid || "");
        if (pn) ids.add(pn);
      } catch {
        // ignore mapping lookup failures
      }
    }
  }

  return Array.from(ids);
}

function getIdVariants(id = "") {
  const base = normalizeJid(id);
  if (!base) return [];

  const out = new Set([base]);

  if (base.startsWith("62") && base.length > 3) {
    out.add(`0${base.slice(2)}`);
  }
  if (base.startsWith("0") && base.length > 3) {
    out.add(`62${base.slice(1)}`);
  }

  return Array.from(out);
}

function hasKnowledgeEditAccess(senderIds = []) {
  for (const id of senderIds) {
    const variants = getIdVariants(id);
    if (variants.some(v => isKnowledgeEditor(v))) {
      return true;
    }
  }
  return false;
}

function getMentionedOrQuotedIds(msg) {
  const ctx = msg?.message?.extendedTextMessage?.contextInfo;
  const mentioned = Array.isArray(ctx?.mentionedJid) ? ctx.mentionedJid : [];
  const quoted = [ctx?.participant, ctx?.participantPn];
  return Array.from(
    new Set([...mentioned, ...quoted].map(normalizeJid).filter(Boolean))
  );
}

function getBotIdSet(sock) {
  const ids = new Set();
  const rawIds = [sock?.user?.id, sock?.user?.lid]
    .map(v => String(v || "").trim())
    .filter(Boolean);

  for (const raw of rawIds) {
    ids.add(raw.toLowerCase());
    const norm = normalizeJid(raw);
    if (norm) ids.add(norm);
  }

  return ids;
}

function getQuotedText(quotedMessage = {}) {
  const q =
    quotedMessage?.ephemeralMessage?.message ||
    quotedMessage?.viewOnceMessage?.message ||
    quotedMessage?.viewOnceMessageV2?.message ||
    quotedMessage?.viewOnceMessageV2Extension?.message ||
    quotedMessage ||
    {};

  return (
    q?.conversation ||
    q?.extendedTextMessage?.text ||
    q?.imageMessage?.caption ||
    q?.videoMessage?.caption ||
    q?.documentMessage?.caption ||
    ""
  );
}

function getContextInfo(msg = {}) {
  const message = msg?.message || {};
  const type = getContentType(message);
  const fromType = type ? message?.[type]?.contextInfo : undefined;
  return (
    fromType ||
    message?.extendedTextMessage?.contextInfo ||
    message?.imageMessage?.contextInfo ||
    message?.videoMessage?.contextInfo ||
    message?.documentMessage?.contextInfo ||
    message?.buttonsResponseMessage?.contextInfo ||
    message?.templateButtonReplyMessage?.contextInfo ||
    message?.listResponseMessage?.contextInfo ||
    null
  );
}

async function expandParticipantCandidates(sock, participants = []) {
  const out = new Set();
  const input = (participants || [])
    .map(v => String(v || "").trim())
    .filter(Boolean);

  for (const raw of input) {
    out.add(raw);

    // Beberapa kasus butuh varian tanpa device suffix, contoh:
    // 62812xxxx:17@s.whatsapp.net -> 62812xxxx@s.whatsapp.net
    if (raw.includes(":") && raw.includes("@")) {
      const [left, right] = raw.split("@");
      const leftBase = left.split(":")[0];
      if (leftBase && right) out.add(`${leftBase}@${right}`);
    }

    const num = normalizeJid(raw);
    if (num) out.add(`${num}@s.whatsapp.net`);
  }

  const lidMapping = sock?.signalRepository?.lidMapping;
  if (lidMapping?.getPNForLID) {
    for (const jid of Array.from(out)) {
      if (!jid.includes("@lid")) continue;
      try {
        const pnJid = await lidMapping.getPNForLID(jid);
        const v = String(pnJid || "").trim();
        if (v) {
          out.add(v);
          if (v.includes(":") && v.includes("@")) {
            const [left, right] = v.split("@");
            const leftBase = left.split(":")[0];
            if (leftBase && right) out.add(`${leftBase}@${right}`);
          }
          const num = normalizeJid(v);
          if (num) out.add(`${num}@s.whatsapp.net`);
        }
      } catch {
        // ignore mapping lookup failures
      }
    }
  }

  return Array.from(out);
}

async function tryDeleteByKey(sock, jid, key) {
  const normalizedKey = {
    remoteJid: key?.remoteJid || jid,
    id: key?.id,
    ...(typeof key?.fromMe === "boolean" ? { fromMe: key.fromMe } : {}),
    ...(key?.participant ? { participant: key.participant } : {})
  };

  if (!normalizedKey.id) {
    return { ok: false, error: new Error("Delete key tidak punya id pesan") };
  }

  let sendErr = null;
  try {
    await sock.sendMessage(normalizedKey.remoteJid, { delete: normalizedKey });
    return { ok: true, via: "sendMessage" };
  } catch (err) {
    sendErr = err;
  }

  try {
    await sock.relayMessage(
      normalizedKey.remoteJid,
      {
        protocolMessage: {
          key: normalizedKey,
          type: 0
        }
      },
      {}
    );
    return { ok: true, via: "relay" };
  } catch (err) {
    return { ok: false, error: err || sendErr || new Error("Delete gagal") };
  }
}

async function buildAccessContext(sock, msg) {
  const jid = msg?.key?.remoteJid || "";
  const ownerIds = parseOwnerIds(sock);
  const senderIds = await getSenderIds(sock, msg);
  const isOwner = msg?.key?.fromMe || senderIds.some(id => ownerIds.has(id));

  let isGroupAdmin = false;
  if (jid.endsWith("@g.us") && !isOwner) {
    try {
      const metadata = await sock.groupMetadata(jid);
      const senderRaw = getSenderRawJids(msg);
      const senderNorm = new Set(senderIds);
      isGroupAdmin = metadata.participants.some(p => {
        if (!p?.admin) return false;
        const pid = String(p.id || "");
        if (senderRaw.includes(pid)) return true;
        const pNorm = normalizeJid(pid);
        return pNorm && senderNorm.has(pNorm);
      });
    } catch {
      isGroupAdmin = false;
    }
  }

  return {
    ownerIds,
    senderIds,
    isOwner: Boolean(isOwner),
    isGroupAdmin: Boolean(isGroupAdmin),
    isPrivileged: Boolean(isOwner || isGroupAdmin)
  };
}

function getAIConversationId(jid, sender) {
  if (jid.endsWith("@g.us")) {
    return `group:${jid}:${sender}`;
  }

  return `private:${jid}`;
}

function getAIKnowledgeScopeId(jid) {
  if (jid.endsWith("@g.us")) {
    return `group:${jid}`;
  }

  return `private:${jid}`;
}

function normalizeKnowledgeScopeId(scopeId = "") {
  const raw = String(scopeId || "").trim();
  if (raw.toLowerCase() === "global") return "global";

  const m = raw.match(/^(group|private):(.+)$/i);
  if (!m) return "";

  const type = m[1].toLowerCase();
  let target = m[2].trim();
  if (!target) return "";

  if (type === "group") {
    if (!target.endsWith("@g.us")) target = `${target.replace(/[^0-9]/g, "")}@g.us`;
    return target.replace(/^group:/i, "") ? `group:${target}` : "";
  }

  if (!target.includes("@")) target = `${normalizeJid(target)}@s.whatsapp.net`;
  return target ? `private:${target}` : "";
}

function normalizeAliasName(name = "") {
  return String(name || "")
    .toLowerCase()
    .replace(/^@+/, "")
    .replace(/[^a-z0-9_.-]/g, "")
    .trim();
}

function resolveKnowledgeAlias(alias = "") {
  const key = normalizeAliasName(alias);
  if (!key) return "";
  return normalizeKnowledgeScopeId(knowledgeAliases[key] || "");
}

function parseTargetKnowledgeScope(text = "", currentScopeId = "") {
  const raw = String(text || "").trim();
  if (!raw) {
    return { scopeId: currentScopeId, input: raw, hasOverride: false };
  }

  const alias = raw.match(/^(?:di|ke|untuk|target)\s+@([a-z0-9_.-]+)\s+([\s\S]+)$/i);
  if (alias) {
    const scopeId = resolveKnowledgeAlias(alias[1]);
    return {
      scopeId: scopeId || currentScopeId,
      input: alias[2].trim(),
      hasOverride: Boolean(scopeId),
      error: scopeId ? "" : `Alias @${alias[1]} tidak ditemukan.`
    };
  }

  const global = raw.match(/^(?:di|ke|untuk|target)\s+global\s+([\s\S]+)$/i);
  if (global) {
    return {
      scopeId: "global",
      input: global[1].trim(),
      hasOverride: true,
      error: ""
    };
  }

  const shorthandGlobal = raw.match(/^global\s+([\s\S]+)$/i);
  if (shorthandGlobal) {
    return {
      scopeId: "global",
      input: shorthandGlobal[1].trim(),
      hasOverride: true,
      error: ""
    };
  }

  const direct = raw.match(/^(?:di|ke|untuk|target)\s+(?:scope\s+)?((?:group|private):\S+|global)\s+([\s\S]+)$/i);
  if (direct) {
    const scopeId = normalizeKnowledgeScopeId(direct[1]);
    return {
      scopeId: scopeId || currentScopeId,
      input: direct[2].trim(),
      hasOverride: Boolean(scopeId),
      error: scopeId ? "" : "Scope target tidak valid."
    };
  }

  const group = raw.match(/^(?:di|ke|untuk|target)\s+(?:grup|group)\s+([0-9]+(?:@g\.us)?)\s+([\s\S]+)$/i);
  if (group) {
    const scopeId = normalizeKnowledgeScopeId(`group:${group[1]}`);
    return {
      scopeId: scopeId || currentScopeId,
      input: group[2].trim(),
      hasOverride: Boolean(scopeId),
      error: scopeId ? "" : "JID grup target tidak valid."
    };
  }

  return { scopeId: currentScopeId, input: raw, hasOverride: false };
}

function formatScopeLabel(scopeId = "") {
  if (scopeId === "global") return "global";
  if (scopeId.startsWith("group:")) return `grup ${scopeId.slice("group:".length)}`;
  if (scopeId.startsWith("private:")) return `private ${scopeId.slice("private:".length)}`;
  return scopeId || "-";
}

function getFeatureRedirect(aiInput = "") {
  return getAIFeatureRedirect(aiInput);
}

function normalizeKnowledgeLookup(text = "") {
  return String(text || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenizeKnowledgeLookup(text = "") {
  return Array.from(
    new Set(
      normalizeKnowledgeLookup(text)
        .split(/\s+/)
        .filter(token => token.length >= 3)
    )
  );
}

function resolveStoredFactKey(scopeId, requestedKey = "") {
  const cleaned = normalizeKnowledgeLookup(requestedKey);
  const facts = listStoredFacts(scopeId);

  if (!cleaned || !facts.length) {
    return { key: String(requestedKey || "").trim().toLowerCase(), found: false, ambiguous: false };
  }

  const exact = facts.find(item => normalizeKnowledgeLookup(item.key) === cleaned);
  if (exact) {
    return { key: exact.key, value: exact.value, found: true, ambiguous: false, score: 999 };
  }

  const tokens = tokenizeKnowledgeLookup(cleaned);
  const scored = facts
    .map(item => {
      const keyNorm = normalizeKnowledgeLookup(item.key);
      const valueNorm = normalizeKnowledgeLookup(item.value);
      let score = 0;

      if (keyNorm.includes(cleaned) || cleaned.includes(keyNorm)) score += 8;
      for (const token of tokens) {
        if (keyNorm.split(/\s+/).includes(token)) score += 4;
        else if (keyNorm.includes(token)) score += 2;
        else if (valueNorm.includes(token)) score += 1;
      }

      return { ...item, score };
    })
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score);

  if (!scored.length || scored[0].score < 3) {
    return { key: String(requestedKey || "").trim().toLowerCase(), found: false, ambiguous: false };
  }

  const top = scored[0];
  const runnerUp = scored[1];
  const ambiguous = Boolean(runnerUp && runnerUp.score >= top.score && normalizeKnowledgeLookup(runnerUp.key) !== normalizeKnowledgeLookup(top.key));

  return {
    key: top.key,
    value: top.value,
    found: true,
    ambiguous,
    score: top.score,
    alternatives: scored.slice(0, 3).map(item => item.key)
  };
}

function formatKnowledgeFactsText(scopeId, facts = []) {
  const lines = [
    `Scope: ${scopeId}`,
    `Total: ${facts.length}`,
    `Dibuat: ${new Date().toISOString()}`,
    ""
  ];

  for (const item of facts) {
    const meta = getStoredFactMeta(scopeId, item.key);
    lines.push(`${item.key} = ${item.value}`);
    if (meta?.updatedBy || meta?.updatedAt) {
      lines.push(`  updatedBy: ${meta?.updatedBy || "-"}`);
      lines.push(`  updatedAt: ${meta?.updatedAt || "-"}`);
    }
    lines.push("");
  }

  return lines.join("\n").trim() || "Tidak ada data.";
}

function parseKnowledgeImportText(text = "") {
  const raw = String(text || "").trim();
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed
        .map(item => ({
          key: String(item?.key || item?.name || "").trim(),
          value: String(item?.value || item?.content || "").trim()
        }))
        .filter(item => item.key && item.value);
    }

    const source = parsed?.data && typeof parsed.data === "object" ? parsed.data : parsed;
    if (source && typeof source === "object") {
      return Object.entries(source)
        .map(([key, value]) => ({
          key: String(key || "").trim(),
          value: typeof value === "string" ? value.trim() : JSON.stringify(value)
        }))
        .filter(item => item.key && item.value);
    }
  } catch {
    // Lanjut parsing teks biasa.
  }

  return raw
    .split(/\r?\n/)
    .map(line => line.replace(/^[-*]\s*/, "").trim())
    .map(line => {
      const eq = line.indexOf("=");
      const colon = line.indexOf(":");
      let idx = -1;
      if (eq > 0 && colon > 0) idx = Math.min(eq, colon);
      else if (eq > 0) idx = eq;
      else if (colon > 0) idx = colon;
      if (idx < 1) return null;
      return {
        key: line.slice(0, idx).trim(),
        value: line.slice(idx + 1).trim()
      };
    })
    .filter(item => item?.key && item?.value);
}

async function readQuotedDocumentText(msg) {
  const quoted = getContextInfo(msg)?.quotedMessage;
  if (!quoted) return "";

  const type = getContentType(quoted);
  if (type !== "documentMessage") return "";

  const node = quoted.documentMessage;
  const mimetype = String(node?.mimetype || "").toLowerCase();
  const fileName = String(node?.fileName || "").toLowerCase();
  const looksText =
    mimetype.includes("json") ||
    mimetype.includes("text") ||
    fileName.endsWith(".json") ||
    fileName.endsWith(".txt");

  if (!looksText) {
    throw new Error("File import harus .txt atau .json.");
  }

  if (Number(node?.fileLength || 0) > 512 * 1024) {
    throw new Error("File import maksimal 512 KB.");
  }

  const buffer = await downloadMediaMessage(
    { message: quoted },
    "buffer",
    {},
    { logger: console }
  );
  return Buffer.from(buffer || []).toString("utf8");
}

function getAIConfirmKey(jid, sender) {
  return `${jid}:${sender}`;
}

function setAIConfirmation(jid, sender, payload) {
  const key = getAIConfirmKey(jid, sender);
  aiConfirmations.set(key, {
    ...payload,
    createdAt: Date.now()
  });
}

function getAIConfirmation(jid, sender) {
  const key = getAIConfirmKey(jid, sender);
  const pending = aiConfirmations.get(key);
  if (!pending) return null;
  if (Date.now() - pending.createdAt > AI_CONFIRM_TTL_MS) {
    aiConfirmations.delete(key);
    return null;
  }
  return pending;
}

function clearAIConfirmation(jid, sender) {
  aiConfirmations.delete(getAIConfirmKey(jid, sender));
}

function isValidImageBuffer(buffer) {
  if (!buffer || buffer.length < 20) return false;

  // PNG
  if (buffer.slice(0, 8).toString("hex") === "89504e470d0a1a0a") return true;

  // JPG / JPEG
  if (buffer.slice(0, 3).toString("hex") === "ffd8ff") return true;

  // WEBP (RIFF)
  if (buffer.slice(0, 4).toString() === "RIFF") return true;

  return false;
}

async function safeDeleteFile(filePath) {
  if (!filePath) return;

  try {
    await fs.promises.unlink(filePath);
    logInfo(`TMP CLEANED | ${filePath}`);
  } catch (err) {
    if (err?.code === "ENOENT") return;
    logWarn(`TMP CLEANUP FAILED | ${filePath} | ${err?.message || err}`);
  }
}

function getErrorMessage(err) {
  if (!err) return "unknown error";
  if (typeof err === "string") return err;
  if (err?.message) return err.message;
  if (err?.response?.data?.message) return String(err.response.data.message);
  return String(err);
}

function formatDateIndo(dateInput) {
  if (!dateInput) return "-";
  const d = new Date(dateInput);
  if (Number.isNaN(d.getTime())) return String(dateInput);
  return d.toLocaleDateString("id-ID", {
    weekday: "long",
    day: "2-digit",
    month: "long"
  });
}

const {
  runtimeStats,
  logCommandResult,
  enforceRateLimit,
  enqueueDownloaderTask,
  getDownloaderQueueSize,
  getDownloaderQueueSnapshot,
  enqueueImageSearch
} = createRuntimeToolkit({
  logInfo,
  logWarn,
  reply,
  ytChoiceCache,
  ytSearchCache,
  ytChoiceTtlMs: YT_CHOICE_TTL_MS,
  ytSearchTtlMs: YT_SEARCH_TTL_MS
});

/* ===============================
   TTS COOLDOWN
================================ */
const ttsCooldown = new Map();
const TTS_DELAY = 15_000; // 15 detik
const MODULAR_PREFIX = process.env.BOT_PREFIX || "!";
const MODULAR_OWNER_NUMBER = (process.env.OWNER_NUMBER || appConfig.ownerNumber || "")
  .replace(/[^0-9]/g, "");

const modularGuard = createAbuseGuard({
  maxInputLength: Math.max(1200, Number(appConfig.maxInputLength) || 1200),
  defaultCooldownMs: 0,
  blockedUsers: new Set(),
  ownerNumber: MODULAR_OWNER_NUMBER
});

const modularLogger = {
  debug: (message, meta) => logInfo(`${message}${meta ? ` | ${JSON.stringify(meta)}` : ""}`),
  info: (message, meta) => logInfo(`${message}${meta ? ` | ${JSON.stringify(meta)}` : ""}`),
  warn: (message, meta) => logWarn(`${message}${meta ? ` | ${JSON.stringify(meta)}` : ""}`),
  error: (message, meta) => logError(message, meta)
};

let modularRouter = null;

function parseCommandName(text = "", prefix = MODULAR_PREFIX) {
  const raw = String(text || "").trim();
  if (!raw.startsWith(prefix)) return "";

  const body = raw.slice(prefix.length).trim();
  if (!body) return "";

  return body.split(/\s+/)[0].toLowerCase();
}

function getModularRouter() {
  if (modularRouter) return modularRouter;

  const modularDeps = {
    fs,
    getContentType,
    downloadMediaMessage,
    makeSticker,
    logWarn,
    isValidImageBuffer,
    stickerToImage,
    ytSearch,
    ytSearchCache,
    ytChoiceCache,
    searchYouTubeMusic,
    enforceRateLimit,
    normalizeYouTubeUrl,
    enqueueDownloaderTask,
    downloadYouTubeAudio,
    safeDeleteFile,
    downloadYouTubeVideo,
    downloadTikTok,
    downloadInstagram,
    getWeatherTomorrow,
    formatDateIndo,
    getWeatherIcon,
    getWeatherBMKG,
    parseImageFlags,
    parseOwnerIds,
    getSenderIds,
    searchImage,
    enqueueImageSearch,
    downloadImage,
    createQuoteImageBuffer,
    formatUptime,
    formatBytes,
    pingUrl,
    getDownloaderQueueSnapshot,
    getDownloaderQueueSize,
    runtimeStats,
    tts,
    ttsCooldown,
    TTS_DELAY,
    tagAll,
    tagAdmin,
    logInfo,
    logError,
    getErrorMessage,
    logCommandResult,
    getReminders: () => reminders,
    setReminders: next => {
      reminders = Array.isArray(next) ? next : reminders;
    },
    saveReminders,
    normalizeReminderTime,
    formatReminderListItem,
    normalizeJid,
    getAccessContext: ({ sock, msg }) => buildAccessContext(sock, msg),
    getContextInfo,
    getQuotedText,
    getBotIdSet,
    BOT_FOOTER,
    saveBotState,
    botState,
    expandParticipantCandidates,
    tryDeleteByKey,
    hasKnowledgeEditAccess,
    getAIConversationId,
    getAIKnowledgeScopeId,
    parseTargetKnowledgeScope,
    formatScopeLabel,
    getAIConfirmation,
    clearAIConfirmation,
    setAIConfirmation,
    setStoredFact,
    appendKnowledgeAudit,
    getAIHistorySize,
    clearAIHistory,
    normalizeAliasName,
    normalizeKnowledgeScopeId,
    saveKnowledgeAliases,
    tokenizeKnowledgeLookup,
    normalizeKnowledgeLookup,
    getMentionedOrQuotedIds,
    getIdVariants,
    addKnowledgeEditor,
    removeKnowledgeEditor,
    listKnowledgeEditors,
    clearKnowledgeEditors,
    listKnowledgeScopes,
    exportKnowledgeSnapshot,
    formatKnowledgeFactsText,
    listStoredFacts,
    readQuotedDocumentText,
    parseKnowledgeImportText,
    readKnowledgeAudit,
    extractKnowledgeFact,
    extractKnowledgeMutation,
    resolveStoredFactKey,
    deleteStoredFact,
    getStoredFact,
    getStoredFactMeta,
    isAIKnowledgeMutationRequest,
    getFeatureRedirect,
    buildFactsContext,
    askAI,
    knowledgeAliases,
    YT_CHOICE_TTL_MS,
    YT_SEARCH_TTL_MS
  };

  const commands = createModularCommands(modularDeps);
  const passiveHandlers = createModularPassiveHandlers(modularDeps);

  modularRouter = createCommandRouter({
    prefix: MODULAR_PREFIX,
    commands,
    passiveHandlers,
    guard: modularGuard,
    logger: modularLogger,
    ownerNumber: MODULAR_OWNER_NUMBER
  });

  return modularRouter;
}

/* ===============================
   MAIN HANDLER
================================ */
export default async function handler(sock, msg) {
  const jid = msg?.key?.remoteJid || "unknown";
  const sender = msg?.key?.participant || msg?.key?.remoteJid || "unknown";
  const text = getText(msg)?.trim();

  try {
    activeSockForJobs = sock;
    if (!text) return;

    logInfo(
      `CMD from ${sender.split("@")[0]} | ${jid.endsWith("@g.us") ? "GROUP" : "PRIVATE"} | ${text}`
    );

// tapi izinkan command fromMe di private/grup
    if (msg.key.fromMe && text.includes(BOT_FOOTER)) return;

    const command = parseCommandName(text, MODULAR_PREFIX);

    if (botState.maintenance.enabled && command) {
      const isAllowedCore = MAINTENANCE_ALLOWED_COMMANDS.has(command);
      if (!isAllowedCore) {
        const access = await buildAccessContext(sock, msg);
        if (!access.isPrivileged) {
          logCommandResult({
            command,
            sender,
            jid,
            status: "FAIL",
            reason: "maintenance mode aktif",
            durationMs: 0
          });
          const reason = botState.maintenance.reason
            ? `\n📝 Alasan: ${botState.maintenance.reason}`
            : "";
          await reply(
            sock,
            msg,
            `🛠️ Bot sedang maintenance. Coba lagi nanti.${reason}\n\nGunakan \`!status\` atau \`!stats\` untuk cek keadaan bot.`
          );
          return;
        }
      }
    }

    const router = getModularRouter();
    const handledByModular = await router.handle({
      sock,
      msg,
      text,
      sender,
      jid,
      reply
    });
    if (handledByModular || !command) return;

    logCommandResult({
      command,
      sender,
      jid,
      status: "FAIL",
      reason: "command tidak dikenali",
      durationMs: 0
    });

 } catch (err) {
  if (typeof text === "string" && text.startsWith("!")) {
    const rawCmd = text.slice(1).trim().split(/\s+/)[0] || "unknown";
    logCommandResult({
      command: rawCmd.toLowerCase(),
      sender,
      jid,
      status: "FAIL",
      reason: getErrorMessage(err),
      durationMs: 0
    });
  }
  logError(
    `HANDLER FAIL | user=${String(sender).split("@")[0]} | cmd=${text || "-"}`,
    err
  );
}
}
