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
      execute: async ctx => executeLegacy(ctx)
    },
    {
      names: ["toimg", "toimage"],
      category: "Media",
      description: "Konversi stiker jadi gambar",
      usage: "!toimg (reply stiker)",
      execute: async ctx => executeLegacy(ctx)
    },
    {
      names: ["readviewonce", "readviewone", "rvo"],
      category: "Media",
      description: "Baca ulang pesan view once (reply pesan view once)",
      usage: "!rvo (reply view once)",
      execute: async ctx => executeLegacy(ctx)
    },
    {
      names: ["ytsearch"],
      category: "Downloader",
      description: "Cari video YouTube (hasil 1-5, balas angka untuk download audio)",
      usage: "!ytsearch <query>",
      execute: async ctx => executeLegacy(ctx)
    },
    {
      names: ["musik", "ymusic"],
      category: "Downloader",
      description: "Cari musik YouTube (durasi, channel, balas angka untuk download)",
      usage: "!musik <query> | !ymusic <query>",
      execute: async ctx => executeLegacy(ctx)
    },
    {
      names: ["yta"],
      category: "Downloader",
      description: "Download audio YouTube langsung dari link",
      usage: "!yta <youtube_url>",
      execute: async ctx => executeLegacy(ctx)
    },
    {
      names: ["yt"],
      category: "Downloader",
      description: "Download YouTube pilih format (1=MP3, 2=MP4)",
      usage: "!yt <youtube_url> -> balas 1 atau 2",
      execute: async ctx => executeLegacy(ctx)
    },
    {
      names: ["tt"],
      category: "Downloader",
      description: "Download video TikTok",
      usage: "!tt <tiktok_url>",
      execute: async ctx => executeLegacy(ctx)
    },
    {
      names: ["ig"],
      category: "Downloader",
      description: "Download video/reel Instagram",
      usage: "!ig <instagram_url>",
      execute: async ctx => executeLegacy(ctx)
    },
    {
      names: ["cuaca"],
      category: "Utility",
      description: "Cek cuaca (BMKG + Tomorrow.io)",
      usage: "!cuaca <lokasi> | !cuaca besok <lokasi>",
      execute: async ctx => executeLegacy(ctx)
    },
    {
      names: ["gambar", "image"],
      category: "Media",
      description: "Cari gambar via Google",
      usage: "!gambar <query> [--safe/--unsafe]",
      execute: async ctx => executeLegacy(ctx)
    },
    {
      names: ["quote", "q"],
      category: "Media",
      description: "Buat gambar quote dari teks/reply",
      usage: "!quote <teks> | !q <teks> (reply chat)",
      execute: async ctx => executeLegacy(ctx)
    }
  ];
}
