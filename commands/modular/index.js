import { createSystemCommands } from "./system.js";
import { createAudioCommands } from "./audio.js";
import { createGroupCommands } from "./group.js";
import { createScheduleCommands } from "./schedule.js";
import { createAdminCommands } from "./admin.js";
import { createAICommands } from "./ai.js";
import { createLegacyMediaCommands } from "./legacy-media.js";
import { createGameCommands } from "./game.js";
import { createUtilityCommands } from "./utility.js";
import { createDownloaderReplyPassiveHandler } from "./passive/downloader-reply.js";
import { createAnonymousCommands } from "./anonymous-chat.js";
import { createAnonymousPassiveHandler } from "./passive/anonymous-chat-handler.js";

export function createModularCommands(deps) {
  return [
    ...createSystemCommands(deps),
    ...createAudioCommands(deps),
    ...createGroupCommands(deps),
    ...createScheduleCommands(deps),
    ...createAdminCommands(deps),
    ...createAICommands(deps),
    ...createGameCommands(deps),
    ...createLegacyMediaCommands(deps),
    ...createUtilityCommands(deps),
    ...createAnonymousCommands(deps)
  ];
}

export function createModularPassiveHandlers(deps) {
  return [
    createDownloaderReplyPassiveHandler(deps),
    createAnonymousPassiveHandler(deps)
  ];
}
