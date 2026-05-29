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

function normalizeText(text = "") {
  return String(text || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s:/.-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function matchIntent(text = "") {
  const normalized = normalizeText(text);
  if (!normalized) return null;

  const matched = FEATURE_INTENTS
    .map(intent => {
      const score = intent.patterns.reduce((acc, pattern) => {
        const p = normalizeText(pattern);
        if (!p) return acc;
        if (normalized.includes(p)) return acc + Math.max(2, p.split(/\s+/).length);
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
