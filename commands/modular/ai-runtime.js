export function createAICommandExecutor(deps) {
  const {
    enforceRateLimit,
    parseOwnerIds,
    getSenderIds,
    hasKnowledgeEditAccess,
    normalizeJid,
    getAIConversationId,
    getAIKnowledgeScopeId,
    parseTargetKnowledgeScope,
    formatScopeLabel,
    getAIConfirmation,
    clearAIConfirmation,
    setAIConfirmation,
    setStoredFact,
    appendKnowledgeAudit,
    getAIHistorySize,
    clearAIHistory,
    normalizeAliasName,
    normalizeKnowledgeScopeId,
    saveKnowledgeAliases,
    tokenizeKnowledgeLookup,
    normalizeKnowledgeLookup,
    getMentionedOrQuotedIds,
    getIdVariants,
    addKnowledgeEditor,
    removeKnowledgeEditor,
    listKnowledgeEditors,
    clearKnowledgeEditors,
    listKnowledgeScopes,
    exportKnowledgeSnapshot,
    formatKnowledgeFactsText,
    listStoredFacts,
    readQuotedDocumentText,
    parseKnowledgeImportText,
    readKnowledgeAudit,
    extractKnowledgeFact,
    extractKnowledgeMutation,
    resolveStoredFactKey,
    deleteStoredFact,
    getStoredFact,
    getStoredFactMeta,
    isAIKnowledgeMutationRequest,
    getFeatureRedirect,
    buildFactsContext,
    askAI,
    getErrorMessage,
    knowledgeAliases
  } = deps;

  return async function handleAICommand(ctx) {
  const { sock, msg, senderRateKey, command, sender, jid, input, reply, logFail, logOk } = ctx;
  if (
    await enforceRateLimit({
      sock,
      msg,
      senderKey: senderRateKey,
      bucket: "ai",
      limit: 10,
      windowMs: 60_000,
      commandLabel: command,
      sender,
      jid
    })
  ) {
    return;
  }

  if (!input) {
    logFail("input ai kosong");
    return reply(
      sock,
      msg,
      "❗ !ai <pertanyaan>\n🧹 !ai reset\n💾 !ai simpan <kunci>=<nilai>\n📚 !ai data list"
    );
  }

  const conversationId = getAIConversationId(jid, sender);
  const currentKnowledgeScopeId = getAIKnowledgeScopeId(jid);
  const ownerIds = parseOwnerIds(sock);
  const senderIds = await getSenderIds(sock, msg);
  const isOwner = msg.key.fromMe || senderIds.some(id => ownerIds.has(id));
  const canEditKnowledge = isOwner || hasKnowledgeEditAccess(senderIds);
  const ownerNum = Array.from(ownerIds)[0] || "";
  const senderNum = senderIds[0] || normalizeJid(sender);
  const targetScope = parseTargetKnowledgeScope(input, currentKnowledgeScopeId);

  if (targetScope.error) {
    logFail(`ai target scope invalid: ${targetScope.error}`);
    return reply(sock, msg, `❗ ${targetScope.error}\nContoh: \`!ai untuk group:120xxx@g.us simpen data jadwal = Jumat\``);
  }

  if (targetScope.hasOverride && !isOwner) {
    logFail("ai target scope ditolak: bukan owner");
    return reply(sock, msg, "🔒 Hanya owner/developer yang bisa mengubah data chat/grup lain.");
  }

  const knowledgeScopeId = targetScope.scopeId;
  const aiInput = targetScope.input.trim();
  const aiCmd = aiInput.toLowerCase();
  const scopeSuffix = targetScope.hasOverride ? `\nScope: ${formatScopeLabel(knowledgeScopeId)}` : "";

  if (["ya", "yes", "lanjut", "konfirmasi", "confirm"].includes(aiCmd)) {
    const pending = getAIConfirmation(jid, sender);
    if (!pending) {
      logFail("ai confirm kosong");
      return reply(sock, msg, "Tidak ada perubahan data yang menunggu konfirmasi.");
    }

    if (pending.requiresOwner && !isOwner) {
      clearAIConfirmation(jid, sender);
      logFail("ai confirm ditolak: bukan owner");
      return reply(sock, msg, "🔒 Konfirmasi ini butuh owner/developer.");
    }

    if (pending.type === "import_facts") {
      const saved = [];
      for (const item of pending.facts) {
        const result = setStoredFact(pending.scopeId, item.key, item.value, {
          updatedBy: senderNum || senderIds.join(", ") || "unknown",
          actorIds: senderIds,
          source: "import",
          confidence: 1
        });
        saved.push(result);
      }

      appendKnowledgeAudit({
        action: "data_import",
        actor: senderIds,
        scope: pending.scopeId,
        count: saved.length,
        keys: saved.map(item => item.key)
      });
      clearAIConfirmation(jid, sender);
      logOk(`ai import confirmed count=${saved.length}`);
      return reply(
        sock,
        msg,
        `✅ Import disimpan.\nScope: ${formatScopeLabel(pending.scopeId)}\nTotal: ${saved.length} data`
      );
    }

    clearAIConfirmation(jid, sender);
    return reply(sock, msg, "❌ Jenis konfirmasi tidak dikenali, jadi aku batalkan.");
  }

  if (["batal", "cancel", "nggak", "tidak"].includes(aiCmd)) {
    const pending = getAIConfirmation(jid, sender);
    clearAIConfirmation(jid, sender);
    logOk(`ai confirmation canceled exists=${Boolean(pending)}`);
    return reply(sock, msg, pending ? "✅ Perubahan data dibatalkan." : "Tidak ada perubahan data yang menunggu konfirmasi.");
  }

  if (aiCmd === "reset" || aiCmd === "clear") {
    const prevTurns = Math.ceil(getAIHistorySize(conversationId) / 2);
    clearAIHistory(conversationId);
    logOk(`ai reset, turn=${prevTurns}`);
    return reply(sock, msg, `🧹 Memory percakapan AI direset (${prevTurns} turn dihapus).`);
  }

  if (aiCmd === "scope" || aiCmd === "scope id" || aiCmd === "data scope") {
    logOk("ai scope");
    return reply(
      sock,
      msg,
      `📌 Scope data chat ini:\n\`${currentKnowledgeScopeId}\`\n\nOwner bisa target scope lain:\n\`!ai untuk group:<jid_grup> simpen data kunci = nilai\``
    );
  }

  if (aiCmd.startsWith("alias ")) {
    if (!isOwner) {
      logFail("ai alias ditolak: bukan owner");
      return reply(sock, msg, "🔒 Hanya owner/developer yang bisa mengatur alias scope.");
    }

    const rest = aiInput.replace(/^alias\s+/i, "").trim();
    if (rest === "list" || rest === "daftar") {
      const entries = Object.entries(knowledgeAliases).sort((a, b) => a[0].localeCompare(b[0]));
      logOk(`ai alias list total=${entries.length}`);
      return reply(
        sock,
        msg,
        entries.length
          ? `🏷️ *Alias Scope*\n${entries.map(([name, scope]) => `@${name} = ${scope}`).join("\n")}`
          : "🏷️ Belum ada alias scope."
      );
    }

    if (/^(hapus|delete|del)\s+/i.test(rest)) {
      const name = normalizeAliasName(rest.replace(/^(hapus|delete|del)\s+/i, ""));
      if (!name) return reply(sock, msg, "❗ Contoh: `!ai alias hapus musik`");
      const existed = Boolean(knowledgeAliases[name]);
      delete knowledgeAliases[name];
      saveKnowledgeAliases();
      appendKnowledgeAudit({ action: "alias_del", actor: senderIds, alias: name, existed });
      logOk(`ai alias del ${name} existed=${existed}`);
      return reply(sock, msg, existed ? `🗑️ Alias @${name} dihapus.` : `❌ Alias @${name} tidak ditemukan.`);
    }

    const match = rest.match(/^(.+?)\s*(?:=|->|:)\s*(.+)$/);
    if (!match) {
      return reply(
        sock,
        msg,
        "❗ Contoh:\n`!ai alias musik = group:120xxx@g.us`\n`!ai alias list`\n`!ai alias hapus musik`"
      );
    }

    const name = normalizeAliasName(match[1].replace(/^grup\s+/i, ""));
    const scope = normalizeKnowledgeScopeId(match[2]);
    if (!name || !scope) {
      return reply(sock, msg, "❗ Alias atau scope tidak valid.\nContoh: `!ai alias musik = group:120xxx@g.us`");
    }

    knowledgeAliases[name] = scope;
    saveKnowledgeAliases();
    appendKnowledgeAudit({ action: "alias_set", actor: senderIds, alias: name, scope });
    logOk(`ai alias set ${name}=${scope}`);
    return reply(sock, msg, `✅ Alias dibuat:\n@${name} = ${scope}`);
  }

  if (aiCmd.startsWith("grup cari ") || aiCmd.startsWith("group cari ") || aiCmd.startsWith("cari grup ") || aiCmd.startsWith("cari group ")) {
    if (!isOwner) {
      logFail("ai grup cari ditolak: bukan owner");
      return reply(sock, msg, "🔒 Hanya owner/developer yang bisa mencari scope grup.");
    }

    const query = aiInput.replace(/^(grup|group)\s+cari\s+/i, "").replace(/^cari\s+(grup|group)\s+/i, "").trim();
    if (!query) return reply(sock, msg, "❗ Contoh: `!ai grup cari seni musik`");

    try {
      const tokens = tokenizeKnowledgeLookup(query);
      const groups = await sock.groupFetchAllParticipating();
      const results = Object.values(groups || {})
        .map(group => ({
          id: group?.id || "",
          subject: String(group?.subject || "-").trim() || "-"
        }))
        .filter(group => group.id)
        .map(group => {
          const hay = normalizeKnowledgeLookup(`${group.subject} ${group.id}`);
          const score = tokens.reduce((acc, token) => acc + (hay.includes(token) ? 1 : 0), 0);
          return { ...group, score };
        })
        .filter(group => group.score > 0)
        .sort((a, b) => b.score - a.score || a.subject.localeCompare(b.subject))
        .slice(0, 10);

      logOk(`ai grup cari query=${query} total=${results.length}`);
      return reply(
        sock,
        msg,
        results.length
          ? `🔎 *Hasil Grup: ${query}*\n${results.map((group, idx) => `${idx + 1}. ${group.subject}\n   group:${group.id}`).join("\n")}`
          : `❌ Tidak ada grup yang cocok untuk: ${query}`
      );
    } catch (err) {
      logFail(`ai grup cari gagal: ${getErrorMessage(err)}`);
      return reply(sock, msg, "❌ Gagal mencari grup.");
    }
  }

  if (
    aiCmd === "grup list" ||
    aiCmd === "group list" ||
    aiCmd === "list grup" ||
    aiCmd === "list group"
  ) {
    if (!isOwner) {
      logFail("ai grup list ditolak: bukan owner");
      return reply(sock, msg, "🔒 Hanya owner/developer yang bisa melihat daftar scope grup.");
    }

    try {
      const groups = await sock.groupFetchAllParticipating();
      const groupRows = Object.values(groups || {})
        .map(group => ({
          id: group?.id || "",
          subject: String(group?.subject || "-").trim() || "-"
        }))
        .filter(group => group.id)
        .sort((a, b) => a.subject.localeCompare(b.subject));

      if (!groupRows.length) {
        logOk("ai grup list kosong");
        return reply(sock, msg, "📚 Bot belum mendeteksi grup yang bisa ditampilkan.");
      }

      const generatedAt = new Date().toLocaleString("id-ID", {
        timeZone: "Asia/Jakarta",
        dateStyle: "medium",
        timeStyle: "medium"
      });
      const lines = groupRows.map((group, idx) => [
        `${idx + 1}. ${group.subject}`,
        `   scope: group:${group.id}`,
        `   contoh: !ai untuk group:${group.id} data list`
      ].join("\n"));
      const fileText = [
        "DAFTAR SCOPE GRUP WHATSAPP",
        `Total: ${groupRows.length}`,
        `Dibuat: ${generatedAt} WIB`,
        "",
        "Pakai scope ini untuk target data grup lain:",
        "!ai untuk group:<jid_grup> simpen data kunci = nilai",
        "!ai untuk group:<jid_grup> data list",
        "!ai untuk group:<jid_grup> gantiin data kunci jadi nilai baru",
        "!ai untuk group:<jid_grup> hapus data kunci",
        "",
        lines.join("\n\n")
      ].join("\n");

      logOk(`ai grup list total=${groupRows.length} as document`);
      return reply(
        sock,
        msg,
        {
          document: Buffer.from(fileText, "utf8"),
          fileName: "scope-grup-whatsapp.txt",
          mimetype: "text/plain",
          caption: `📎 Daftar scope grup dikirim sebagai file.\nTotal: ${groupRows.length} grup.`
        }
      );
    } catch (err) {
      logFail(`ai grup list gagal: ${getErrorMessage(err)}`);
      return reply(sock, msg, "❌ Gagal mengambil daftar grup.");
    }
  }

  if (aiCmd === "editor list" || aiCmd === "list editor") {
    const editors = listKnowledgeEditors();
    const lines = [
      `owner: ${Array.from(ownerIds).join(", ") || "-"}`,
      ...editors.map((id, idx) => `${idx + 1}. ${id}`)
    ].join("\n");

    logOk("ai editor list");
    return reply(
      sock,
      msg,
      `👥 *Editor Data Knowledge*\n${lines}${editors.length === 0 ? "\n(belum ada editor tambahan)" : ""}`
    );
  }

  if (aiCmd === "editor id" || aiCmd === "my id" || aiCmd === "whoami") {
    logOk("ai editor id");
    return reply(
      sock,
      msg,
      `🆔 ID kamu terdeteksi:\n${senderIds.length ? senderIds.map((id, i) => `${i + 1}. ${id}`).join("\n") : "-"}\n\nMinta owner tambah salah satu ID ini:\n\`!ai editor add <id>\``
    );
  }

  if (aiCmd === "editor clear" || aiCmd === "editor reset") {
    if (!isOwner) {
      logFail("editor clear ditolak: bukan owner");
      return reply(
        sock,
        msg,
        `🔒 Hanya owner yang bisa reset editor.\nID kamu terdeteksi: ${senderNum || "-"}`
      );
    }

    const removedCount = clearKnowledgeEditors();
    appendKnowledgeAudit({
      action: "editor_clear",
      actor: senderIds,
      removedCount
    });

    logOk(`ai editor clear, removed=${removedCount}`);
    return reply(sock, msg, `✅ Semua editor tambahan dihapus (${removedCount} akun).`);
  }

  if (
    aiCmd === "editor add" ||
    aiCmd === "editor tambah" ||
    aiCmd.startsWith("editor add ") ||
    aiCmd.startsWith("editor tambah ")
  ) {
    if (!isOwner) {
      logFail("editor add ditolak: bukan owner");
      return reply(
        sock,
        msg,
        `🔒 Hanya owner yang bisa menambah editor.\nID kamu terdeteksi: ${senderNum || "-"}`
      );
    }

    const raw = aiInput.replace(/^editor\s+(add|tambah)\s+/i, "").trim();
    const fromText = raw
      .split(/[,\s]+/)
      .map(normalizeJid)
      .filter(Boolean);
    const fromCtx = getMentionedOrQuotedIds(msg);
    const candidateIds = Array.from(new Set([...fromText, ...fromCtx]));

    if (!candidateIds.length) {
      logFail("editor add gagal: kandidat kosong");
      return reply(
        sock,
        msg,
        "❗ Nomor/ID editor tidak valid.\nContoh: !ai editor add 6281234567890\nAtau reply pesan user lalu kirim: !ai editor add"
      );
    }

    const added = [];
    const skippedOwner = [];
    const already = [];

    for (const candidate of candidateIds) {
      const variants = getIdVariants(candidate);
      let wasAdded = false;
      let isOwnerVariant = false;

      for (const variant of variants) {
        if (!variant || variant.length < 8) continue;
        if (ownerIds.has(variant)) {
          isOwnerVariant = true;
          continue;
        }

        const result = addKnowledgeEditor(variant);
        if (result.added) {
          added.push(variant);
          wasAdded = true;
        } else {
          already.push(variant);
        }
      }

      if (isOwnerVariant && !wasAdded) {
        skippedOwner.push(candidate);
      }
    }

    if (!added.length && !already.length) {
      logFail("editor add gagal: tidak ada id valid");
      return reply(sock, msg, "❌ Tidak ada ID editor valid yang bisa ditambahkan.");
    }

    const parts = [];
    if (added.length) parts.push(`✅ Ditambahkan:\n${Array.from(new Set(added)).join("\n")}`);
    if (already.length) parts.push(`ℹ️ Sudah terdaftar:\n${Array.from(new Set(already)).join("\n")}`);
    if (skippedOwner.length) parts.push("ℹ️ ID owner dilewati (owner otomatis punya akses).");

    appendKnowledgeAudit({
      action: "editor_add",
      actor: senderIds,
      input: candidateIds,
      added: Array.from(new Set(added)),
      already: Array.from(new Set(already)),
      skippedOwner: skippedOwner.length
    });

    logOk(`ai editor add, added=${Array.from(new Set(added)).length}`);
    return reply(
      sock,
      msg,
      parts.join("\n\n")
    );
  }

  if (
    aiCmd === "editor del" ||
    aiCmd === "editor delete" ||
    aiCmd === "editor hapus" ||
    aiCmd.startsWith("editor del ") ||
    aiCmd.startsWith("editor delete ") ||
    aiCmd.startsWith("editor hapus ")
  ) {
    if (!isOwner) {
      logFail("editor del ditolak: bukan owner");
      return reply(
        sock,
        msg,
        `🔒 Hanya owner yang bisa menghapus editor.\nID kamu terdeteksi: ${senderNum || "-"}`
      );
    }

    const raw = aiInput.replace(/^editor\s+(del|delete|hapus)\s+/i, "").trim();
    const fromText = raw
      .split(/[,\s]+/)
      .map(normalizeJid)
      .filter(Boolean);
    const fromCtx = getMentionedOrQuotedIds(msg);
    const candidateIds = Array.from(new Set([...fromText, ...fromCtx]));

    if (!candidateIds.length) {
      logFail("editor del gagal: kandidat kosong");
      return reply(
        sock,
        msg,
        "❗ Nomor/ID editor tidak valid.\nContoh: !ai editor del 6281234567890\nAtau reply pesan user lalu kirim: !ai editor del"
      );
    }

    const removedList = [];
    const notFoundList = [];

    for (const candidate of candidateIds) {
      const variants = getIdVariants(candidate);
      let removedAny = false;
      let hasOwnerVariant = false;

      for (const variant of variants) {
        if (!variant || variant.length < 8) continue;
        if (ownerIds.has(variant)) {
          hasOwnerVariant = true;
          continue;
        }

        const removed = removeKnowledgeEditor(variant);
        if (removed) {
          removedList.push(variant);
          removedAny = true;
        } else {
          notFoundList.push(variant);
        }
      }

      if (hasOwnerVariant && !removedAny) {
        logFail("editor del ditolak: target owner");
        return reply(sock, msg, "❌ Owner tidak bisa dihapus dari akses editor.");
      }
    }

    const parts = [];
    if (removedList.length) parts.push(`🗑️ Dihapus:\n${Array.from(new Set(removedList)).join("\n")}`);
    if (notFoundList.length) parts.push(`❌ Tidak ditemukan:\n${Array.from(new Set(notFoundList)).join("\n")}`);

    if (!parts.length) {
      logFail("editor del gagal: tidak ada perubahan");
      return reply(sock, msg, "❌ Tidak ada ID editor yang diproses.");
    }

    appendKnowledgeAudit({
      action: "editor_del",
      actor: senderIds,
      input: candidateIds,
      removed: Array.from(new Set(removedList)),
      notFound: Array.from(new Set(notFoundList))
    });

    logOk(`ai editor del, removed=${Array.from(new Set(removedList)).length}`);
    return reply(
      sock,
      msg,
      parts.join("\n\n")
    );
  }

  if (aiCmd === "data backup all" || aiCmd === "backup data all" || aiCmd === "data backup semua") {
    if (!isOwner) {
      logFail("ai data backup all ditolak: bukan owner");
      return reply(sock, msg, "🔒 Hanya owner/developer yang bisa backup semua data knowledge.");
    }

    const snapshot = {
      ...exportKnowledgeSnapshot(),
      aliases: knowledgeAliases,
      editors: listKnowledgeEditors()
    };
    const text = JSON.stringify(snapshot, null, 2);
    logOk("ai data backup all");
    return reply(sock, msg, {
      document: Buffer.from(text, "utf8"),
      fileName: "knowledge-backup-all.json",
      mimetype: "application/json",
      caption: `📦 Backup semua data knowledge.\nScope: ${listKnowledgeScopes().length} scope`
    });
  }

  if (aiCmd === "data export" || aiCmd === "export data" || aiCmd === "data export txt") {
    const facts = listStoredFacts(knowledgeScopeId);
    const asText = aiCmd.includes("txt");
    const payload = asText
      ? formatKnowledgeFactsText(knowledgeScopeId, facts)
      : JSON.stringify(exportKnowledgeSnapshot(knowledgeScopeId), null, 2);

    logOk(`ai data export scope=${knowledgeScopeId} total=${facts.length}`);
    return reply(sock, msg, {
      document: Buffer.from(payload, "utf8"),
      fileName: asText ? "knowledge-export.txt" : "knowledge-export.json",
      mimetype: asText ? "text/plain" : "application/json",
      caption: `📎 Export data knowledge.\nScope: ${formatScopeLabel(knowledgeScopeId)}\nTotal: ${facts.length} data`
    });
  }

  if (aiCmd.startsWith("import data") || aiCmd.startsWith("data import")) {
    if (!canEditKnowledge) {
      logFail("ai import data ditolak: tanpa akses");
      return reply(
        sock,
        msg,
        `🔒 Hanya owner atau editor terdaftar yang bisa import data.\nID kamu terdeteksi: ${senderIds.join(", ") || "-"}`
      );
    }

    try {
      const inline = aiInput.replace(/^(import\s+data|data\s+import)\s*/i, "").trim();
      const fileText = inline || await readQuotedDocumentText(msg);
      if (!fileText) {
        return reply(
          sock,
          msg,
          "❗ Reply file `.txt`/`.json` lalu kirim `!ai import data`, atau tulis data setelah command.\nFormat teks: `kunci = nilai` per baris."
        );
      }

      const facts = parseKnowledgeImportText(fileText)
        .slice(0, 100)
        .map(item => ({
          key: item.key.toLowerCase(),
          value: item.value
        }));

      if (!facts.length) {
        logFail("ai import data kosong");
        return reply(sock, msg, "❌ Tidak ada data valid yang bisa diimport.");
      }

      setAIConfirmation(jid, sender, {
        type: "import_facts",
        scopeId: knowledgeScopeId,
        facts,
        requiresOwner: targetScope.hasOverride
      });

      const preview = facts
        .slice(0, 8)
        .map((item, idx) => `${idx + 1}. ${item.key} = ${item.value}`)
        .join("\n");
      logOk(`ai import preview count=${facts.length}`);
      return reply(
        sock,
        msg,
        `🧾 *Preview Import Data*\nScope: ${formatScopeLabel(knowledgeScopeId)}\nTotal: ${facts.length} data\n\n${preview}${facts.length > 8 ? "\n..." : ""}\n\nKirim \`!ai ya\` untuk simpan, atau \`!ai batal\` untuk batal.`
      );
    } catch (err) {
      logFail(`ai import data gagal: ${getErrorMessage(err)}`);
      return reply(sock, msg, `❌ Gagal import data: ${getErrorMessage(err)}`);
    }
  }

  if (aiCmd === "data log" || aiCmd.startsWith("data log ") || aiCmd === "log data" || aiCmd.startsWith("log data ")) {
    const key = aiInput
      .replace(/^(data\s+log|log\s+data)\s*/i, "")
      .trim();
    const rows = readKnowledgeAudit({ scopeId: knowledgeScopeId, key, limit: 20 });
    if (!rows.length) {
      logFail("ai data log kosong");
      return reply(sock, msg, `📜 Belum ada log data untuk scope ini.${scopeSuffix}`);
    }

    const lines = rows.map((row, idx) => {
      const actor = Array.isArray(row.actor) ? row.actor.join(",") : row.actor || "-";
      const rowKey = row.key || row.requestedKey || "-";
      return `${idx + 1}. ${row.ts || "-"}\n   ${row.action || "-"} | ${rowKey}\n   actor: ${actor}`;
    });
    logOk(`ai data log total=${rows.length}`);
    return reply(sock, msg, `📜 *Log Data*${scopeSuffix}\n${lines.join("\n")}`);
  }

  if (aiCmd === "data list" || aiCmd === "list data") {
    const facts = listStoredFacts(knowledgeScopeId);
    if (!facts.length) {
      logFail("data list kosong");
      return reply(sock, msg, `📚 Belum ada data tersimpan di scope ini.${scopeSuffix}`);
    }

    const lines = facts
      .slice(0, 30)
      .map((item, idx) => `${idx + 1}. ${item.key} = ${item.value}`)
      .join("\n");

    logOk(`ai data list, total=${facts.length}`);
    return reply(
      sock,
      msg,
      `📚 *Data Tersimpan (${facts.length})*${scopeSuffix}\n${lines}${facts.length > 30 ? "\n..." : ""}`
    );
  }

  if (
    aiCmd.startsWith("simpan ") ||
    aiCmd.startsWith("simpen ") ||
    aiCmd.startsWith("save ") ||
    aiCmd.startsWith("ingat ") ||
    aiCmd.startsWith("inget ") ||
    aiCmd.startsWith("catat ") ||
    aiCmd.startsWith("catet ")
  ) {
    if (!canEditKnowledge) {
      logFail("simpan data ditolak: tanpa akses");
      return reply(
        sock,
        msg,
        `🔒 Hanya owner atau editor terdaftar yang bisa mengubah data.\nID kamu terdeteksi: ${senderIds.join(", ") || "-"}\nMinta owner pakai: !ai editor add <id>`
      );
    }

    const payload = aiInput
      .replace(/^(simpan|simpen|save|ingat|inget|catat|catet|catetin)\s+/i, "")
      .trim();
    const eqIndex = payload.indexOf("=");
    const colonIndex = payload.indexOf(":");
    let cutIndex = -1;

    if (eqIndex > 0 && colonIndex > 0) cutIndex = Math.min(eqIndex, colonIndex);
    else if (eqIndex > 0) cutIndex = eqIndex;
    else if (colonIndex > 0) cutIndex = colonIndex;

    let key = "";
    let value = "";
    let source = "manual";
    let confidence = 1;

    if (cutIndex < 1) {
      const extracted = await extractKnowledgeFact(aiInput);
      if (!extracted.shouldSave) {
        logFail("simpan data gagal: ekstraksi kosong");
        return reply(
          sock,
          msg,
          "❗ Aku belum bisa nangkep data yang harus disimpan.\nContoh natural: `!ai ingat jadwal latihan = Jumat jam 19.00`\nAtau: `!ai catat bahwa jadwal latihan adalah Jumat jam 19.00`"
        );
      }

      key = extracted.key;
      value = extracted.value;
      source = extracted.source === "ai" ? "ai-natural" : "heuristic";
      confidence = extracted.confidence;
    } else {
      key = payload
        .slice(0, cutIndex)
        .replace(/^(data|bahwa)\s+/i, "")
        .trim();
      value = payload.slice(cutIndex + 1).trim();
    }

    if (!key || !value) {
      logFail("simpan data gagal: key/value kosong");
      return reply(sock, msg, "❗ Kunci atau nilai kosong.");
    }

    setStoredFact(knowledgeScopeId, key, value, {
      updatedBy: senderNum || senderIds.join(", ") || "unknown",
      actorIds: senderIds,
      source,
      confidence
    });
    appendKnowledgeAudit({
      action: source === "manual" ? "data_set" : "data_set_ai",
      actor: senderIds,
      scope: knowledgeScopeId,
      key: key.toLowerCase(),
      value,
      source,
      confidence
    });
    logOk(`ai simpan key=${key.toLowerCase()}`);
    return reply(
      sock,
      msg,
      `✅ Data disimpan oleh *${senderNum || "-"}*${scopeSuffix}:\n*${key.toLowerCase()}* = ${value}`
    );
  }

  if (
    aiCmd.startsWith("hapus ") ||
    aiCmd.startsWith("apusin ") ||
    aiCmd.startsWith("hapuskan ") ||
    aiCmd.startsWith("delete ") ||
    aiCmd.startsWith("del ")
  ) {
    if (!canEditKnowledge) {
      logFail("hapus data ditolak: tanpa akses");
      return reply(
        sock,
        msg,
        `🔒 Hanya owner atau editor terdaftar yang bisa mengubah data.\nID kamu terdeteksi: ${senderIds.join(", ") || "-"}\nMinta owner pakai: !ai editor add <id>`
      );
    }

    const key = aiInput
      .replace(/^(hapus|apusin|hapuskan|delete|del)\s+/i, "")
      .replace(/^(data|tentang)\s+/i, "")
      .trim();
    if (!key) {
      logFail("hapus data gagal: key kosong");
      return reply(sock, msg, "❗ Contoh: !ai hapus alamat kantor");
    }

    const resolved = resolveStoredFactKey(knowledgeScopeId, key);
    if (resolved.ambiguous) {
      return reply(
        sock,
        msg,
        `❗ Data yang mau dihapus masih ambigu.\nCoba pakai salah satu:\n${resolved.alternatives.map(item => `• ${item}`).join("\n")}`
      );
    }

    const deleted = resolved.found ? deleteStoredFact(knowledgeScopeId, resolved.key) : false;
    appendKnowledgeAudit({
      action: "data_del",
      actor: senderIds,
      scope: knowledgeScopeId,
      key: resolved.found ? resolved.key : key.toLowerCase(),
      requestedKey: key.toLowerCase(),
      deleted
    });
    logOk(`ai hapus key=${key.toLowerCase()} resolved=${resolved.key} deleted=${deleted}`);
    return reply(
      sock,
      msg,
      deleted
        ? `🗑️ Data *${resolved.key}* dihapus.${scopeSuffix}`
        : `❌ Data *${key.toLowerCase()}* tidak ditemukan.`
    );
  }

  if (aiCmd.startsWith("data ")) {
    const key = aiInput.replace(/^data\s+/i, "").trim();
    if (!key || key.toLowerCase() === "list") {
      const facts = listStoredFacts(knowledgeScopeId);
      if (!facts.length) {
        logFail("ai data list kosong");
        return reply(sock, msg, `📚 Belum ada data tersimpan di scope ini.${scopeSuffix}`);
      }

      const lines = facts
        .slice(0, 30)
        .map((item, idx) => `${idx + 1}. ${item.key} = ${item.value}`)
        .join("\n");

      logOk(`ai data list, total=${facts.length}`);
      return reply(
        sock,
        msg,
        `📚 *Data Tersimpan (${facts.length})*${scopeSuffix}\n${lines}${facts.length > 30 ? "\n..." : ""}`
      );
    }

    const value = getStoredFact(knowledgeScopeId, key);
    if (!value) {
      logFail(`ai data key tidak ditemukan: ${key.toLowerCase()}`);
      return reply(sock, msg, `❌ Data *${key.toLowerCase()}* tidak ditemukan.`);
    }

    logOk(`ai data key=${key.toLowerCase()}`);
    const meta = getStoredFactMeta(knowledgeScopeId, key);
    const metaLine = meta?.updatedBy
      ? `\n📝 Diupdate oleh: ${meta.updatedBy}${meta.updatedAt ? `\n⏱️ ${meta.updatedAt}` : ""}`
      : "";
    return reply(sock, msg, `📌 *${key.toLowerCase()}* = ${value}${metaLine}${scopeSuffix}`);
  }

  if (isAIKnowledgeMutationRequest(aiInput)) {
    if (!canEditKnowledge) {
      logFail("mutasi data natural ditolak: tanpa akses");
      return reply(
        sock,
        msg,
        `🔒 Aku paham kamu mau mengubah data, tapi hanya owner/editor yang boleh.\nID kamu terdeteksi: ${senderIds.join(", ") || "-"}\nMinta owner pakai: !ai editor add <id>`
      );
    }

    const existingFacts = listStoredFacts(knowledgeScopeId);
    const mutation = await extractKnowledgeMutation(aiInput, existingFacts.map(item => item.key));

    if (mutation.action === "none") {
      logFail("mutasi data natural gagal: ekstraksi kosong");
      return reply(
        sock,
        msg,
        "❗ Aku paham kamu mau mengubah data, tapi instruksinya masih kurang jelas.\nContoh:\n• `!ai ganti data jadwal latihan jadi Jumat jam 19.00`\n• `!ai hapus data jadwal latihan`"
      );
    }

    if (mutation.action === "delete") {
      const resolved = resolveStoredFactKey(knowledgeScopeId, mutation.key);

      if (resolved.ambiguous) {
        return reply(
          sock,
          msg,
          `❗ Data yang mau dihapus masih ambigu.\nCoba pakai salah satu:\n${resolved.alternatives.map(item => `• ${item}`).join("\n")}`
        );
      }

      if (!resolved.found) {
        logFail(`hapus data natural gagal: key tidak ditemukan ${mutation.key}`);
        return reply(sock, msg, `❌ Data *${mutation.key}* tidak ditemukan.`);
      }

      const deleted = deleteStoredFact(knowledgeScopeId, resolved.key);
      appendKnowledgeAudit({
        action: "data_del_ai",
        actor: senderIds,
        scope: knowledgeScopeId,
        key: resolved.key,
        requestedKey: mutation.key,
        deleted,
        source: mutation.source,
        confidence: mutation.confidence,
        rawInput: aiInput
      });

      logOk(`ai hapus natural key=${resolved.key} deleted=${deleted}`);
      return reply(
        sock,
        msg,
        deleted
          ? `🗑️ Data *${resolved.key}* dihapus oleh *${senderNum || "-"}*.`
            + scopeSuffix
          : `❌ Data *${resolved.key}* gagal dihapus.`
      );
    }

    const wantsExisting = /^(ai|bot|botnya|min|admin)?[,\s:.-]*(tolong\s+)?(ganti|gantiin|ubah|ubahin|rubah|update|perbarui|perbaharui|edit|revisi)\s+(data\s+)?/i.test(aiInput);
    const resolved = resolveStoredFactKey(knowledgeScopeId, mutation.key);

    if (resolved.ambiguous) {
      return reply(
        sock,
        msg,
        `❗ Data yang mau diganti masih ambigu.\nCoba pakai salah satu:\n${resolved.alternatives.map(item => `• ${item}`).join("\n")}`
      );
    }

    if (wantsExisting && !resolved.found) {
      logFail(`ganti data natural gagal: key tidak ditemukan ${mutation.key}`);
      return reply(
        sock,
        msg,
        `❌ Data *${mutation.key}* belum ada, jadi aku belum berani menggantinya.\nKalau mau tambah baru, pakai: \`!ai catat bahwa ${mutation.key} adalah ${mutation.value}\``
      );
    }

    const keyToSave = resolved.found ? resolved.key : mutation.key;
    const oldValue = resolved.found ? resolved.value : null;

    setStoredFact(knowledgeScopeId, keyToSave, mutation.value, {
      updatedBy: senderNum || senderIds.join(", ") || "unknown",
      actorIds: senderIds,
      source: mutation.source === "ai" ? "ai-natural" : "heuristic",
      confidence: mutation.confidence
    });
    appendKnowledgeAudit({
      action: oldValue == null ? "data_set_ai" : "data_update_ai",
      actor: senderIds,
      scope: knowledgeScopeId,
      key: keyToSave,
      requestedKey: mutation.key,
      oldValue,
      value: mutation.value,
      source: mutation.source,
      confidence: mutation.confidence,
      rawInput: aiInput
    });

    logOk(`ai mutasi natural action=set key=${keyToSave}`);
    return reply(
      sock,
      msg,
      oldValue == null
        ? `✅ Data disimpan oleh *${senderNum || "-"}*${scopeSuffix}:\n*${keyToSave}* = ${mutation.value}`
        : `✅ Data diganti oleh *${senderNum || "-"}*${scopeSuffix}:\n*${keyToSave}*\nSebelumnya: ${oldValue}\nSekarang: ${mutation.value}`
    );
  }

  const featureRedirect = getFeatureRedirect(aiInput);
  if (featureRedirect) {
    logOk("ai redirect ke fitur bot");
    return reply(sock, msg, featureRedirect);
  }

  const scopedContext = buildFactsContext(knowledgeScopeId, aiInput, 8, 1200);
  const globalContext = knowledgeScopeId === "global"
    ? ""
    : buildFactsContext("global", aiInput, 5, 800);
  const knowledgeContext = [
    globalContext ? `Data global:\n${globalContext}` : "",
    scopedContext ? `Data scope ${formatScopeLabel(knowledgeScopeId)}:\n${scopedContext}` : ""
  ].filter(Boolean).join("\n\n");
  const { content, model, historySize, usedSearch } = await askAI(aiInput, conversationId, {
    knowledgeContext,
    enableSearch: true
  });
  const turns = Math.ceil(historySize / 2);

  const text = `
🤖 Model: *${model}*
🧠 Memory: *${turns} turn*
${usedSearch ? "🔍 Web Search: *aktif*" : ""}
━━━━━━━━━━━━━━━━━━
${content}
`.trim();

  logOk(`ai response model=${model}`);
  return reply(sock, msg, text);
  };
}
