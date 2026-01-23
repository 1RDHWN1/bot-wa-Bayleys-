import sharp from "sharp";
import { exec } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";

function execPromise(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

export async function makeSticker(buffer, isVideo = false) {
  const tmp = path.join(os.tmpdir(), `stk-${Date.now()}`);

  // ======================
  // IMAGE → WEBP STICKER
  // ======================
  if (!isVideo) {
    const png = await sharp(buffer).png().toBuffer();
    return await sharp(png)
      .resize(512, 512, { fit: "inside" })
      .webp({ quality: 80 })
      .toBuffer();
  }

  // ======================
  // VIDEO → ANIMATED WEBP
  // ======================
  const mp4 = `${tmp}.mp4`;
  const webp = `${tmp}.webp`;

  fs.writeFileSync(mp4, buffer);

  // ffmpeg convert (WA sticker standard)
await execPromise(
  `ffmpeg -y -i "${mp4}" ` +
  `-vf "setsar=1,fps=10,scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=black" ` +
  `-loop 0 -t 8 -an ` +
  `-vcodec libwebp -lossless 0 -quality 60 -compression_level 6 -method 4 ` +
  `"${webp}"`
);


  const webpBuffer = fs.readFileSync(webp);

  // cleanup
  fs.unlinkSync(mp4);
  fs.unlinkSync(webp);

  return webpBuffer;
}
