import {
  getContentType,
  downloadMediaMessage
} from "@whiskeysockets/baileys";

import fs from "fs";
import os from "os";

import { makeSticker } from "./sticker.js";
import { askAI, clearAIHistory, getAIHistorySize } from "./ai.js";
import {
  setStoredFact,
  getStoredFact,
  deleteStoredFact,
  listStoredFacts,
  buildFactsContext,
  isKnowledgeEditor,
  addKnowledgeEditor,
  removeKnowledgeEditor,
  listKnowledgeEditors,
  clearKnowledgeEditors,
  appendKnowledgeAudit
} from "./knowledge.js";
import { tts } from "./tts.js";
import { tagAll, tagAdmin } from "./group.js";

import {
  formatUptime,
  formatBytes,
  pingUrl,
  searchImageCSE,
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
  getWeatherIcon
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
const BOT_FOOTER = "> *pesan otomatis dari bot*";

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

function getFeatureRedirect(aiInput = "") {
  const t = String(aiInput || "").toLowerCase();
  const has = (...words) => words.some(w => t.includes(w));

  if (has("cuaca", "weather", "hujan", "suhu", "prakiraan")) {
    return "🌦️ Permintaan itu lebih pas pakai fitur cuaca bot.\nGunakan: `!cuaca <lokasi>`\nContoh: `!cuaca Tasikmalaya`";
  }

  if (has("tiktok.com", "video tiktok", "download tiktok")) {
    return "🎵 Untuk TikTok, pakai downloader bot.\nGunakan: `!tt <url_tiktok>`";
  }

  if (has("instagram.com", "download instagram", "video instagram", "reels")) {
    return "📸 Untuk Instagram, pakai downloader bot.\nGunakan: `!ig <url_instagram>`";
  }

  if (
    has("youtube", "yt", "lagu youtube", "audio youtube", "mp3 youtube") &&
    has("download", "ambil", "convert", "mp3", "audio", "lagu")
  ) {
    return "🎧 Untuk audio YouTube, pakai fitur bot:\n• `!yt <watch_url>` (pilih audio/video)\n• `!musik <judul lagu>` (rekomendasi)\n• `!yta <watch_url>`\n• `!ytsearch <judul lagu>`";
  }

  if (has("cari youtube", "search youtube", "ytsearch", "video youtube")) {
    return "🔎 Untuk cari video YouTube, gunakan: `!ytsearch <kata_kunci>`";
  }

  if (has("gambar", "image", "foto", "carikan gambar", "cari gambar")) {
    return "🖼️ Untuk gambar, pakai fitur bot:\nGunakan: `!gambar <kata_kunci>`";
  }

  if (has("stiker", "sticker", "jadi stiker", "buat stiker")) {
    return "🧩 Untuk bikin stiker, reply gambar/video lalu kirim: `!stiker`";
  }

  if (has("toimg", "ubah stiker", "stiker ke gambar", "convert stiker")) {
    return "🔄 Untuk ubah stiker ke gambar, reply stikernya lalu kirim: `!toimg`";
  }

  if (has("tts", "voice note", "suara", "text to speech")) {
    return "🎙️ Untuk voice note dari teks, pakai: `!suara <teks>`";
  }

  if (has("status bot", "cek status", "ping bot", "latency bot")) {
    return "📊 Untuk cek status bot, gunakan: `!status` atau `!ping`";
  }

  if (has("fitur bot", "menu bot", "help bot", "daftar command")) {
    return "📌 Untuk lihat semua fitur, gunakan: `!menu` atau `!help`";
  }

  return null;
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
  try {
    const result = await task.worker();
    task.resolveTask(result);
  } catch (err) {
    task.rejectTask(err);
  } finally {
    downloaderQueueActive = false;
    processDownloaderQueue();
  }
}

function getDownloaderQueueSize() {
  return downloaderQueue.length + (downloaderQueueActive ? 1 : 0);
}

/* ===============================
   TTS COOLDOWN
================================ */
const ttsCooldown = new Map();
const TTS_DELAY = 15_000; // 15 detik


/* ===============================
   MAIN HANDLER
================================ */
export default async function handler(sock, msg) {
  const jid = msg?.key?.remoteJid || "unknown";
  const sender = msg?.key?.participant || msg?.key?.remoteJid || "unknown";
  const text = getText(msg)?.trim();
  const senderRateKey = normalizeJid(sender) || sender;

  try {
    if (!text) return;



    logInfo(
      `CMD from ${sender.split("@")[0]} | ${jid.endsWith("@g.us") ? "GROUP" : "PRIVATE"} | ${text}`
    );

    // ⛔ anti loop: abaikan pesan otomatis bot sendiri (ber-footer),
    // tapi izinkan command fromMe di private/grup
    if (msg.key.fromMe && text.includes(BOT_FOOTER)) return;


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
      const cache = ytSearchCache.get(sender);
      if (!cache) return;
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

      const selected = cache[Number(text) - 1];
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
      const quoted =
        msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;

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
       YTSEARCH
    ================================ */
    if (command === "ytsearch") {
      if (!input) {
        logFail("kata kunci kosong");
        return reply(sock, msg, "❗ Masukkan kata kunci");
      }

      try {
        const results = await ytSearch(input);
        ytSearchCache.set(sender, results);

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
        ytSearchCache.set(sender, results);

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
  if (!input) {
    logFail("lokasi kosong");
    return reply(sock, msg,
      `❗ *Cara pakai:*\n!cuaca <nama lokasi>\n\n*Contoh:*\n• !cuaca Tawang\n• !cuaca Tasikmalaya\n• !cuaca Cipedes\n• !cuaca Bandung\n\n_Bisa pakai nama kecamatan atau kota_`
    );
  }

 try {
    await reply(sock, msg, "🔍 Mencari data cuaca...");

    const w = await getWeatherBMKG(input);
    const s = w.cuacaSekarang;

    // ✅ Definisikan jamSekarang SEBELUM dipakai
    const jamSekarang = new Date(s.local_datetime).toLocaleTimeString("id-ID", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Asia/Jakarta"
    });

    let prakiraan = "";
    w.prakiraan.forEach(c => {
      const date = new Date(c.local_datetime);
      const jam = date.toLocaleTimeString("id-ID", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Asia/Jakarta"
      });
      prakiraan += `🕒 ${jam} | ${getWeatherIcon(c.weather_desc)} ${c.weather_desc} | ${c.t}°C | 🌧️ ${c.rainChance}%\n`;
    });

    const text = `
🌦️ *PRAKIRAAN CUACA*
━━━━━━━━━━━━━━━━━━
📍 *${w.lokasi}*
🗺️ ${w.provinsi}

🌡️ *Kondisi Pukul ${jamSekarang} WIB:*
${getWeatherIcon(s.weather_desc)} ${s.weather_desc}
🌡️ Suhu: *${s.t}°C*
💧 Kelembapan: ${s.hu}%
💨 Angin: ${s.ws} km/j

⏱️ *Prakiraan Beberapa Jam ke Depan:*
${prakiraan}
━━━━━━━━━━━━━━━━━━
📡 _Sumber: Tomorrow.io_
`.trim();

    logOk(`lokasi=${w.lokasi}`);
    return reply(sock, msg, text);

  } catch (err) {
    logError("CUACA ERROR", err);
    logFail(getErrorMessage(err));
    return reply(sock, msg,
      `❌ Lokasi *"${input}"* tidak ditemukan.\n\nCoba gunakan nama yang lebih umum.\n\n*Contoh:*\n• !cuaca Tawang\n• !cuaca Tasikmalaya\n• !cuaca Bandung`
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
        const imageUrl = await searchImageCSE(query, safeMode);
        const image = await downloadImage(imageUrl);

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
        return reply(sock, msg, "❌ Gagal menampilkan gambar.");
      }
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
  └ Tanya AI (pakai memory + data tersimpan)
• !ai reset
  └ Hapus memory percakapan AI
• !ai simpan <kunci>=<nilai>
  └ Simpan data dari chat (hanya editor)
• !ai data list
  └ Lihat semua data tersimpan
• !ai data <kunci>
  └ Ambil data tertentu
• !ai hapus <kunci>
  └ Hapus data tersimpan (hanya editor)
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

  🔄 *Konversi Media*
• !toimg
  └ Ubah stiker menjadi gambar

  🌦️ *Cuaca* (Beta)
• !cuaca <lokasi>(spasi)<provinsi>(spasi)<negara>
  └ Cek cuaca di lokasi tertentu


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

📊 *Status Bot*
• !ping
• !status
• !stats
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
  const knowledgeScopeId = getAIKnowledgeScopeId(jid);
  const ownerIds = parseOwnerIds(sock);
  const senderIds = await getSenderIds(sock, msg);
  const isOwner = msg.key.fromMe || senderIds.some(id => ownerIds.has(id));
  const canEditKnowledge = isOwner || hasKnowledgeEditAccess(senderIds);
  const ownerNum = Array.from(ownerIds)[0] || "";
  const senderNum = senderIds[0] || normalizeJid(sender);
  const aiInput = input.trim();
  const aiCmd = aiInput.toLowerCase();

  if (aiCmd === "reset" || aiCmd === "clear") {
    const prevTurns = Math.ceil(getAIHistorySize(conversationId) / 2);
    clearAIHistory(conversationId);
    logOk(`ai reset, turn=${prevTurns}`);
    return reply(sock, msg, `🧹 Memory percakapan AI direset (${prevTurns} turn dihapus).`);
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

  if (aiCmd === "data list" || aiCmd === "list data") {
    const facts = listStoredFacts(knowledgeScopeId);
    if (!facts.length) {
      logFail("data list kosong");
      return reply(sock, msg, "📚 Belum ada data tersimpan di chat ini.");
    }

    const lines = facts
      .slice(0, 30)
      .map((item, idx) => `${idx + 1}. ${item.key} = ${item.value}`)
      .join("\n");

    logOk(`ai data list, total=${facts.length}`);
    return reply(
      sock,
      msg,
      `📚 *Data Tersimpan (${facts.length})*\n${lines}${facts.length > 30 ? "\n..." : ""}`
    );
  }

  if (aiCmd.startsWith("simpan ") || aiCmd.startsWith("save ") || aiCmd.startsWith("ingat ")) {
    if (!canEditKnowledge) {
      logFail("simpan data ditolak: tanpa akses");
      return reply(
        sock,
        msg,
        `🔒 Hanya owner atau editor terdaftar yang bisa mengubah data.\nID kamu terdeteksi: ${senderIds.join(", ") || "-"}\nMinta owner pakai: !ai editor add <id>`
      );
    }

    const payload = aiInput.replace(/^(simpan|save|ingat)\s+/i, "").trim();
    const eqIndex = payload.indexOf("=");
    const colonIndex = payload.indexOf(":");
    let cutIndex = -1;

    if (eqIndex > 0 && colonIndex > 0) cutIndex = Math.min(eqIndex, colonIndex);
    else if (eqIndex > 0) cutIndex = eqIndex;
    else if (colonIndex > 0) cutIndex = colonIndex;

    if (cutIndex < 1) {
      logFail("simpan data gagal: format salah");
      return reply(sock, msg, "❗ Format salah.\nContoh: !ai simpan alamat kantor=Jl. Merdeka 10");
    }

    const key = payload.slice(0, cutIndex).trim();
    const value = payload.slice(cutIndex + 1).trim();

    if (!key || !value) {
      logFail("simpan data gagal: key/value kosong");
      return reply(sock, msg, "❗ Kunci atau nilai kosong.");
    }

    setStoredFact(knowledgeScopeId, key, value);
    appendKnowledgeAudit({
      action: "data_set",
      actor: senderIds,
      scope: knowledgeScopeId,
      key: key.toLowerCase(),
      value
    });
    logOk(`ai simpan key=${key.toLowerCase()}`);
    return reply(sock, msg, `✅ Data disimpan:\n*${key.toLowerCase()}* = ${value}`);
  }

  if (aiCmd.startsWith("hapus ") || aiCmd.startsWith("delete ") || aiCmd.startsWith("del ")) {
    if (!canEditKnowledge) {
      logFail("hapus data ditolak: tanpa akses");
      return reply(
        sock,
        msg,
        `🔒 Hanya owner atau editor terdaftar yang bisa mengubah data.\nID kamu terdeteksi: ${senderIds.join(", ") || "-"}\nMinta owner pakai: !ai editor add <id>`
      );
    }

    const key = aiInput.replace(/^(hapus|delete|del)\s+/i, "").trim();
    if (!key) {
      logFail("hapus data gagal: key kosong");
      return reply(sock, msg, "❗ Contoh: !ai hapus alamat kantor");
    }

    const deleted = deleteStoredFact(knowledgeScopeId, key);
    appendKnowledgeAudit({
      action: "data_del",
      actor: senderIds,
      scope: knowledgeScopeId,
      key: key.toLowerCase(),
      deleted
    });
    logOk(`ai hapus key=${key.toLowerCase()} deleted=${deleted}`);
    return reply(
      sock,
      msg,
      deleted
        ? `🗑️ Data *${key.toLowerCase()}* dihapus.`
        : `❌ Data *${key.toLowerCase()}* tidak ditemukan.`
    );
  }

  if (aiCmd.startsWith("data ")) {
    const key = aiInput.replace(/^data\s+/i, "").trim();
    if (!key || key.toLowerCase() === "list") {
      const facts = listStoredFacts(knowledgeScopeId);
      if (!facts.length) {
        logFail("ai data list kosong");
        return reply(sock, msg, "📚 Belum ada data tersimpan di chat ini.");
      }

      const lines = facts
        .slice(0, 30)
        .map((item, idx) => `${idx + 1}. ${item.key} = ${item.value}`)
        .join("\n");

      logOk(`ai data list, total=${facts.length}`);
      return reply(
        sock,
        msg,
        `📚 *Data Tersimpan (${facts.length})*\n${lines}${facts.length > 30 ? "\n..." : ""}`
      );
    }

    const value = getStoredFact(knowledgeScopeId, key);
    if (!value) {
      logFail(`ai data key tidak ditemukan: ${key.toLowerCase()}`);
      return reply(sock, msg, `❌ Data *${key.toLowerCase()}* tidak ditemukan.`);
    }

    logOk(`ai data key=${key.toLowerCase()}`);
    return reply(sock, msg, `📌 *${key.toLowerCase()}* = ${value}`);
  }

  const featureRedirect = getFeatureRedirect(aiInput);
  if (featureRedirect) {
    logOk("ai redirect ke fitur bot");
    return reply(sock, msg, featureRedirect);
  }

  const knowledgeContext = buildFactsContext(knowledgeScopeId, aiInput, 8, 1200);
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
