export async function handleWeatherAndImageCommands(ctx, deps) {
  const { sock, msg, command, sender, jid, input, senderRateKey, reply, logOk, logFail } = ctx;
  const {
    parseImageFlags,
    parseOwnerIds,
    getSenderIds,
    searchImage,
    enqueueImageSearch,
    downloadImage,
    getWeatherTomorrow,
    formatDateIndo,
    getWeatherIcon,
    getWeatherBMKG,
    enforceRateLimit,
    getQuotedText,
    normalizeJid,
    createQuoteImageBuffer,
    getErrorMessage,
    logError
  } = deps;

if (command === "cuaca") {
  const cuacaInput = String(input || "").trim();
  const isBesok = /^(besok|esok)\b/i.test(cuacaInput);
  const lokasiQuery = isBesok
    ? cuacaInput.replace(/^(besok|esok)\s*/i, "").trim()
    : cuacaInput;

  if (!lokasiQuery) {
    logFail("lokasi kosong");
    return reply(sock, msg,
      `❗ *Cara pakai:*\n!cuaca <nama lokasi>\n!cuaca besok <nama lokasi>\n\n*Contoh:*\n• !cuaca Tawang\n• !cuaca besok Tasikmalaya\n• !cuaca Bandung\n\n_Bisa pakai nama kecamatan atau kota_`
    );
  }

 try {
    await reply(sock, msg, "🔍 Mencari data cuaca...");

    if (isBesok) {
      const wBesok = await getWeatherTomorrow(lokasiQuery);
      const cacheLabel = wBesok?._cache?.hit
        ? `cache (${wBesok._cache.ageSec} detik)`
        : "live";
      const tanggal = formatDateIndo(wBesok.date);
      const textBesok = `
🌤️ *PRAKIRAAN BESOK*
📍 ${wBesok.lokasi}
🗺️ ${wBesok.provinsi}
📅 ${tanggal}

${getWeatherIcon(wBesok.weather_desc)} ${wBesok.weather_desc}
🌡️ Suhu: *${wBesok.tMin}°C - ${wBesok.tMax}°C*
🌧️ Peluang hujan: ${wBesok.rainChance}%
💧 Kelembapan rata-rata: ${wBesok.humidityAvg}%
💨 Angin rata-rata: ${wBesok.windAvg} km/j

📡 Sumber: Tomorrow.io | ${cacheLabel}
`.trim();

      logOk(`lokasi-besok=${wBesok.lokasi}`);
      return reply(sock, msg, textBesok);
    }

    const w = await getWeatherBMKG(lokasiQuery);
    const s = w.cuacaSekarang;

    // ✅ Definisikan jamSekarang SEBELUM dipakai
    const jamSekarang = new Date(s.local_datetime).toLocaleTimeString("id-ID", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Asia/Jakarta"
    });

    const prakiraan = w.prakiraan.map(c => {
      const date = new Date(c.local_datetime);
      const jam = date.toLocaleTimeString("id-ID", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Asia/Jakarta"
      });

      return `• ${jam} | ${getWeatherIcon(c.weather_desc)} ${c.weather_desc} | 🌡️ ${c.t}°C | 🌧️ ${c.rainChance}%`;
    }).join("\n");

    const cacheLabel = w?._cache?.hit
      ? `cache (${w._cache.ageSec} detik)`
      : "live";

    const text = `
🌦️ *CUACA SEKARANG*
📍 ${w.lokasi}
🗺️ ${w.provinsi}
🕒 ${jamSekarang} WIB

${getWeatherIcon(s.weather_desc)} ${s.weather_desc}
🌡️ Suhu: *${s.t}°C* (RH ${s.hu}%)
💨 Angin: ${s.ws} km/j

⏱️ *Prakiraan Singkat*
${prakiraan}

📡 Sumber: Tomorrow.io | ${cacheLabel}
`.trim();

    logOk(`lokasi=${w.lokasi}`);
    return reply(sock, msg, text);

  } catch (err) {
    logError("CUACA ERROR", err);
    logFail(getErrorMessage(err));
    return reply(sock, msg,
      `❌ Lokasi *"${lokasiQuery}"* tidak ditemukan.\n\nCoba gunakan nama yang lebih umum.\n\n*Contoh:*\n• !cuaca Tawang\n• !cuaca besok Tasikmalaya\n• !cuaca Bandung`
    );
  }
}
    /* ===============================
       GAMBAR (CSE)
    ================================ */
    if (command === "gambar" || command === "image") {
      if (
        await enforceRateLimit({
          sock,
          msg,
          senderKey: senderRateKey,
          bucket: "image",
          limit: 8,
          windowMs: 60_000,
          commandLabel: command,
          sender,
          jid
        })
      ) {
        return;
      }

      if (!input) {
        logFail("kata kunci kosong");
        return reply(
          sock,
          msg,
          "❗ Contoh:\n!gambar kucing\n!gambar --unsafe anime"
        );
      }

      const { safeMode, query } = parseImageFlags(input);
      if (!query) {
        logFail("query kosong");
        return reply(sock, msg, "❗ Kata kunci kosong.");
      }

      if (!safeMode) {
        const ownerIds = parseOwnerIds(sock);
        const senderIds = await getSenderIds(sock, msg);
        const isOwner = msg.key.fromMe || senderIds.some(id => ownerIds.has(id));

        if (!isOwner) {
          logFail("akses unsafe ditolak");
          return reply(sock, msg, "🔒 Mode UNSAFE hanya untuk owner.");
        }
      }

      await reply(
        sock,
        msg,
        `🖼️ Mencari gambar (${safeMode ? "SAFE" : "UNSAFE"})...`
      );

      try {
        // Antrekan ke global image queue agar tidak membanjiri Google CSE
        const imageUrl = await enqueueImageSearch(() => searchImage(query, safeMode));
        const image = await downloadImage(imageUrl);

        // Guard null: downloadImage bisa return null jika URL gagal diunduh
        if (!image || !image.buffer) {
          logFail("buffer gambar null");
          return reply(sock, msg, "❌ Gambar tidak bisa diunduh. Coba kata kunci lain.");
        }

        logOk(`gambar mode=${safeMode ? "safe" : "unsafe"}`);
        return reply(sock, msg, {
          image: image.buffer,
          mimetype: image.mimetype,
          caption: `🖼️ ${query}\n🛡️ Mode: ${
            safeMode ? "SAFE" : "UNSAFE"
          }`
        });
      } catch (err) {
        logFail(getErrorMessage(err));
        return reply(sock, msg, "❌ Gagal menampilkan gambar. Coba lagi.");
      }
    }

    if (command === "quote" || command === "q") {
      if (
        await enforceRateLimit({
          sock,
          msg,
          senderKey: senderRateKey,
          bucket: "image",
          limit: 8,
          windowMs: 60_000,
          commandLabel: command,
          sender,
          jid
        })
      ) {
        return;
      }

      const ctxInfo = msg?.message?.extendedTextMessage?.contextInfo;
      const quoted = ctxInfo?.quotedMessage;
      const quotedText = getQuotedText(quoted);
      const textInput = String(input || "").trim();
      const finalText = textInput || quotedText;

      if (!finalText) {
        logFail("quote kosong");
        return reply(sock, msg, "❗ Kirim `!quote <teks>` atau reply pesan lalu kirim `!quote`.");
      }

      const author = msg.pushName || normalizeJid(sender) || "User";
      try {
        const image = await createQuoteImageBuffer(finalText, author);
        logOk("quote image terkirim");
        return reply(sock, msg, {
          image,
          caption: "📝 Quote berhasil dibuat."
        });
      } catch (err) {
        logFail(getErrorMessage(err));
        return reply(sock, msg, "❌ Gagal membuat quote.");
      }
    }



  return false;
}
