import os from "os";
import { makeOkLogger } from "./logger.js";

/* ===============================
   DYNAMIC HELP BUILDER
================================ */

function safeString(val) {
  if (val == null) return "";
  if (typeof val === "string") return val;
  if (Array.isArray(val)) return val.map(safeString).join(", ");
  return String(val);
}

function safeJoin(arr, sep = " | ") {
  if (!arr) return "";
  if (Array.isArray(arr)) return arr.map(safeString).filter(Boolean).join(sep);
  return safeString(arr);
}

function formatCommandHelp(cmd) {
  const names = safeJoin(cmd.names);
  const desc = safeString(cmd.description) || "Tidak ada deskripsi";
  const usage = cmd.usage ? `\n   └ Contoh: ${safeString(cmd.usage)}` : "";
  let text = `• ${names}${usage}\n   └ ${desc}`;
  
  // Add sub-commands if available
  if (cmd.subCommands && Array.isArray(cmd.subCommands) && cmd.subCommands.length > 0) {
    for (const sub of cmd.subCommands) {
      const subNames = safeJoin(sub.names);
      const subDesc = safeString(sub.description) || "";
      const subUsage = sub.usage ? ` ${safeString(sub.usage)}` : "";
      text += `\n  • ${subNames}${subUsage}\n     └ ${subDesc}`;
    }
  }
  return text;
}

function buildMenuText(msg, categoryMap, allCategories, prefix, botName, ownerName, ownerNumber) {
  const senderName =
    msg.pushName ||
    safeString(msg.key?.participant)?.split("@")[0] ||
    "Unknown";

  let text = `🤖 *${safeString(botName)} — HELP MENU*\n*Halo ${senderName}*\n\nGunakan \`${prefix}help <kategori>\` untuk lihat detail kategori.\nContoh: \`${prefix}help ai\`, \`${prefix}help downloader\`\n\n`;

  // Ensure allCategories are strings
  const safeCategories = Array.isArray(allCategories) ? allCategories.map(safeString) : [];
  
  for (const cat of safeCategories) {
    const cmds = categoryMap.get(cat) || [];
    if (cmds.length === 0) continue;
    const emoji = {
      "System": "⚙️", "AI": "🧠", "Knowledge": "📚",
      "Media": "🖼️", "Downloader": "🎧", "Group": "👥",
      "Game": "🎰", "Schedule": "🗓️", "Admin": "🛡️",
      "Utility": "🔧", "Owner": "👑", "Lainnya": "📦"
    }[cat] || "📦";
    text += `${emoji} *${safeString(cat)}* (${cmds.length} command)\n`;
  }

  text += `\n━━━━━━━━━━━━━━━━━━\n👑 *Owner*\n• Nama: ${safeString(ownerName)}\n• Kontak: wa.me/${safeString(ownerNumber)}\n\n━━━━━━━━━━━━━━━━━━\nℹ️ *Catatan*\n• Beberapa fitur hanya bisa di grup\n• Bot tidak selalu online 24/7\n\n✅ *Status Bot:* Aktif`;

  return text.trim();
}

function buildCategoryDetailText(category, commands, prefix) {
  const emojiMap = {
    "System": "⚙️", "AI": "🧠", "Knowledge": "📚",
    "Media": "🖼️", "Downloader": "🎧", "Group": "👥",
    "Game": "🎰", "Schedule": "🗓️", "Admin": "🛡️",
    "Utility": "🔧", "Owner": "👑", "Lainnya": "📦"
  };
  const emoji = emojiMap[safeString(category)] || "📦";
  
  let text = `${emoji} *${safeString(category)} COMMANDS*\n━━━━━━━━━━━━━━━━━━\n`;
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
  const ownerNumber = safeString(process.env.OWNER_NUMBER).replace(/\D/g, "");

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
        
        // Ensure allCategories are strings
        const safeCategories = Array.isArray(allCategories) ? allCategories.map(safeString) : [];
        
        const args = ctx.args || [];
        if (args.length > 0) {
          const requestedCat = safeString(args[0]).toLowerCase();
          const matchedCat = safeCategories.find(c => safeString(c).toLowerCase() === requestedCat);
          if (matchedCat) {
            const cmds = categoryMap.get(matchedCat) || [];
            const text = buildCategoryDetailText(matchedCat, cmds, prefix);
            logOk(ctx, `help category=${matchedCat}`);
            return reply(sock, msg, text);
          }
          return reply(sock, msg, `❌ Kategori "${safeString(args[0])}" tidak ditemukan.\nKategori tersedia: ${safeCategories.join(", ")}`);
        }

        const text = buildMenuText(msg, categoryMap, safeCategories, prefix, botName, ownerName, ownerNumber);
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
          ? `🎬 Sedang diproses: ${safeString(q.active?.name)} (${q.active?.runningSec ?? 0} detik)`
          : "🎬 Sedang diproses: -";
        const textQueue = `
🧾 *STATUS ANTRIAN DOWNLOADER*
━━━━━━━━━━━━━━━━━━
${activeLine}
📥 Menunggu: ${q.waiting ?? 0}
🧮 Total antrean: ${q.total ?? 0}
`.trim();

        logOk(ctx, `antrian total=${q.total ?? 0}`);
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
                return `${i + 1}. ${safeString(name)} (${s.total}x | ok ${s.ok} | fail ${s.fail} | avg ${avg}ms)`;
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