import { makeFailLogger, makeOkLogger } from "./logger.js";

export function createScheduleCommands(deps) {
  const {
    getReminders,
    setReminders,
    saveReminders,
    normalizeReminderTime,
    formatReminderListItem,
    normalizeJid,
    logCommandResult
  } = deps;
  const logOk = makeOkLogger(logCommandResult);
  const logFail = makeFailLogger(logCommandResult);

  return [
    {
      names: ["jadwal"],
      category: "Schedule",
      description: "Kelola jadwal/reminder per chat (harian WIB)",
      usage: "!jadwal list | !jadwal tambah HH:MM pesan | !jadwal hapus <id> | !jadwal clear | !jadwal on/off <id>",
      execute: async ctx => {
        const input = String(ctx.input || "").trim();
        const [firstToken, ...restTokens] = input.split(/\s+/).filter(Boolean);
        const sub = String(firstToken || "list").toLowerCase();
        const rest = restTokens.join(" ").trim();
        const reminders = getReminders();
        const inCurrentChat = reminders.filter(item => item.jid === ctx.jid);

        if (sub === "list" || sub === "ls") {
          if (!inCurrentChat.length) {
            logFail(ctx, "jadwal list kosong");
            return ctx.reply(ctx.sock, ctx.msg, "📭 Belum ada jadwal di chat ini.");
          }

          const lines = inCurrentChat
            .sort((a, b) => String(a.time).localeCompare(String(b.time)))
            .map(formatReminderListItem)
            .join("\n");
          logOk(ctx, `jadwal list total=${inCurrentChat.length}`);
          return ctx.reply(ctx.sock, ctx.msg, `🗓️ *JADWAL CHAT INI*\n${lines}`);
        }

        if (sub === "tambah" || sub === "add" || normalizeReminderTime(sub)) {
          const timeRaw = normalizeReminderTime(sub) ? sub : firstToken;
          const textRaw = normalizeReminderTime(sub) ? rest : input.replace(/^(tambah|add)\s+/i, "");
          const [timeToken, ...msgTokens] = textRaw.split(/\s+/).filter(Boolean);
          const time = normalizeReminderTime(normalizeReminderTime(sub) ? timeRaw : timeToken);
          const message = normalizeReminderTime(sub)
            ? rest
            : msgTokens.join(" ").trim();

          if (!time || !message) {
            logFail(ctx, "jadwal tambah format salah");
            return ctx.reply(
              ctx.sock,
              ctx.msg,
              "❗ Format:\n• !jadwal tambah HH:MM pesan\n• !jadwal HH:MM pesan\nContoh: !jadwal 08:00 Standup tim"
            );
          }

          const id = Math.random().toString(36).slice(2, 7);
          reminders.push({
            id,
            jid: ctx.jid,
            time,
            message,
            enabled: true,
            createdAt: Date.now(),
            createdBy: normalizeJid(ctx.sender),
            lastTriggeredDate: ""
          });
          setReminders(reminders);
          saveReminders();

          logOk(ctx, `jadwal tambah id=${id} jam=${time}`);
          return ctx.reply(
            ctx.sock,
            ctx.msg,
            `✅ Jadwal ditambahkan.\nID: ${id}\nJam: ${time} WIB\nPesan: ${message}`
          );
        }

        if (sub === "hapus" || sub === "del" || sub === "delete") {
          const id = rest.split(/\s+/)[0] || "";
          if (!id) {
            logFail(ctx, "jadwal hapus tanpa id");
            return ctx.reply(ctx.sock, ctx.msg, "❗ Contoh: !jadwal hapus <id>");
          }

          const before = reminders.length;
          const next = reminders.filter(item => !(item.jid === ctx.jid && String(item.id) === String(id)));
          if (next.length === before) {
            logFail(ctx, "jadwal hapus id tidak ditemukan");
            return ctx.reply(ctx.sock, ctx.msg, `❌ Jadwal dengan ID ${id} tidak ditemukan di chat ini.`);
          }

          setReminders(next);
          saveReminders();
          logOk(ctx, `jadwal hapus id=${id}`);
          return ctx.reply(ctx.sock, ctx.msg, `🗑️ Jadwal ${id} dihapus.`);
        }

        if (sub === "clear") {
          const before = reminders.length;
          const next = reminders.filter(item => item.jid !== ctx.jid);
          const removed = before - next.length;
          if (!removed) {
            logFail(ctx, "jadwal clear kosong");
            return ctx.reply(ctx.sock, ctx.msg, "📭 Tidak ada jadwal untuk dihapus di chat ini.");
          }

          setReminders(next);
          saveReminders();
          logOk(ctx, `jadwal clear total=${removed}`);
          return ctx.reply(ctx.sock, ctx.msg, `🗑️ ${removed} jadwal di chat ini berhasil dihapus.`);
        }

        if (sub === "on" || sub === "off") {
          const id = rest.split(/\s+/)[0] || "";
          if (!id) {
            logFail(ctx, "jadwal on/off tanpa id");
            return ctx.reply(ctx.sock, ctx.msg, `❗ Contoh: !jadwal ${sub} <id>`);
          }

          const next = reminders.map(item => {
            if (item.jid === ctx.jid && String(item.id) === String(id)) {
              return { ...item, enabled: sub === "on" };
            }
            return item;
          });

          const exists = next.some(item => item.jid === ctx.jid && String(item.id) === String(id));
          if (!exists) {
            logFail(ctx, "jadwal on/off id tidak ditemukan");
            return ctx.reply(ctx.sock, ctx.msg, `❌ Jadwal dengan ID ${id} tidak ditemukan di chat ini.`);
          }

          setReminders(next);
          saveReminders();
          logOk(ctx, `jadwal ${sub} id=${id}`);
          return ctx.reply(
            ctx.sock,
            ctx.msg,
            `✅ Jadwal ${id} ${sub === "on" ? "diaktifkan" : "dinonaktifkan"}.`
          );
        }

        logFail(ctx, "jadwal subcommand tidak valid");
        return ctx.reply(
          ctx.sock,
          ctx.msg,
          "❗ Format jadwal:\n• !jadwal list\n• !jadwal tambah HH:MM pesan\n• !jadwal HH:MM pesan\n• !jadwal hapus <id>\n• !jadwal clear\n• !jadwal on <id>\n• !jadwal off <id>"
        );
      }
    }
  ];
}
