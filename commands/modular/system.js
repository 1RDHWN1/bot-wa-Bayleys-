import os from "os";
import { makeOkLogger } from "./logger.js";

/* ===============================
   DYNAMIC HELP BUILDER
================================ */

function formatCommandHelp(cmd) {
  const names = cmd.names.join(" | ");
  const desc = cmd.description || "Tidak ada deskripsi";
  const usage = cmd.usage ? `\n   └ Contoh: ${cmd.usage}` : "";
  let text = `• ${names}${usage}\n   └ ${desc}`;
  
  // Add sub-commands if available
  if (cmd.subCommands && Array.isArray(cmd.subCommands) && cmd.subCommands.length > 0) {
    for (const sub of cmd.subCommands) {
      const subNames = Array.isArray(sub.names) ? sub.names.join(" | ") : sub.names;
      const subDesc = sub.description || "";
      const subUsage = sub.usage ? ` ${sub.usage}` : "";
      text += `\n  • ${subNames}${subUsage}\n     └ ${subDesc}`;
    }
  }
  return text;
}

function buildMenuText(msg, categoryMap, allCategories, prefix, botName, ownerName, ownerNumber) {
  const senderName =
    msg.pushName ||
    msg.key.participant?.split("@")[0] ||
    "Unknown";

  let text = `🤖 *${botName} — HELP MENU*\n*Halo ${senderName}*

Gunakan \`${prefix}help <kategori>\` untuk lihat detail kategori.
Contoh: \`${prefix}help ai\`, \`${prefix}help downloader\`

`;

  for (const cat of allCategories) {
    const cmds = categoryMap.get(cat) || [];
    if (cmds.length === 0) continue;
    const emoji = {
      "System": "⚙️", "AI": "🧠", "Knowledge": "📚",
      "Media": "🖼️", "Downloader": "🎧", "Group": "👥",
      "Game": "🎰", "Schedule": "🗓️", "Admin": "🛡️",
      "Utility": "🔧", "Owner": "👑", "Lainnya": "📦"
    }[cat] || "📦";
    text += `${emoji} *${cat}* (${cmds.length} command)\n`;
  }

  text += `\n━━━━━━━━━━━━━━━━━━
👑 *Owner*
• Nama: ${ownerName}
• Kontak: wa.me/${ownerNumber}

━━━━━━━━━━━━━━━━━━
ℹ️ *Catatan*
• Beberapa fitur hanya bisa di grup
• Bot tidak selalu online 24/7

✅ *Status Bot:* Aktif`;

  return text.trim();
}

function buildCategoryDetailText(category, commands, prefix) {
  const emojiMap = {
    "System": "⚙️", "AI": "🧠", "Knowledge": "📚",
    "Media": "🖼️", "Downloader": "🎧", "Group": "👥",
    "Game": "🎰", "Schedule": "🗓️", "Admin": "🛡️",
    "Utility": "🔧", "Owner": "👑", "Lainnya": "📦"
  };
  const emoji = emojiMap[category] || "📦";
  
  let text = `${emoji} *${category} COMMANDS*\n━━━━━━━━━━━━━━━━━━\n`;
  for (const cmd of commands) {
    text += formatCommandHelp(cmd) + "\n";
  }
  text += `\n━━━━━━━━━━━━━━━━━━\nKetik \`${prefix}help\` untuk kembali ke menu utama.`;
  return text.trim();
}

export function createSystemCommands(deps) {
  const {
    formatUptime,
    formatBytes,
    pingUrl,
    getDownloaderQueueSnapshot,
    getDownloaderQueueSize,
    runtimeStats,
    logCommandResult,
    getCategoryMap,
    getAllCategories
  } = deps;
  const logOk = makeOkLogger(logCommandResult);

  const prefix = process.env.BOT_PREFIX || "!";
  const botName = process.env.BOT_NAME || "BOT WA";
  const ownerName = process.env.OWNER_NAME || "Owner";
  const ownerNumber = (process.env.OWNER_NUMBER || "").replace(/\D/g, "");

  return [
    {
      names: ["help", "menu"],
      category: "System",
      description: "Tampilkan menu bantuan (overview semua kategori)",
      usage: "!help [kategori]",
      execute: async ctx => {
        const { msg, reply, sock } = ctx;
        const categoryMap = getCategoryMap();
        const allCategories = getAllCategories();
        
        const args = ctx.args || [];
        if (args.length > 0) {
          const requestedCat = args[0].toLowerCase();
          const matchedCat = allCategories.find(c => c.toLowerCase() === requestedCat);
          if (matchedCat) {
            const cmds = categoryMap.get(matchedCat) || [];
            const text = buildCategoryDetailText(matchedCat, cmds, prefix);
            logOk(ctx, `help category=${matchedCat}`);
            return reply(sock, msg, text);
          }
          return reply(sock, msg, `❌ Kategori "${args[0]}" tidak ditemukan.\nKategori tersedia: ${allCategories.join(", ")}`);
        }

        const text = buildMenuText(msg, categoryMap, allCategories, prefix, botName, ownerName, ownerNumber);
        logOk(ctx, "menu overview terkirim");
        return reply(sock, msg, text);
      }
    },
    {
      names: ["ping", "status"],
      category: "System",
      description: "Cek status bot, ping, uptime, RAM, internet",
      usage: "!ping",
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
━━━━━━━━━━━━━━`.trim();

        logOk(ctx, `status ping=${ping}ms net=${netLatency ? `${netLatency}ms` : "off"}`);
        return ctx.reply(ctx.sock, ctx.msg, textStatus);
      }
    },
    {
      names: ["antrian", "queue"],
      category: "System",
      description: "Lihat status antrean downloader",
      usage: "!antrian",
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
      category: "System",
      description: "Statistik runtime bot (total eksekusi, top command, dll)",
      usage: "!stats",
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
