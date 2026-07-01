import makeWASocket, { useMultiFileAuthState, Browsers } from "@whiskeysockets/baileys";
import Pino from "pino";

async function test() {
  const { state, saveCreds } = await useMultiFileAuthState("test_session");
  const sock = makeWASocket({
    auth: state,
    logger: Pino({ level: "trace" }), // to see exactly why it drops
    browser: Browsers.ubuntu("Chrome"),
    version: [2, 3000, 1042470511],
    printQRInTerminal: true,
  });
  
  sock.ev.on("connection.update", (update) => {
    console.log("UPDATE:", update);
  });
}
test();
