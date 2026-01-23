export async function tagAll(sock, msg, text) {
  const jid = msg.key.remoteJid;

  if (!jid.endsWith("@g.us")) {
    return sock.sendMessage(jid, {
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

    return sock.sendMessage(jid, {
      text: messageText,
      mentions
    });
  } catch (err) {
    console.error("❌ tagAll error:", err);
    return sock.sendMessage(jid, {
      text: "❌ Gagal menandai anggota grup."
    });
  }
}


export async function tagAdmin(sock, msg, text) {
  const jid = msg.key.remoteJid;

  if (!jid.endsWith("@g.us")) {
    return sock.sendMessage(jid, {
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

    return sock.sendMessage(jid, {
      text: messageText,
      mentions
    });
  } catch (err) {
    console.error("❌ tagAdmin error:", err);
    return sock.sendMessage(jid, {
      text: "❌ Gagal menandai admin."
    });
  }
}

