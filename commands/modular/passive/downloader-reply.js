export function createDownloaderReplyPassiveHandler(deps) {
  const {
    ytChoiceCache,
    ytSearchCache,
    YT_CHOICE_TTL_MS,
    YT_SEARCH_TTL_MS,
    normalizeJid,
    enforceRateLimit,
    enqueueDownloaderTask,
    downloadYouTubeAudio,
    downloadYouTubeVideo,
    normalizeYouTubeUrl,
    safeDeleteFile,
    getErrorMessage,
    logCommandResult,
    botState,
    getAccessContext
  } = deps;

  return async function handleDownloaderNumericReply(ctx) {
    const { sock, msg, text, sender, jid, reply } = ctx;
    const senderRateKey = normalizeJid(sender) || sender;

    if (!/^[1-5]$/.test(text)) return false;

    if (botState?.maintenance?.enabled) {
      const access = await getAccessContext({ sock, msg });
      if (!access?.isPrivileged) {
        await reply(sock, msg, "🛠️ Bot sedang maintenance. Proses downloader sementara ditahan.");
        return true;
      }
    }

    if (/^[1-2]$/.test(text)) {
      const ytChoice = ytChoiceCache.get(sender);
      if (!ytChoice) return false;

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
        return true;
      }

      const expired = Date.now() - ytChoice.createdAt > YT_CHOICE_TTL_MS;
      if (expired) {
        ytChoiceCache.delete(sender);
        await reply(sock, msg, "⌛ Pilihan !yt sudah kadaluarsa. Kirim ulang `!yt <link>`.");
        return true;
      }

      ytChoiceCache.delete(sender);

      if (text === "1") {
        await reply(sock, msg, "🎧 Mengambil audio (MP3)...");
        try {
          const queued = enqueueDownloaderTask("yt-choice-audio", () => downloadYouTubeAudio(ytChoice.url));
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
          return true;
        } catch (err) {
          logCommandResult({
            command: "yt-choice-audio",
            sender,
            jid,
            status: "FAIL",
            reason: getErrorMessage(err),
            durationMs: 0
          });
          await reply(
            sock,
            msg,
            typeof err === "string" ? `❌ ${err}` : "❌ Gagal mengambil audio."
          );
          return true;
        }
      }

      await reply(sock, msg, "🎬 Mengambil video (MP4)...");
      try {
        const queued = enqueueDownloaderTask("yt-choice-video", () => downloadYouTubeVideo(ytChoice.url));
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
        return true;
      } catch (err) {
        logCommandResult({
          command: "yt-choice-video",
          sender,
          jid,
          status: "FAIL",
          reason: getErrorMessage(err),
          durationMs: 0
        });
        await reply(
          sock,
          msg,
          typeof err === "string" ? `❌ ${err}` : "❌ Gagal mengambil video."
        );
        return true;
      }
    }

    const cacheState = ytSearchCache.get(sender);
    if (!cacheState) return false;
    const cacheItems = Array.isArray(cacheState) ? cacheState : cacheState.items;
    const cacheCreatedAt = Array.isArray(cacheState)
      ? Date.now()
      : Number(cacheState.createdAt || 0);

    if (!Array.isArray(cacheItems) || !cacheItems.length) return false;

    if (cacheCreatedAt && Date.now() - cacheCreatedAt > YT_SEARCH_TTL_MS) {
      ytSearchCache.delete(sender);
      await reply(sock, msg, "⌛ Hasil pencarian sudah kadaluarsa. Kirim ulang `!ytsearch` atau `!musik`.");
      return true;
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
      return true;
    }

    const selected = cacheItems[Number(text) - 1];
    if (!selected) return false;

    ytSearchCache.delete(sender);
    await reply(sock, msg, `🎧 Mengambil audio:\n${selected.title}`);

    try {
      const ytUrl = normalizeYouTubeUrl(selected.url) || selected.url;
      const queued = enqueueDownloaderTask("ytsearch-pick", () => downloadYouTubeAudio(ytUrl));
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
      return true;
    } catch (err) {
      logCommandResult({
        command: "ytsearch-pick",
        sender,
        jid,
        status: "FAIL",
        reason: getErrorMessage(err),
        durationMs: 0
      });
      await reply(
        sock,
        msg,
        typeof err === "string" ? `❌ ${err}` : "❌ Gagal mengambil audio."
      );
      return true;
    }
  };
}
