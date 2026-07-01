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
    const rawText = (text || "").trim();
    if (rawText.startsWith("!stop") || rawText.startsWith("!end") || rawText.startsWith("!leave") || rawText.startsWith("!next") || rawText.startsWith("!skip")) {
      return false;
    }

    const partner = anonState.pairs.get(sender);
    const type = getContentType(msg.message);
    
    try {
      if (type === "conversation" || type === "extendedTextMessage") {
        // Pesan teks biasa
        await sock.sendMessage(partner, { text: rawText });
      } else {
        // Cek apakah pesan adalah viewOnce (sekali lihat)
        let isViewOnce = false;
        let innerType = type;
        let innerMsg = msg.message;
        
        if (type === "viewOnceMessage" || type === "viewOnceMessageV2" || type === "viewOnceMessageV2Extension") {
          isViewOnce = true;
          innerMsg = msg.message[type].message;
          innerType = getContentType(innerMsg);
        }

        // Cek media dari innerType (apabila viewOnce, maka innerType adalah imageMessage/videoMessage dll)
        const isMedia = ["imageMessage", "videoMessage", "stickerMessage", "audioMessage", "documentMessage"].includes(innerType);
        
        if (isMedia) {
          // Buat format msg tiruan agar downloadMediaMessage dapat mengekstrak media dengan benar
          const downloadMsg = isViewOnce ? { key: msg.key, message: innerMsg } : msg;
          
          const buffer = await downloadMediaMessage(
            downloadMsg, 
            "buffer", 
            {}, 
            { logger: sock.logger, reuploadRequest: sock.updateMediaMessage }
          );
          
          if (innerType === "imageMessage") {
            await sock.sendMessage(partner, { image: buffer, caption: innerMsg.imageMessage?.caption || "", viewOnce: isViewOnce });
          } else if (innerType === "stickerMessage") {
            await sock.sendMessage(partner, { sticker: buffer }); // Stiker tidak ada viewOnce
          } else if (innerType === "videoMessage") {
            await sock.sendMessage(partner, { video: buffer, caption: innerMsg.videoMessage?.caption || "", gifPlayback: innerMsg.videoMessage?.gifPlayback, viewOnce: isViewOnce });
          } else if (innerType === "audioMessage") {
            await sock.sendMessage(partner, { audio: buffer, ptt: innerMsg.audioMessage?.ptt || false }); // VN bisa dikirim biasa
          } else if (innerType === "documentMessage") {
            await sock.sendMessage(partner, { document: buffer, mimetype: innerMsg.documentMessage?.mimetype, fileName: innerMsg.documentMessage?.fileName });
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
