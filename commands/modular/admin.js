import { makeFailLogger, makeOkLogger } from "./logger.js";

export function createAdminCommands(deps) {
  const {
    getAccessContext,
    getContextInfo,
    getQuotedText,
    getBotIdSet,
    normalizeJid,
    BOT_FOOTER,
    saveBotState,
    botState,
    expandParticipantCandidates,
    tryDeleteByKey,
    getErrorMessage,
    logCommandResult
  } = deps;
  const logOk = makeOkLogger(logCommandResult);
  const logFail = makeFailLogger(logCommandResult);

  return [
    {
      names: ["maintenance"],
      category: "Admin",
      description: "Mode maintenance bot (hanya owner)",
      usage: "!maintenance status | !maintenance on [alasan] | !maintenance off",
      execute: async ctx => {
        const access = await getAccessContext(ctx);
        const subRaw = String(ctx.input || "").trim();
        const [subCmd] = subRaw.split(/\s+/);
        const sub = String(subCmd || "status").toLowerCase();

        if (sub === "status" || !subRaw) {
          const st = botState.maintenance;
          const enabledText = st.enabled ? "ON" : "OFF";
          const since = st.enabledAt ? `\n🕒 Sejak: ${new Date(st.enabledAt).toLocaleString("id-ID")}` : "";
          const by = st.enabledBy ? `\n👤 Oleh: ${st.enabledBy}` : "";
          const reason = st.reason ? `\n📝 Alasan: ${st.reason}` : "";
          logOk(ctx, `maintenance status=${enabledText}`);
          return ctx.reply(ctx.sock, ctx.msg, `🛠️ Maintenance: *${enabledText}*${since}${by}${reason}`);
        }

        if (!access.isOwner) {
          logFail(ctx, "maintenance ditolak: bukan owner");
          return ctx.reply(ctx.sock, ctx.msg, "🔒 Hanya owner yang boleh mengubah mode maintenance.");
        }

        if (sub === "on") {
          const reason = subRaw.replace(/^on\s*/i, "").trim();
          botState.maintenance.enabled = true;
          botState.maintenance.enabledAt = Date.now();
          botState.maintenance.enabledBy = (access.senderIds && access.senderIds[0]) || normalizeJid(ctx.sender);
          botState.maintenance.reason = reason;
          saveBotState();
          logOk(ctx, "maintenance on");
          return ctx.reply(
            ctx.sock,
            ctx.msg,
            `✅ Maintenance diaktifkan.${reason ? `\n📝 ${reason}` : ""}`
          );
        }

        if (sub === "off") {
          botState.maintenance.enabled = false;
          botState.maintenance.enabledAt = null;
          botState.maintenance.enabledBy = "";
          botState.maintenance.reason = "";
          saveBotState();
          logOk(ctx, "maintenance off");
          return ctx.reply(ctx.sock, ctx.msg, "✅ Maintenance dimatikan. Bot kembali normal.");
        }

        logFail(ctx, "maintenance subcommand tidak valid");
        return ctx.reply(
          ctx.sock,
          ctx.msg,
          "❗ Format:\n• !maintenance status\n• !maintenance on [alasan]\n• !maintenance off"
        );
      }
    },
    {
      names: ["hapus"],
      category: "Admin",
      description: "Hapus pesan bot (reply pesan bot, owner/admin di grup)",
      usage: "!hapus (reply pesan bot)",
      execute: async ctx => {
        const ctxInfo = getContextInfo(ctx.msg);
        const stanzaId = ctxInfo?.stanzaId;
        const quoted = ctxInfo?.quotedMessage;
        const quotedParticipantsRaw = Array.from(
          new Set(
            [ctxInfo?.participant, ctxInfo?.participantPn, ctxInfo?.participantLid]
              .map(v => String(v || "").trim())
              .filter(Boolean)
          )
        );

        if (!stanzaId || !quoted) {
          logFail(ctx, "hapus gagal: tidak reply pesan");
          return ctx.reply(ctx.sock, ctx.msg, "❗ Reply pesan bot yang mau dihapus, lalu kirim `!hapus`.");
        }

        const access = await getAccessContext(ctx);
        if (ctx.jid.endsWith("@g.us") && !access.isPrivileged) {
          logFail(ctx, "hapus ditolak: bukan owner/admin");
          return ctx.reply(ctx.sock, ctx.msg, "🔒 Di grup, hanya owner/admin yang boleh pakai `!hapus`.");
        }

        const botIds = getBotIdSet(ctx.sock);
        const quotedText = getQuotedText(quoted);
        const isBotFooterMessage = String(quotedText || "").includes(BOT_FOOTER);
        const isBotParticipant = quotedParticipantsRaw.some(participantRaw => {
          const raw = String(participantRaw || "").trim().toLowerCase();
          if (raw && botIds.has(raw)) return true;
          const norm = normalizeJid(participantRaw || "");
          return norm && botIds.has(norm);
        });

        if (!isBotFooterMessage && !isBotParticipant) {
          logFail(ctx, "hapus gagal: target bukan pesan bot");
          return ctx.reply(ctx.sock, ctx.msg, "❌ Yang bisa dihapus hanya pesan dari bot.");
        }

        try {
          const candidateKeys = [];
          const isGroup = ctx.jid.endsWith("@g.us");
          let quotedParticipants = await expandParticipantCandidates(ctx.sock, quotedParticipantsRaw);
          const remoteJidCandidates = Array.from(
            new Set([ctx.jid, String(ctxInfo?.remoteJid || "").trim()].filter(Boolean))
          );

          if (isGroup) {
            if (!quotedParticipants.length && isBotFooterMessage) {
              const botRaw = [ctx.sock?.user?.id, ctx.sock?.user?.lid]
                .map(v => String(v || "").trim())
                .filter(Boolean);
              quotedParticipants = await expandParticipantCandidates(ctx.sock, botRaw);
            }

            if (quotedParticipants.length) {
              for (const remoteJidCandidate of remoteJidCandidates) {
                for (const participant of quotedParticipants) {
                  candidateKeys.push({ remoteJid: remoteJidCandidate, id: stanzaId, participant, fromMe: true });
                  candidateKeys.push({ remoteJid: remoteJidCandidate, id: stanzaId, participant });
                  candidateKeys.push({ remoteJid: remoteJidCandidate, id: stanzaId, participant, fromMe: false });
                }
              }
            }

            for (const remoteJidCandidate of remoteJidCandidates) {
              candidateKeys.push({ remoteJid: remoteJidCandidate, id: stanzaId, fromMe: true });
              candidateKeys.push({ remoteJid: remoteJidCandidate, id: stanzaId });
              candidateKeys.push({ remoteJid: remoteJidCandidate, id: stanzaId, fromMe: false });
            }
          } else {
            for (const remoteJidCandidate of remoteJidCandidates) {
              candidateKeys.push({ remoteJid: remoteJidCandidate, id: stanzaId, fromMe: true });
              candidateKeys.push({ remoteJid: remoteJidCandidate, id: stanzaId });
              candidateKeys.push({ remoteJid: remoteJidCandidate, id: stanzaId, fromMe: false });
            }
          }

          const seen = new Set();
          const dedupedKeys = candidateKeys.filter(key => {
            const signature = JSON.stringify({
              remoteJid: key.remoteJid || "",
              id: key.id || "",
              participant: key.participant || "",
              fromMe: Boolean(key.fromMe)
            });
            if (seen.has(signature)) return false;
            seen.add(signature);
            return true;
          });

          let deleted = false;
          let lastErr = null;
          const successLogs = [];
          for (const key of dedupedKeys) {
            const result = await tryDeleteByKey(ctx.sock, ctx.jid, key);
            if (result.ok) {
              deleted = true;
              successLogs.push(
                `via=${result.via || "-"} fromMe=${typeof key.fromMe === "boolean" ? key.fromMe : "unset"} participant=${key.participant ? "set" : "unset"}`
              );
              continue;
            }
            lastErr = result.error;
          }

          if (!deleted) {
            throw lastErr || new Error("Delete key tidak valid");
          }

          logOk(ctx, `hapus request terkirim total_ok=${successLogs.length}`);
          return;
        } catch (err) {
          logFail(ctx, getErrorMessage(err));
          return ctx.reply(ctx.sock, ctx.msg, "❌ Gagal menghapus pesan bot.");
        }
      }
    }
  ];
}
