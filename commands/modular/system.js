import os from "os";
import { makeOkLogger } from "./logger.js";

function buildMenuText(msg) {
  const botName = process.env.BOT_NAME || "BOT WA";
  const ownerName = process.env.OWNER_NAME || "Owner";
  const ownerNumber = process.env.OWNER_NUMBER || "-";
  const senderName =
    msg.pushName ||
    msg.key.participant?.split("@")[0] ||
    "Unknown";

  return `
🤖 *${botName} — HELP MENU*
*Halo ${senderName}*
Ini adalah bot experimental yang dibuat dengan library Baileys. Bot ini merupakan project gabut individu dari *${ownerName}*. Sehingga mohon dimaklumi
apabila ada fitur yang kurang stabil atau tidak berjalan sempurna.

━━━━━━━━━━━━━━━━━━
📌 *Daftar Fitur Bot*

🖼️ *Stiker*
• !stiker
  └ Reply gambar / video untuk jadi stiker

🧠 *AI Chat*
• !ai <pertanyaan>
  └ Tanya AI (memory + data chat + data global)
• !ai reset
  └ Hapus memory percakapan AI

📚 *AI Data / Knowledge*
• !ai simpan <kunci>=<nilai>
• !ai simpen data <kunci> adalah <nilai>
• !ai catat bahwa <kunci> adalah <nilai>
  └ Simpan data natural (owner/editor)
• !ai ganti data <kunci> jadi <nilai>
• !ai ubahin data <kunci> jadi <nilai>
  └ Ganti/update data natural (owner/editor)
• !ai hapus <kunci>
• !ai apusin data <kunci>
  └ Hapus data tersimpan (owner/editor)
• !ai data list
  └ Lihat semua data tersimpan
• !ai data <kunci>
  └ Ambil data tertentu
• !ai data log
• !ai data log <kunci>
  └ Lihat riwayat perubahan data
• !ai data export
• !ai data export txt
  └ Export data scope saat ini jadi file
• !ai import data
  └ Import data dari file .txt/.json (preview dulu)
• !ai ya
• !ai batal
  └ Konfirmasi / batalkan import

🌐 *AI Scope / Grup* (Owner)
• !ai scope
  └ Lihat scope data chat ini
• !ai grup list
  └ Kirim file daftar scope semua grup
• !ai grup cari <nama>
  └ Cari scope grup berdasarkan nama
• !ai alias <nama> = group:<jid>
• !ai alias list
• !ai alias hapus <nama>
  └ Alias scope, contoh pakai: !ai untuk @musik data list
• !ai untuk group:<jid> data list
• !ai untuk group:<jid> simpen data <kunci> = <nilai>
• !ai untuk @alias gantiin data <kunci> jadi <nilai>
  └ Kelola data grup lain tanpa chat di grup itu
• !ai global simpen data <kunci> = <nilai>
• !ai global data list
  └ Data global yang bisa dipakai semua chat
• !ai data backup all
  └ Backup semua knowledge ke file JSON

👥 *AI Editor*
• !ai editor list
  └ Lihat daftar editor data
• !ai editor id
  └ Lihat ID kamu (untuk didaftarkan owner)
• !ai editor add <nomor>
  └ Tambah editor (owner only, bisa reply/mention user)
• !ai editor del <nomor>
  └ Hapus editor (owner only)
• !ai editor clear
  └ Hapus semua editor tambahan (owner only)

🎙️ *Text to Speech*
• !suara <teks>
  └ Ubah teks jadi voice note

  🖼️ *Gambar*
• !gambar <kata kunci>
  └ Cari gambar via Google
• !quote <teks>
• !q <teks>
  └ Buat gambar quote dari teks / reply chat

  🔄 *Konversi Media*
• !toimg
  └ Ubah stiker menjadi gambar
• !rvo
  └ Reply pesan view once untuk baca ulang media

  🌦️ *Cuaca* (Beta)
• !cuaca <lokasi>(spasi)<provinsi>(spasi)<negara>
• !cuaca besok <lokasi>
  └ Cek cuaca di lokasi tertentu

🗓️ *Jadwal*
• !jadwal list
• !jadwal HH:MM <pesan>
• !jadwal tambah HH:MM <pesan>
• !jadwal hapus <id>
• !jadwal clear
• !jadwal on <id>
• !jadwal off <id>

🎰 *Anime Lucky Spin* (Hybrid)
• !spin
  └ Spin karakter anime 1x per hari (WIB) + gambar karakter
• !spin stats
  └ Lihat poin, streak, dan status spin
• !spin top
  └ Leaderboard global poin spin
• !koleksi
  └ Lihat koleksi karakter kamu
• !spin sync status
  └ Cek status sinkronisasi hybrid (owner)
• !spin sync top|full
  └ Jalankan batch sinkronisasi bertahap (owner)
• !spin sync step <jumlah_page>
  └ Sinkronisasi manual sejumlah page (owner)
• !spin reset all
  └ Reset jatah spin semua user untuk hari ini (owner)
• !spin reset <nomor> / reply user + !spin reset
  └ Reset jatah spin user tertentu (owner)


🎧 YouTube
• !yt <watch url>
• !musik <query>
• !yta <watch url>
• !ytsearch <query>

⚠️ *Fitur Downloader sedang dalam penhgembangan, mohon bersabar yaa.*

🎵 TikTok
• !tt <url>

📸 Instagram
• !ig <url>

📣 *Tag Grup*
• !tagall <pesan>
  └ Tag semua anggota grup
• !tagadmin <pesan>
  └ Tag admin grup

🧹 *Moderasi*
• !hapus
  └ Reply pesan bot untuk hapus pesan tersebut
• !maintenance status
• !maintenance on [alasan]
• !maintenance off

📊 *Status Bot*
• !ping
• !status
• !stats
• !antrian
  └ Cek status bot & server

━━━━━━━━━━━━━━━━━━
👑 *Owner*
• Nama: ${ownerName}
• Kontak: wa.me/${ownerNumber}

━━━━━━━━━━━━━━━━━━
ℹ️ *Catatan*
• Gunakan bot dengan bijak
• Beberapa fitur hanya bisa di grup
• Bot tidak selalu online 24/7 (jika dinyalakan saja, karena masih pakai PC pribadi sebagai server.)

✅ *Status Bot:* Aktif
`.trim();
}

export function createSystemCommands(deps) {
  const {
    formatUptime,
    formatBytes,
    pingUrl,
    getDownloaderQueueSnapshot,
    getDownloaderQueueSize,
    runtimeStats,
    logCommandResult
  } = deps;
  const logOk = makeOkLogger(logCommandResult);

  return [
    {
      names: ["help", "menu"],
      execute: async ctx => {
        const menuText = buildMenuText(ctx.msg);
        logOk(ctx, "menu terkirim");
        return ctx.reply(ctx.sock, ctx.msg, menuText);
      }
    },
    {
      names: ["ping", "status"],
      execute: async ctx => {
        const start = Date.now();
        await ctx.reply(ctx.sock, ctx.msg, "⏱️ Mengecek status...");
        const ping = Date.now() - start;

        const uptime = formatUptime(Date.now() - global.startTime);
        const totalRam = formatBytes(os.totalmem());
        const usedRam = formatBytes(os.totalmem() - os.freemem());
        const netLatency = await pingUrl("https://www.google.com");

        const textStatus = `
🤖 *BOT STATUS*
━━━━━━━━━━━━━━
📡 Ping: ${ping} ms
🌐 Internet: ${netLatency ? netLatency + " ms" : "❌"}
⏱️ Uptime: ${uptime}
💾 RAM: ${usedRam} / ${totalRam}
━━━━━━━━━━━━━━
`.trim();

        logOk(ctx, `status ping=${ping}ms net=${netLatency ? `${netLatency}ms` : "off"}`);
        return ctx.reply(ctx.sock, ctx.msg, textStatus);
      }
    },
    {
      names: ["antrian", "queue"],
      execute: async ctx => {
        const q = getDownloaderQueueSnapshot();
        const activeLine = q.active
          ? `🎬 Sedang diproses: ${q.active.name} (${q.active.runningSec} detik)`
          : "🎬 Sedang diproses: -";
        const textQueue = `
🧾 *STATUS ANTRIAN DOWNLOADER*
━━━━━━━━━━━━━━━━━━
${activeLine}
📥 Menunggu: ${q.waiting}
🧮 Total antrean: ${q.total}
`.trim();

        logOk(ctx, `antrian total=${q.total}`);
        return ctx.reply(ctx.sock, ctx.msg, textQueue);
      }
    },
    {
      names: ["stats"],
      execute: async ctx => {
        const totals = runtimeStats.totals.ok + runtimeStats.totals.fail;
        const dTotals = runtimeStats.downloader.ok + runtimeStats.downloader.fail;
        const dFailRate = dTotals
          ? ((runtimeStats.downloader.fail / dTotals) * 100).toFixed(1)
          : "0.0";
        const uptime = formatUptime(Date.now() - runtimeStats.startedAt);
        const topCommands = Array.from(runtimeStats.commands.entries())
          .sort((a, b) => b[1].total - a[1].total)
          .slice(0, 5);

        const topLines = topCommands.length
          ? topCommands
              .map(([name, s], i) => {
                const avg = s.total ? Math.round(s.totalDurationMs / s.total) : 0;
                return `${i + 1}. ${name} (${s.total}x | ok ${s.ok} | fail ${s.fail} | avg ${avg}ms)`;
              })
              .join("\n")
          : "-";

        const textStats = `
📊 *RUNTIME STATS*
━━━━━━━━━━━━━━━━━━
⏱️ Sejak runtime: ${uptime}
🧮 Total eksekusi: ${totals}
✅ Sukses: ${runtimeStats.totals.ok}
❌ Gagal: ${runtimeStats.totals.fail}

🎬 Downloader:
• total: ${dTotals}
• sukses: ${runtimeStats.downloader.ok}
• gagal: ${runtimeStats.downloader.fail}
• fail rate: ${dFailRate}%
• antrean aktif: ${getDownloaderQueueSize()}

🏆 Top Command:
${topLines}
`.trim();

        logOk(ctx, "stats terkirim");
        return ctx.reply(ctx.sock, ctx.msg, textStats);
      }
    }
  ];
}
