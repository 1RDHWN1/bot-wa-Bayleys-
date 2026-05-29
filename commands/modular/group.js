import { makeOkLogger } from "./logger.js";

export function createGroupCommands(deps) {
  const { tagAll, tagAdmin, logCommandResult } = deps;
  const logOk = makeOkLogger(logCommandResult);

  return [
    {
      names: ["tagall"],
      execute: async ctx => {
        logOk(ctx, "tagall dipanggil");
        return tagAll(ctx.sock, ctx.msg, ctx.input);
      }
    },
    {
      names: ["tagadmin"],
      execute: async ctx => {
        logOk(ctx, "tagadmin dipanggil");
        return tagAdmin(ctx.sock, ctx.msg, ctx.input);
      }
    }
  ];
}
