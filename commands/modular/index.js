import { createSystemCommands } from "./system.js";
import { createAudioCommands } from "./audio.js";
import { createGroupCommands } from "./group.js";
import { createScheduleCommands } from "./schedule.js";
import { createAdminCommands } from "./admin.js";
import { createAICommands } from "./ai.js";
import { createLegacyMediaCommands } from "./legacy-media.js";
import { createGameCommands } from "./game.js";
import { createDownloaderReplyPassiveHandler } from "./passive/downloader-reply.js";

export function createModularCommands(deps) {
  return [
    ...createSystemCommands(deps),
    ...createAudioCommands(deps),
    ...createGroupCommands(deps),
    ...createScheduleCommands(deps),
    ...createAdminCommands(deps),
    ...createAICommands(deps),
    ...createGameCommands(deps),
    ...createLegacyMediaCommands(deps)
  ];
}

export function createModularPassiveHandlers(deps) {
  return [
    createDownloaderReplyPassiveHandler(deps)
  ];
}
