const BOT_FOOTER = "> *pesan otomatis dari bot*";

function addBotFooter(text) {
  if (typeof text !== "string" || !text.trim()) return text;
  if (text.includes(BOT_FOOTER)) return text;
  return `${text}\n\n${BOT_FOOTER}`;
}

function sendWithFooter(sock, jid, payload) {
  const content = { ...payload };

  if (typeof content.text === "string") {
    content.text = addBotFooter(content.text);
  }

  if (typeof content.caption === "string") {
    content.caption = addBotFooter(content.caption);
  }

  return sock.sendMessage(jid, content);
}

export async function tagAll(sock, msg, text) {
  const jid = msg.key.remoteJid;

  if (!jid.endsWith("@g.us")) {
    return sendWithFooter(sock, jid, {
      text: "❌ Perintah ini hanya bisa digunakan di grup."
    });
  }

  try {
    const meta = await sock.groupMetadata(jid);
    const participants = meta.participants;

    const senderJid = msg.key.participant || msg.key.remoteJid;
    const senderTag = `@${senderJid.split("@")[0]}`;

    const mentions = [
      senderJid,
      ...participants.map(p => p.id)
    ];

    const total = participants.length;

    const messageText = `
👥 *Pesan dari:* ${senderTag}
🔔 *Pesan:* ${text || "-"}

_Sorry for the tag._
_Menandai semua anggota grup (${total} orang)_
`.trim();

    return sendWithFooter(sock, jid, {
      text: messageText,
      mentions
    });
  } catch (err) {
    console.error("❌ tagAll error:", err);
    return sendWithFooter(sock, jid, {
      text: "❌ Gagal menandai anggota grup."
    });
  }
}


export async function tagAdmin(sock, msg, text) {
  const jid = msg.key.remoteJid;

  if (!jid.endsWith("@g.us")) {
    return sendWithFooter(sock, jid, {
      text: "❌ Perintah ini hanya bisa digunakan di grup."
    });
  }

  try {
    const meta = await sock.groupMetadata(jid);

    const admins = meta.participants
      .filter(p => p.admin)
      .map(p => p.id);

    const senderJid = msg.key.participant || msg.key.remoteJid;
    const senderTag = `@${senderJid.split("@")[0]}`;

    const mentions = [
      senderJid,
      ...admins
    ];

    const messageText = `
👮 *Pesan admin dari:* ${senderTag}
🔔 *Pesan:* ${text || "-"}

_Menandai admin grup (${admins.length} orang)_
`.trim();

    return sendWithFooter(sock, jid, {
      text: messageText,
      mentions
    });
  } catch (err) {
    console.error("❌ tagAdmin error:", err);
    return sendWithFooter(sock, jid, {
      text: "❌ Gagal menandai admin."
    });
  }
}

