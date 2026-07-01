import "dotenv/config";
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  Browsers,
  fetchLatestWaWebVersion
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
let reconnectTimer = null;

/* ===============================
   START BOT
================================ */
async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState("session");
  const { version, isLatest } = await fetchLatestWaWebVersion();

  const sock = makeWASocket({
    auth: state,
    logger: Pino({ level: "silent" }),
    browser: Browsers.macOS("Desktop"),
    version
  });

  console.log(
    `🔌 Memakai WA Web version ${version.join(".")} (${isLatest ? "latest" : "fallback"})`
  );

  sock.ev.on("creds.update", saveCreds);

  /* ===== PENGGUNAAN PAIRING CODE (BYPASS BLOKIR IP) ===== */
  if (!sock.authState.creds.registered) {
    console.log("Menunggu untuk request Pairing Code...");
    setTimeout(async () => {
      try {
        const readline = await import("readline");
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        rl.question("Masukkan nomor WA bot (contoh: 628123456789): ", async (phoneNumber) => {
          rl.close();
          phoneNumber = phoneNumber.replace(/[^0-9]/g, "");
          const code = await sock.requestPairingCode(phoneNumber);
          console.log(`\n=======================================\nKODE PAIRING ANDA: ${code}\nMasukkan kode ini di menu Tautkan Perangkat di HP Anda!\n=======================================\n`);
        });
      } catch (err) {
        console.error("Gagal request pairing code:", err);
      }
    }, 3000);
  }

  /* ===== CONNECTION & QR ===== */
  sock.ev.on("connection.update", ({ connection, lastDisconnect }) => {
    if (connection === "open") {
      console.log("✅ Bot Baileys terhubung");
    }

    if (connection === "close") {
      const code = lastDisconnect?.error?.output?.statusCode;
      const reason = lastDisconnect?.error?.message || "unknown";
      console.log(`❌ Koneksi terputus: ${code} (${reason})`);

      if (code !== DisconnectReason.loggedOut) {
        if (reconnectTimer) clearTimeout(reconnectTimer);

        if (code === 405) {
          console.log("⚠️ 405 biasanya karena koneksi WS ditolak (version/browser/jaringan).");
        }

        console.log("🔄 Reconnecting dalam 4 detik...");
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          startBot();
        }, 4000);
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
