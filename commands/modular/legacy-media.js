import { createLegacyMediaCommandExecutor } from "./legacy-media-runtime.js";
import { makeFailLogger, makeOkLogger } from "./logger.js";

export function createLegacyMediaCommands(deps) {
  const handleLegacyMediaCommand = createLegacyMediaCommandExecutor(deps);
  const logOk = makeOkLogger(deps.logCommandResult);
  const logFail = makeFailLogger(deps.logCommandResult);
  const executeLegacy = ctx =>
    handleLegacyMediaCommand({
      ...ctx,
      logOk: reason => logOk(ctx, reason),
      logFail: reason => logFail(ctx, reason)
    });

  return [
    {
      names: ["stiker", "sticker"],
      execute: async ctx => executeLegacy(ctx)
    },
    {
      names: ["toimg", "toimage"],
      execute: async ctx => executeLegacy(ctx)
    },
    {
      names: ["readviewonce", "readviewone", "rvo"],
      execute: async ctx => executeLegacy(ctx)
    },
    {
      names: ["ytsearch"],
      execute: async ctx => executeLegacy(ctx)
    },
    {
      names: ["musik", "ymusic"],
      execute: async ctx => executeLegacy(ctx)
    },
    {
      names: ["yta"],
      execute: async ctx => executeLegacy(ctx)
    },
    {
      names: ["yt"],
      execute: async ctx => executeLegacy(ctx)
    },
    {
      names: ["tt"],
      execute: async ctx => executeLegacy(ctx)
    },
    {
      names: ["ig"],
      execute: async ctx => executeLegacy(ctx)
    },
    {
      names: ["cuaca"],
      execute: async ctx => executeLegacy(ctx)
    },
    {
      names: ["gambar", "image"],
      execute: async ctx => executeLegacy(ctx)
    },
    {
      names: ["quote", "q"],
      execute: async ctx => executeLegacy(ctx)
    }
  ];
}
