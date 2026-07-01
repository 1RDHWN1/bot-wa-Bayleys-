import { getContentType, downloadMediaMessage } from "@whiskeysockets/baileys";
import { anonState } from "../anonymous-chat.js";

export function createAnonymousPassiveHandler(deps) {
  const { logInfo, logWarn } = deps;

  return async function anonymousChatHandler(ctx) {
    const { sock, msg, sender, text } = ctx;

    // Abaikan pesan dari bot sendiri untuk mencegah infinite loop
    if (msg.key.fromMe) return false;

    // Abaikan jika pengirim tidak dalam obrolan
    if (!anonState.pairs.has(sender)) {
      return false; 
    }

    // Hindari meneruskan pesan command (dimulai dengan prefix misal '!')
    // Tapi karena kita ingin live chat mengesampingkan command lain selain stop/next,
    // kita perlu cek.
    const rawText = (text || "").trim();
    if (rawText.startsWith("!stop") || rawText.startsWith("!end") || rawText.startsWith("!leave") || rawText.startsWith("!next") || rawText.startsWith("!skip")) {
      // Biarkan router memproses command ini
      return false;
    }

    const partner = anonState.pairs.get(sender);
    
    // Ambil tipe pesan
    const type = getContentType(msg.message);
    
    try {
      if (type === "conversation" || type === "extendedTextMessage") {
        // Pesan teks biasa
        await sock.sendMessage(partner, { text: rawText });
      } else {
        // Media (gambar, stiker, audio, video, dokumen)
        // Fitur { forward: msg } bawaan sering bug atau bocor metadata pengirim asli,
        // jadi kita download dan re-upload medianya secara native.
        const isMedia = ["imageMessage", "videoMessage", "stickerMessage", "audioMessage", "documentMessage"].includes(type);
        
        if (isMedia) {
          const buffer = await downloadMediaMessage(
            msg, 
            "buffer", 
            {}, 
            { logger: sock.logger, reuploadRequest: sock.updateMediaMessage }
          );
          
          if (type === "imageMessage") {
            await sock.sendMessage(partner, { image: buffer, caption: msg.message.imageMessage?.caption || "" });
          } else if (type === "stickerMessage") {
            await sock.sendMessage(partner, { sticker: buffer });
          } else if (type === "videoMessage") {
            await sock.sendMessage(partner, { video: buffer, caption: msg.message.videoMessage?.caption || "", gifPlayback: msg.message.videoMessage?.gifPlayback });
          } else if (type === "audioMessage") {
            await sock.sendMessage(partner, { audio: buffer, ptt: msg.message.audioMessage?.ptt || false });
          } else if (type === "documentMessage") {
            await sock.sendMessage(partner, { document: buffer, mimetype: msg.message.documentMessage?.mimetype, fileName: msg.message.documentMessage?.fileName });
          }
        } else {
          // Fallback untuk tipe pesan aneh lainnya
          await sock.sendMessage(partner, { forward: msg });
        }
      }
      
      logInfo(`ANON-CHAT | Relayed message from ${sender.split("@")[0]} to ${partner.split("@")[0]}`);
      
      return true; 
    } catch (err) {
      logWarn(`ANON-CHAT | Failed to relay message: ${err.message}`);
      return false;
    }
  };
}
