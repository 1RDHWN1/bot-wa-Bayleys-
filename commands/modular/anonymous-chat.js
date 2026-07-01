export const anonState = {
  queue: [],
  pairs: new Map()
};

export function createAnonymousCommands(deps) {
  const { logCommandResult, reply, logInfo } = deps;

  const logOk = (ctx, reason = "OK") => logCommandResult({ ...ctx, status: "OK", reason, durationMs: 0 });

  function stopChat(sender, sock) {
    if (anonState.queue.includes(sender)) {
      anonState.queue = anonState.queue.filter(id => id !== sender);
      return { status: "unqueued", partner: null };
    }
    
    if (anonState.pairs.has(sender)) {
      const partner = anonState.pairs.get(sender);
      anonState.pairs.delete(sender);
      anonState.pairs.delete(partner);
      return { status: "stopped", partner };
    }
    
    return { status: "none", partner: null };
  }

  return [
    {
      names: ["search", "start"],
      category: "Anonymous",
      description: "Mencari pasangan chat anonim (Live Chat)",
      usage: "!search",
      execute: async ctx => {
        const { sock, msg, sender, reply } = ctx;

        // Cek apakah sudah chatting
        if (anonState.pairs.has(sender)) {
          await reply(sock, msg, "❌ Kamu sedang dalam obrolan! Ketik `!stop` terlebih dahulu untuk mengakhiri.");
          return logOk(ctx, "already in chat");
        }

        // Cek apakah sudah di antrian
        if (anonState.queue.includes(sender)) {
          await reply(sock, msg, "⏳ Kamu masih dalam antrean mencari pasangan. Mohon tunggu...\n_(Ketik `!stop` untuk batal)_");
          return logOk(ctx, "already in queue");
        }

        // Jika antrian kosong, masuk ke antrian
        if (anonState.queue.length === 0) {
          anonState.queue.push(sender);
          await reply(sock, msg, "🔍 *Mencari pasangan...*\n\nMohon tunggu sampai ada yang membalas.\n_(Ketik `!stop` untuk batal mencari)_");
          logInfo(`ANON-CHAT | user=${sender.split("@")[0]} join queue`);
          return logOk(ctx, "queued");
        }

        // Jika ada orang di antrian, pasangkan
        const partner = anonState.queue.shift(); // Ambil dari antrian terdepan
        
        // Mencegah dipasangkan dengan diri sendiri (walau seharusnya tertangkap blok di atas)
        if (partner === sender) {
          anonState.queue.push(sender);
          return logOk(ctx, "queued (self-match prevention)");
        }

        anonState.pairs.set(sender, partner);
        anonState.pairs.set(partner, sender);

        logInfo(`ANON-CHAT | matched ${sender.split("@")[0]} with ${partner.split("@")[0]}`);

        // Notifikasi ke pemanggil (!search)
        await reply(sock, msg, "✅ *Pasangan ditemukan!*\n\nSilakan mulai mengirim pesan (teks/gambar/stiker). Pesanmu akan diteruskan secara anonim.\n_(Ketik `!stop` untuk mengakhiri)_");
        
        // Notifikasi ke partner (menggunakan sendMessage karena tidak ada msg context partner)
        await sock.sendMessage(partner, { text: "✅ *Pasangan ditemukan!*\n\nSilakan mulai mengirim pesan (teks/gambar/stiker). Pesanmu akan diteruskan secara anonim.\n_(Ketik `!stop` untuk mengakhiri)_" });

        return logOk(ctx, "matched");
      }
    },
    {
      names: ["stop", "end", "leave"],
      category: "Anonymous",
      description: "Mengakhiri obrolan anonim atau batal mencari",
      usage: "!stop",
      execute: async ctx => {
        const { sock, msg, sender, reply } = ctx;

        const result = stopChat(sender, sock);

        if (result.status === "unqueued") {
          await reply(sock, msg, "✅ Pencarian pasangan dibatalkan.");
          logInfo(`ANON-CHAT | user=${sender.split("@")[0]} left queue`);
        } else if (result.status === "stopped") {
          await reply(sock, msg, "🛑 *Obrolan dihentikan.*\nTerima kasih telah menggunakan Live Chat.");
          // Beri tahu partner bahwa obrolan dihentikan oleh pasangan
          await sock.sendMessage(result.partner, { text: "🛑 *Pasanganmu telah menghentikan obrolan (meninggalkan chat).*\nKetik `!search` untuk mencari pasangan baru." });
          logInfo(`ANON-CHAT | ended between ${sender.split("@")[0]} and ${result.partner.split("@")[0]}`);
        } else {
          await reply(sock, msg, "❌ Kamu sedang tidak mencari atau dalam obrolan anonim.");
        }

        return logOk(ctx, "stopped");
      }
    },
    {
      names: ["next", "skip"],
      category: "Anonymous",
      description: "Berhenti obrolan saat ini dan langsung cari yang baru",
      usage: "!next",
      execute: async ctx => {
        const { sock, msg, sender, reply, command, args, isOwner } = ctx;

        const result = stopChat(sender, sock);
        
        if (result.status === "stopped") {
          await reply(sock, msg, "🛑 *Obrolan dihentikan.*");
          // Beri tahu partner bahwa pasangan men-skip obrolan
          await sock.sendMessage(result.partner, { text: "🛑 *Pasanganmu telah men-skip/melewati obrolan ini.*\nKetik `!search` untuk mencari pasangan baru." });
        }

        // Otomatis trigger search
        // Kita panggil manual logika search agar cepat
        if (anonState.queue.length === 0) {
          anonState.queue.push(sender);
          await reply(sock, msg, "🔍 *Mencari pasangan baru...*\n\n_(Ketik `!stop` untuk batal mencari)_");
          logInfo(`ANON-CHAT | user=${sender.split("@")[0]} join queue via next`);
        } else {
          const partner = anonState.queue.shift();
          
          if (partner === sender) {
            anonState.queue.push(sender);
            return logOk(ctx, "queued (self-match prevention)");
          }

          anonState.pairs.set(sender, partner);
          anonState.pairs.set(partner, sender);
          
          logInfo(`ANON-CHAT | matched ${sender.split("@")[0]} with ${partner.split("@")[0]} via next`);

          await reply(sock, msg, "✅ *Pasangan baru ditemukan!*\n\nSilakan mulai mengirim pesan.\n_(Ketik `!stop` untuk mengakhiri)_");
          await sock.sendMessage(partner, { text: "✅ *Pasangan ditemukan!*\n\nSilakan mulai mengirim pesan.\n_(Ketik `!stop` untuk mengakhiri)_" });
        }

        return logOk(ctx, "next executed");
      }
    }
  ];
}
