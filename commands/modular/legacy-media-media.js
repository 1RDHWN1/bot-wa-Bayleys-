export async function handleMediaCommands(ctx, deps) {
  const { sock, msg, command, reply, logFail } = ctx;
  const {
    getContentType,
    downloadMediaMessage,
    makeSticker,
    logError,
    logWarn,
    isValidImageBuffer,
    getContextInfo,
    stickerToImage,
    getErrorMessage,
    getQuotedText,
    createQuoteImageBuffer,
    normalizeJid,
    enforceRateLimit,
    logInfo
  } = deps;

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
      const quoted = getContextInfo(msg)?.quotedMessage;

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
       READ VIEW ONCE
    ================================ */
    if (command === "readviewonce" || command === "readviewone" || command === "rvo") {
      const quoted = getContextInfo(msg)?.quotedMessage;
      if (!quoted) {
        return reply(sock, msg, "❗ Reply pesan view once, lalu kirim `!rvo`.");
      }

      let viewOncePayload =
        quoted?.viewOnceMessage?.message ||
        quoted?.viewOnceMessageV2?.message ||
        quoted?.viewOnceMessageV2Extension?.message ||
        null;

      // Beberapa klien tidak pakai wrapper viewOnceMessage,
      // tapi langsung di image/video dengan flag viewOnce=true.
      if (!viewOncePayload) {
        const directType = getContentType(quoted);
        const directNode = directType ? quoted?.[directType] : null;
        if (directType && directNode?.viewOnce) {
          viewOncePayload = {
            [directType]: {
              ...directNode,
              viewOnce: false
            }
          };
        }
      }

      if (!viewOncePayload) {
        return reply(sock, msg, "❗ Yang direply harus pesan *view once*.");
      }

      const mediaType = getContentType(viewOncePayload);
      const mediaNode = mediaType ? viewOncePayload?.[mediaType] : null;
      if (!mediaType || !mediaNode) {
        return reply(sock, msg, "❌ Media view once tidak valid.");
      }

      try {
        const buffer = await downloadMediaMessage(
          { message: { [mediaType]: mediaNode } },
          "buffer",
          {}
        );

        if (mediaType === "imageMessage") {
          return reply(sock, msg, {
            image: buffer,
            caption: mediaNode?.caption || "🖼️ View once berhasil dibuka."
          });
        }

        if (mediaType === "videoMessage") {
          return reply(sock, msg, {
            video: buffer,
            caption: mediaNode?.caption || "🎬 View once berhasil dibuka."
          });
        }

        if (mediaType === "audioMessage") {
          return reply(sock, msg, {
            audio: buffer,
            mimetype: mediaNode?.mimetype || "audio/ogg; codecs=opus",
            ptt: false
          });
        }

        if (mediaType === "stickerMessage") {
          return reply(sock, msg, { sticker: buffer });
        }

        if (mediaType === "documentMessage") {
          return reply(sock, msg, {
            document: buffer,
            fileName: mediaNode?.fileName || "view-once.bin",
            mimetype: mediaNode?.mimetype || "application/octet-stream"
          });
        }

        return reply(sock, msg, `⚠️ Tipe media view once belum didukung: ${mediaType}`);
      } catch (err) {
        logFail(getErrorMessage(err));
        return reply(sock, msg, "❌ Gagal membaca view once.");
      }
    }

    /* ===============================
       YTSEARCH
    ================================ */

  return false;
}
