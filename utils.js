// ============================================================
// LANGKAH 1: Install dulu di terminal:
//   npm install bmkg-wrapper
//
// LANGKAH 2: Ganti seluruh isi utils.js dengan file ini
//
// LANGKAH 3: Di handler.js, ganti import:
//   getWeatherWeatherAPI  →  getWeatherBMKG, getWeatherIcon
// ============================================================

export function getText(msg) {
  return (
    msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    ""
  );
}

import fs from "fs-extra";
import path from "path";
import { spawn } from "child_process";
import https from "https";
import axios from "axios";
import sharp from "sharp";

// ============================================================
//   HELPER
// ============================================================

export function formatUptime(ms) {
  const sec = Math.floor(ms / 1000);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${h} jam ${m} menit ${s} detik`;
}

export function formatBytes(bytes) {
  const gb = bytes / (1024 ** 3);
  return gb.toFixed(2) + " GB";
}

export function pingUrl(url, timeout = 5000, headers = {}) {
  return new Promise((resolve) => {
    const start = Date.now();
    const req = https.get(url, { timeout, headers }, () => {
      resolve(Date.now() - start);
      req.destroy();
    });
    req.on("error", () => resolve(null));
    req.on("timeout", () => { req.destroy(); resolve(null); });
  });
}

// ============================================================
//   BMKG WEATHER (GRATIS, AKURAT UNTUK INDONESIA)
// ============================================================

export function getWeatherIcon(desc = "") {
  const d = String(desc).toLowerCase();
  if (d.includes("badai") || d.includes("petir") || d.includes("thunder")) return "⛈️";
  if (d.includes("hujan lebat")) return "🌧️";
  if (d.includes("hujan")) return "🌦️";
  if (d.includes("gerimis")) return "🌦️";
  if (d.includes("kabut") || d.includes("asap")) return "🌫️";
  if (d.includes("berawan tebal")) return "☁️";
  if (d.includes("berawan")) return "⛅";
  if (d.includes("cerah berawan")) return "🌤️";
  if (d.includes("cerah")) return "☀️";
  return "🌡️";
}

export async function getWeatherBMKG(query) {
  // Step 1: Geocoding via Nominatim
  const geoRes = await axios.get(
    "https://nominatim.openstreetmap.org/search",
    {
      params: { q: query + ", Indonesia", format: "json", limit: 1 },
      headers: { "User-Agent": "BotWA/1.0" },
      timeout: 8000
    }
  );

  if (!geoRes.data || geoRes.data.length === 0) {
    throw new Error("Lokasi tidak ditemukan");
  }

  const { lat, lon, display_name } = geoRes.data[0];

  // Step 2: Cuaca dari Tomorrow.io
  const apiKey = process.env.TOMORROW_API_KEY;
  const cuacaRes = await axios.get(
    "https://api.tomorrow.io/v4/weather/forecast",
    {
      params: {
        location: `${lat},${lon}`,
        apikey: apiKey,
        timesteps: "1h",
        units: "metric",
        timezone: "Asia/Jakarta"
      },
      timeout: 8000
    }
  );

  const hourly = cuacaRes.data.timelines.hourly;
  const prakiraan = hourly.slice(0, 4).map(h => ({
    local_datetime: h.time,
    t: Math.round(h.values.temperature),
    hu: Math.round(h.values.humidity),
    ws: Math.round(h.values.windSpeed),
    weather_desc: tomorrowCodeToDesc(h.values.weatherCode),
    rainChance: Math.round(h.values.precipitationProbability)
  }));

// Ambil provinsi yang benar — skip "Jawa" (pulau) dan "Indonesia"
  const lokasiParts = display_name.split(", ");
  const skipWords = ["jawa", "sumatera", "kalimantan", "sulawesi", "papua", "indonesia", "bali", "nusa tenggara"];
  const provinsi = [...lokasiParts].reverse().find(p =>
    !skipWords.includes(p.toLowerCase())
  ) || "Indonesia";

  return {
    lokasi: lokasiParts.slice(0, 3).join(", "),
    kotkab: lokasiParts[2] || "",
    provinsi,
    cuacaSekarang: prakiraan[0],
    prakiraan
  };

}

function tomorrowCodeToDesc(code) {
  const map = {
    1000: "Cerah", 1100: "Cerah Berawan", 1101: "Berawan Sebagian",
    1102: "Berawan", 1001: "Berawan Tebal",
    2000: "Kabut", 2100: "Kabut Ringan",
    4000: "Gerimis", 4001: "Hujan", 4200: "Hujan Ringan", 4201: "Hujan Lebat",
    5000: "Salju", 5001: "Salju Lebat", 5100: "Salju Ringan",
    6000: "Gerimis Beku", 6001: "Hujan Beku", 6200: "Hujan Beku Ringan",
    7000: "Hujan Es", 7101: "Hujan Es Lebat", 7102: "Hujan Es Ringan",
    8000: "Hujan Petir"
  };
  return map[code] || "Berawan";
}

// ============================================================
//   IMAGE SEARCH (Google CSE)
// ============================================================

export async function searchImageCSE(query, safeMode = true) {
  const apiKey = process.env.GOOGLE_API_KEY;
  const cseId = process.env.GOOGLE_CSE_ID;

  if (!apiKey || !cseId) throw new Error("GOOGLE_API_KEY / GOOGLE_CSE_ID belum diset");

  const res = await axios.get("https://www.googleapis.com/customsearch/v1", {
    params: { key: apiKey, cx: cseId, q: query, searchType: "image", num: 5, safe: safeMode ? "active" : "off" }
  });

  const items = res.data.items;
  if (!items || !items.length) return null;

  return items[Math.floor(Math.random() * items.length)].link;
}

// ============================================================
//   DOWNLOAD IMAGE
// ============================================================

export async function downloadImage(url) {
  try {
    const res = await axios.get(url, {
      responseType: "arraybuffer",
      timeout: 8000,
      headers: { "User-Agent": "Mozilla/5.0", Accept: "image/*" }
    });

    const contentType = res.headers["content-type"] || "";
    if (!contentType.startsWith("image/")) return null;
    if (contentType.includes("svg") || contentType.includes("avif")) return null;

    return { buffer: Buffer.from(res.data), mimetype: contentType };
  } catch {
    return null;
  }
}

export async function stickerToImage(buffer) {
  return await sharp(buffer).png().toBuffer();
}

// ============================================================
//   DOWNLOAD TIKTOK
// ============================================================

export async function downloadTikTok(url) {
  const input = String(url || "").trim();
  if (!input) throw new Error("Link TikTok kosong.");

  // 1) Utama: TikWM (cepat, direct URL)
  try {
    const res = await axios.post("https://tikwm.com/api/", null, {
      params: { url: input },
      timeout: 15000
    });
    const payload = res.data?.data || {};
    const playUrl = payload?.play || payload?.hdplay;
    if (playUrl) {
      return {
        video: String(playUrl).startsWith("http")
          ? playUrl
          : `https://tikwm.com${playUrl}`,
        author: payload?.author?.nickname || "Unknown",
        title: payload?.title || "Tanpa judul"
      };
    }
  } catch (err) {
    console.error("❗ [tt] tikwm gagal:", err?.message || err);
  }

  // 2) Fallback: yt-dlp (lebih tahan untuk link yang sulit)
  const tmpDir = path.resolve("./tmp");
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir);

  try {
    const result = await new Promise((resolve, reject) => {
      const baseJobId = `tt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const output = path.join(tmpDir, `${baseJobId}.%(ext)s`);
      const cookiesPath = path.resolve("./cookies.txt");
      const hasCookies = fs.existsSync(cookiesPath);
      const userAgent =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36";

      const args = [
        "--no-playlist",
        "--no-update",
        "--user-agent", userAgent,
        "--add-header", "Referer: https://www.tiktok.com/",
        "--add-header", "Origin: https://www.tiktok.com/",
        ...(hasCookies ? ["--cookies", cookiesPath] : []),
        "-f", "mp4/best",
        "-o", output,
        input
      ];

      const proc = spawn("yt-dlp", args, { stdio: ["ignore", "pipe", "pipe"] });
      let stderrText = "";
      let stdoutText = "";

      proc.stdout.on("data", d => {
        const line = d.toString().trim();
        stdoutText += `${line}\n`;
        console.log("▶️ [tt-ytdlp]", line);
      });
      proc.stderr.on("data", d => {
        const line = d.toString().trim();
        stderrText += `${line}\n`;
        console.error("❗ [tt-ytdlp]", line);
      });

      proc.on("error", (err) => {
        if (err?.code === "ENOENT") return reject(new Error("yt-dlp belum terpasang di server."));
        reject(new Error(err?.message || "Gagal menjalankan yt-dlp untuk TikTok."));
      });

      proc.on("close", (code) => {
        if (code !== 0) {
          return reject(new Error(stderrText || stdoutText || "yt-dlp gagal memproses link TikTok."));
        }

        const files = fs.readdirSync(tmpDir).filter(
          f =>
            f.startsWith(baseJobId) &&
            (f.endsWith(".mp4") || f.endsWith(".mov") || f.endsWith(".mkv") || f.endsWith(".webm"))
        );
        if (!files.length) {
          return reject(new Error("File video TikTok tidak ditemukan."));
        }

        const latest = files
          .map(f => ({ f, t: fs.statSync(path.join(tmpDir, f)).mtime.getTime() }))
          .sort((a, b) => b.t - a.t)[0];

        resolve({
          video: path.join(tmpDir, latest.f),
          author: "Unknown",
          title: "TikTok Video"
        });
      });
    });

    return result;
  } catch (err) {
    throw new Error(err?.message || "Gagal download TikTok. Coba link lain yang public.");
  }
}

// ============================================================
//   DOWNLOAD INSTAGRAM
// ============================================================

export async function downloadInstagram(url) {
  const input = String(url || "").trim();
  if (!input) throw new Error("Link Instagram kosong.");

  const tmpDir = path.resolve("./tmp");
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir);

  // 1) Utama: pakai yt-dlp (lebih stabil untuk reels/post public)
  try {
    const videoPath = await new Promise((resolve, reject) => {
      const baseJobId = `ig_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const cookiesPath = path.resolve("./cookies.txt");
      const hasCookies = fs.existsSync(cookiesPath);
      const output = path.join(tmpDir, `${baseJobId}.%(ext)s`);
      const userAgent =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36";

      const args = [
        "--no-playlist",
        "--no-update",
        "--user-agent", userAgent,
        "--add-header", "Referer: https://www.instagram.com/",
        ...(hasCookies ? ["--cookies", cookiesPath] : []),
        "-f", "mp4/best",
        "-o", output,
        input
      ];

      const proc = spawn("yt-dlp", args, { stdio: ["ignore", "pipe", "pipe"] });
      let stderrText = "";

      proc.stdout.on("data", d => console.log("▶️ [ig-ytdlp]", d.toString().trim()));
      proc.stderr.on("data", d => {
        const line = d.toString().trim();
        stderrText += `${line}\n`;
        console.error("❗ [ig-ytdlp]", line);
      });

      proc.on("error", (err) => {
        if (err?.code === "ENOENT") return reject(new Error("yt-dlp belum terpasang di server."));
        reject(new Error(err?.message || "Gagal menjalankan yt-dlp untuk Instagram."));
      });

      proc.on("close", (code) => {
        if (code !== 0) {
          return reject(new Error(stderrText || "yt-dlp gagal memproses link Instagram."));
        }

        const files = fs.readdirSync(tmpDir).filter(
          f =>
            f.startsWith(baseJobId) &&
            (f.endsWith(".mp4") || f.endsWith(".mov") || f.endsWith(".mkv") || f.endsWith(".webm"))
        );

        if (!files.length) {
          return reject(new Error("File video Instagram tidak ditemukan."));
        }

        const latest = files
          .map(f => ({ f, t: fs.statSync(path.join(tmpDir, f)).mtime.getTime() }))
          .sort((a, b) => b.t - a.t)[0];
        resolve(path.join(tmpDir, latest.f));
      });
    });

    return videoPath;
  } catch (err) {
    console.error("❗ [ig] yt-dlp fallback ke API:", err?.message || err);
  }

  // 2) Fallback: API eksternal lama
  try {
    const res = await axios.post(
      "https://igram.world/api/ig",
      { url: input },
      { timeout: 15000 }
    );
    const items = Array.isArray(res.data?.data) ? res.data.data : [];
    const first = items.find(item => item?.url || item?.download_url) || items[0];
    const video = first?.url || first?.download_url || res.data?.url;
    if (!video) throw new Error("Link video dari API tidak ditemukan.");
    return video;
  } catch {
    throw new Error("Gagal download Instagram. Coba link reel/post lain yang public.");
  }
}

export function normalizeYouTubeUrl(rawUrl = "") {
  const input = String(rawUrl || "").trim();
  if (!input) return null;

  let parsed;
  try {
    parsed = new URL(input);
  } catch {
    return null;
  }

  const host = parsed.hostname.toLowerCase();
  const isYoutubeHost = [
    "youtube.com",
    "www.youtube.com",
    "m.youtube.com",
    "music.youtube.com",
    "youtu.be"
  ].includes(host);

  if (!isYoutubeHost) return null;

  // youtu.be/<id>
  if (host === "youtu.be") {
    const id = parsed.pathname.split("/").filter(Boolean)[0];
    if (!id) return null;
    return `https://www.youtube.com/watch?v=${id}`;
  }

  // /shorts/<id>
  if (parsed.pathname.startsWith("/shorts/")) {
    const id = parsed.pathname.split("/")[2];
    if (!id) return null;
    return `https://www.youtube.com/watch?v=${id}`;
  }

  // /watch?v=<id>
  if (parsed.pathname === "/watch") {
    const id = parsed.searchParams.get("v");
    if (!id) return null;
    return `https://www.youtube.com/watch?v=${id}`;
  }

  return null;
}

// ============================================================
//   YOUTUBE AUDIO (yt-dlp)
// ============================================================

export async function downloadYouTubeAudio(url) {
  return new Promise((resolve, reject) => {
    const tmpDir = path.resolve("./tmp");
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir);

    const baseJobId = `yt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const cookiesPath = path.resolve("./cookies.txt");
    const hasCookies = fs.existsSync(cookiesPath);
    const baseArgs = [
      "--no-playlist",
      "--no-update",
      "--js-runtimes", "node",
      "--add-header", "Referer: https://www.youtube.com/",
      "--extract-audio",
      "--audio-format", "mp3",
      "--audio-quality", "0",
      "--newline"
    ];
    const userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36";

    const attempts = [
      {
        name: hasCookies ? "cookies+default" : "default",
        extraArgs: [
          ...(hasCookies ? ["--cookies", cookiesPath] : []),
          "--user-agent", userAgent,
          "--extractor-args", "youtube:player_client=android,ios,web",
          "-f", "bestaudio[ext=m4a]/bestaudio/best"
        ]
      },
      {
        name: "no-cookies",
        extraArgs: [
          "--user-agent", userAgent,
          "--extractor-args", "youtube:player_client=android,ios,web",
          "-f", "bestaudio[ext=m4a]/bestaudio/best"
        ]
      },
      {
        name: "web-client-fallback",
        extraArgs: [
          "--user-agent", userAgent,
          "--extractor-args", "youtube:player_client=web",
          "-f", "bestaudio/best"
        ]
      },
      {
        name: "tv-ios-fallback",
        extraArgs: [
          "--user-agent", userAgent,
          "--extractor-args", "youtube:player_client=tv,ios",
          "-f", "bestaudio*/best"
        ]
      }
    ];

    let attemptIndex = 0;
    let lastStderr = "";

    const runNextAttempt = () => {
      if (attemptIndex >= attempts.length) {
        const lower = String(lastStderr || "").toLowerCase();
        return reject(
          lower.includes("requested format is not available")
            ? "Format audio tidak tersedia untuk video ini."
            : lower.includes("http error 403")
              ? "YouTube menolak akses (HTTP 403). Coba video lain atau refresh cookies."
              : lower.includes("no supported javascript runtime")
                ? "Runtime JavaScript untuk yt-dlp belum siap. Pastikan Node.js terdeteksi di server."
                : "yt-dlp gagal memproses video ini."
        );
      }

      const attempt = attempts[attemptIndex];
      const attemptJobId = `${baseJobId}_a${attemptIndex + 1}`;
      const output = path.join(tmpDir, `${attemptJobId}.%(ext)s`);
      const args = [...attempt.extraArgs, ...baseArgs, "-o", output, url];
      const proc = spawn("yt-dlp", args, { stdio: ["pipe", "pipe", "pipe"] });
      let done = false;
      let stderrText = "";

      const timeout = setTimeout(() => {
        if (done) return;
        done = true;
        proc.kill("SIGKILL");
        lastStderr = "timeout";
        attemptIndex += 1;
        runNextAttempt();
      }, 120000);

      proc.on("error", (err) => {
        if (done) return;
        done = true;
        clearTimeout(timeout);
        if (err?.code === "ENOENT") {
          return reject("yt-dlp belum terpasang di server.");
        }
        lastStderr = err?.message || "spawn error";
        attemptIndex += 1;
        runNextAttempt();
      });

      proc.stdin.end();
      proc.stdout.on("data", d => console.log(`▶️ [${attempt.name}]`, d.toString().trim()));
      proc.stderr.on("data", d => {
        const line = d.toString().trim();
        stderrText += `${line}\n`;
        console.error(`❗ [${attempt.name}]`, line);
      });

      proc.on("close", code => {
        if (done) return;
        done = true;
        clearTimeout(timeout);

        if (code !== 0) {
          lastStderr = stderrText;
          attemptIndex += 1;
          return runNextAttempt();
        }

        const files = fs.readdirSync(tmpDir).filter(
          f => f.endsWith(".mp3") && f.startsWith(attemptJobId)
        );
        if (!files.length) {
          lastStderr = "File audio tidak ditemukan";
          attemptIndex += 1;
          return runNextAttempt();
        }

        const latest = files
          .map(f => ({ f, t: fs.statSync(path.join(tmpDir, f)).mtime.getTime() }))
          .sort((a, b) => b.t - a.t)[0];
        return resolve(path.join(tmpDir, latest.f));
      });
    };

    runNextAttempt();
  });
}

export async function downloadYouTubeVideo(url) {
  return new Promise((resolve, reject) => {
    const tmpDir = path.resolve("./tmp");
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir);

    const baseJobId = `ytv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const cookiesPath = path.resolve("./cookies.txt");
    const hasCookies = fs.existsSync(cookiesPath);
    const baseArgs = [
      "--no-playlist",
      "--no-update",
      "--js-runtimes", "node",
      "--add-header", "Referer: https://www.youtube.com/",
      "--merge-output-format", "mp4",
      "--newline"
    ];
    const userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36";

    const attempts = [
      {
        name: hasCookies ? "cookies+video" : "video-default",
        extraArgs: [
          ...(hasCookies ? ["--cookies", cookiesPath] : []),
          "--user-agent", userAgent,
          "--extractor-args", "youtube:player_client=android,ios,web",
          "-f", "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/best"
        ]
      },
      {
        name: "video-no-cookies",
        extraArgs: [
          "--user-agent", userAgent,
          "--extractor-args", "youtube:player_client=android,ios,web",
          "-f", "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/best"
        ]
      },
      {
        name: "video-tv-ios-fallback",
        extraArgs: [
          "--user-agent", userAgent,
          "--extractor-args", "youtube:player_client=tv,ios",
          "-f", "bestvideo+bestaudio/best"
        ]
      }
    ];

    let attemptIndex = 0;
    let lastStderr = "";

    const runNextAttempt = () => {
      if (attemptIndex >= attempts.length) {
        const lower = String(lastStderr || "").toLowerCase();
        return reject(
          lower.includes("requested format is not available")
            ? "Format video tidak tersedia untuk link ini."
            : lower.includes("http error 403")
              ? "YouTube menolak akses (HTTP 403). Coba video lain atau refresh cookies."
              : "yt-dlp gagal memproses video ini."
        );
      }

      const attempt = attempts[attemptIndex];
      const attemptJobId = `${baseJobId}_a${attemptIndex + 1}`;
      const output = path.join(tmpDir, `${attemptJobId}.%(ext)s`);
      const args = [...attempt.extraArgs, ...baseArgs, "-o", output, url];
      const proc = spawn("yt-dlp", args, { stdio: ["pipe", "pipe", "pipe"] });
      let done = false;
      let stderrText = "";

      const timeout = setTimeout(() => {
        if (done) return;
        done = true;
        proc.kill("SIGKILL");
        lastStderr = "timeout";
        attemptIndex += 1;
        runNextAttempt();
      }, 180000);

      proc.on("error", (err) => {
        if (done) return;
        done = true;
        clearTimeout(timeout);
        if (err?.code === "ENOENT") {
          return reject("yt-dlp belum terpasang di server.");
        }
        lastStderr = err?.message || "spawn error";
        attemptIndex += 1;
        runNextAttempt();
      });

      proc.stdin.end();
      proc.stdout.on("data", d => console.log(`▶️ [${attempt.name}]`, d.toString().trim()));
      proc.stderr.on("data", d => {
        const line = d.toString().trim();
        stderrText += `${line}\n`;
        console.error(`❗ [${attempt.name}]`, line);
      });

      proc.on("close", code => {
        if (done) return;
        done = true;
        clearTimeout(timeout);

        if (code !== 0) {
          lastStderr = stderrText;
          attemptIndex += 1;
          return runNextAttempt();
        }

        const files = fs.readdirSync(tmpDir).filter(
          f =>
            f.startsWith(attemptJobId) &&
            (f.endsWith(".mp4") || f.endsWith(".mkv") || f.endsWith(".webm"))
        );
        if (!files.length) {
          lastStderr = "File video tidak ditemukan";
          attemptIndex += 1;
          return runNextAttempt();
        }

        const latest = files
          .map(f => ({ f, t: fs.statSync(path.join(tmpDir, f)).mtime.getTime() }))
          .sort((a, b) => b.t - a.t)[0];
        return resolve(path.join(tmpDir, latest.f));
      });
    };

    runNextAttempt();
  });
}

// ============================================================
//   YOUTUBE SEARCH
// ============================================================

export async function ytSearch(query) {
  const apiKey = process.env.GOOGLE_API_KEY;
  const cseId = process.env.GOOGLE_CSE_ID;
  if (!apiKey || !cseId) throw new Error("Google CSE belum dikonfigurasi");

  const res = await axios.get("https://www.googleapis.com/customsearch/v1", {
    params: { key: apiKey, cx: cseId, q: query + " site:youtube.com", num: 5 },
    timeout: 15000
  });

  const items = res?.data?.items;
  if (!Array.isArray(items) || items.length === 0) throw new Error("Hasil pencarian kosong");

  return items.map(item => ({ title: item.title, url: item.link }));
}

function formatDuration(totalSec = 0) {
  const sec = Math.max(0, Number(totalSec) || 0);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function scoreMusicResult(item = {}, q = "") {
  const title = String(item.title || "").toLowerCase();
  const channel = String(item.channel || "").toLowerCase();
  const query = String(q || "").toLowerCase();
  let score = 0;

  if (channel.includes("topic")) score += 3;
  if (title.includes("official music video")) score += 3;
  if (title.includes("official audio")) score += 2;
  if (title.includes("lyrics") || title.includes("lyric")) score += 1;
  if (title.includes("remix") || title.includes("nightcore")) score -= 2;
  if (query && title.includes(query)) score += 2;

  const d = Number(item.duration || 0);
  if (d >= 90 && d <= 600) score += 2; // mayoritas lagu normal
  if (d > 1200) score -= 2;

  return score;
}

export async function searchYouTubeMusic(query) {
  return new Promise((resolve, reject) => {
    const args = [
      "--dump-json",
      "--flat-playlist",
      "--skip-download",
      "--no-warnings",
      "--playlist-end", "12",
      `ytsearch12:${query}`
    ];

    const proc = spawn("yt-dlp", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", d => { stdout += d.toString(); });
    proc.stderr.on("data", d => { stderr += d.toString(); });

    proc.on("error", (err) => {
      if (err?.code === "ENOENT") {
        return reject(new Error("yt-dlp belum terpasang di server."));
      }
      return reject(new Error("Gagal menjalankan yt-dlp untuk pencarian musik."));
    });

    proc.on("close", (code) => {
      if (code !== 0) {
        return reject(new Error(stderr.trim() || "Pencarian musik gagal."));
      }

      const rows = stdout
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean);

      const parsed = rows
        .map(line => {
          try {
            return JSON.parse(line);
          } catch {
            return null;
          }
        })
        .filter(Boolean)
        .map(item => ({
          title: item.title || "Tanpa judul",
          url: item.id ? `https://www.youtube.com/watch?v=${item.id}` : item.webpage_url,
          channel: item.channel || item.uploader || "-",
          duration: Number(item.duration || 0)
        }))
        .filter(item => item.url);

      if (!parsed.length) {
        return reject(new Error("Hasil musik kosong."));
      }

      const ranked = parsed
        .map(item => ({ ...item, score: scoreMusicResult(item, query) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 5)
        .map(item => ({
          title: item.title,
          url: item.url,
          channel: item.channel,
          duration: formatDuration(item.duration)
        }));

      return resolve(ranked);
    });
  });
}
