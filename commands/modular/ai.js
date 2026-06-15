import { createAICommandExecutor } from "./ai-runtime.js";
import { makeFailLogger, makeOkLogger } from "./logger.js";

export function createAICommands(deps) {
  const handleAICommand = createAICommandExecutor(deps);
  const logOk = makeOkLogger(deps.logCommandResult);
  const logFail = makeFailLogger(deps.logCommandResult);

  return [
    {
      names: ["ai"],
      category: "AI",
      description: "Chat dengan AI (memory + knowledge + context chat)",
      usage: "!ai <pertanyaan> | !ai reset",
      execute: async ctx =>
        handleAICommand({
          ...ctx,
          logOk: reason => logOk(ctx, reason),
          logFail: reason => logFail(ctx, reason)
        })
    }
  ];
}
