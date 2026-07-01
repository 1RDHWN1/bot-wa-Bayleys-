import { getContentType } from "@whiskeysockets/baileys";
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
        // Kita gunakan fitur forward bawaan agar tidak perlu download-upload ulang
        await sock.sendMessage(partner, { forward: msg });
      }
      
      logInfo(`ANON-CHAT | Relayed message from ${sender.split("@")[0]} to ${partner.split("@")[0]}`);
      
      // Mengembalikan true berarti pesan ini sudah di-handle sepenuhnya, 
      // router tidak perlu mengecek prefix/command lagi untuk pesan ini.
      return true; 
    } catch (err) {
      logWarn(`ANON-CHAT | Failed to relay message: ${err.message}`);
      return false;
    }
  };
}
