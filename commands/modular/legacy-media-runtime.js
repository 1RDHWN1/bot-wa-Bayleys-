import { handleMediaCommands } from "./legacy-media-media.js";
import { handleDownloaderCommands } from "./legacy-media-downloader.js";
import { handleWeatherAndImageCommands } from "./legacy-media-weather-image.js";

export function createLegacyMediaCommandExecutor(deps) {
  return async function handleLegacyMediaCommand(ctx) {
    if (await handleMediaCommands(ctx, deps)) return true;
    if (await handleDownloaderCommands(ctx, deps)) return true;
    if (await handleWeatherAndImageCommands(ctx, deps)) return true;
    return false;
  };
}
