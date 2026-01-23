import axios from "axios";
import fs from "fs";
import path from "path";
import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";

ffmpeg.setFfmpegPath(ffmpegPath);

export async function tts(text) {
  const apiKey = process.env.ELEVEN_API_KEY;
  const voiceId = process.env.ELEVEN_VOICE_ID;

  if (!apiKey) throw new Error("ELEVEN_API_KEY belum diset");
  if (!voiceId) throw new Error("ELEVEN_VOICE_ID belum diset");

  const id = Date.now();
  const mp3Path = path.join(process.cwd(), `tts_${id}.mp3`);
  const oggPath = path.join(process.cwd(), `tts_${id}.ogg`);

  try {
    // 1️⃣ ElevenLabs → MP3
    const res = await axios.post(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
      {
        text,
        voice_settings: {
          stability: 0.4,
          similarity_boost: 0.7
        }
      },
      {
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
          "Accept": "audio/mpeg"
        },
        responseType: "arraybuffer",
        timeout: 30_000
      }
    );

    fs.writeFileSync(mp3Path, Buffer.from(res.data));

    // 2️⃣ Convert MP3 → OGG OPUS
    await new Promise((resolve, reject) => {
      ffmpeg(mp3Path)
        .audioCodec("libopus")
        .audioBitrate("64k")
        .format("ogg")
        .save(oggPath)
        .on("end", resolve)
        .on("error", reject);
    });

    const oggBuffer = fs.readFileSync(oggPath);

    return oggBuffer;

  } finally {
    setTimeout(() => {
      try { fs.unlinkSync(mp3Path); } catch {}
      try { fs.unlinkSync(oggPath); } catch {}
    }, 1500);
  }
}
