export function getText(msg) {
  return (
    msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    ""
  );
}

import fs from "fs-extra";
import path from "path";
import { exec } from "child_process";


export function formatUptime(ms) {
  const sec = Math.floor(ms / 1000);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;

  return `${h} jam ${m} menit ${s} detik`;
}

import https from "https";

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
    req.on("timeout", () => {
      req.destroy();
      resolve(null);
    });
  });
}

import axios from "axios";
export async function searchImageCSE(query, safeMode = true) {
  const apiKey = process.env.GOOGLE_API_KEY;
  const cseId = process.env.GOOGLE_CSE_ID;

  if (!apiKey || !cseId) {
    throw new Error("GOOGLE_API_KEY / GOOGLE_CSE_ID belum diset");
  }

  const res = await axios.get(
    "https://www.googleapis.com/customsearch/v1",
    {
      params: {
        key: apiKey,
        cx: cseId,
        q: query,
        searchType: "image",
        num: 5,
        safe: safeMode ? "active" : "off"
      }
    }
  );

  const items = res.data.items;
  if (!items || !items.length) return null;

  const pick = items[Math.floor(Math.random() * items.length)];
  return pick.link;
}


// ===== DOWNLOAD IMAGE (SUDAH ADA PUNYAMU) =====
export async function downloadImage(url) {
  try {
    const res = await axios.get(url, {
      responseType: "arraybuffer",
      timeout: 8000,
      headers: {
        "User-Agent": "Mozilla/5.0",
        Accept: "image/*"
      }
    });

    const contentType = res.headers["content-type"] || "";

    if (!contentType.startsWith("image/")) return null;
    if (contentType.includes("svg")) return null;
    if (contentType.includes("avif")) return null;

    return {
      buffer: Buffer.from(res.data),
      mimetype: contentType
    };
  } catch {
    return null;
  }
}

import sharp from "sharp";

export async function stickerToImage(buffer) {
  return await sharp(buffer)
    .png()
    .toBuffer();
}

export async function downloadTikTok(url) {
  const api = "https://tikwm.com/api/";

  const res = await axios.post(api, null, {
    params: { url }
  });

  if (!res.data?.data?.play) {
    throw new Error("Gagal ambil video TikTok");
  }

  return {
    video: "https://tikwm.com" + res.data.data.play,
    author: res.data.data.author.nickname,
    title: res.data.data.title
  };
}

export async function downloadInstagram(url) {
  const api = "https://igram.world/api/ig";

  const res = await axios.post(api, { url });

  const video = res.data?.data?.[0]?.url;
  if (!video) throw new Error("IG gagal");

  return video;
}

// ===== DOWNLOAD YOUTUBE AUDIO VIA yt-dlp =====
export async function downloadYouTubeAudio(url) {
  return new Promise((resolve, reject) => {
    const tmpDir = path.resolve("./tmp");
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir);

    const output = path.join(tmpDir, "%(id)s.%(ext)s");

    const args = [
      "--cookies", "cookies.txt",
      "--user-agent",
      "Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36",
      "--extractor-args", "youtube:player_client=android",
      "-f", "bestaudio[ext=m4a]/bestaudio",
      "--no-playlist",
      "--extract-audio",
      "--audio-format", "mp3",
      "--audio-quality", "0",
      "--newline",
      "-o", output,
      url
    ];

    console.log("🎬 YT-DLP START");
    console.log("▶️ yt-dlp", args.join(" "));

    const proc = spawn("yt-dlp", args, {
      stdio: ["pipe", "pipe", "pipe"]
    });

    // 🔥 INI YANG HILANG SEBELUMNYA
    proc.stdin.end();

    proc.stdout.on("data", d => {
      console.log("▶️", d.toString().trim());
    });

    proc.stderr.on("data", d => {
      console.error("❗", d.toString().trim());
    });

    proc.on("close", code => {
      console.log("⏹️ yt-dlp exit:", code);

      if (code !== 0) {
        return reject("yt-dlp gagal");
      }

      const files = fs.readdirSync(tmpDir)
        .filter(f => f.endsWith(".mp3"));

      if (!files.length) {
        return reject("File audio tidak ditemukan");
      }

      const latest = files
        .map(f => ({
          f,
          t: fs.statSync(path.join(tmpDir, f)).mtime.getTime()
        }))
        .sort((a, b) => b.t - a.t)[0];

      resolve(path.join(tmpDir, latest.f));
    });
  });
}

export async function ytSearch(query) {
  const apiKey = process.env.GOOGLE_API_KEY;
  const cseId = process.env.GOOGLE_CSE_ID;

  if (!apiKey || !cseId) {
    throw new Error("Google CSE belum dikonfigurasi");
  }

  const res = await axios.get(
    "https://www.googleapis.com/customsearch/v1",
    {
      params: {
        key: apiKey,
        cx: cseId,
        q: query + " site:youtube.com",
        num: 5
      },
      timeout: 15000
    }
  );

  const items = res?.data?.items;
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("Hasil pencarian kosong");
  }

  return items.map(item => ({
    title: item.title,
    url: item.link
  }));
}

function getWeatherIcon(text = "") {
  const t = text.toLowerCase();

  if (t.includes("thunder")) return "⛈️";
  if (t.includes("rain") || t.includes("drizzle")) return "🌧️";
  if (t.includes("snow")) return "❄️";
  if (t.includes("mist") || t.includes("fog")) return "🌫️";
  if (t.includes("cloud")) return "☁️";
  if (t.includes("clear")) return "☀️";

  return "🌤️";
}

function getIndonesiaTimezoneLabel(tz) {
  if (tz === "Asia/Jakarta") return "WIB";
  if (tz === "Asia/Makassar") return "WITA";
  if (tz === "Asia/Jayapura") return "WIT";
  return tz;
}

export async function getWeatherWeatherAPI(query) {
  const apiKey = process.env.WEATHERAPI_KEY;
  if (!apiKey) throw new Error("API key cuaca belum diset");

  const url = `https://api.weatherapi.com/v1/forecast.json?key=${apiKey}&q=${encodeURIComponent(
    query
  )}&days=1&lang=id`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error("Lokasi tidak ditemukan");
  }

  const data = await res.json();

  // ⏱️ Ambil waktu lokal lokasi (BUKAN UTC)
  const localTime = data.location.localtime; // "2026-01-23 20:37"
  const currentHour = Number(localTime.split(" ")[1].slice(0, 2));

  const timezone = getIndonesiaTimezoneLabel(data.location.tz_id);

  const hourly = data.forecast.forecastday[0].hour
    .filter(h => Number(h.time.split(" ")[1].slice(0, 2)) >= currentHour)
    .slice(0, 6)
    .map(h => ({
      time: h.time.split(" ")[1],
      temp: h.temp_c,
      condition: h.condition.text,
      icon: getWeatherIcon(h.condition.text),
      rainChance: h.chance_of_rain
    }));

  return {
    location: `${data.location.name}, ${data.location.region}, ${data.location.country}`,
    lat: data.location.lat,
    lon: data.location.lon,
    timezone,
    temp: data.current.temp_c,
    feels: data.current.feelslike_c,
    condition: `${getWeatherIcon(data.current.condition.text)} ${data.current.condition.text}`,
    humidity: data.current.humidity,
    wind: data.current.wind_kph,
    rain: data.current.precip_mm,
    hourly
  };
}

export async function getHourlyWeather(lat, lon, hours = 6) {
  const apiKey = process.env.WEATHERAPI_KEY;

  const url = `https://api.weatherapi.com/v1/forecast.json?key=${apiKey}&q=${lat},${lon}&lang=id`;

  const res = await fetch(url);
  if (!res.ok) throw new Error("Gagal ambil forecast");

  const data = await res.json();

  const localTime = data.location.localtime; // "2026-01-23 20:37"
  const currentHour = Number(localTime.split(" ")[1].slice(0, 2));

  const timezoneLabel = getIndonesiaTimezoneLabel(data.location.tz_id);

  const hourly = data.forecast.forecastday[0].hour
    .filter(h => Number(h.time.split(" ")[1].slice(0, 2)) >= currentHour)
    .slice(0, hours)
    .map(h => ({
      time: h.time.split(" ")[1],
      temp: h.temp_c,
      condition: h.condition.text,
      icon: getWeatherIcon(h.condition.text),
      rainChance: h.chance_of_rain
    }));

  return {
    timezone: timezoneLabel,
    hourly
  };
}


