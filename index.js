import "dotenv/config";
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason
} from "@whiskeysockets/baileys";
import Pino from "pino";
import qrcode from "qrcode-terminal";
import handler from "./handler.js";

/* ===============================
   GLOBAL
================================ */
global.stats = {
  private: new Set(),
  group: new Set()
};
global.startTime = Date.now();

/* ===============================
   START BOT
================================ */
async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState("session");

  const sock = makeWASocket({
    auth: state,
    logger: Pino({ level: "silent" }),
    browser: ["Bot-WA", "Chrome", "1.0.0"]
  });

  sock.ev.on("creds.update", saveCreds);

  /* ===== CONNECTION & QR ===== */
  sock.ev.on("connection.update", ({ connection, qr, lastDisconnect }) => {
    if (qr) {
      console.log("\n📲 Scan QR ini:");
      qrcode.generate(qr, { small: true });
    }

    if (connection === "open") {
      console.log("✅ Bot Baileys terhubung");
    }

    if (connection === "close") {
      const code = lastDisconnect?.error?.output?.statusCode;
      console.log("❌ Koneksi terputus:", code);

      if (code !== DisconnectReason.loggedOut) {
        console.log("🔄 Reconnecting...");
        startBot();
      } else {
        console.log("🚪 Logged out. Hapus folder session lalu scan ulang.");
      }
    }
  });

  /* ===== MESSAGE HANDLER ===== */
  sock.ev.on("messages.upsert", async ({ messages }) => {
    const msg = messages?.[0];
    if (!msg?.message) return;

    const jid = msg.key.remoteJid;

    if (jid.endsWith("@g.us")) {
      global.stats.group.add(jid);
    } else {
      global.stats.private.add(jid);
    }

    try {
      await handler(sock, msg);
    } catch (err) {
      console.error("HANDLER ERROR:", err);
    }
  });
}

startBot();
