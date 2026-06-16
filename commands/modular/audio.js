import { makeFailLogger, makeOkLogger } from "./logger.js";

export function createAudioCommands(deps) {
  const {
    tts,
    ttsCooldown,
    TTS_DELAY,
    logInfo,
    logError,
    getErrorMessage,
    logCommandResult
  } = deps;
  const logOk = makeOkLogger(logCommandResult);
  const logFail = makeFailLogger(logCommandResult);

  return [
    {
      names: ["suara"],
      category: "Media",
      description: "Teks ke voice note (TTS)",
      usage: "!suara <teks> (max 250 karakter)",
      subCommands: [
        { names: ["suara <teks>"], description: "Ubah teks jadi voice note (max 250 karakter)" }
      ],
      execute: async ctx => {
        const input = String(ctx.input || "");
        const sender = String(ctx.sender || "");

        if (!input) {
          logFail(ctx, "teks tts kosong");
          return ctx.reply(ctx.sock, ctx.msg, "❗ !suara <teks>");
        }

        if (input.length > 250) {
          logFail(ctx, "teks tts melebihi 250 karakter");
          return ctx.reply(ctx.sock, ctx.msg, "❗ Maksimal 250 karakter.");
        }

        const now = Date.now();
        const last = ttsCooldown.get(sender) || 0;
        const remaining = TTS_DELAY - (now - last);
        if (remaining > 0) {
          logFail(ctx, `tts cooldown ${Math.ceil(remaining / 1000)}s`);
          return ctx.reply(
            ctx.sock,
            ctx.msg,
            `⏳ Tunggu *${Math.ceil(remaining / 1000)} detik* sebelum pakai TTS lagi.`
          );
        }

        try {
          ttsCooldown.set(sender, now);
          logInfo(`TTS processing | user=${sender.split("@")[0]}`);
          const audio = await tts(input);

          logOk(ctx, "tts voice note terkirim");
          return ctx.reply(ctx.sock, ctx.msg, {
            audio,
            mimetype: "audio/ogg; codecs=opus",
            ptt: true
          });
        } catch (err) {
          ttsCooldown.delete(sender);
          logError("TTS ERROR", err);
          logFail(ctx, getErrorMessage(err));
          return ctx.reply(ctx.sock, ctx.msg, "❌ Gagal membuat suara.");
        }
      }
    }
  ];
}
