import { normalizeNumberFromJid } from "./abuse-guard.js";

function parseCommand(text, prefix) {
  const raw = text.slice(prefix.length).trim();
  if (!raw) return null;
  const parts = raw.split(/\s+/);
  const command = parts.shift()?.toLowerCase() || "";
  return { command, args: parts, input: parts.join(" ") };
}

function toStringSafe(val) {
  if (val == null) return "";
  if (typeof val === "string") return val;
  if (Array.isArray(val)) return val.map(toStringSafe).join(", ");
  return String(val);
}

export function createCommandRouter({ prefix, commands, passiveHandlers = [], guard, logger, ownerNumber }) {
  const map = new Map();
  const categoryMap = new Map();
  for (const cmd of commands) {
    for (const name of cmd.names) {
      map.set(name.toLowerCase(), cmd);
    }
    const cat = toStringSafe(cmd.category || "Lainnya");
    if (!categoryMap.has(cat)) categoryMap.set(cat, []);
    categoryMap.get(cat).push(cmd);
  }

  const getCommandMap = () => map;
  const getCategoryMap = () => categoryMap;
  const getAllCategories = () => Array.from(categoryMap.keys()).map(toStringSafe).sort();

  async function handlePassive(ctx) {
    for (const handler of passiveHandlers) {
      try {
        const handled = await handler(ctx);
        if (handled) return true;
      } catch (err) {
        logger.error("Passive handler gagal", { handler: handler.name || "anonymous", error: err?.message || String(err) });
      }
    }
    return false;
  }

  async function handle(ctx) {
    if (!ctx.text) return false;
    const passiveHandled = await handlePassive(ctx);
    if (passiveHandled) return true;
    if (!ctx.text.startsWith(prefix)) return false;
    const parsed = parseCommand(ctx.text, prefix);
    if (!parsed || !parsed.command) return false;
    const cmd = map.get(parsed.command);
    if (!cmd) return false;
    const senderNumber = normalizeNumberFromJid(ctx.sender);
    const isOwner = senderNumber && senderNumber === ownerNumber;
    if (!isOwner && guard.isBlocked(ctx.sender)) {
      await ctx.reply(ctx.sock, ctx.msg, "⛔ Kamu masuk blocklist bot.");
      return true;
    }
    const lengthCheck = guard.checkInputLength(parsed.input, cmd.maxInputLength);
    if (!lengthCheck.ok) {
      await ctx.reply(ctx.sock, ctx.msg, `❌ Input terlalu panjang (maks ${lengthCheck.maxLength} karakter).`);
      return true;
    }
    const cooldownMs = Number.isFinite(cmd.cooldownMs) ? cmd.cooldownMs : undefined;
    const cooldownCheck = guard.checkCooldown(ctx.sender, cmd.names[0], cooldownMs);
    if (!cooldownCheck.ok) {
      const seconds = Math.ceil(cooldownCheck.remainingMs / 1000);
      await ctx.reply(ctx.sock, ctx.msg, `⏳ Tunggu ${seconds} detik sebelum pakai command ini lagi.`);
      return true;
    }
    try {
      await cmd.execute({ ...ctx, command: parsed.command, args: parsed.args, input: parsed.input, isOwner });
    } catch (err) {
      logger.error("Command gagal", { command: parsed.command, sender: ctx.sender, jid: ctx.jid, error: err?.message || String(err) });
      await ctx.reply(ctx.sock, ctx.msg, "❌ Terjadi error saat menjalankan command.");
    }
    return true;
  }
  return { handle, getCommandMap, getCategoryMap, getAllCategories };
}