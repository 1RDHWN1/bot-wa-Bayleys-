export function makeOkLogger(logCommandResult) {
  return (ctx, reason) => {
    if (!logCommandResult) return;
    logCommandResult({
      command: ctx.command,
      sender: ctx.sender,
      jid: ctx.jid,
      status: "OK",
      reason,
      durationMs: 0
    });
  };
}

export function makeFailLogger(logCommandResult) {
  return (ctx, reason) => {
    if (!logCommandResult) return;
    logCommandResult({
      command: ctx.command,
      sender: ctx.sender,
      jid: ctx.jid,
      status: "FAIL",
      reason,
      durationMs: 0
    });
  };
}
