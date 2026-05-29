export function createRuntimeToolkit(options) {
  const {
    logInfo,
    logWarn,
    reply,
    ytChoiceCache,
    ytSearchCache,
    ytChoiceTtlMs,
    ytSearchTtlMs,
    rateLimitPruneKeepMs = 10 * 60 * 1000,
    imageSearchIntervalMs = 1200
  } = options;

  const downloaderCommands = new Set([
    "yta",
    "yt-choice-audio",
    "yt-choice-video",
    "ytsearch-pick",
    "tt",
    "ig"
  ]);

  const runtimeStats = {
    startedAt: Date.now(),
    totals: { ok: 0, fail: 0 },
    downloader: { ok: 0, fail: 0 },
    commands: new Map()
  };

  function recordCommandStats(command, status, durationMs = 0) {
    const key = String(command || "unknown");
    const stat = runtimeStats.commands.get(key) || {
      total: 0,
      ok: 0,
      fail: 0,
      totalDurationMs: 0,
      lastAt: 0
    };

    stat.total += 1;
    stat.totalDurationMs += Number(durationMs) || 0;
    stat.lastAt = Date.now();

    if (status === "OK") {
      stat.ok += 1;
      runtimeStats.totals.ok += 1;
      if (downloaderCommands.has(key)) runtimeStats.downloader.ok += 1;
    } else {
      stat.fail += 1;
      runtimeStats.totals.fail += 1;
      if (downloaderCommands.has(key)) runtimeStats.downloader.fail += 1;
    }

    runtimeStats.commands.set(key, stat);
  }

  function logCommandResult({
    command = "unknown",
    sender = "unknown",
    jid = "unknown",
    status = "OK",
    reason = "-",
    durationMs = 0
  }) {
    const senderNum = String(sender).split("@")[0];
    const scope = String(jid).endsWith("@g.us") ? "GROUP" : "PRIVATE";
    const safeReason = String(reason || "-").replace(/\s+/g, " ").trim();
    const line = `CMD ${status} | ${command} | user=${senderNum} | ${scope} | ${durationMs}ms | ${safeReason}`;

    if (status === "OK") logInfo(line);
    else logWarn(line);

    recordCommandStats(command, status, durationMs);
  }

  const rateLimitStore = new Map();

  function hitRateLimit(userKey, bucket, limit, windowMs) {
    const now = Date.now();
    const key = `${userKey}:${bucket}`;
    const existing = rateLimitStore.get(key) || [];
    const active = existing.filter(ts => now - ts < windowMs);

    if (active.length >= limit) {
      rateLimitStore.set(key, active);
      const retryMs = windowMs - (now - active[0]);
      return { limited: true, retryMs };
    }

    active.push(now);
    rateLimitStore.set(key, active);
    return { limited: false, retryMs: 0 };
  }

  async function enforceRateLimit({
    sock,
    msg,
    senderKey,
    bucket,
    limit,
    windowMs,
    commandLabel,
    sender,
    jid
  }) {
    const result = hitRateLimit(senderKey, bucket, limit, windowMs);
    if (!result.limited) return false;

    const waitSec = Math.max(1, Math.ceil(result.retryMs / 1000));
    logCommandResult({
      command: commandLabel,
      sender,
      jid,
      status: "FAIL",
      reason: `rate limit (${bucket}) ${waitSec}s`,
      durationMs: 0
    });

    await reply(sock, msg, `⏳ Terlalu cepat. Coba lagi dalam *${waitSec} detik* untuk command ini.`);
    return true;
  }

  const downloaderQueue = [];
  let downloaderQueueActive = false;
  let downloaderCurrentTask = null;

  function enqueueDownloaderTask(taskName, worker) {
    const position = (downloaderQueueActive ? 1 : 0) + downloaderQueue.length + 1;
    let resolveTask;
    let rejectTask;

    const promise = new Promise((resolve, reject) => {
      resolveTask = resolve;
      rejectTask = reject;
    });

    downloaderQueue.push({ taskName, worker, resolveTask, rejectTask });
    processDownloaderQueue();
    return { position, promise };
  }

  async function processDownloaderQueue() {
    if (downloaderQueueActive) return;
    const task = downloaderQueue.shift();
    if (!task) return;

    downloaderQueueActive = true;
    downloaderCurrentTask = { name: task.taskName, startedAt: Date.now() };
    try {
      const result = await task.worker();
      task.resolveTask(result);
    } catch (err) {
      task.rejectTask(err);
    } finally {
      downloaderQueueActive = false;
      downloaderCurrentTask = null;
      processDownloaderQueue();
    }
  }

  function getDownloaderQueueSize() {
    return downloaderQueue.length + (downloaderQueueActive ? 1 : 0);
  }

  function getDownloaderQueueSnapshot() {
    const waiting = downloaderQueue.length;
    const active = downloaderCurrentTask
      ? {
          name: downloaderCurrentTask.name,
          runningSec: Math.floor((Date.now() - downloaderCurrentTask.startedAt) / 1000)
        }
      : null;

    return { waiting, active, total: getDownloaderQueueSize() };
  }

  const imageSearchQueue = [];
  let imageSearchBusy = false;

  function enqueueImageSearch(worker) {
    return new Promise((resolve, reject) => {
      imageSearchQueue.push({ worker, resolve, reject });
      processImageSearchQueue();
    });
  }

  async function processImageSearchQueue() {
    if (imageSearchBusy || !imageSearchQueue.length) return;
    imageSearchBusy = true;
    const task = imageSearchQueue.shift();
    try {
      const result = await task.worker();
      task.resolve(result);
    } catch (err) {
      task.reject(err);
    } finally {
      setTimeout(() => {
        imageSearchBusy = false;
        processImageSearchQueue();
      }, imageSearchIntervalMs);
    }
  }

  function pruneRateLimitStore() {
    const now = Date.now();
    for (const [key, values] of rateLimitStore.entries()) {
      const kept = Array.isArray(values)
        ? values.filter(ts => now - ts < rateLimitPruneKeepMs)
        : [];
      if (!kept.length) {
        rateLimitStore.delete(key);
        continue;
      }
      rateLimitStore.set(key, kept);
    }
  }

  function pruneRuntimeStats() {
    const maxCommandEntries = Number(process.env.STATS_MAX_COMMANDS || 150);
    if (runtimeStats.commands.size <= maxCommandEntries) return;

    const sorted = Array.from(runtimeStats.commands.entries())
      .sort((a, b) => b[1].lastAt - a[1].lastAt)
      .slice(0, maxCommandEntries);
    runtimeStats.commands = new Map(sorted);
  }

  function pruneYtCaches() {
    const now = Date.now();

    for (const [key, value] of ytChoiceCache.entries()) {
      if (!value?.createdAt || now - value.createdAt > ytChoiceTtlMs) {
        ytChoiceCache.delete(key);
      }
    }

    for (const [key, value] of ytSearchCache.entries()) {
      if (Array.isArray(value)) continue;
      if (!value?.createdAt || now - value.createdAt > ytSearchTtlMs) {
        ytSearchCache.delete(key);
      }
    }
  }

  setInterval(() => {
    pruneRateLimitStore();
    pruneRuntimeStats();
    pruneYtCaches();
  }, 2 * 60 * 1000).unref?.();

  return {
    runtimeStats,
    logCommandResult,
    enforceRateLimit,
    enqueueDownloaderTask,
    getDownloaderQueueSize,
    getDownloaderQueueSnapshot,
    enqueueImageSearch
  };
}
