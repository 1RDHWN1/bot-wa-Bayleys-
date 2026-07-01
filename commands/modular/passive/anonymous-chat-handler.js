import { getContentType, downloadMediaMessage, generateMessageID } from "@whiskeysockets/baileys";
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
    let actualMsg = msg.message;
    let type = getContentType(actualMsg);
    
    // Buka bungkusan pesan sementara (disappearing messages) jika ada
    if (type === "ephemeralMessage") {
      actualMsg = actualMsg.ephemeralMessage.message;
      type = getContentType(actualMsg);
    }
    
    try {
      if (type === "conversation" || type === "extendedTextMessage") {
        // Pesan teks biasa
        const textToRelay = actualMsg?.conversation || actualMsg?.extendedTextMessage?.text || rawText;
        await sock.sendMessage(partner, { text: textToRelay });
      } else {
        // Cek apakah pesan adalah viewOnce (sekali lihat)
        let isViewOnce = false;
        let innerType = type;
        let innerMsg = actualMsg;
        
        if (type === "viewOnceMessage" || type === "viewOnceMessageV2" || type === "viewOnceMessageV2Extension") {
          isViewOnce = true;
          innerMsg = actualMsg[type].message;
          innerType = getContentType(innerMsg);
        }

        // Cek media dari innerType
        const isMedia = ["imageMessage", "videoMessage", "stickerMessage", "audioMessage", "documentMessage", "ptvMessage"].includes(innerType);
        
        // Deteksi viewOnce alternatif (kadangkala viewOnce disematkan langsung di dalam imageMessage)
        if (isMedia && !isViewOnce) {
          if (innerMsg[innerType]?.viewOnce) {
            isViewOnce = true;
          }
        }
        
        if (isMedia) {
          if (isViewOnce) {
            // WORKAROUND UNTUK VIEWONCE V2:
            // 1. Kirim media ke nomor bot sendiri agar Baileys mengunggahnya & membuat kunci kriptografi (mediaKey dll)
            const botJid = sock.user.id.split(":")[0] + "@s.whatsapp.net";
            const sendOptions = {};
            
            if (innerType === "imageMessage") {
              sendOptions.image = buffer;
              sendOptions.caption = innerMsg.imageMessage?.caption || "";
            } else if (innerType === "videoMessage") {
              sendOptions.video = buffer;
              sendOptions.caption = innerMsg.videoMessage?.caption || "";
              sendOptions.gifPlayback = innerMsg.videoMessage?.gifPlayback;
            } else if (innerType === "ptvMessage") {
              sendOptions.video = buffer;
              sendOptions.ptv = true;
            } else if (innerType === "audioMessage") {
              sendOptions.audio = buffer;
              sendOptions.ptt = innerMsg.audioMessage?.ptt || false;
            } else {
              sendOptions.document = buffer;
            }
            
            logInfo(`ANON-CHAT | [ViewOnce] Uploading media to bot's own number (${botJid})...`);
            const sentToSelf = await sock.sendMessage(botJid, sendOptions);
            
            // 2. Ekstrak pesan media mentah yang sudah terunggah dari hasil kiriman tadi
            // (sock.sendMessage terkadang membungkus pesan dalam ephemeralMessage jika mode sementara aktif)
            const selfMsg = sentToSelf.message;
            logInfo(`ANON-CHAT | [ViewOnce] Message uploaded. selfMsg keys: ${Object.keys(selfMsg || {}).join(", ")}`);
            
            const uploadedMediaMsg = selfMsg?.[innerType] || selfMsg?.ephemeralMessage?.message?.[innerType] || selfMsg?.viewOnceMessage?.message?.[innerType];
            
            if (uploadedMediaMsg) {
              logInfo(`ANON-CHAT | [ViewOnce] Media extracted successfully. Relaying to ${partner}...`);
              const mediaContent = { ...uploadedMediaMsg };
              delete mediaContent.contextInfo; // Bersihkan metadata
              
              // 3. Bungkus dengan viewOnceMessageV2 (format baru WhatsApp) dan teruskan ke pasangan
              const relayId = generateMessageID();
              await sock.relayMessage(partner, {
                viewOnceMessageV2: {
                  message: {
                    [innerType]: mediaContent
                  }
                }
              }, { messageId: relayId });
              logInfo(`ANON-CHAT | [ViewOnce] Relayed successfully with ID: ${relayId}`);
            } else {
              logWarn(`ANON-CHAT | [ViewOnce] FAILED to extract media! selfMsg: ${JSON.stringify(selfMsg)}`);
            }
          } else {
            // Selalu teruskan msg asli agar fungsi decrypt downloadMediaMessage tidak error (kehilangan konteks kriptografi)
            const buffer = await downloadMediaMessage(
              msg, 
              "buffer", 
              {}, 
              { logger: sock.logger, reuploadRequest: sock.updateMediaMessage }
            );
            
            if (innerType === "imageMessage") {
              await sock.sendMessage(partner, { image: buffer, caption: innerMsg.imageMessage?.caption || "" });
            } else if (innerType === "stickerMessage") {
              await sock.sendMessage(partner, { sticker: buffer });
            } else if (innerType === "videoMessage") {
              await sock.sendMessage(partner, { video: buffer, caption: innerMsg.videoMessage?.caption || "", gifPlayback: innerMsg.videoMessage?.gifPlayback });
            } else if (innerType === "ptvMessage") {
              await sock.sendMessage(partner, { video: buffer, ptv: true }); // Video Note (bulat)
            } else if (innerType === "audioMessage") {
              await sock.sendMessage(partner, { audio: buffer, ptt: innerMsg.audioMessage?.ptt || false }); // VN
            } else if (innerType === "documentMessage") {
              await sock.sendMessage(partner, { document: buffer, mimetype: innerMsg.documentMessage?.mimetype, fileName: innerMsg.documentMessage?.fileName });
            }
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
