export function createReplyHelper(footerText) {
  function addFooter(text) {
    if (typeof text !== "string" || !text.trim()) return text;
    if (text.includes(footerText)) return text;
    return `${text}\n\n${footerText}`;
  }

  // Sanitize markdown to WhatsApp-compatible formatting
  function sanitizeForWhatsApp(text) {
    if (typeof text !== "string") return text;
    
    return text
      // **bold** → *bold*
      .replace(/\*\*(.+?)\*\*/g, '*$1*')
      // ~~strikethrough~~ → ~strikethrough~
      .replace(/~~(.+?)~~/g, '~$1~')
      // ### header → *header*
      .replace(/^###\s+(.+)$/gm, '*$1*')
      // ## header → *header*
      .replace(/^##\s+(.+)$/gm, '*$1*')
      // # header → *header*
      .replace(/^#\s+(.+)$/gm, '*$1*')
      // - bullet → • bullet
      .replace(/^-\s+(.+)$/gm, '• $1')
      // * bullet → • bullet (keep as is)
      // `code` → `code` (keep as is)
      // > quote → > quote (keep as is)
      // | tabel | markdown | → convert to key: value lines
      .replace(/\|([^|]+)\|([^|]+)\|/g, (match, ...parts) => {
        const cells = parts.slice(0, -1).map(c => c.trim()).filter(Boolean);
        if (cells.length >= 2) {
          return cells.map((c, i) => i % 2 === 0 ? `*${c}*` : c).join(': ');
        }
        return match;
      })
      // Clean up multiple blank lines
      .replace(/\n{3,}/g, '\n\n');
  }

  function addFooter(text) {
    if (typeof text !== "string" || !text.trim()) return text;
    if (text.includes(footerText)) return text;
    return `${text}\n\n${footerText}`;
  }

  return function reply(sock, msg, payload) {
    const jid = msg.key.remoteJid;
    const content = typeof payload === "string" ? { text: payload } : { ...payload };

    if (typeof content.text === "string") {
      content.text = addFooter(sanitizeForWhatsApp(content.text));
    }

    if (typeof content.caption === "string") {
      content.caption = addFooter(sanitizeForWhatsApp(content.caption));
    }

    return sock.sendMessage(jid, content, { quoted: msg });
  };
}
