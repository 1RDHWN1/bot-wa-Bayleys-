import axios from "axios";
import fs from "fs";
import path from "path";
import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";

ffmpeg.setFfmpegPath(ffmpegPath);

export async function tts(text) {
  if (!text || !text.trim()) {
    throw new Error("Teks TTS kosong");
  }

  const apiKey = process.env.ELEVEN_API_KEY;
  const voiceId = process.env.ELEVEN_VOICE_ID;

  if (!apiKey) throw new Error("ELEVEN_API_KEY belum diset");
  if (!voiceId) throw new Error("ELEVEN_VOICE_ID belum diset");

  // 📁 Pakai tmp directory (AMAN di Railway)
  const tmpDir = path.join(process.cwd(), "tmp");
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir);

  const id = Date.now();
  const mp3Path = path.join(tmpDir, `tts_${id}.mp3`);
  const oggPath = path.join(tmpDir, `tts_${id}.ogg`);

  try {
    // 1️⃣ Request ke ElevenLabs
    const res = await axios.post(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
      {
        text,
        model_id: "eleven_multilingual_v2",
        voice_settings: {
          stability: 0.6,
          similarity_boost: 0.8
        }
      },
      {
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
          Accept: "audio/mpeg"
        },
        responseType: "arraybuffer",
        timeout: 20000
      }
    );

    // ❌ Jika API balas JSON error
    const contentType = res.headers["content-type"] || "";
    if (!contentType.includes("audio")) {
      throw new Error(res.data.toString());
    }

    fs.writeFileSync(mp3Path, Buffer.from(res.data));

    // 2️⃣ Convert MP3 ➜ OGG OPUS (WA Friendly)
    await new Promise((resolve, reject) => {
      ffmpeg(mp3Path)
        .audioCodec("libopus")
        .audioBitrate("64k")
        .audioFrequency(48000)
        .format("ogg")
        .on("end", resolve)
        .on("error", reject)
        .save(oggPath);
    });

    const oggBuffer = fs.readFileSync(oggPath);
    return oggBuffer;

  } finally {
    // 3️⃣ Cleanup AMAN
    setTimeout(() => {
      try { fs.unlinkSync(mp3Path); } catch {}
      try { fs.unlinkSync(oggPath); } catch {}
    }, 1000);
  }
}