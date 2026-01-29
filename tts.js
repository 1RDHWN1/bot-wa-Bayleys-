// tts google
import fs from "fs";
import path from "path";
import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";
import gTTS from "gtts";

ffmpeg.setFfmpegPath(ffmpegPath);

function detectLang(text) {
  // Simple & efektif
  if (/[ぁ-んァ-ン]/.test(text)) return "ja"; // Jepang
  if (/[一-龯]/.test(text)) return "zh";     // China
  if (/[а-яА-Я]/.test(text)) return "ru";     // Rusia
  if (/[áéíóúñ]/i.test(text)) return "es";    // Spanyol
  return "id"; // default Indonesia
}

export async function tts(text) {
  const lang = detectLang(text);

  const id = Date.now();
  const mp3Path = path.join(process.cwd(), `tts_${id}.mp3`);
  const oggPath = path.join(process.cwd(), `tts_${id}.ogg`);

  // 1️⃣ Google TTS → MP3
  await new Promise((resolve, reject) => {
    const gtts = new gTTS(text, lang);
    gtts.save(mp3Path, err => {
      if (err) reject(err);
      else resolve();
    });
  });

  // 2️⃣ MP3 → OGG OPUS (WA STANDARD)
  await new Promise((resolve, reject) => {
    ffmpeg(mp3Path)
      .audioCodec("libopus")
      .audioBitrate("64k")
      .format("ogg")
      .save(oggPath)
      .on("end", resolve)
      .on("error", reject);
  });

  const buffer = fs.readFileSync(oggPath);

  // 3️⃣ Cleanup
  setTimeout(() => {
    try { fs.unlinkSync(mp3Path); } catch {}
    try { fs.unlinkSync(oggPath); } catch {}
  }, 1500);

  return buffer;
}
