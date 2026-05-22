import {
  getContentType,
  downloadMediaMessage
} from "@whiskeysockets/baileys";

import fs from "fs";
import os from "os";
import path from "path";
import sharp from "sharp";

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

/* ===============================
   HELPER REPLY (TAMBAHAN SAJA)
================================ */
function reply(sock, msg, payload) {
  const jid = msg.key.remoteJid;
  const content = typeof payload === "string" ? { text: payload } : { ...payload };

  if (typeof content.text === "string") {
    content.text = addBotFooter(content.text);
  }

  if (typeof content.caption === "string") {
    content.caption = addBotFooter(content.caption);
  }

  return sock.sendMessage(
    jid,
    content,
    { quoted: msg }
  );
}

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
  const envOwnerRaw = String(process.env.OWNER_NUMBER || "");

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

function logCommandResult({
  command = "unknown",
  sender = "unknown",
  jid = "unknown",
  status = "OK",
  reason = "-",
  durationMs = 0
}) {
  const senderNum = String(sender).split("@")[0];
  const scope = String(jid).endsWith("@g.us") ? "GROUP" : "PRIVATE";
  const safeReason = String(reason || "-").replace(/\s+/g, " ").trim();
  const line =
    `CMD ${status} | ${command} | user=${senderNum} | ${scope} | ${durationMs}ms | ${safeReason}`;

  if (status === "OK") {
    logInfo(line);
  } else {
    logWarn(line);
  }

  recordCommandStats(command, status, durationMs);
}

const DOWNLOADER_COMMANDS = new Set([
  "yta",
  "yt-choice-audio",
  "yt-choice-video",
  "ytsearch-pick",
  "tt",
  "ig"
]);

const runtimeStats = {
  startedAt: Date.now(),
  totals: { ok: 0, fail: 0 },
  downloader: { ok: 0, fail: 0 },
  commands: new Map()
};

function recordCommandStats(command, status, durationMs = 0) {
  const key = String(command || "unknown");
  const stat = runtimeStats.commands.get(key) || {
    total: 0,
    ok: 0,
    fail: 0,
    totalDurationMs: 0,
    lastAt: 0
  };

  stat.total += 1;
  stat.totalDurationMs += Number(durationMs) || 0;
  stat.lastAt = Date.now();

  if (status === "OK") {
    stat.ok += 1;
    runtimeStats.totals.ok += 1;
    if (DOWNLOADER_COMMANDS.has(key)) runtimeStats.downloader.ok += 1;
  } else {
    stat.fail += 1;
    runtimeStats.totals.fail += 1;
    if (DOWNLOADER_COMMANDS.has(key)) runtimeStats.downloader.fail += 1;
  }

  runtimeStats.commands.set(key, stat);
}

const rateLimitStore = new Map();
const RATE_LIMIT_PRUNE_KEEP_MS = 10 * 60 * 1000;

function hitRateLimit(userKey, bucket, limit, windowMs) {
  const now = Date.now();
  const key = `${userKey}:${bucket}`;
  const existing = rateLimitStore.get(key) || [];
  const active = existing.filter(ts => now - ts < windowMs);

  if (active.length >= limit) {
    rateLimitStore.set(key, active);
    const retryMs = windowMs - (now - active[0]);
    return { limited: true, retryMs };
  }

  active.push(now);
  rateLimitStore.set(key, active);
  return { limited: false, retryMs: 0 };
}

function pruneRateLimitStore() {
  const now = Date.now();
  for (const [key, values] of rateLimitStore.entries()) {
    const kept = Array.isArray(values)
      ? values.filter(ts => now - ts < RATE_LIMIT_PRUNE_KEEP_MS)
      : [];
    if (!kept.length) {
      rateLimitStore.delete(key);
      continue;
    }
    rateLimitStore.set(key, kept);
  }
}

function pruneRuntimeStats() {
  const maxCommandEntries = Number(process.env.STATS_MAX_COMMANDS || 150);
  if (runtimeStats.commands.size <= maxCommandEntries) return;

  const sorted = Array.from(runtimeStats.commands.entries())
    .sort((a, b) => b[1].lastAt - a[1].lastAt)
    .slice(0, maxCommandEntries);
  runtimeStats.commands = new Map(sorted);
}

function pruneYtCaches() {
  const now = Date.now();

  for (const [key, value] of ytChoiceCache.entries()) {
    if (!value?.createdAt || now - value.createdAt > YT_CHOICE_TTL_MS) {
      ytChoiceCache.delete(key);
    }
  }

  for (const [key, value] of ytSearchCache.entries()) {
    if (Array.isArray(value)) continue;
    if (!value?.createdAt || now - value.createdAt > YT_SEARCH_TTL_MS) {
      ytSearchCache.delete(key);
    }
  }
}

async function enforceRateLimit({
  sock,
  msg,
  senderKey,
  bucket,
  limit,
  windowMs,
  commandLabel,
  sender,
  jid
}) {
  const r = hitRateLimit(senderKey, bucket, limit, windowMs);
  if (!r.limited) return false;

  const waitSec = Math.max(1, Math.ceil(r.retryMs / 1000));
  logCommandResult({
    command: commandLabel,
    sender,
    jid,
    status: "FAIL",
    reason: `rate limit (${bucket}) ${waitSec}s`,
    durationMs: 0
  });

  await reply(
    sock,
    msg,
    `⏳ Terlalu cepat. Coba lagi dalam *${waitSec} detik* untuk command ini.`
  );
  return true;
}

const downloaderQueue = [];
let downloaderQueueActive = false;
let downloaderCurrentTask = null;

function enqueueDownloaderTask(taskName, worker) {
  const position = (downloaderQueueActive ? 1 : 0) + downloaderQueue.length + 1;
  let resolveTask;
  let rejectTask;

  const promise = new Promise((resolve, reject) => {
    resolveTask = resolve;
    rejectTask = reject;
  });

  downloaderQueue.push({
    taskName,
    worker,
    resolveTask,
    rejectTask
  });

  processDownloaderQueue();
  return { position, promise };
}

async function processDownloaderQueue() {
  if (downloaderQueueActive) return;
  const task = downloaderQueue.shift();
  if (!task) return;

  downloaderQueueActive = true;
  downloaderCurrentTask = {
    name: task.taskName,
    startedAt: Date.now()
  };
  try {
    const result = await task.worker();
    task.resolveTask(result);
  } catch (err) {
    task.rejectTask(err);
  } finally {
    downloaderQueueActive = false;
    downloaderCurrentTask = null;
    processDownloaderQueue();
  }
}

function getDownloaderQueueSize() {
  return downloaderQueue.length + (downloaderQueueActive ? 1 : 0);
}

function getDownloaderQueueSnapshot() {
  const waiting = downloaderQueue.length;
  const active = downloaderCurrentTask
    ? {
        name: downloaderCurrentTask.name,
        runningSec: Math.floor((Date.now() - downloaderCurrentTask.startedAt) / 1000)
      }
    : null;
  return { waiting, active, total: getDownloaderQueueSize() };
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

setInterval(() => {
  pruneRateLimitStore();
  pruneRuntimeStats();
  pruneYtCaches();
}, 2 * 60 * 1000).unref?.();

/* ===============================
   TTS COOLDOWN
================================ */
const ttsCooldown = new Map();
const TTS_DELAY = 15_000; // 15 detik

/* ===============================
   IMAGE SEARCH GLOBAL QUEUE
   Mencegah 429 ke Google CSE karena
   banyak request bersamaan
================================ */
const imageSearchQueue = [];
let imageSearchBusy = false;
const IMAGE_SEARCH_INTERVAL_MS = 1200; // min jeda antar request ke CSE

function enqueueImageSearch(worker) {
  return new Promise((resolve, reject) => {
    imageSearchQueue.push({ worker, resolve, reject });
    processImageSearchQueue();
  });
}

async function processImageSearchQueue() {
  if (imageSearchBusy || !imageSearchQueue.length) return;
  imageSearchBusy = true;
  const task = imageSearchQueue.shift();
  try {
    const result = await task.worker();
    task.resolve(result);
  } catch (err) {
    task.reject(err);
  } finally {
    setTimeout(() => {
      imageSearchBusy = false;
      processImageSearchQueue();
    }, IMAGE_SEARCH_INTERVAL_MS);
  }
}


/* ===============================
   MAIN HANDLER
================================ */
export default async function handler(sock, msg) {
  const jid = msg?.key?.remoteJid || "unknown";
  const sender = msg?.key?.participant || msg?.key?.remoteJid || "unknown";
  const text = getText(msg)?.trim();
  const senderRateKey = normalizeJid(sender) || sender;

  try {
    activeSockForJobs = sock;
    if (!text) return;



    logInfo(
      `CMD from ${sender.split("@")[0]} | ${jid.endsWith("@g.us") ? "GROUP" : "PRIVATE"} | ${text}`
    );

    // ⛔ anti loop: abaikan pesan otomatis bot sendiri (ber-footer),
    // tapi izinkan command fromMe di private/grup
    if (msg.key.fromMe && text.includes(BOT_FOOTER)) return;

    if (botState.maintenance.enabled && /^[1-5]$/.test(text)) {
      const ctx = await buildAccessContext(sock, msg);
      if (!ctx.isPrivileged) {
        return reply(sock, msg, "🛠️ Bot sedang maintenance. Proses downloader sementara ditahan.");
      }
    }


    /* ===============================
       1️⃣ HANDLE YT CHOICE + YTSEARCH NUMBER REPLY
    ================================ */
    if (/^[1-2]$/.test(text)) {
      const ytChoice = ytChoiceCache.get(sender);
      if (ytChoice) {
        if (
          await enforceRateLimit({
            sock,
            msg,
            senderKey: senderRateKey,
            bucket: "downloader",
            limit: 6,
            windowMs: 60_000,
            commandLabel: "yt-choice",
            sender,
            jid
          })
        ) {
          return;
        }

        const expired = Date.now() - ytChoice.createdAt > YT_CHOICE_TTL_MS;
        if (expired) {
          ytChoiceCache.delete(sender);
          return reply(sock, msg, "⌛ Pilihan !yt sudah kadaluarsa. Kirim ulang `!yt <link>`.");
        }

        ytChoiceCache.delete(sender);

        if (text === "1") {
          await reply(sock, msg, "🎧 Mengambil audio (MP3)...");
          try {
            const queued = enqueueDownloaderTask(
              "yt-choice-audio",
              () => downloadYouTubeAudio(ytChoice.url)
            );
            if (queued.position > 1) {
              await reply(sock, msg, `⏳ Antrean downloader: posisi *${queued.position}*.`);
            }

            const audioPath = await queued.promise;
            await reply(sock, msg, {
              audio: { url: audioPath },
              mimetype: "audio/mpeg"
            });
            await safeDeleteFile(audioPath);
            logCommandResult({
              command: "yt-choice-audio",
              sender,
              jid,
              status: "OK",
              reason: "audio terkirim",
              durationMs: 0
            });
            return;
          } catch (err) {
            logCommandResult({
              command: "yt-choice-audio",
              sender,
              jid,
              status: "FAIL",
              reason: getErrorMessage(err),
              durationMs: 0
            });
            return reply(
              sock,
              msg,
              typeof err === "string" ? `❌ ${err}` : "❌ Gagal mengambil audio."
            );
          }
        }

        await reply(sock, msg, "🎬 Mengambil video (MP4)...");
        try {
          const queued = enqueueDownloaderTask(
            "yt-choice-video",
            () => downloadYouTubeVideo(ytChoice.url)
          );
          if (queued.position > 1) {
            await reply(sock, msg, `⏳ Antrean downloader: posisi *${queued.position}*.`);
          }

          const videoPath = await queued.promise;
          await reply(sock, msg, {
            video: { url: videoPath },
            caption: "🎬 Berhasil mengunduh video."
          });
          await safeDeleteFile(videoPath);
          logCommandResult({
            command: "yt-choice-video",
            sender,
            jid,
            status: "OK",
            reason: "video terkirim",
            durationMs: 0
          });
          return;
        } catch (err) {
          logCommandResult({
            command: "yt-choice-video",
            sender,
            jid,
            status: "FAIL",
            reason: getErrorMessage(err),
            durationMs: 0
          });
          return reply(
            sock,
            msg,
            typeof err === "string" ? `❌ ${err}` : "❌ Gagal mengambil video."
          );
        }
      }
    }

    if (/^[1-5]$/.test(text)) {
      const cacheState = ytSearchCache.get(sender);
      if (!cacheState) return;
      const cacheItems = Array.isArray(cacheState)
        ? cacheState
        : cacheState.items;
      const cacheCreatedAt = Array.isArray(cacheState)
        ? Date.now()
        : Number(cacheState.createdAt || 0);
      if (!Array.isArray(cacheItems) || !cacheItems.length) return;
      if (cacheCreatedAt && Date.now() - cacheCreatedAt > YT_SEARCH_TTL_MS) {
        ytSearchCache.delete(sender);
        return reply(sock, msg, "⌛ Hasil pencarian sudah kadaluarsa. Kirim ulang `!ytsearch` atau `!musik`.");
      }
      if (
        await enforceRateLimit({
          sock,
          msg,
          senderKey: senderRateKey,
          bucket: "downloader",
          limit: 6,
          windowMs: 60_000,
          commandLabel: "ytsearch-pick",
          sender,
          jid
        })
      ) {
        return;
      }

      const selected = cacheItems[Number(text) - 1];
      if (!selected) return;

      ytSearchCache.delete(sender);

      await reply(sock, msg, `🎧 Mengambil audio:\n${selected.title}`);

      try {
        const ytUrl = normalizeYouTubeUrl(selected.url) || selected.url;
        const queued = enqueueDownloaderTask(
          "ytsearch-pick",
          () => downloadYouTubeAudio(ytUrl)
        );
        if (queued.position > 1) {
          await reply(sock, msg, `⏳ Antrean downloader: posisi *${queued.position}*.`);
        }

        const audioPath = await queued.promise;
        await reply(sock, msg, {
          audio: { url: audioPath },
          mimetype: "audio/mpeg"
        });
        await safeDeleteFile(audioPath);
        logCommandResult({
          command: "ytsearch-pick",
          sender,
          jid,
          status: "OK",
          reason: "audio hasil pencarian terkirim",
          durationMs: 0
        });
        return;
      } catch (err) {
        logCommandResult({
          command: "ytsearch-pick",
          sender,
          jid,
          status: "FAIL",
          reason: getErrorMessage(err),
          durationMs: 0
        });
        return reply(
          sock,
          msg,
          typeof err === "string" ? `❌ ${err}` : "❌ Gagal mengambil audio."
        );
      }
    }

    /* ===============================
       2️⃣ HANYA COMMAND
    ================================ */
    if (!text.startsWith("!")) return;

    const args = text.slice(1).trim().split(/\s+/);
    const command = args.shift().toLowerCase();
    const input = args.join(" ");
    let accessContext = null;
    const getAccessContext = async () => {
      if (accessContext) return accessContext;
      accessContext = await buildAccessContext(sock, msg);
      return accessContext;
    };
    const commandStartMs = Date.now();
    const logOk = (reason) =>
      logCommandResult({
        command,
        sender,
        jid,
        status: "OK",
        reason,
        durationMs: Date.now() - commandStartMs
      });
    const logFail = (reason) =>
      logCommandResult({
        command,
        sender,
        jid,
        status: "FAIL",
        reason,
        durationMs: Date.now() - commandStartMs
      });

    if (botState.maintenance.enabled) {
      const isAllowedCore = MAINTENANCE_ALLOWED_COMMANDS.has(command);
      if (!isAllowedCore) {
        const ctx = await getAccessContext();
        if (!ctx.isPrivileged) {
          logFail("maintenance mode aktif");
          const reason = botState.maintenance.reason
            ? `\n📝 Alasan: ${botState.maintenance.reason}`
            : "";
          return reply(
            sock,
            msg,
            `🛠️ Bot sedang maintenance. Coba lagi nanti.${reason}\n\nGunakan \`!status\` atau \`!stats\` untuk cek keadaan bot.`
          );
        }
      }
    }

    /* ===============================
       STIKER
    ================================ */
if (command === "stiker" || command === "sticker") {
  const quoted =
    msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;

  if (!quoted) {
    return reply(sock, msg, "❗ Reply gambar atau video.");
  }

  const type = getContentType(quoted);

  // ❌ Tolak stiker
  if (type === "stickerMessage") {
    return reply(sock, msg, "❗ Itu sudah stiker.");
  }

  if (quoted.fileLength > 8 * 1024 * 1024) {
  return reply(sock, msg, "❌ Video terlalu besar (maks 8MB).");
}


  // ❌ Hanya image / video
  if (!["imageMessage", "videoMessage"].includes(type)) {
    return reply(sock, msg, "❗ Hanya gambar atau video yang bisa dijadikan stiker.");
  }

  // ❌ Batasi video
  if (type === "videoMessage" && quoted.seconds > 10) {
    return reply(sock, msg, "❗ Video terlalu panjang (maks 10 detik).");
  }

  let buffer;
  try {
    buffer = await downloadMediaMessage(
      { message: quoted },
      "buffer",
      {},
      {
        logger: undefined,
        reuploadRequest: sock.updateMediaMessage
      }
    );
  } catch (err) {
    logError("STICKER DOWNLOAD ERROR", err);
    return reply(sock, msg, "❌ Gagal mengunduh media.");
  }

  // ❌ VALIDASI IMAGE (JPEG / PNG ONLY)
  if (type === "imageMessage" && !isValidImageBuffer(buffer)) {
    logWarn("STICKER INVALID IMAGE BUFFER (WEBP/UNKNOWN)");
    return reply(
      sock,
      msg,
      "❌ Format gambar tidak didukung.\nGunakan JPG atau PNG."
    );
  }

  try {
    const isVideo = type === "videoMessage";
    const sticker = await makeSticker(buffer, isVideo);

    logInfo(`STICKER OK | type=${type}`);
    return reply(sock, msg, { sticker });

  } catch (err) {
    logError("STICKER PROCESS ERROR", err);
    return reply(sock, msg, "❌ Gagal memproses stiker.");
  }
}



    /* ===============================
       TOIMG
    ================================ */
    if (command === "toimg" || command === "toimage") {
      const quoted = getContextInfo(msg)?.quotedMessage;

      if (!quoted) {
        return reply(sock, msg, "❗ Reply stiker dengan !toimg");
      }

      const type = getContentType(quoted);
      if (type !== "stickerMessage") {
        return reply(sock, msg, "❗ Yang direply harus stiker.");
      }

      const buffer = await downloadMediaMessage(
        { message: quoted },
        "buffer",
        {}
      );

      const imageBuffer = await stickerToImage(buffer);
      return reply(sock, msg, {
        image: imageBuffer,
        caption: "🖼️ Berhasil diubah ke gambar"
      });
    }

    /* ===============================
       READ VIEW ONCE
    ================================ */
    if (command === "readviewonce" || command === "readviewone" || command === "rvo") {
      const quoted = getContextInfo(msg)?.quotedMessage;
      if (!quoted) {
        return reply(sock, msg, "❗ Reply pesan view once, lalu kirim `!rvo`.");
      }

      let viewOncePayload =
        quoted?.viewOnceMessage?.message ||
        quoted?.viewOnceMessageV2?.message ||
        quoted?.viewOnceMessageV2Extension?.message ||
        null;

      // Beberapa klien tidak pakai wrapper viewOnceMessage,
      // tapi langsung di image/video dengan flag viewOnce=true.
      if (!viewOncePayload) {
        const directType = getContentType(quoted);
        const directNode = directType ? quoted?.[directType] : null;
        if (directType && directNode?.viewOnce) {
          viewOncePayload = {
            [directType]: {
              ...directNode,
              viewOnce: false
            }
          };
        }
      }

      if (!viewOncePayload) {
        return reply(sock, msg, "❗ Yang direply harus pesan *view once*.");
      }

      const mediaType = getContentType(viewOncePayload);
      const mediaNode = mediaType ? viewOncePayload?.[mediaType] : null;
      if (!mediaType || !mediaNode) {
        return reply(sock, msg, "❌ Media view once tidak valid.");
      }

      try {
        const buffer = await downloadMediaMessage(
          { message: { [mediaType]: mediaNode } },
          "buffer",
          {}
        );

        if (mediaType === "imageMessage") {
          return reply(sock, msg, {
            image: buffer,
            caption: mediaNode?.caption || "🖼️ View once berhasil dibuka."
          });
        }

        if (mediaType === "videoMessage") {
          return reply(sock, msg, {
            video: buffer,
            caption: mediaNode?.caption || "🎬 View once berhasil dibuka."
          });
        }

        if (mediaType === "audioMessage") {
          return reply(sock, msg, {
            audio: buffer,
            mimetype: mediaNode?.mimetype || "audio/ogg; codecs=opus",
            ptt: false
          });
        }

        if (mediaType === "stickerMessage") {
          return reply(sock, msg, { sticker: buffer });
        }

        if (mediaType === "documentMessage") {
          return reply(sock, msg, {
            document: buffer,
            fileName: mediaNode?.fileName || "view-once.bin",
            mimetype: mediaNode?.mimetype || "application/octet-stream"
          });
        }

        return reply(sock, msg, `⚠️ Tipe media view once belum didukung: ${mediaType}`);
      } catch (err) {
        logFail(getErrorMessage(err));
        return reply(sock, msg, "❌ Gagal membaca view once.");
      }
    }

    /* ===============================
       YTSEARCH
    ================================ */
    if (command === "ytsearch") {
      if (!input) {
        logFail("kata kunci kosong");
        return reply(sock, msg, "❗ Masukkan kata kunci");
      }

      try {
        const results = await ytSearch(input);
        ytSearchCache.set(sender, {
          items: results,
          createdAt: Date.now()
        });

        let txt = "*🔎 Hasil YouTube:*\n\n";
        results.forEach((v, i) => {
          txt += `${i + 1}. ${v.title}\n`;
        });
        txt += "\nBalas angka (1–5)";

        logOk(`hasil=${results.length}`);
        return reply(sock, msg, txt);
      } catch (err) {
        logFail(getErrorMessage(err));
        return reply(sock, msg, "❌ Gagal mencari YouTube.");
      }
    }

    /* ===============================
       YMUSIC SEARCH
    ================================ */
    if (command === "musik" || command === "ymusic") {
      if (!input) {
        logFail("query kosong");
        return reply(sock, msg, "❗ Contoh: !musik aku ikhlas aftershine");
      }

      try {
        const results = await searchYouTubeMusic(input);
        ytSearchCache.set(sender, {
          items: results,
          createdAt: Date.now()
        });

        let txt = "*🎵 Hasil YMusic:*\n\n";
        results.forEach((v, i) => {
          const dur = v.duration ? ` (${v.duration})` : "";
          const ch = v.channel ? `\n   👤 ${v.channel}` : "";
          txt += `${i + 1}. ${v.title}${dur}${ch}\n`;
        });
        txt += "\nBalas angka (1–5)";

        logOk(`hasil=${results.length}`);
        return reply(sock, msg, txt);
      } catch (err) {
        logFail(getErrorMessage(err));
        return reply(
          sock,
          msg,
          err?.message ? `❌ ${err.message}` : "❌ Gagal mencari lagu."
        );
      }
    }

    /* ===============================
       YTA (DIRECT LINK)
    ================================ */
    if (command === "yta") {
      if (
        await enforceRateLimit({
          sock,
          msg,
          senderKey: senderRateKey,
          bucket: "downloader",
          limit: 6,
          windowMs: 60_000,
          commandLabel: command,
          sender,
          jid
        })
      ) {
        return;
      }

      const ytUrl = normalizeYouTubeUrl(input);
      if (!ytUrl) {
        logFail("link youtube tidak valid");
        return reply(
          sock,
          msg,
          "❗ Link YouTube tidak valid.\nContoh:\n• !yta https://www.youtube.com/watch?v=...\n• !yta https://youtu.be/..."
        );
      }

      await reply(sock, msg, "🎧 Mengambil audio (yt-dlp)...");

      try {
        const queued = enqueueDownloaderTask(command, () => downloadYouTubeAudio(ytUrl));
        if (queued.position > 1) {
          await reply(sock, msg, `⏳ Antrean downloader: posisi *${queued.position}*.`);
        }

        const audioPath = await queued.promise;
        await reply(sock, msg, {
          audio: { url: audioPath },
          mimetype: "audio/mpeg"
        });
        await safeDeleteFile(audioPath);
        logOk("audio youtube terkirim");
        return;
      } catch (err) {
        logFail(getErrorMessage(err));
        return reply(
          sock,
          msg,
          typeof err === "string" ? err : "❌ Gagal mengambil audio"
        );
      }
    }

    /* ===============================
       YT (PILIH AUDIO / VIDEO)
    ================================ */
    if (command === "yt") {
      const ytUrl = normalizeYouTubeUrl(input);
      if (!ytUrl) {
        logFail("link youtube tidak valid");
        return reply(
          sock,
          msg,
          "❗ Link YouTube tidak valid.\nContoh:\n• !yt https://www.youtube.com/watch?v=...\n• !yt https://youtu.be/..."
        );
      }

      ytChoiceCache.set(sender, {
        url: ytUrl,
        createdAt: Date.now()
      });

      logOk("menunggu pilihan format 1/2");
      return reply(
        sock,
        msg,
        "📥 *Pilih format download:*\n1. Music (MP3)\n2. Video (MP4)\n\nBalas angka *1* atau *2*."
      );
    }

    /* ===============================
       TIKTOK
    ================================ */
    if (command === "tt") {
      if (
        await enforceRateLimit({
          sock,
          msg,
          senderKey: senderRateKey,
          bucket: "downloader",
          limit: 6,
          windowMs: 60_000,
          commandLabel: command,
          sender,
          jid
        })
      ) {
        return;
      }

      if (!/(tiktok\.com|vt\.tiktok\.com|vm\.tiktok\.com)/i.test(input)) {
        logFail("link tiktok tidak valid");
        return reply(sock, msg, "❗ Link TikTok tidak valid");
      }

      await reply(sock, msg, "📥 Mengunduh TikTok...");

      try {
        const queued = enqueueDownloaderTask(command, () => downloadTikTok(input));
        if (queued.position > 1) {
          await reply(sock, msg, `⏳ Antrean downloader: posisi *${queued.position}*.`);
        }

        const data = await queued.promise;
        await reply(sock, msg, {
          video: { url: data.video },
          caption: `🎵 ${data.title}\n👤 ${data.author}`
        });
        if (typeof data?.video === "string" && fs.existsSync(data.video)) {
          await safeDeleteFile(data.video);
        }
        logOk("video tiktok terkirim");
        return;
      } catch (err) {
        logFail(getErrorMessage(err));
        return reply(
          sock,
          msg,
          err?.message ? `❌ ${err.message}` : "❌ Gagal download TikTok"
        );
      }
    }

    /* ===============================
       INSTAGRAM
    ================================ */
    if (command === "ig") {
      if (
        await enforceRateLimit({
          sock,
          msg,
          senderKey: senderRateKey,
          bucket: "downloader",
          limit: 6,
          windowMs: 60_000,
          commandLabel: command,
          sender,
          jid
        })
      ) {
        return;
      }

      if (!/(instagram\.com|instagr\.am)/i.test(input)) {
        logFail("link instagram tidak valid");
        return reply(sock, msg, "❗ Link Instagram tidak valid");
      }

      await reply(sock, msg, "📸 Mengunduh Instagram...");

      try {
        const queued = enqueueDownloaderTask(command, () => downloadInstagram(input));
        if (queued.position > 1) {
          await reply(sock, msg, `⏳ Antrean downloader: posisi *${queued.position}*.`);
        }

        const video = await queued.promise;
        await reply(sock, msg, { video: { url: video } });

        if (typeof video === "string" && fs.existsSync(video)) {
          await safeDeleteFile(video);
        }
        logOk("video instagram terkirim");
        return;
      } catch (err) {
        logFail(getErrorMessage(err));
        return reply(
          sock,
          msg,
          err?.message ? `❌ ${err.message}` : "❌ Gagal download Instagram"
        );
      }
    }

    /* ===============================
       CUACA BMKG
    ================================ */

if (command === "cuaca") {
  const cuacaInput = String(input || "").trim();
  const isBesok = /^(besok|esok)\b/i.test(cuacaInput);
  const lokasiQuery = isBesok
    ? cuacaInput.replace(/^(besok|esok)\s*/i, "").trim()
    : cuacaInput;

  if (!lokasiQuery) {
    logFail("lokasi kosong");
    return reply(sock, msg,
      `❗ *Cara pakai:*\n!cuaca <nama lokasi>\n!cuaca besok <nama lokasi>\n\n*Contoh:*\n• !cuaca Tawang\n• !cuaca besok Tasikmalaya\n• !cuaca Bandung\n\n_Bisa pakai nama kecamatan atau kota_`
    );
  }

 try {
    await reply(sock, msg, "🔍 Mencari data cuaca...");

    if (isBesok) {
      const wBesok = await getWeatherTomorrow(lokasiQuery);
      const cacheLabel = wBesok?._cache?.hit
        ? `cache (${wBesok._cache.ageSec} detik)`
        : "live";
      const tanggal = formatDateIndo(wBesok.date);
      const textBesok = `
🌤️ *PRAKIRAAN BESOK*
📍 ${wBesok.lokasi}
🗺️ ${wBesok.provinsi}
📅 ${tanggal}

${getWeatherIcon(wBesok.weather_desc)} ${wBesok.weather_desc}
🌡️ Suhu: *${wBesok.tMin}°C - ${wBesok.tMax}°C*
🌧️ Peluang hujan: ${wBesok.rainChance}%
💧 Kelembapan rata-rata: ${wBesok.humidityAvg}%
💨 Angin rata-rata: ${wBesok.windAvg} km/j

📡 Sumber: Tomorrow.io | ${cacheLabel}
`.trim();

      logOk(`lokasi-besok=${wBesok.lokasi}`);
      return reply(sock, msg, textBesok);
    }

    const w = await getWeatherBMKG(lokasiQuery);
    const s = w.cuacaSekarang;

    // ✅ Definisikan jamSekarang SEBELUM dipakai
    const jamSekarang = new Date(s.local_datetime).toLocaleTimeString("id-ID", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Asia/Jakarta"
    });

    const prakiraan = w.prakiraan.map(c => {
      const date = new Date(c.local_datetime);
      const jam = date.toLocaleTimeString("id-ID", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Asia/Jakarta"
      });

      return `• ${jam} | ${getWeatherIcon(c.weather_desc)} ${c.weather_desc} | 🌡️ ${c.t}°C | 🌧️ ${c.rainChance}%`;
    }).join("\n");

    const cacheLabel = w?._cache?.hit
      ? `cache (${w._cache.ageSec} detik)`
      : "live";

    const text = `
🌦️ *CUACA SEKARANG*
📍 ${w.lokasi}
🗺️ ${w.provinsi}
🕒 ${jamSekarang} WIB

${getWeatherIcon(s.weather_desc)} ${s.weather_desc}
🌡️ Suhu: *${s.t}°C* (RH ${s.hu}%)
💨 Angin: ${s.ws} km/j

⏱️ *Prakiraan Singkat*
${prakiraan}

📡 Sumber: Tomorrow.io | ${cacheLabel}
`.trim();

    logOk(`lokasi=${w.lokasi}`);
    return reply(sock, msg, text);

  } catch (err) {
    logError("CUACA ERROR", err);
    logFail(getErrorMessage(err));
    return reply(sock, msg,
      `❌ Lokasi *"${lokasiQuery}"* tidak ditemukan.\n\nCoba gunakan nama yang lebih umum.\n\n*Contoh:*\n• !cuaca Tawang\n• !cuaca besok Tasikmalaya\n• !cuaca Bandung`
    );
  }
}
    /* ===============================
       GAMBAR (CSE)
    ================================ */
    if (command === "gambar" || command === "image") {
      if (
        await enforceRateLimit({
          sock,
          msg,
          senderKey: senderRateKey,
          bucket: "image",
          limit: 8,
          windowMs: 60_000,
          commandLabel: command,
          sender,
          jid
        })
      ) {
        return;
      }

      if (!input) {
        logFail("kata kunci kosong");
        return reply(
          sock,
          msg,
          "❗ Contoh:\n!gambar kucing\n!gambar --unsafe anime"
        );
      }

      const { safeMode, query } = parseImageFlags(input);
      if (!query) {
        logFail("query kosong");
        return reply(sock, msg, "❗ Kata kunci kosong.");
      }

      if (!safeMode) {
        const ownerIds = parseOwnerIds(sock);
        const senderIds = await getSenderIds(sock, msg);
        const isOwner = msg.key.fromMe || senderIds.some(id => ownerIds.has(id));

        if (!isOwner) {
          logFail("akses unsafe ditolak");
          return reply(sock, msg, "🔒 Mode UNSAFE hanya untuk owner.");
        }
      }

      await reply(
        sock,
        msg,
        `🖼️ Mencari gambar (${safeMode ? "SAFE" : "UNSAFE"})...`
      );

      try {
        // Antrekan ke global image queue agar tidak membanjiri Google CSE
        const imageUrl = await enqueueImageSearch(() => searchImage(query, safeMode));
        const image = await downloadImage(imageUrl);

        // Guard null: downloadImage bisa return null jika URL gagal diunduh
        if (!image || !image.buffer) {
          logFail("buffer gambar null");
          return reply(sock, msg, "❌ Gambar tidak bisa diunduh. Coba kata kunci lain.");
        }

        logOk(`gambar mode=${safeMode ? "safe" : "unsafe"}`);
        return reply(sock, msg, {
          image: image.buffer,
          mimetype: image.mimetype,
          caption: `🖼️ ${query}\n🛡️ Mode: ${
            safeMode ? "SAFE" : "UNSAFE"
          }`
        });
      } catch (err) {
        logFail(getErrorMessage(err));
        return reply(sock, msg, "❌ Gagal menampilkan gambar. Coba lagi.");
      }
    }

    if (command === "quote" || command === "q") {
      if (
        await enforceRateLimit({
          sock,
          msg,
          senderKey: senderRateKey,
          bucket: "image",
          limit: 8,
          windowMs: 60_000,
          commandLabel: command,
          sender,
          jid
        })
      ) {
        return;
      }

      const ctxInfo = msg?.message?.extendedTextMessage?.contextInfo;
      const quoted = ctxInfo?.quotedMessage;
      const quotedText = getQuotedText(quoted);
      const textInput = String(input || "").trim();
      const finalText = textInput || quotedText;

      if (!finalText) {
        logFail("quote kosong");
        return reply(sock, msg, "❗ Kirim `!quote <teks>` atau reply pesan lalu kirim `!quote`.");
      }

      const author = msg.pushName || normalizeJid(sender) || "User";
      try {
        const image = await createQuoteImageBuffer(finalText, author);
        logOk("quote image terkirim");
        return reply(sock, msg, {
          image,
          caption: "📝 Quote berhasil dibuat."
        });
      } catch (err) {
        logFail(getErrorMessage(err));
        return reply(sock, msg, "❌ Gagal membuat quote.");
      }
    }

    if (command === "jadwal") {
      const raw = String(input || "").trim();
      const [firstToken, ...restTokens] = raw.split(/\s+/).filter(Boolean);
      const sub = String(firstToken || "list").toLowerCase();
      const rest = restTokens.join(" ").trim();

      const inCurrentChat = reminders.filter(r => r.jid === jid);

      if (sub === "list" || sub === "ls") {
        if (!inCurrentChat.length) {
          logFail("jadwal list kosong");
          return reply(sock, msg, "📭 Belum ada jadwal di chat ini.");
        }

        const lines = inCurrentChat
          .sort((a, b) => String(a.time).localeCompare(String(b.time)))
          .map(formatReminderListItem)
          .join("\n");
        logOk(`jadwal list total=${inCurrentChat.length}`);
        return reply(sock, msg, `🗓️ *JADWAL CHAT INI*\n${lines}`);
      }

      if (sub === "tambah" || sub === "add" || normalizeReminderTime(sub)) {
        const timeRaw = normalizeReminderTime(sub) ? sub : firstToken;
        const textRaw = normalizeReminderTime(sub) ? rest : raw.replace(/^(tambah|add)\s+/i, "");
        const [timeToken, ...msgTokens] = textRaw.split(/\s+/).filter(Boolean);
        const time = normalizeReminderTime(normalizeReminderTime(sub) ? timeRaw : timeToken);
        const message = normalizeReminderTime(sub)
          ? rest
          : msgTokens.join(" ").trim();

        if (!time || !message) {
          logFail("jadwal tambah format salah");
          return reply(
            sock,
            msg,
            "❗ Format:\n• !jadwal tambah HH:MM pesan\n• !jadwal HH:MM pesan\nContoh: !jadwal 08:00 Standup tim"
          );
        }

        const id = Math.random().toString(36).slice(2, 7);
        reminders.push({
          id,
          jid,
          time,
          message,
          enabled: true,
          createdAt: Date.now(),
          createdBy: normalizeJid(sender),
          lastTriggeredDate: ""
        });
        saveReminders();
        logOk(`jadwal tambah id=${id} jam=${time}`);
        return reply(sock, msg, `✅ Jadwal ditambahkan.\nID: ${id}\nJam: ${time} WIB\nPesan: ${message}`);
      }

      if (sub === "hapus" || sub === "del" || sub === "delete") {
        const id = rest.split(/\s+/)[0] || "";
        if (!id) {
          logFail("jadwal hapus tanpa id");
          return reply(sock, msg, "❗ Contoh: !jadwal hapus <id>");
        }

        const before = reminders.length;
        reminders = reminders.filter(r => !(r.jid === jid && String(r.id) === String(id)));
        if (reminders.length === before) {
          logFail("jadwal hapus id tidak ditemukan");
          return reply(sock, msg, `❌ Jadwal dengan ID ${id} tidak ditemukan di chat ini.`);
        }

        saveReminders();
        logOk(`jadwal hapus id=${id}`);
        return reply(sock, msg, `🗑️ Jadwal ${id} dihapus.`);
      }

      if (
        sub === "clear"
      ) {
        const before = reminders.length;
        reminders = reminders.filter(r => r.jid !== jid);
        const removed = before - reminders.length;

        if (!removed) {
          logFail("jadwal clear kosong");
          return reply(sock, msg, "📭 Tidak ada jadwal untuk dihapus di chat ini.");
        }

        saveReminders();
        logOk(`jadwal clear total=${removed}`);
        return reply(sock, msg, `🗑️ ${removed} jadwal di chat ini berhasil dihapus.`);
      }

      if (sub === "on" || sub === "off") {
        const id = rest.split(/\s+/)[0] || "";
        if (!id) {
          logFail("jadwal on/off tanpa id");
          return reply(sock, msg, `❗ Contoh: !jadwal ${sub} <id>`);
        }

        const target = reminders.find(r => r.jid === jid && String(r.id) === String(id));
        if (!target) {
          logFail("jadwal on/off id tidak ditemukan");
          return reply(sock, msg, `❌ Jadwal dengan ID ${id} tidak ditemukan di chat ini.`);
        }

        target.enabled = sub === "on";
        saveReminders();
        logOk(`jadwal ${sub} id=${id}`);
        return reply(sock, msg, `✅ Jadwal ${id} ${sub === "on" ? "diaktifkan" : "dinonaktifkan"}.`);
      }

      logFail("jadwal subcommand tidak valid");
      return reply(
        sock,
        msg,
        "❗ Format jadwal:\n• !jadwal list\n• !jadwal tambah HH:MM pesan\n• !jadwal HH:MM pesan\n• !jadwal hapus <id>\n• !jadwal clear\n• !jadwal on <id>\n• !jadwal off <id>"
      );
    }

    /* ===============================
       HELP / MENU
    ================================ */
    if (command === "help" || command === "menu") {
      const botName = process.env.BOT_NAME || "BOT WA";
      const ownerName = process.env.OWNER_NAME || "Owner";
      const ownerNumber = process.env.OWNER_NUMBER || "-";
      const senderName =
        msg.pushName ||
        msg.key.participant?.split("@")[0] ||
        "Unknown";

      const menuText = `
🤖 *${botName} — HELP MENU*
*Halo ${senderName}*
Ini adalah bot experimental yang dibuat dengan library Baileys. Bot ini merupakan project gabut individu dari *${ownerName}*. Sehingga mohon dimaklumi
apabila ada fitur yang kurang stabil atau tidak berjalan sempurna.

━━━━━━━━━━━━━━━━━━
📌 *Daftar Fitur Bot*

🖼️ *Stiker*
• !stiker
  └ Reply gambar / video untuk jadi stiker

🧠 *AI Chat*
• !ai <pertanyaan>
  └ Tanya AI (memory + data chat + data global)
• !ai reset
  └ Hapus memory percakapan AI

📚 *AI Data / Knowledge*
• !ai simpan <kunci>=<nilai>
• !ai simpen data <kunci> adalah <nilai>
• !ai catat bahwa <kunci> adalah <nilai>
  └ Simpan data natural (owner/editor)
• !ai ganti data <kunci> jadi <nilai>
• !ai ubahin data <kunci> jadi <nilai>
  └ Ganti/update data natural (owner/editor)
• !ai hapus <kunci>
• !ai apusin data <kunci>
  └ Hapus data tersimpan (owner/editor)
• !ai data list
  └ Lihat semua data tersimpan
• !ai data <kunci>
  └ Ambil data tertentu
• !ai data log
• !ai data log <kunci>
  └ Lihat riwayat perubahan data
• !ai data export
• !ai data export txt
  └ Export data scope saat ini jadi file
• !ai import data
  └ Import data dari file .txt/.json (preview dulu)
• !ai ya
• !ai batal
  └ Konfirmasi / batalkan import

🌐 *AI Scope / Grup* (Owner)
• !ai scope
  └ Lihat scope data chat ini
• !ai grup list
  └ Kirim file daftar scope semua grup
• !ai grup cari <nama>
  └ Cari scope grup berdasarkan nama
• !ai alias <nama> = group:<jid>
• !ai alias list
• !ai alias hapus <nama>
  └ Alias scope, contoh pakai: !ai untuk @musik data list
• !ai untuk group:<jid> data list
• !ai untuk group:<jid> simpen data <kunci> = <nilai>
• !ai untuk @alias gantiin data <kunci> jadi <nilai>
  └ Kelola data grup lain tanpa chat di grup itu
• !ai global simpen data <kunci> = <nilai>
• !ai global data list
  └ Data global yang bisa dipakai semua chat
• !ai data backup all
  └ Backup semua knowledge ke file JSON

👥 *AI Editor*
• !ai editor list
  └ Lihat daftar editor data
• !ai editor id
  └ Lihat ID kamu (untuk didaftarkan owner)
• !ai editor add <nomor>
  └ Tambah editor (owner only, bisa reply/mention user)
• !ai editor del <nomor>
  └ Hapus editor (owner only)
• !ai editor clear
  └ Hapus semua editor tambahan (owner only)

🎙️ *Text to Speech*
• !suara <teks>
  └ Ubah teks jadi voice note

  🖼️ *Gambar*
• !gambar <kata kunci>
  └ Cari gambar via Google
• !quote <teks>
• !q <teks>
  └ Buat gambar quote dari teks / reply chat

  🔄 *Konversi Media*
• !toimg
  └ Ubah stiker menjadi gambar
• !rvo
  └ Reply pesan view once untuk baca ulang media

  🌦️ *Cuaca* (Beta)
• !cuaca <lokasi>(spasi)<provinsi>(spasi)<negara>
• !cuaca besok <lokasi>
  └ Cek cuaca di lokasi tertentu

🗓️ *Jadwal*
• !jadwal list
• !jadwal HH:MM <pesan>
• !jadwal tambah HH:MM <pesan>
• !jadwal hapus <id>
• !jadwal clear
• !jadwal on <id>
• !jadwal off <id>


🎧 YouTube
• !yt <watch url>
• !musik <query>
• !yta <watch url>
• !ytsearch <query>

⚠️ *Fitur Downloader sedang dalam penhgembangan, mohon bersabar yaa.*

🎵 TikTok
• !tt <url>

📸 Instagram
• !ig <url>

📣 *Tag Grup*
• !tagall <pesan>
  └ Tag semua anggota grup
• !tagadmin <pesan>
  └ Tag admin grup

🧹 *Moderasi*
• !hapus
  └ Reply pesan bot untuk hapus pesan tersebut
• !maintenance status
• !maintenance on [alasan]
• !maintenance off

📊 *Status Bot*
• !ping
• !status
• !stats
• !antrian
  └ Cek status bot & server

━━━━━━━━━━━━━━━━━━
👑 *Owner*
• Nama: ${ownerName}
• Kontak: wa.me/${ownerNumber}

━━━━━━━━━━━━━━━━━━
ℹ️ *Catatan*
• Gunakan bot dengan bijak
• Beberapa fitur hanya bisa di grup
• Bot tidak selalu online 24/7 (jika dinyalakan saja, karena masih pakai PC pribadi sebagai server.)

✅ *Status Bot:* Aktif
`.trim();

      logOk("menu terkirim");
      return reply(sock, msg, menuText);
    }

    if (command === "maintenance") {
      const ctx = await getAccessContext();
      const subRaw = String(input || "").trim();
      const [subCmd] = subRaw.split(/\s+/);
      const sub = String(subCmd || "status").toLowerCase();

      if (sub === "status" || !subRaw) {
        const st = botState.maintenance;
        const enabledText = st.enabled ? "ON" : "OFF";
        const since = st.enabledAt ? `\n🕒 Sejak: ${new Date(st.enabledAt).toLocaleString("id-ID")}` : "";
        const by = st.enabledBy ? `\n👤 Oleh: ${st.enabledBy}` : "";
        const reason = st.reason ? `\n📝 Alasan: ${st.reason}` : "";
        logOk(`maintenance status=${enabledText}`);
        return reply(sock, msg, `🛠️ Maintenance: *${enabledText}*${since}${by}${reason}`);
      }

      if (!ctx.isOwner) {
        logFail("maintenance ditolak: bukan owner");
        return reply(sock, msg, "🔒 Hanya owner yang boleh mengubah mode maintenance.");
      }

      if (sub === "on") {
        const reason = subRaw.replace(/^on\s*/i, "").trim();
        botState.maintenance.enabled = true;
        botState.maintenance.enabledAt = Date.now();
        botState.maintenance.enabledBy = (ctx.senderIds && ctx.senderIds[0]) || normalizeJid(sender);
        botState.maintenance.reason = reason;
        saveBotState();
        logOk("maintenance on");
        return reply(
          sock,
          msg,
          `✅ Maintenance diaktifkan.${reason ? `\n📝 ${reason}` : ""}`
        );
      }

      if (sub === "off") {
        botState.maintenance.enabled = false;
        botState.maintenance.enabledAt = null;
        botState.maintenance.enabledBy = "";
        botState.maintenance.reason = "";
        saveBotState();
        logOk("maintenance off");
        return reply(sock, msg, "✅ Maintenance dimatikan. Bot kembali normal.");
      }

      logFail("maintenance subcommand tidak valid");
      return reply(
        sock,
        msg,
        "❗ Format:\n• !maintenance status\n• !maintenance on [alasan]\n• !maintenance off"
      );
    }

    if (command === "hapus") {
      const ctxInfo = getContextInfo(msg);
      const stanzaId = ctxInfo?.stanzaId;
      const quoted = ctxInfo?.quotedMessage;
      const quotedParticipantsRaw = Array.from(
        new Set(
          [
            ctxInfo?.participant,
            ctxInfo?.participantPn,
            ctxInfo?.participantLid
          ]
            .map(v => String(v || "").trim())
            .filter(Boolean)
        )
      );

      if (!stanzaId || !quoted) {
        logFail("hapus gagal: tidak reply pesan");
        return reply(sock, msg, "❗ Reply pesan bot yang mau dihapus, lalu kirim `!hapus`.");
      }

      const ctx = await getAccessContext();
      if (jid.endsWith("@g.us") && !ctx.isPrivileged) {
        logFail("hapus ditolak: bukan owner/admin");
        return reply(sock, msg, "🔒 Di grup, hanya owner/admin yang boleh pakai `!hapus`.");
      }

      const botIds = getBotIdSet(sock);
      const quotedText = getQuotedText(quoted);
      const isBotFooterMessage = String(quotedText || "").includes(BOT_FOOTER);
      const isBotParticipant = quotedParticipantsRaw.some(participantRaw => {
        const raw = String(participantRaw || "").trim().toLowerCase();
        if (raw && botIds.has(raw)) return true;
        const norm = normalizeJid(participantRaw || "");
        return norm && botIds.has(norm);
      });

      if (!isBotFooterMessage && !isBotParticipant) {
        logFail("hapus gagal: target bukan pesan bot");
        return reply(sock, msg, "❌ Yang bisa dihapus hanya pesan dari bot.");
      }

      try {
        const candidateKeys = [];
        const isGroup = jid.endsWith("@g.us");
        let quotedParticipants = await expandParticipantCandidates(sock, quotedParticipantsRaw);
        const remoteJidCandidates = Array.from(
          new Set(
            [jid, String(ctxInfo?.remoteJid || "").trim()]
              .filter(Boolean)
          )
        );

        if (isGroup) {
          // Jika participant quoted kosong tapi pesan dikenali sebagai pesan bot (footer),
          // pakai identitas bot sebagai fallback participant.
          if (!quotedParticipants.length && isBotFooterMessage) {
            const botRaw = [sock?.user?.id, sock?.user?.lid]
              .map(v => String(v || "").trim())
              .filter(Boolean);
            quotedParticipants = await expandParticipantCandidates(sock, botRaw);
          }

          // Group delete kadang butuh variasi fromMe/participant, coba beberapa strategi.
          if (quotedParticipants.length) {
            for (const remoteJidCandidate of remoteJidCandidates) {
              for (const participant of quotedParticipants) {
                candidateKeys.push({
                  remoteJid: remoteJidCandidate,
                  id: stanzaId,
                  participant,
                  fromMe: true
                });
                candidateKeys.push({
                  remoteJid: remoteJidCandidate,
                  id: stanzaId,
                  participant
                });
                candidateKeys.push({
                  remoteJid: remoteJidCandidate,
                  id: stanzaId,
                  participant,
                  fromMe: false
                });
              }
            }
          }

          for (const remoteJidCandidate of remoteJidCandidates) {
            candidateKeys.push({
              remoteJid: remoteJidCandidate,
              id: stanzaId,
              fromMe: true
            });
            candidateKeys.push({
              remoteJid: remoteJidCandidate,
              id: stanzaId
            });
            candidateKeys.push({
              remoteJid: remoteJidCandidate,
              id: stanzaId,
              fromMe: false
            });
          }
        } else {
          for (const remoteJidCandidate of remoteJidCandidates) {
            candidateKeys.push({
              remoteJid: remoteJidCandidate,
              id: stanzaId,
              fromMe: true
            });
            candidateKeys.push({
              remoteJid: remoteJidCandidate,
              id: stanzaId
            });
            candidateKeys.push({
              remoteJid: remoteJidCandidate,
              id: stanzaId,
              fromMe: false
            });
          }
        }

        const seen = new Set();
        const dedupedKeys = candidateKeys.filter(key => {
          const signature = JSON.stringify({
            remoteJid: key.remoteJid || "",
            id: key.id || "",
            participant: key.participant || "",
            fromMe: Boolean(key.fromMe)
          });
          if (seen.has(signature)) return false;
          seen.add(signature);
          return true;
        });

        let deleted = false;
        const successLogs = [];
        let lastErr = null;
        for (const key of dedupedKeys) {
          const result = await tryDeleteByKey(sock, jid, key);
          if (result.ok) {
            deleted = true;
            successLogs.push(
              `via=${result.via || "-"} fromMe=${typeof key.fromMe === "boolean" ? key.fromMe : "unset"} participant=${key.participant ? "set" : "unset"}`
            );
            continue;
          }
          lastErr = result.error;
        }

        if (!deleted) {
          logWarn(
            `hapus gagal semua candidate | id=${stanzaId} | total_candidate=${dedupedKeys.length}`
          );
          throw lastErr || new Error("Delete key tidak valid");
        }

        logOk(`hapus request terkirim total_ok=${successLogs.length} | ${successLogs.slice(0, 3).join(" || ")}`);
        return;
      } catch (err) {
        logFail(getErrorMessage(err));
        return reply(sock, msg, "❌ Gagal menghapus pesan bot.");
      }
    }

    /* ===============================
       AI
    ================================ */
if (command === "ai") {
  if (
    await enforceRateLimit({
      sock,
      msg,
      senderKey: senderRateKey,
      bucket: "ai",
      limit: 10,
      windowMs: 60_000,
      commandLabel: command,
      sender,
      jid
    })
  ) {
    return;
  }

  if (!input) {
    logFail("input ai kosong");
    return reply(
      sock,
      msg,
      "❗ !ai <pertanyaan>\n🧹 !ai reset\n💾 !ai simpan <kunci>=<nilai>\n📚 !ai data list"
    );
  }

  const conversationId = getAIConversationId(jid, sender);
  const currentKnowledgeScopeId = getAIKnowledgeScopeId(jid);
  const ownerIds = parseOwnerIds(sock);
  const senderIds = await getSenderIds(sock, msg);
  const isOwner = msg.key.fromMe || senderIds.some(id => ownerIds.has(id));
  const canEditKnowledge = isOwner || hasKnowledgeEditAccess(senderIds);
  const ownerNum = Array.from(ownerIds)[0] || "";
  const senderNum = senderIds[0] || normalizeJid(sender);
  const targetScope = parseTargetKnowledgeScope(input, currentKnowledgeScopeId);

  if (targetScope.error) {
    logFail(`ai target scope invalid: ${targetScope.error}`);
    return reply(sock, msg, `❗ ${targetScope.error}\nContoh: \`!ai untuk group:120xxx@g.us simpen data jadwal = Jumat\``);
  }

  if (targetScope.hasOverride && !isOwner) {
    logFail("ai target scope ditolak: bukan owner");
    return reply(sock, msg, "🔒 Hanya owner/developer yang bisa mengubah data chat/grup lain.");
  }

  const knowledgeScopeId = targetScope.scopeId;
  const aiInput = targetScope.input.trim();
  const aiCmd = aiInput.toLowerCase();
  const scopeSuffix = targetScope.hasOverride ? `\nScope: ${formatScopeLabel(knowledgeScopeId)}` : "";

  if (["ya", "yes", "lanjut", "konfirmasi", "confirm"].includes(aiCmd)) {
    const pending = getAIConfirmation(jid, sender);
    if (!pending) {
      logFail("ai confirm kosong");
      return reply(sock, msg, "Tidak ada perubahan data yang menunggu konfirmasi.");
    }

    if (pending.requiresOwner && !isOwner) {
      clearAIConfirmation(jid, sender);
      logFail("ai confirm ditolak: bukan owner");
      return reply(sock, msg, "🔒 Konfirmasi ini butuh owner/developer.");
    }

    if (pending.type === "import_facts") {
      const saved = [];
      for (const item of pending.facts) {
        const result = setStoredFact(pending.scopeId, item.key, item.value, {
          updatedBy: senderNum || senderIds.join(", ") || "unknown",
          actorIds: senderIds,
          source: "import",
          confidence: 1
        });
        saved.push(result);
      }

      appendKnowledgeAudit({
        action: "data_import",
        actor: senderIds,
        scope: pending.scopeId,
        count: saved.length,
        keys: saved.map(item => item.key)
      });
      clearAIConfirmation(jid, sender);
      logOk(`ai import confirmed count=${saved.length}`);
      return reply(
        sock,
        msg,
        `✅ Import disimpan.\nScope: ${formatScopeLabel(pending.scopeId)}\nTotal: ${saved.length} data`
      );
    }

    clearAIConfirmation(jid, sender);
    return reply(sock, msg, "❌ Jenis konfirmasi tidak dikenali, jadi aku batalkan.");
  }

  if (["batal", "cancel", "nggak", "tidak"].includes(aiCmd)) {
    const pending = getAIConfirmation(jid, sender);
    clearAIConfirmation(jid, sender);
    logOk(`ai confirmation canceled exists=${Boolean(pending)}`);
    return reply(sock, msg, pending ? "✅ Perubahan data dibatalkan." : "Tidak ada perubahan data yang menunggu konfirmasi.");
  }

  if (aiCmd === "reset" || aiCmd === "clear") {
    const prevTurns = Math.ceil(getAIHistorySize(conversationId) / 2);
    clearAIHistory(conversationId);
    logOk(`ai reset, turn=${prevTurns}`);
    return reply(sock, msg, `🧹 Memory percakapan AI direset (${prevTurns} turn dihapus).`);
  }

  if (aiCmd === "scope" || aiCmd === "scope id" || aiCmd === "data scope") {
    logOk("ai scope");
    return reply(
      sock,
      msg,
      `📌 Scope data chat ini:\n\`${currentKnowledgeScopeId}\`\n\nOwner bisa target scope lain:\n\`!ai untuk group:<jid_grup> simpen data kunci = nilai\``
    );
  }

  if (aiCmd.startsWith("alias ")) {
    if (!isOwner) {
      logFail("ai alias ditolak: bukan owner");
      return reply(sock, msg, "🔒 Hanya owner/developer yang bisa mengatur alias scope.");
    }

    const rest = aiInput.replace(/^alias\s+/i, "").trim();
    if (rest === "list" || rest === "daftar") {
      const entries = Object.entries(knowledgeAliases).sort((a, b) => a[0].localeCompare(b[0]));
      logOk(`ai alias list total=${entries.length}`);
      return reply(
        sock,
        msg,
        entries.length
          ? `🏷️ *Alias Scope*\n${entries.map(([name, scope]) => `@${name} = ${scope}`).join("\n")}`
          : "🏷️ Belum ada alias scope."
      );
    }

    if (/^(hapus|delete|del)\s+/i.test(rest)) {
      const name = normalizeAliasName(rest.replace(/^(hapus|delete|del)\s+/i, ""));
      if (!name) return reply(sock, msg, "❗ Contoh: `!ai alias hapus musik`");
      const existed = Boolean(knowledgeAliases[name]);
      delete knowledgeAliases[name];
      saveKnowledgeAliases();
      appendKnowledgeAudit({ action: "alias_del", actor: senderIds, alias: name, existed });
      logOk(`ai alias del ${name} existed=${existed}`);
      return reply(sock, msg, existed ? `🗑️ Alias @${name} dihapus.` : `❌ Alias @${name} tidak ditemukan.`);
    }

    const match = rest.match(/^(.+?)\s*(?:=|->|:)\s*(.+)$/);
    if (!match) {
      return reply(
        sock,
        msg,
        "❗ Contoh:\n`!ai alias musik = group:120xxx@g.us`\n`!ai alias list`\n`!ai alias hapus musik`"
      );
    }

    const name = normalizeAliasName(match[1].replace(/^grup\s+/i, ""));
    const scope = normalizeKnowledgeScopeId(match[2]);
    if (!name || !scope) {
      return reply(sock, msg, "❗ Alias atau scope tidak valid.\nContoh: `!ai alias musik = group:120xxx@g.us`");
    }

    knowledgeAliases[name] = scope;
    saveKnowledgeAliases();
    appendKnowledgeAudit({ action: "alias_set", actor: senderIds, alias: name, scope });
    logOk(`ai alias set ${name}=${scope}`);
    return reply(sock, msg, `✅ Alias dibuat:\n@${name} = ${scope}`);
  }

  if (aiCmd.startsWith("grup cari ") || aiCmd.startsWith("group cari ") || aiCmd.startsWith("cari grup ") || aiCmd.startsWith("cari group ")) {
    if (!isOwner) {
      logFail("ai grup cari ditolak: bukan owner");
      return reply(sock, msg, "🔒 Hanya owner/developer yang bisa mencari scope grup.");
    }

    const query = aiInput.replace(/^(grup|group)\s+cari\s+/i, "").replace(/^cari\s+(grup|group)\s+/i, "").trim();
    if (!query) return reply(sock, msg, "❗ Contoh: `!ai grup cari seni musik`");

    try {
      const tokens = tokenizeKnowledgeLookup(query);
      const groups = await sock.groupFetchAllParticipating();
      const results = Object.values(groups || {})
        .map(group => ({
          id: group?.id || "",
          subject: String(group?.subject || "-").trim() || "-"
        }))
        .filter(group => group.id)
        .map(group => {
          const hay = normalizeKnowledgeLookup(`${group.subject} ${group.id}`);
          const score = tokens.reduce((acc, token) => acc + (hay.includes(token) ? 1 : 0), 0);
          return { ...group, score };
        })
        .filter(group => group.score > 0)
        .sort((a, b) => b.score - a.score || a.subject.localeCompare(b.subject))
        .slice(0, 10);

      logOk(`ai grup cari query=${query} total=${results.length}`);
      return reply(
        sock,
        msg,
        results.length
          ? `🔎 *Hasil Grup: ${query}*\n${results.map((group, idx) => `${idx + 1}. ${group.subject}\n   group:${group.id}`).join("\n")}`
          : `❌ Tidak ada grup yang cocok untuk: ${query}`
      );
    } catch (err) {
      logFail(`ai grup cari gagal: ${getErrorMessage(err)}`);
      return reply(sock, msg, "❌ Gagal mencari grup.");
    }
  }

  if (
    aiCmd === "grup list" ||
    aiCmd === "group list" ||
    aiCmd === "list grup" ||
    aiCmd === "list group"
  ) {
    if (!isOwner) {
      logFail("ai grup list ditolak: bukan owner");
      return reply(sock, msg, "🔒 Hanya owner/developer yang bisa melihat daftar scope grup.");
    }

    try {
      const groups = await sock.groupFetchAllParticipating();
      const groupRows = Object.values(groups || {})
        .map(group => ({
          id: group?.id || "",
          subject: String(group?.subject || "-").trim() || "-"
        }))
        .filter(group => group.id)
        .sort((a, b) => a.subject.localeCompare(b.subject));

      if (!groupRows.length) {
        logOk("ai grup list kosong");
        return reply(sock, msg, "📚 Bot belum mendeteksi grup yang bisa ditampilkan.");
      }

      const generatedAt = new Date().toLocaleString("id-ID", {
        timeZone: "Asia/Jakarta",
        dateStyle: "medium",
        timeStyle: "medium"
      });
      const lines = groupRows.map((group, idx) => [
        `${idx + 1}. ${group.subject}`,
        `   scope: group:${group.id}`,
        `   contoh: !ai untuk group:${group.id} data list`
      ].join("\n"));
      const fileText = [
        "DAFTAR SCOPE GRUP WHATSAPP",
        `Total: ${groupRows.length}`,
        `Dibuat: ${generatedAt} WIB`,
        "",
        "Pakai scope ini untuk target data grup lain:",
        "!ai untuk group:<jid_grup> simpen data kunci = nilai",
        "!ai untuk group:<jid_grup> data list",
        "!ai untuk group:<jid_grup> gantiin data kunci jadi nilai baru",
        "!ai untuk group:<jid_grup> hapus data kunci",
        "",
        lines.join("\n\n")
      ].join("\n");

      logOk(`ai grup list total=${groupRows.length} as document`);
      return reply(
        sock,
        msg,
        {
          document: Buffer.from(fileText, "utf8"),
          fileName: "scope-grup-whatsapp.txt",
          mimetype: "text/plain",
          caption: `📎 Daftar scope grup dikirim sebagai file.\nTotal: ${groupRows.length} grup.`
        }
      );
    } catch (err) {
      logFail(`ai grup list gagal: ${getErrorMessage(err)}`);
      return reply(sock, msg, "❌ Gagal mengambil daftar grup.");
    }
  }

  if (aiCmd === "editor list" || aiCmd === "list editor") {
    const editors = listKnowledgeEditors();
    const lines = [
      `owner: ${Array.from(ownerIds).join(", ") || "-"}`,
      ...editors.map((id, idx) => `${idx + 1}. ${id}`)
    ].join("\n");

    logOk("ai editor list");
    return reply(
      sock,
      msg,
      `👥 *Editor Data Knowledge*\n${lines}${editors.length === 0 ? "\n(belum ada editor tambahan)" : ""}`
    );
  }

  if (aiCmd === "editor id" || aiCmd === "my id" || aiCmd === "whoami") {
    logOk("ai editor id");
    return reply(
      sock,
      msg,
      `🆔 ID kamu terdeteksi:\n${senderIds.length ? senderIds.map((id, i) => `${i + 1}. ${id}`).join("\n") : "-"}\n\nMinta owner tambah salah satu ID ini:\n\`!ai editor add <id>\``
    );
  }

  if (aiCmd === "editor clear" || aiCmd === "editor reset") {
    if (!isOwner) {
      logFail("editor clear ditolak: bukan owner");
      return reply(
        sock,
        msg,
        `🔒 Hanya owner yang bisa reset editor.\nID kamu terdeteksi: ${senderNum || "-"}`
      );
    }

    const removedCount = clearKnowledgeEditors();
    appendKnowledgeAudit({
      action: "editor_clear",
      actor: senderIds,
      removedCount
    });

    logOk(`ai editor clear, removed=${removedCount}`);
    return reply(sock, msg, `✅ Semua editor tambahan dihapus (${removedCount} akun).`);
  }

  if (
    aiCmd === "editor add" ||
    aiCmd === "editor tambah" ||
    aiCmd.startsWith("editor add ") ||
    aiCmd.startsWith("editor tambah ")
  ) {
    if (!isOwner) {
      logFail("editor add ditolak: bukan owner");
      return reply(
        sock,
        msg,
        `🔒 Hanya owner yang bisa menambah editor.\nID kamu terdeteksi: ${senderNum || "-"}`
      );
    }

    const raw = aiInput.replace(/^editor\s+(add|tambah)\s+/i, "").trim();
    const fromText = raw
      .split(/[,\s]+/)
      .map(normalizeJid)
      .filter(Boolean);
    const fromCtx = getMentionedOrQuotedIds(msg);
    const candidateIds = Array.from(new Set([...fromText, ...fromCtx]));

    if (!candidateIds.length) {
      logFail("editor add gagal: kandidat kosong");
      return reply(
        sock,
        msg,
        "❗ Nomor/ID editor tidak valid.\nContoh: !ai editor add 6281234567890\nAtau reply pesan user lalu kirim: !ai editor add"
      );
    }

    const added = [];
    const skippedOwner = [];
    const already = [];

    for (const candidate of candidateIds) {
      const variants = getIdVariants(candidate);
      let wasAdded = false;
      let isOwnerVariant = false;

      for (const variant of variants) {
        if (!variant || variant.length < 8) continue;
        if (ownerIds.has(variant)) {
          isOwnerVariant = true;
          continue;
        }

        const result = addKnowledgeEditor(variant);
        if (result.added) {
          added.push(variant);
          wasAdded = true;
        } else {
          already.push(variant);
        }
      }

      if (isOwnerVariant && !wasAdded) {
        skippedOwner.push(candidate);
      }
    }

    if (!added.length && !already.length) {
      logFail("editor add gagal: tidak ada id valid");
      return reply(sock, msg, "❌ Tidak ada ID editor valid yang bisa ditambahkan.");
    }

    const parts = [];
    if (added.length) parts.push(`✅ Ditambahkan:\n${Array.from(new Set(added)).join("\n")}`);
    if (already.length) parts.push(`ℹ️ Sudah terdaftar:\n${Array.from(new Set(already)).join("\n")}`);
    if (skippedOwner.length) parts.push("ℹ️ ID owner dilewati (owner otomatis punya akses).");

    appendKnowledgeAudit({
      action: "editor_add",
      actor: senderIds,
      input: candidateIds,
      added: Array.from(new Set(added)),
      already: Array.from(new Set(already)),
      skippedOwner: skippedOwner.length
    });

    logOk(`ai editor add, added=${Array.from(new Set(added)).length}`);
    return reply(
      sock,
      msg,
      parts.join("\n\n")
    );
  }

  if (
    aiCmd === "editor del" ||
    aiCmd === "editor delete" ||
    aiCmd === "editor hapus" ||
    aiCmd.startsWith("editor del ") ||
    aiCmd.startsWith("editor delete ") ||
    aiCmd.startsWith("editor hapus ")
  ) {
    if (!isOwner) {
      logFail("editor del ditolak: bukan owner");
      return reply(
        sock,
        msg,
        `🔒 Hanya owner yang bisa menghapus editor.\nID kamu terdeteksi: ${senderNum || "-"}`
      );
    }

    const raw = aiInput.replace(/^editor\s+(del|delete|hapus)\s+/i, "").trim();
    const fromText = raw
      .split(/[,\s]+/)
      .map(normalizeJid)
      .filter(Boolean);
    const fromCtx = getMentionedOrQuotedIds(msg);
    const candidateIds = Array.from(new Set([...fromText, ...fromCtx]));

    if (!candidateIds.length) {
      logFail("editor del gagal: kandidat kosong");
      return reply(
        sock,
        msg,
        "❗ Nomor/ID editor tidak valid.\nContoh: !ai editor del 6281234567890\nAtau reply pesan user lalu kirim: !ai editor del"
      );
    }

    const removedList = [];
    const notFoundList = [];

    for (const candidate of candidateIds) {
      const variants = getIdVariants(candidate);
      let removedAny = false;
      let hasOwnerVariant = false;

      for (const variant of variants) {
        if (!variant || variant.length < 8) continue;
        if (ownerIds.has(variant)) {
          hasOwnerVariant = true;
          continue;
        }

        const removed = removeKnowledgeEditor(variant);
        if (removed) {
          removedList.push(variant);
          removedAny = true;
        } else {
          notFoundList.push(variant);
        }
      }

      if (hasOwnerVariant && !removedAny) {
        logFail("editor del ditolak: target owner");
        return reply(sock, msg, "❌ Owner tidak bisa dihapus dari akses editor.");
      }
    }

    const parts = [];
    if (removedList.length) parts.push(`🗑️ Dihapus:\n${Array.from(new Set(removedList)).join("\n")}`);
    if (notFoundList.length) parts.push(`❌ Tidak ditemukan:\n${Array.from(new Set(notFoundList)).join("\n")}`);

    if (!parts.length) {
      logFail("editor del gagal: tidak ada perubahan");
      return reply(sock, msg, "❌ Tidak ada ID editor yang diproses.");
    }

    appendKnowledgeAudit({
      action: "editor_del",
      actor: senderIds,
      input: candidateIds,
      removed: Array.from(new Set(removedList)),
      notFound: Array.from(new Set(notFoundList))
    });

    logOk(`ai editor del, removed=${Array.from(new Set(removedList)).length}`);
    return reply(
      sock,
      msg,
      parts.join("\n\n")
    );
  }

  if (aiCmd === "data backup all" || aiCmd === "backup data all" || aiCmd === "data backup semua") {
    if (!isOwner) {
      logFail("ai data backup all ditolak: bukan owner");
      return reply(sock, msg, "🔒 Hanya owner/developer yang bisa backup semua data knowledge.");
    }

    const snapshot = {
      ...exportKnowledgeSnapshot(),
      aliases: knowledgeAliases,
      editors: listKnowledgeEditors()
    };
    const text = JSON.stringify(snapshot, null, 2);
    logOk("ai data backup all");
    return reply(sock, msg, {
      document: Buffer.from(text, "utf8"),
      fileName: "knowledge-backup-all.json",
      mimetype: "application/json",
      caption: `📦 Backup semua data knowledge.\nScope: ${listKnowledgeScopes().length} scope`
    });
  }

  if (aiCmd === "data export" || aiCmd === "export data" || aiCmd === "data export txt") {
    const facts = listStoredFacts(knowledgeScopeId);
    const asText = aiCmd.includes("txt");
    const payload = asText
      ? formatKnowledgeFactsText(knowledgeScopeId, facts)
      : JSON.stringify(exportKnowledgeSnapshot(knowledgeScopeId), null, 2);

    logOk(`ai data export scope=${knowledgeScopeId} total=${facts.length}`);
    return reply(sock, msg, {
      document: Buffer.from(payload, "utf8"),
      fileName: asText ? "knowledge-export.txt" : "knowledge-export.json",
      mimetype: asText ? "text/plain" : "application/json",
      caption: `📎 Export data knowledge.\nScope: ${formatScopeLabel(knowledgeScopeId)}\nTotal: ${facts.length} data`
    });
  }

  if (aiCmd.startsWith("import data") || aiCmd.startsWith("data import")) {
    if (!canEditKnowledge) {
      logFail("ai import data ditolak: tanpa akses");
      return reply(
        sock,
        msg,
        `🔒 Hanya owner atau editor terdaftar yang bisa import data.\nID kamu terdeteksi: ${senderIds.join(", ") || "-"}`
      );
    }

    try {
      const inline = aiInput.replace(/^(import\s+data|data\s+import)\s*/i, "").trim();
      const fileText = inline || await readQuotedDocumentText(msg);
      if (!fileText) {
        return reply(
          sock,
          msg,
          "❗ Reply file `.txt`/`.json` lalu kirim `!ai import data`, atau tulis data setelah command.\nFormat teks: `kunci = nilai` per baris."
        );
      }

      const facts = parseKnowledgeImportText(fileText)
        .slice(0, 100)
        .map(item => ({
          key: item.key.toLowerCase(),
          value: item.value
        }));

      if (!facts.length) {
        logFail("ai import data kosong");
        return reply(sock, msg, "❌ Tidak ada data valid yang bisa diimport.");
      }

      setAIConfirmation(jid, sender, {
        type: "import_facts",
        scopeId: knowledgeScopeId,
        facts,
        requiresOwner: targetScope.hasOverride
      });

      const preview = facts
        .slice(0, 8)
        .map((item, idx) => `${idx + 1}. ${item.key} = ${item.value}`)
        .join("\n");
      logOk(`ai import preview count=${facts.length}`);
      return reply(
        sock,
        msg,
        `🧾 *Preview Import Data*\nScope: ${formatScopeLabel(knowledgeScopeId)}\nTotal: ${facts.length} data\n\n${preview}${facts.length > 8 ? "\n..." : ""}\n\nKirim \`!ai ya\` untuk simpan, atau \`!ai batal\` untuk batal.`
      );
    } catch (err) {
      logFail(`ai import data gagal: ${getErrorMessage(err)}`);
      return reply(sock, msg, `❌ Gagal import data: ${getErrorMessage(err)}`);
    }
  }

  if (aiCmd === "data log" || aiCmd.startsWith("data log ") || aiCmd === "log data" || aiCmd.startsWith("log data ")) {
    const key = aiInput
      .replace(/^(data\s+log|log\s+data)\s*/i, "")
      .trim();
    const rows = readKnowledgeAudit({ scopeId: knowledgeScopeId, key, limit: 20 });
    if (!rows.length) {
      logFail("ai data log kosong");
      return reply(sock, msg, `📜 Belum ada log data untuk scope ini.${scopeSuffix}`);
    }

    const lines = rows.map((row, idx) => {
      const actor = Array.isArray(row.actor) ? row.actor.join(",") : row.actor || "-";
      const rowKey = row.key || row.requestedKey || "-";
      return `${idx + 1}. ${row.ts || "-"}\n   ${row.action || "-"} | ${rowKey}\n   actor: ${actor}`;
    });
    logOk(`ai data log total=${rows.length}`);
    return reply(sock, msg, `📜 *Log Data*${scopeSuffix}\n${lines.join("\n")}`);
  }

  if (aiCmd === "data list" || aiCmd === "list data") {
    const facts = listStoredFacts(knowledgeScopeId);
    if (!facts.length) {
      logFail("data list kosong");
      return reply(sock, msg, `📚 Belum ada data tersimpan di scope ini.${scopeSuffix}`);
    }

    const lines = facts
      .slice(0, 30)
      .map((item, idx) => `${idx + 1}. ${item.key} = ${item.value}`)
      .join("\n");

    logOk(`ai data list, total=${facts.length}`);
    return reply(
      sock,
      msg,
      `📚 *Data Tersimpan (${facts.length})*${scopeSuffix}\n${lines}${facts.length > 30 ? "\n..." : ""}`
    );
  }

  if (
    aiCmd.startsWith("simpan ") ||
    aiCmd.startsWith("simpen ") ||
    aiCmd.startsWith("save ") ||
    aiCmd.startsWith("ingat ") ||
    aiCmd.startsWith("inget ") ||
    aiCmd.startsWith("catat ") ||
    aiCmd.startsWith("catet ")
  ) {
    if (!canEditKnowledge) {
      logFail("simpan data ditolak: tanpa akses");
      return reply(
        sock,
        msg,
        `🔒 Hanya owner atau editor terdaftar yang bisa mengubah data.\nID kamu terdeteksi: ${senderIds.join(", ") || "-"}\nMinta owner pakai: !ai editor add <id>`
      );
    }

    const payload = aiInput
      .replace(/^(simpan|simpen|save|ingat|inget|catat|catet|catetin)\s+/i, "")
      .trim();
    const eqIndex = payload.indexOf("=");
    const colonIndex = payload.indexOf(":");
    let cutIndex = -1;

    if (eqIndex > 0 && colonIndex > 0) cutIndex = Math.min(eqIndex, colonIndex);
    else if (eqIndex > 0) cutIndex = eqIndex;
    else if (colonIndex > 0) cutIndex = colonIndex;

    let key = "";
    let value = "";
    let source = "manual";
    let confidence = 1;

    if (cutIndex < 1) {
      const extracted = await extractKnowledgeFact(aiInput);
      if (!extracted.shouldSave) {
        logFail("simpan data gagal: ekstraksi kosong");
        return reply(
          sock,
          msg,
          "❗ Aku belum bisa nangkep data yang harus disimpan.\nContoh natural: `!ai ingat jadwal latihan = Jumat jam 19.00`\nAtau: `!ai catat bahwa jadwal latihan adalah Jumat jam 19.00`"
        );
      }

      key = extracted.key;
      value = extracted.value;
      source = extracted.source === "ai" ? "ai-natural" : "heuristic";
      confidence = extracted.confidence;
    } else {
      key = payload
        .slice(0, cutIndex)
        .replace(/^(data|bahwa)\s+/i, "")
        .trim();
      value = payload.slice(cutIndex + 1).trim();
    }

    if (!key || !value) {
      logFail("simpan data gagal: key/value kosong");
      return reply(sock, msg, "❗ Kunci atau nilai kosong.");
    }

    setStoredFact(knowledgeScopeId, key, value, {
      updatedBy: senderNum || senderIds.join(", ") || "unknown",
      actorIds: senderIds,
      source,
      confidence
    });
    appendKnowledgeAudit({
      action: source === "manual" ? "data_set" : "data_set_ai",
      actor: senderIds,
      scope: knowledgeScopeId,
      key: key.toLowerCase(),
      value,
      source,
      confidence
    });
    logOk(`ai simpan key=${key.toLowerCase()}`);
    return reply(
      sock,
      msg,
      `✅ Data disimpan oleh *${senderNum || "-"}*${scopeSuffix}:\n*${key.toLowerCase()}* = ${value}`
    );
  }

  if (
    aiCmd.startsWith("hapus ") ||
    aiCmd.startsWith("apusin ") ||
    aiCmd.startsWith("hapuskan ") ||
    aiCmd.startsWith("delete ") ||
    aiCmd.startsWith("del ")
  ) {
    if (!canEditKnowledge) {
      logFail("hapus data ditolak: tanpa akses");
      return reply(
        sock,
        msg,
        `🔒 Hanya owner atau editor terdaftar yang bisa mengubah data.\nID kamu terdeteksi: ${senderIds.join(", ") || "-"}\nMinta owner pakai: !ai editor add <id>`
      );
    }

    const key = aiInput
      .replace(/^(hapus|apusin|hapuskan|delete|del)\s+/i, "")
      .replace(/^(data|tentang)\s+/i, "")
      .trim();
    if (!key) {
      logFail("hapus data gagal: key kosong");
      return reply(sock, msg, "❗ Contoh: !ai hapus alamat kantor");
    }

    const resolved = resolveStoredFactKey(knowledgeScopeId, key);
    if (resolved.ambiguous) {
      return reply(
        sock,
        msg,
        `❗ Data yang mau dihapus masih ambigu.\nCoba pakai salah satu:\n${resolved.alternatives.map(item => `• ${item}`).join("\n")}`
      );
    }

    const deleted = resolved.found ? deleteStoredFact(knowledgeScopeId, resolved.key) : false;
    appendKnowledgeAudit({
      action: "data_del",
      actor: senderIds,
      scope: knowledgeScopeId,
      key: resolved.found ? resolved.key : key.toLowerCase(),
      requestedKey: key.toLowerCase(),
      deleted
    });
    logOk(`ai hapus key=${key.toLowerCase()} resolved=${resolved.key} deleted=${deleted}`);
    return reply(
      sock,
      msg,
      deleted
        ? `🗑️ Data *${resolved.key}* dihapus.${scopeSuffix}`
        : `❌ Data *${key.toLowerCase()}* tidak ditemukan.`
    );
  }

  if (aiCmd.startsWith("data ")) {
    const key = aiInput.replace(/^data\s+/i, "").trim();
    if (!key || key.toLowerCase() === "list") {
      const facts = listStoredFacts(knowledgeScopeId);
      if (!facts.length) {
        logFail("ai data list kosong");
        return reply(sock, msg, `📚 Belum ada data tersimpan di scope ini.${scopeSuffix}`);
      }

      const lines = facts
        .slice(0, 30)
        .map((item, idx) => `${idx + 1}. ${item.key} = ${item.value}`)
        .join("\n");

      logOk(`ai data list, total=${facts.length}`);
      return reply(
        sock,
        msg,
        `📚 *Data Tersimpan (${facts.length})*${scopeSuffix}\n${lines}${facts.length > 30 ? "\n..." : ""}`
      );
    }

    const value = getStoredFact(knowledgeScopeId, key);
    if (!value) {
      logFail(`ai data key tidak ditemukan: ${key.toLowerCase()}`);
      return reply(sock, msg, `❌ Data *${key.toLowerCase()}* tidak ditemukan.`);
    }

    logOk(`ai data key=${key.toLowerCase()}`);
    const meta = getStoredFactMeta(knowledgeScopeId, key);
    const metaLine = meta?.updatedBy
      ? `\n📝 Diupdate oleh: ${meta.updatedBy}${meta.updatedAt ? `\n⏱️ ${meta.updatedAt}` : ""}`
      : "";
    return reply(sock, msg, `📌 *${key.toLowerCase()}* = ${value}${metaLine}${scopeSuffix}`);
  }

  if (isAIKnowledgeMutationRequest(aiInput)) {
    if (!canEditKnowledge) {
      logFail("mutasi data natural ditolak: tanpa akses");
      return reply(
        sock,
        msg,
        `🔒 Aku paham kamu mau mengubah data, tapi hanya owner/editor yang boleh.\nID kamu terdeteksi: ${senderIds.join(", ") || "-"}\nMinta owner pakai: !ai editor add <id>`
      );
    }

    const existingFacts = listStoredFacts(knowledgeScopeId);
    const mutation = await extractKnowledgeMutation(aiInput, existingFacts.map(item => item.key));

    if (mutation.action === "none") {
      logFail("mutasi data natural gagal: ekstraksi kosong");
      return reply(
        sock,
        msg,
        "❗ Aku paham kamu mau mengubah data, tapi instruksinya masih kurang jelas.\nContoh:\n• `!ai ganti data jadwal latihan jadi Jumat jam 19.00`\n• `!ai hapus data jadwal latihan`"
      );
    }

    if (mutation.action === "delete") {
      const resolved = resolveStoredFactKey(knowledgeScopeId, mutation.key);

      if (resolved.ambiguous) {
        return reply(
          sock,
          msg,
          `❗ Data yang mau dihapus masih ambigu.\nCoba pakai salah satu:\n${resolved.alternatives.map(item => `• ${item}`).join("\n")}`
        );
      }

      if (!resolved.found) {
        logFail(`hapus data natural gagal: key tidak ditemukan ${mutation.key}`);
        return reply(sock, msg, `❌ Data *${mutation.key}* tidak ditemukan.`);
      }

      const deleted = deleteStoredFact(knowledgeScopeId, resolved.key);
      appendKnowledgeAudit({
        action: "data_del_ai",
        actor: senderIds,
        scope: knowledgeScopeId,
        key: resolved.key,
        requestedKey: mutation.key,
        deleted,
        source: mutation.source,
        confidence: mutation.confidence,
        rawInput: aiInput
      });

      logOk(`ai hapus natural key=${resolved.key} deleted=${deleted}`);
      return reply(
        sock,
        msg,
        deleted
          ? `🗑️ Data *${resolved.key}* dihapus oleh *${senderNum || "-"}*.`
            + scopeSuffix
          : `❌ Data *${resolved.key}* gagal dihapus.`
      );
    }

    const wantsExisting = /^(ai|bot|botnya|min|admin)?[,\s:.-]*(tolong\s+)?(ganti|gantiin|ubah|ubahin|rubah|update|perbarui|perbaharui|edit|revisi)\s+(data\s+)?/i.test(aiInput);
    const resolved = resolveStoredFactKey(knowledgeScopeId, mutation.key);

    if (resolved.ambiguous) {
      return reply(
        sock,
        msg,
        `❗ Data yang mau diganti masih ambigu.\nCoba pakai salah satu:\n${resolved.alternatives.map(item => `• ${item}`).join("\n")}`
      );
    }

    if (wantsExisting && !resolved.found) {
      logFail(`ganti data natural gagal: key tidak ditemukan ${mutation.key}`);
      return reply(
        sock,
        msg,
        `❌ Data *${mutation.key}* belum ada, jadi aku belum berani menggantinya.\nKalau mau tambah baru, pakai: \`!ai catat bahwa ${mutation.key} adalah ${mutation.value}\``
      );
    }

    const keyToSave = resolved.found ? resolved.key : mutation.key;
    const oldValue = resolved.found ? resolved.value : null;

    setStoredFact(knowledgeScopeId, keyToSave, mutation.value, {
      updatedBy: senderNum || senderIds.join(", ") || "unknown",
      actorIds: senderIds,
      source: mutation.source === "ai" ? "ai-natural" : "heuristic",
      confidence: mutation.confidence
    });
    appendKnowledgeAudit({
      action: oldValue == null ? "data_set_ai" : "data_update_ai",
      actor: senderIds,
      scope: knowledgeScopeId,
      key: keyToSave,
      requestedKey: mutation.key,
      oldValue,
      value: mutation.value,
      source: mutation.source,
      confidence: mutation.confidence,
      rawInput: aiInput
    });

    logOk(`ai mutasi natural action=set key=${keyToSave}`);
    return reply(
      sock,
      msg,
      oldValue == null
        ? `✅ Data disimpan oleh *${senderNum || "-"}*${scopeSuffix}:\n*${keyToSave}* = ${mutation.value}`
        : `✅ Data diganti oleh *${senderNum || "-"}*${scopeSuffix}:\n*${keyToSave}*\nSebelumnya: ${oldValue}\nSekarang: ${mutation.value}`
    );
  }

  const featureRedirect = getFeatureRedirect(aiInput);
  if (featureRedirect) {
    logOk("ai redirect ke fitur bot");
    return reply(sock, msg, featureRedirect);
  }

  const scopedContext = buildFactsContext(knowledgeScopeId, aiInput, 8, 1200);
  const globalContext = knowledgeScopeId === "global"
    ? ""
    : buildFactsContext("global", aiInput, 5, 800);
  const knowledgeContext = [
    globalContext ? `Data global:\n${globalContext}` : "",
    scopedContext ? `Data scope ${formatScopeLabel(knowledgeScopeId)}:\n${scopedContext}` : ""
  ].filter(Boolean).join("\n\n");
  const { content, model, historySize } = await askAI(aiInput, conversationId, {
    knowledgeContext
  });
  const turns = Math.ceil(historySize / 2);

  const text = `
🤖 Model: *${model}*
🧠 Memory: *${turns} turn*
━━━━━━━━━━━━━━━━━━
${content}
`.trim();

  logOk(`ai response model=${model}`);
  return reply(sock, msg, text);
}

    /* ===============================
       SUARA / TTS
    ================================ */
    // google TTS
if (command === "suara") {
  if (!input) {
    logFail("teks tts kosong");
    return reply(sock, msg, "❗ !suara <teks>");
  }

  if (input.length > 250) {
    logFail("teks tts melebihi 250 karakter");
    return reply(sock, msg, "❗ Maksimal 250 karakter.");
  }

  const now = Date.now();
  const last = ttsCooldown.get(sender) || 0;
  const remaining = TTS_DELAY - (now - last);

  if (remaining > 0) {
    logFail(`tts cooldown ${Math.ceil(remaining / 1000)}s`);
    return reply(
      sock,
      msg,
      `⏳ Tunggu *${Math.ceil(remaining / 1000)} detik* sebelum pakai TTS lagi.`
    );
  }

  try {
    ttsCooldown.set(sender, now);
    logInfo(`TTS processing | user=${sender.split("@")[0]}`);

    const audio = await tts(input);

    logOk("tts voice note terkirim");
    return reply(sock, msg, {
      audio,
      mimetype: "audio/ogg; codecs=opus",
      ptt: true
    });

  } catch (err) {
    ttsCooldown.delete(sender);
    logError("TTS ERROR", err);
    logFail(getErrorMessage(err));
    return reply(sock, msg, "❌ Gagal membuat suara.");
  }
}


    /* ===============================
       TAG
    ================================ */
    if (command === "tagall") {
      logOk("tagall dipanggil");
      return tagAll(sock, msg, input);
    }
    if (command === "tagadmin") {
      logOk("tagadmin dipanggil");
      return tagAdmin(sock, msg, input);
    }

    /* ===============================
       STATUS / PING
    ================================ */
    if (command === "ping" || command === "status") {
      const start = Date.now();
      await reply(sock, msg, "⏱️ Mengecek status...");
      const ping = Date.now() - start;

      const uptime = formatUptime(Date.now() - global.startTime);
      const totalRam = formatBytes(os.totalmem());
      const usedRam = formatBytes(os.totalmem() - os.freemem());

      const netLatency = await pingUrl("https://www.google.com");

      const textStatus = `
🤖 *BOT STATUS*
━━━━━━━━━━━━━━
📡 Ping: ${ping} ms
🌐 Internet: ${netLatency ? netLatency + " ms" : "❌"}
⏱️ Uptime: ${uptime}
💾 RAM: ${usedRam} / ${totalRam}
━━━━━━━━━━━━━━
`.trim();

      logOk(`status ping=${ping}ms net=${netLatency ? `${netLatency}ms` : "off"}`);
      return reply(sock, msg, textStatus);
    }

    if (command === "antrian" || command === "queue") {
      const q = getDownloaderQueueSnapshot();
      const activeLine = q.active
        ? `🎬 Sedang diproses: ${q.active.name} (${q.active.runningSec} detik)`
        : "🎬 Sedang diproses: -";
      const textQueue = `
🧾 *STATUS ANTRIAN DOWNLOADER*
━━━━━━━━━━━━━━━━━━
${activeLine}
📥 Menunggu: ${q.waiting}
🧮 Total antrean: ${q.total}
`.trim();

      logOk(`antrian total=${q.total}`);
      return reply(sock, msg, textQueue);
    }

    if (command === "stats") {
      const totals = runtimeStats.totals.ok + runtimeStats.totals.fail;
      const dTotals = runtimeStats.downloader.ok + runtimeStats.downloader.fail;
      const dFailRate = dTotals
        ? ((runtimeStats.downloader.fail / dTotals) * 100).toFixed(1)
        : "0.0";
      const uptime = formatUptime(Date.now() - runtimeStats.startedAt);
      const topCommands = Array.from(runtimeStats.commands.entries())
        .sort((a, b) => b[1].total - a[1].total)
        .slice(0, 5);

      const topLines = topCommands.length
        ? topCommands
            .map(([name, s], i) => {
              const avg = s.total ? Math.round(s.totalDurationMs / s.total) : 0;
              return `${i + 1}. ${name} (${s.total}x | ok ${s.ok} | fail ${s.fail} | avg ${avg}ms)`;
            })
            .join("\n")
        : "-";

      const textStats = `
📊 *RUNTIME STATS*
━━━━━━━━━━━━━━━━━━
⏱️ Sejak runtime: ${uptime}
🧮 Total eksekusi: ${totals}
✅ Sukses: ${runtimeStats.totals.ok}
❌ Gagal: ${runtimeStats.totals.fail}

🎬 Downloader:
• total: ${dTotals}
• sukses: ${runtimeStats.downloader.ok}
• gagal: ${runtimeStats.downloader.fail}
• fail rate: ${dFailRate}%
• antrean aktif: ${getDownloaderQueueSize()}

🏆 Top Command:
${topLines}
`.trim();

      logOk("stats terkirim");
      return reply(sock, msg, textStats);
    }

    logFail("command tidak dikenali");
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
