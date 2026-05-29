# Bot Architecture (Current + Next Step)

## Current state
- `handler.js`: command dispatch utama sudah via `core/router.js`; fallback chain lama sudah dibersihkan.
  - teks non-prefix juga diteruskan ke router untuk passive handler (contoh: reply angka downloader).
- `core/runtime-toolkit.js`: runtime infra dipusatkan:
  - command metrics + log result
  - rate limiter
  - downloader queue
  - image search queue
  - pruning cache/stat periodik
- `ai.js`: facade compatibility untuk import lama.
- `ai/`: modul AI yang sudah dipisah.
- `commands/modular/*`: domain command modular yang aktif dipakai router.

## Modular commands (active)
- `commands/modular/system.js`:
  - `help/menu`
  - `ping/status`
  - `antrian/queue`
  - `stats`
- `commands/modular/audio.js`:
  - `suara`
- `commands/modular/group.js`:
  - `tagall`
  - `tagadmin`
- `commands/modular/schedule.js`:
  - `jadwal`
- `commands/modular/admin.js`:
  - `maintenance`
  - `hapus`
- `commands/modular/ai.js`:
  - `ai` (eksekusi didelegasikan ke `commands/modular/ai-runtime.js`)
- `commands/modular/game.js`:
  - `spin` (hybrid anime gacha: local seed + API cache)
    - sync bertahap paginated (`top/full`) dengan resume page di cache lokal
    - hasil spin kirim gambar karakter jika tersedia
  - `koleksi/collection/karakterku`
- `commands/modular/legacy-media.js`:
  - `stiker/sticker`, `toimg/toimage`, `readviewonce/readviewone/rvo`
  - `ytsearch`, `musik/ymusic`, `yta`, `yt`, `tt`, `ig`
  - `cuaca`, `gambar/image`, `quote/q`
  - eksekusi didelegasikan ke `commands/modular/legacy-media-runtime.js`
- `commands/modular/legacy-media-runtime.js`:
  - komposer command domain:
    - `legacy-media-media.js`
    - `legacy-media-downloader.js`
    - `legacy-media-weather-image.js`
- `commands/modular/passive/downloader-reply.js`:
  - passive handler reply angka tanpa prefix:
    - pilihan `!yt` (balas `1`/`2`)
    - pick hasil `!ytsearch`/`!musik` (balas `1-5`)
- `commands/modular/logger.js`:
  - helper `makeOkLogger` / `makeFailLogger` untuk semua modul command.

## AI modules
- `ai/config.js`: konstanta, env parsing, waktu lokal.
- `ai/client.js`: HTTP client ke OpenRouter.
- `ai/intent.js`: intent matching untuk redirect ke command bot.
- `ai/knowledge.js`: deteksi mutasi knowledge + ekstraksi natural language.
- `ai/memory.js`: session memory + summarization.
- `ai/prompt.js`: system prompt builder.
- `ai/service.js`: orkestrasi `askAI`.
- `ai/index.js`: public API AI.

## Smoke test
- File: `tests/modular-smoke.test.mjs`
- Cakupan command kunci:
  - `menu`, `ping`, `ai`, `suara`, `jadwal`, `stiker`, `cuaca`, `ytsearch`
  - plus flow numerik downloader: `!yt -> 1/2` dan `!ytsearch -> 1-5`
- Jalankan:
  - `npm test`
  - atau `npm run test:smoke`
