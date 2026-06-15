import { createLegacyMediaCommandExecutor } from "./legacy-media-runtime.js";
import { makeFailLogger, makeOkLogger } from "./logger.js";

export function createLegacyMediaCommands(deps) {
  const handleLegacyMediaCommand = createLegacyMediaCommandExecutor(deps);
  const logOk = makeOkLogger(deps.logCommandResult);
  const logFail = makeFailLogger(deps.logCommandResult);
  const executeLegacy = ctx =>
    handleLegacyMediaCommand({
      ...ctx,
      logOk: reason => logOk(ctx, reason),
      logFail: reason => logFail(ctx, reason)
    });

  return [
    {
      names: ["stiker", "sticker"],
      category: "Media",
      description: "Buat stiker dari gambar/video (reply media)",
      usage: "!stiker (reply gambar/video)",
      subCommands: [
        { names: "stiker", description: "Buat stiker dari gambar/video yang di-reply" },
        { names: "sticker", description: "Alias stiker" }
      ],
      execute: async ctx => executeLegacy(ctx)
    },
    {
      names: ["toimg", "toimage"],
      category: "Media",
      description: "Konversi stiker jadi gambar",
      usage: "!toimg (reply stiker)",
      subCommands: [
        { names: "toimg", description: "Konversi stiker jadi gambar" },
        { names: "toimage", description: "Alias toimg" }
      ],
      execute: async ctx => executeLegacy(ctx)
    },
    {
      names: ["readviewonce", "readviewone", "rvo"],
      category: "Media",
      description: "Baca ulang pesan view once (reply pesan view once)",
      usage: "!rvo (reply view once)",
      subCommands: [
        { names: "readviewonce", description: "Baca ulang pesan view once" },
        { names: "readviewone", description: "Alias readviewonce" },
        { names: "rvo", description: "Shortcut read view once" }
      ],
      execute: async ctx => executeLegacy(ctx)
    },
    {
      names: ["ytsearch"],
      category: "Downloader",
      description: "Cari video YouTube (hasil 1-5, balas angka untuk download audio)",
      usage: "!ytsearch <query>",
      subCommands: [
        { names: "ytsearch <query>", description: "Cari video YouTube, hasil 1-5 (balas angka untuk download audio)" }
      ],
      execute: async ctx => executeLegacy(ctx)
    },
    {
      names: ["musik", "ymusic"],
      category: "Downloader",
      description: "Cari musik YouTube (durasi, channel, balas angka untuk download)",
      usage: "!musik <query> | !ymusic <query>",
      subCommands: [
        { names: "musik <query>", description: "Cari musik YouTube dengan durasi & channel" },
        { names: "ymusic <query>", description: "Alias musik" }
      ],
      execute: async ctx => executeLegacy(ctx)
    },
    {
      names: ["yta"],
      category: "Downloader",
      description: "Download audio YouTube langsung dari link",
      usage: "!yta <youtube_url>",
      subCommands: [
        { names: "yta <youtube_url>", description: "Download audio YouTube (MP3) dari link langsung" }
      ],
      execute: async ctx => executeLegacy(ctx)
    },
    {
      names: ["yt"],
      category: "Downloader",
      description: "Download YouTube pilih format (1=MP3, 2=MP4)",
      usage: "!yt <youtube_url> -> balas 1 atau 2",
      subCommands: [
        { names: "yt <youtube_url>", description: "Download YouTube pilih format: balas 1 (MP3) atau 2 (MP4)" }
      ],
      execute: async ctx => executeLegacy(ctx)
    },
    {
      names: ["tt"],
      category: "Downloader",
      description: "Download video TikTok",
      usage: "!tt <tiktok_url>",
      subCommands: [
        { names: "tt <tiktok_url>", description: "Download video TikTok (tanpa watermark)" }
      ],
      execute: async ctx => executeLegacy(ctx)
    },
    {
      names: ["ig"],
      category: "Downloader",
      description: "Download video/reel Instagram",
      usage: "!ig <instagram_url>",
      subCommands: [
        { names: "ig <instagram_url>", description: "Download video/reel Instagram" }
      ],
      execute: async ctx => executeLegacy(ctx)
    },
    {
      names: ["cuaca"],
      category: "Utility",
      description: "Cek cuaca (BMKG + Tomorrow.io)",
      usage: "!cuaca <lokasi> | !cuaca besok <lokasi>",
      subCommands: [
        { names: "cuaca <lokasi>", description: "Cek cuaca sekarang di lokasi tertentu" },
        { names: "cuaca besok <lokasi>", description: "Cek prakiraan cuaca besok" }
      ],
      execute: async ctx => executeLegacy(ctx)
    },
    {
      names: ["gambar", "image"],
      category: "Media",
      description: "Cari gambar via Google",
      usage: "!gambar <query> [--safe/--unsafe]",
      subCommands: [
        { names: "gambar <query>", description: "Cari gambar via Google (safe mode default)" },
        { names: "gambar <query> --unsafe", description: "Cari gambar tanpa safe search" },
        { names: "image <query>", description: "Alias gambar (English)" }
      ],
      execute: async ctx => executeLegacy(ctx)
    },
    {
      names: ["quote", "q"],
      category: "Media",
      description: "Buat gambar quote dari teks/reply",
      usage: "!quote <teks> | !q <teks> (reply chat)",
      subCommands: [
        { names: "quote <teks>", description: "Buat gambar quote dari teks" },
        { names: "quote (reply)", description: "Buat quote dari pesan yang di-reply" },
        { names: "q <teks>", description: "Alias quote (singkat)" }
      ],
      execute: async ctx => executeLegacy(ctx)
    }
  ];
}
