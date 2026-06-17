import { createAICommandExecutor } from "./ai-runtime.js";
import { makeFailLogger, makeOkLogger } from "./logger.js";

export function createAICommands(deps) {
  const handleAICommand = createAICommandExecutor(deps);
  const logOk = makeOkLogger(deps.logCommandResult);
  const logFail = makeFailLogger(deps.logCommandResult);

  return [
    {
      names: ["ai"],
      category: "AI",
      description: "Chat dengan AI (memory + knowledge + context chat)",
      usage: "!ai <pertanyaan> | !ai reset",
      subCommands: [
        { names: ["ai <pertanyaan>"], description: "Tanya AI dengan memory dan knowledge" },
        { names: ["ai reset"], description: "Hapus memory percakapan AI" },
        { names: ["ai simpan <kunci>=<nilai>"], description: "Simpan data natural (owner/editor)" },
        { names: ["ai simpen data <kunci> adalah <nilai>"], description: "Simpan data natural bahasa Indonesia" },
        { names: ["ai catat bahwa <kunci> adalah <nilai>"], description: "Alias simpan data" },
        { names: ["ai ganti data <kunci> jadi <nilai>"], description: "Ganti/update data (owner/editor)" },
        { names: ["ai ubahin data <kunci> jadi <nilai>"], description: "Alias ganti data" },
        { names: ["ai hapus <kunci>"], description: "Hapus data tersimpan (owner/editor)" },
        { names: ["ai apusin data <kunci>"], description: "Alias hapus data" },
        { names: ["ai data list"], description: "Lihat semua data tersimpan" },
        { names: ["ai data <kunci>"], description: "Ambil data tertentu" },
        { names: ["ai data log"], description: "Lihat riwayat perubahan semua data" },
        { names: ["ai data log <kunci>"], description: "Lihat riwayat perubahan data tertentu" },
        { names: ["ai data export"], description: "Export data scope saat ini jadi file JSON" },
        { names: ["ai data export txt"], description: "Export data scope jadi file TXT" },
        { names: ["ai import data"], description: "Import data dari file .txt/.json (preview dulu)" },
        { names: ["ai ya"], description: "Konfirmasi import data" },
        { names: ["ai batal"], description: "Batalkan import data" },
        { names: ["ai scope"], description: "Lihat scope data chat ini (owner)" },
        { names: ["ai grup list"], description: "Kirim file daftar scope semua grup (owner)" },
        { names: ["ai grup cari <nama>"], description: "Cari scope grup berdasarkan nama (owner)" },
        { names: ["ai alias <nama> = group:<jid>"], description: "Buat alias scope grup (owner)" },
        { names: ["ai alias list"], description: "Lihat daftar alias (owner)" },
        { names: ["ai alias hapus <nama>"], description: "Hapus alias (owner)" },
        { names: ["ai untuk group:<jid> data list"], description: "Lihat data grup lain (owner)" },
        { names: ["ai untuk group:<jid> simpen data <kunci> = <nilai>"], description: "Simpan data ke grup lain (owner)" },
        { names: ["ai untuk @alias gantiin data <kunci> jadi <nilai>"], description: "Ganti data grup via alias (owner)" },
        { names: ["ai global simpen data <kunci> = <nilai>"], description: "Simpan data global (owner)" },
        { names: ["ai global data list"], description: "Lihat data global (owner)" },
        { names: ["ai data backup all"], description: "Backup semua knowledge ke file JSON (owner)" },
        { names: ["ai editor list"], description: "Lihat daftar editor data" },
        { names: ["ai editor id"], description: "Lihat ID kamu (untuk didaftarkan owner)" },
        { names: ["ai editor add <nomor>"], description: "Tambah editor (owner only)" },
        { names: ["ai editor del <nomor>"], description: "Hapus editor (owner only)" },
        { names: ["ai editor clear"], description: "Hapus semua editor tambahan (owner only)" }
      ],
      execute: async ctx =>
        handleAICommand({
          ...ctx,
          logOk: reason => logOk(ctx, reason),
          logFail: reason => logFail(ctx, reason)
        })
    }
  ];
}
