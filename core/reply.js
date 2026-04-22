export function createReplyHelper(footerText) {
  function addFooter(text) {
    if (typeof text !== "string" || !text.trim()) return text;
    if (text.includes(footerText)) return text;
    return `${text}\n\n${footerText}`;
  }

  return function reply(sock, msg, payload) {
    const jid = msg.key.remoteJid;
    const content = typeof payload === "string" ? { text: payload } : { ...payload };

    if (typeof content.text === "string") {
      content.text = addFooter(content.text);
    }

    if (typeof content.caption === "string") {
      content.caption = addFooter(content.caption);
    }

    return sock.sendMessage(jid, content, { quoted: msg });
  };
}

