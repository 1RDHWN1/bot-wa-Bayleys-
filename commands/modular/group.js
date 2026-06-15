import { makeOkLogger } from "./logger.js";

export function createGroupCommands(deps) {
  const { tagAll, tagAdmin, logCommandResult } = deps;
  const logOk = makeOkLogger(logCommandResult);

  return [
    {
      names: ["tagall"],
      category: "Group",
      description: "Tag semua anggota grup",
      usage: "!tagall <pesan>",
      execute: async ctx => {
        logOk(ctx, "tagall dipanggil");
        return deps.tagAll(ctx.sock, ctx.msg, ctx.input);
      }
    },
    {
      names: ["tagadmin"],
      category: "Group",
      description: "Tag admin grup",
      usage: "!tagadmin <pesan>",
      execute: async ctx => {
        logOk(ctx, "tagadmin dipanggil");
        return deps.tagAdmin(ctx.sock, ctx.msg, ctx.input);
      }
    }
  ];
}
