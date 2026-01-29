import {
  getContentType,
  downloadMediaMessage
} from "@whiskeysockets/baileys";

import fs from "fs";
import os from "os";

import { makeSticker } from "./sticker.js";
import { askAI } from "./ai.js";
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
  downloadTikTok,
  downloadInstagram,
  downloadYouTubeAudio,
  getWeatherWeatherAPI
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

/* ===============================
   HELPER REPLY (TAMBAHAN SAJA)
================================ */
function reply(sock, msg, payload) {
  const jid = msg.key.remoteJid;
  return sock.sendMessage(
    jid,
    typeof payload === "string" ? { text: payload } : payload,
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
  return jid.replace(/[^0-9]/g, "");
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

  try {
    const text = getText(msg)?.trim();
    if (!text) return;



logInfo(
  `CMD from ${sender.split("@")[0]} | ${jid.endsWith("@g.us") ? "GROUP" : "PRIVATE"} | ${text}`
);


    // ⛔ anti loop
    if (msg.key.fromMe && !msg.key.remoteJid.endsWith("@g.us")) return;


    /* ===============================
       1️⃣ HANDLE YTSEARCH NUMBER REPLY
    ================================ */
    if (/^[1-5]$/.test(text)) {
      const cache = ytSearchCache.get(sender);
      if (!cache) return;

      const selected = cache[Number(text) - 1];
      if (!selected) return;

      ytSearchCache.delete(sender);

      await reply(sock, msg, `🎧 Mengambil audio:\n${selected.title}`);

      try {
        const audioPath = await downloadYouTubeAudio(selected.url);
        return reply(sock, msg, {
          audio: { url: audioPath },
          mimetype: "audio/mpeg"
        });
      } catch {
        return reply(sock, msg, "❌ Gagal mengambil audio.");
      }
    }

    /* ===============================
       2️⃣ HANYA COMMAND
    ================================ */
    if (!text.startsWith("!")) return;

    const args = text.slice(1).trim().split(/\s+/);
    const command = args.shift().toLowerCase();
    const input = args.join(" ");

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

        return reply(sock, msg, txt);
      } catch {
        return reply(sock, msg, "❌ Gagal mencari YouTube.");
      }
    }

    /* ===============================
       YTA (DIRECT LINK)
    ================================ */
    if (command === "yta") {
      if (!input || !input.includes("watch?v=")) {
        return reply(
          sock,
          msg,
          "❗ Gunakan link YouTube watch?v=\nShorts tidak didukung."
        );
      }

      await reply(sock, msg, "🎧 Mengambil audio (yt-dlp)...");

      try {
        const audioPath = await downloadYouTubeAudio(input);
        return reply(sock, msg, {
          audio: { url: audioPath },
          mimetype: "audio/mpeg"
        });
      } catch (err) {
        return reply(
          sock,
          msg,
          typeof err === "string" ? err : "❌ Gagal mengambil audio"
        );
      }
    }

    /* ===============================
       TIKTOK
    ================================ */
    if (command === "tt") {
      if (!input.includes("tiktok.com")) {
        return reply(sock, msg, "❗ Link TikTok tidak valid");
      }

      await reply(sock, msg, "📥 Mengunduh TikTok...");

      try {
        const data = await downloadTikTok(input);
        return reply(sock, msg, {
          video: { url: data.video },
          caption: `🎵 ${data.title}\n👤 ${data.author}`
        });
      } catch {
        return reply(sock, msg, "❌ Gagal download TikTok");
      }
    }

    /* ===============================
       INSTAGRAM
    ================================ */
    if (command === "ig") {
      if (!input.includes("instagram.com")) {
        return reply(sock, msg, "❗ Link Instagram tidak valid");
      }

      await reply(sock, msg, "📸 Mengunduh Instagram...");

      try {
        const video = await downloadInstagram(input);
        return reply(sock, msg, { video: { url: video } });
      } catch {
        return reply(sock, msg, "❌ Gagal download Instagram");
      }
    }

if (command === "cuaca") {
  if (!input) {
    return reply(
      sock,
      msg,
      "❗ Contoh:\n!cuaca Mugarsari Tasikmalaya\n!cuaca Tasikmalaya\n!cuaca Tasikmalaya Indonesia"
    );
  }

  try {
    const w = await getWeatherWeatherAPI(input);

    let hourlyText = "";
    w.hourly.forEach(h => {
      hourlyText += `🕒 ${h.time} | ${h.icon} ${h.condition} | ${h.temp}°C | 🌧️ ${h.rainChance}%\n`;
    });

    const text = `
🌦️ *CUACA DETAIL*
━━━━━━━━━━━━━━
📍 *Lokasi:*
${w.location}
⏱️ *Zona Waktu:* ${w.timezone}

🌡️ *Saat ini:*
${w.temp}°C (terasa ${w.feels}°C)
${w.condition}
💧 ${w.humidity}% | 💨 ${w.wind} km/jam
🌧️ Curah hujan: ${w.rain} mm

⏱️ *Perkiraan Beberapa Jam ke Depan*
${hourlyText}
━━━━━━━━━━━━━━
`.trim();

    return reply(sock, msg, text);
  } catch (err) {
    return reply(
      sock,
      msg,
      "❌ Lokasi tidak dikenali.\nCoba:\n• Mugarsari Tasikmalaya\n• Tasikmalaya\n• Tasikmalaya Indonesia"
    );
  }
}




    /* ===============================
       GAMBAR (CSE)
    ================================ */
    if (command === "gambar" || command === "image") {
      if (!input) {
        return reply(
          sock,
          msg,
          "❗ Contoh:\n!gambar kucing\n!gambar --unsafe anime"
        );
      }

      const { safeMode, query } = parseImageFlags(input);
      if (!query) {
        return reply(sock, msg, "❗ Kata kunci kosong.");
      }

      if (!safeMode) {
        const owner = normalizeJid(process.env.OWNER_NUMBER);
        const senderNum = normalizeJid(sender);
        if (!msg.key.fromMe && senderNum !== owner) {
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

        return reply(sock, msg, {
          image: image.buffer,
          mimetype: image.mimetype,
          caption: `🖼️ ${query}\n🛡️ Mode: ${
            safeMode ? "SAFE" : "UNSAFE"
          }`
        });
      } catch {
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
  └ Tanya AI (OpenRouter)

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

      return reply(sock, msg, menuText);
    }

    /* ===============================
       AI
    ================================ */
if (command === "ai") {
  if (!input) {
    return reply(sock, msg, "❗ !ai <pertanyaan>");
  }

  const { content, model } = await askAI(input);

  const text = `
🤖 Model: *Gemini-3-flash*
━━━━━━━━━━━━━━━━━━━
${content}
`.trim();

  return reply(sock, msg, text);
}

    /* ===============================
       SUARA / TTS
    ================================ */
    // google TTS
if (command === "suara") {
  if (!input) {
    return reply(sock, msg, "❗ !suara <teks>");
  }

  if (input.length > 250) {
    return reply(sock, msg, "❗ Maksimal 250 karakter.");
  }

  const now = Date.now();
  const last = ttsCooldown.get(sender) || 0;
  const remaining = TTS_DELAY - (now - last);

  if (remaining > 0) {
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

    return reply(sock, msg, {
      audio,
      mimetype: "audio/ogg; codecs=opus",
      ptt: true
    });

  } catch (err) {
    ttsCooldown.delete(sender);
    logError("TTS ERROR", err);
    return reply(sock, msg, "❌ Gagal membuat suara.");
  }
}


    /* ===============================
       TAG
    ================================ */
    if (command === "tagall") return tagAll(sock, msg, input);
    if (command === "tagadmin") return tagAdmin(sock, msg, input);

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

      return reply(sock, msg, textStatus);
    }
 } catch (err) {
  logError(
    `HANDLER FAIL | user=${String(sender).split("@")[0]} | cmd=${text || "-"}`,
    err
  );
}
}
