export async function handleDownloaderCommands(ctx, deps) {
  const { sock, msg, command, sender, jid, input, senderRateKey, reply, logOk, logFail } = ctx;
  const {
    fs,
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
    getErrorMessage,
    normalizeJid
  } = deps;

    if (command === "ytsearch") {
      if (!input) {
        logFail("kata kunci kosong");
        return reply(sock, msg, "❗ Masukkan kata kunci");
      }

      try {
        const results = await ytSearch(input);
        const senderKey = normalizeJid(sender);
        ytSearchCache.set(senderKey, {
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
        const senderKey = normalizeJid(sender);
        ytSearchCache.set(senderKey, {
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



  return false;
}
