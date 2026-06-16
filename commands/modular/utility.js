import axios from "axios";

export function createUtilityCommands(deps) {
  const { logCommandResult, reply, logInfo, logWarn } = deps;

  const logOk = (ctx, reason = "OK") => logCommandResult({ ...ctx, status: "OK", reason, durationMs: 0 });
  const logFail = (ctx, reason) => logCommandResult({ ...ctx, status: "FAIL", reason, durationMs: 0 });

  // ============================================================
  // QR CODE GENERATOR (Google Chart API - no key needed)
  // ============================================================
  async function generateQR(text) {
    const encoded = encodeURIComponent(text);
    const size = 300;
    const url = `https://chart.googleapis.com/chart?cht=qr&chl=${encoded}&chs=${size}x${size}&choe=UTF-8`;
    
    const res = await axios.get(url, { 
      responseType: "arraybuffer",
      timeout: 10000,
      headers: { "User-Agent": "BotWA/1.0" }
    });
    
    return Buffer.from(res.data);
  }

  // ============================================================
  // URL SHORTENER (multiple fallbacks: TinyURL -> is.gd -> CleanURI)
  // ============================================================
  async function shortenUrl(longUrl) {
    const errors = [];

    // 1. TinyURL (most reliable, no key)
    try {
      const res = await axios.get("https://tinyurl.com/api-create.php", {
        params: { url: longUrl },
        timeout: 8000,
        headers: { "User-Agent": "BotWA/1.0" }
      });
      const short = String(res.data).trim();
      if (short.startsWith("http") && short !== longUrl) return short;
      errors.push(`TinyURL: ${short}`);
    } catch (e) {
      errors.push(`TinyURL: ${e.message}`);
    }

    // 2. is.gd (backup, no key)
    try {
      const res = await axios.get("https://is.gd/create.php", {
        params: { format: "json", url: longUrl },
        timeout: 8000,
        headers: { "User-Agent": "BotWA/1.0" }
      });
      if (res.data?.shorturl && res.data.shorturl !== longUrl) return res.data.shorturl;
      errors.push(`is.gd: ${res.data?.error || "unknown"}`);
    } catch (e) {
      errors.push(`is.gd: ${e.message}`);
    }

    // 3. CleanURI (backup)
    try {
      const res = await axios.post("https://cleanuri.com/api/v1/shorten", null, {
        params: { url: longUrl },
        timeout: 8000,
        headers: { "User-Agent": "BotWA/1.0" }
      });
      if (res.data?.result_url && res.data.result_url !== longUrl) return res.data.result_url;
      errors.push(`CleanURI: ${res.data?.error || "unknown"}`);
    } catch (e) {
      errors.push(`CleanURI: ${e.message}`);
    }

    throw new Error(`Semua shortener gagal: ${errors.join(" | ")}`);
  }

  // ============================================================
  // VALIDASI URL
  // ============================================================
  function isValidUrl(text) {
    try {
      const u = new URL(text);
      return u.protocol === "http:" || u.protocol === "https:";
    } catch {
      return false;
    }
  }

  // ============================================================
  // COMMAND DEFINITIONS
  // ============================================================
  return [
    {
      names: ["qr"],
      category: "Utility",
      description: "Generate QR code dari teks/link (max 2000 char)",
      usage: "!qr <teks atau link>",
      subCommands: [
        { names: "qr <teks>", description: "Generate QR code, kirim sebagai gambar" },
        { names: "qr <link>", description: "Generate QR untuk link (bisa di-scan)" }
      ],
      execute: async ctx => {
        const { sock, msg, args, jid, sender, reply } = ctx;
        const text = args.join(" ").trim();

        if (!text) {
          await reply(sock, msg, "❌ Format: `!qr <teks atau link>`\nContoh: `!qr https://github.com` atau `!qr Halo dunia`");
          return logFail(ctx, "no args");
        }

        if (text.length > 2000) {
          await reply(sock, msg, "❌ Teks terlalu panjang (max 2000 karakter).");
          return logFail(ctx, "too long");
        }

        try {
          const qrBuffer = await generateQR(text);
          
          await sock.sendMessage(jid, {
            image: qrBuffer,
            caption: `📱 *QR Code*\n${text.length > 80 ? text.slice(0, 80) + "..." : text}`,
            mimetype: "image/png"
          }, { quoted: msg });

          logInfo(`QR GENERATED | user=${sender.split("@")[0]} | len=${text.length}`);
          logOk(ctx, "qr generated");
        } catch (err) {
          logWarn(`QR FAIL | ${err.message}`);
          await reply(sock, msg, `❌ Gagal generate QR: ${err.message}`);
          logFail(ctx, err.message);
        }
      }
    },

    {
      names: ["short", "shorturl", "tiny"],
      category: "Utility",
      description: "Pendekkan URL panjang (TinyURL / is.gd / CleanURI)",
      usage: "!short <url> | !tiny <url>",
      subCommands: [
        { names: "short <url>", description: "Pendekkan URL dengan TinyURL (fallback ke is.gd, CleanURI)" },
        { names: "tiny <url>", description: "Alias short" },
        { names: "shorturl <url>", description: "Alias short (English)" }
      ],
      execute: async ctx => {
        const { sock, msg, args, jid, sender, reply } = ctx;
        const url = args[0]?.trim();

        if (!url) {
          await reply(sock, msg, "❌ Format: `!short <url>`\nContoh: `!short https://github.com/user/repo/tree/main/folder/file.js`");
          return logFail(ctx, "no url");
        }

        if (!isValidUrl(url)) {
          await reply(sock, msg, "❌ URL tidak valid. Harus diawali `http://` atau `https://`");
          return logFail(ctx, "invalid url");
        }

        try {
          const shortUrl = await shortenUrl(url);
          
          await reply(sock, msg, 
            `✅ *URL Disingkat*\n\n` +
            `🔗 Asli: ${url.length > 100 ? url.slice(0, 100) + "..." : url}\n` +
            `✂️ Pendek: ${shortUrl}\n\n` +
            `_Powered by TinyURL / is.gd / CleanURI_`
          );

          logInfo(`SHORTURL | user=${sender.split("@")[0]} | ${url} -> ${shortUrl}`);
          logOk(ctx, "shortened");
        } catch (err) {
          logWarn(`SHORTURL FAIL | ${err.message}`);
          await reply(sock, msg, `❌ Gagal memendekkan URL: ${err.message}`);
          logFail(ctx, err.message);
        }
      }
    }
  ];
}
