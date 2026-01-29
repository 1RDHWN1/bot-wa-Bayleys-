import axios from "axios";
import fs from "fs";
import path from "path"; // ✅ WAJIB
import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";



export async function tts(text) {
  const apiKey = process.env.ELEVEN_API_KEY;
  const voiceId = process.env.ELEVEN_VOICE_ID;

  if (!apiKey) throw new Error("ELEVEN_API_KEY belum diset");
  if (!voiceId) throw new Error("ELEVEN_VOICE_ID belum diset");

  const id = Date.now();
  const mp3Path = path.join(process.cwd(), `tts_${id}.mp3`);
  const oggPath = path.join(process.cwd(), `tts_${id}.ogg`);

  console.log("[TTS] ▶️ Start");
  console.log("[TTS] Voice ID :", voiceId);
  console.log("[TTS] Text len :", text.length);

  try {
    // 1️⃣ Request ke ElevenLabs
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

    console.log("[TTS] ✅ ElevenLabs OK");
    console.log("[TTS] Audio size:", res.data.length, "bytes");

    fs.writeFileSync(mp3Path, Buffer.from(res.data));

    // 2️⃣ Convert MP3 → OGG OPUS
    await new Promise((resolve, reject) => {
      ffmpeg(mp3Path)
        .audioCodec("libopus")
        .audioBitrate("64k")
        .format("ogg")
        .save(oggPath)
        .on("end", () => {
          console.log("[TTS] 🔄 Convert MP3 → OGG sukses");
          resolve();
        })
        .on("error", err => {
          console.error("[TTS] ❌ FFmpeg error:", err.message);
          reject(err);
        });
    });

    const oggBuffer = fs.readFileSync(oggPath);
    console.log("[TTS] 📦 Final OGG size:", oggBuffer.length, "bytes");

    return oggBuffer;

  } catch (err) {
    console.error("\n[TTS] ❌ ERROR TERJADI");

    if (err.response) {
      console.error("[TTS] HTTP STATUS :", err.response.status);
      console.error("[TTS] RESPONSE   :", JSON.stringify(
        err.response.data,
        null,
        2
      ));

      if (err.response.status === 402) {
        console.error("[TTS] 🔥 PENYEBAB: Quota habis / billing belum aktif");
      } else if (err.response.status === 401) {
        console.error("[TTS] 🔑 PENYEBAB: API key salah / revoked");
      } else if (err.response.status === 404) {
        console.error("[TTS] 🎙️ PENYEBAB: Voice ID tidak ditemukan");
      }
    } else if (err.code === "ECONNABORTED") {
      console.error("[TTS] ⏱️ Timeout ke ElevenLabs");
    } else {
      console.error("[TTS] ERROR :", err.message || err);
    }

    throw err;

  } finally {
    // Cleanup
    setTimeout(() => {
      try { fs.unlinkSync(mp3Path); } catch {}
      try { fs.unlinkSync(oggPath); } catch {}
      console.log("[TTS] 🧹 Cleanup selesai");
    }, 1500);
  }
}


// tts google
// import fs from "fs";
// import path from "path";
// import ffmpeg from "fluent-ffmpeg";
// import ffmpegPath from "ffmpeg-static";
// import gTTS from "gtts";

// ffmpeg.setFfmpegPath(ffmpegPath);

// function detectLang(text) {
//   // Simple & efektif
//   if (/[ぁ-んァ-ン]/.test(text)) return "ja"; // Jepang
//   if (/[一-龯]/.test(text)) return "zh";     // China
//   if (/[а-яА-Я]/.test(text)) return "ru";     // Rusia
//   if (/[áéíóúñ]/i.test(text)) return "es";    // Spanyol
//   return "id"; // default Indonesia
// }

// export async function tts(text) {
//   const lang = detectLang(text);

//   const id = Date.now();
//   const mp3Path = path.join(process.cwd(), `tts_${id}.mp3`);
//   const oggPath = path.join(process.cwd(), `tts_${id}.ogg`);

//   // 1️⃣ Google TTS → MP3
//   await new Promise((resolve, reject) => {
//     const gtts = new gTTS(text, lang);
//     gtts.save(mp3Path, err => {
//       if (err) reject(err);
//       else resolve();
//     });
//   });

//   // 2️⃣ MP3 → OGG OPUS (WA STANDARD)
//   await new Promise((resolve, reject) => {
//     ffmpeg(mp3Path)
//       .audioCodec("libopus")
//       .audioBitrate("64k")
//       .format("ogg")
//       .save(oggPath)
//       .on("end", resolve)
//       .on("error", reject);
//   });

//   const buffer = fs.readFileSync(oggPath);

//   // 3️⃣ Cleanup
//   setTimeout(() => {
//     try { fs.unlinkSync(mp3Path); } catch {}
//     try { fs.unlinkSync(oggPath); } catch {}
//   }, 1500);

//   return buffer;
// }
