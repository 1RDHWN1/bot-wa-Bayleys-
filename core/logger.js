import fs from "fs";
import path from "path";

const LEVEL_PRIORITY = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

const CONSOLE_METHOD = {
  debug: "log",
  info: "log",
  warn: "warn",
  error: "error"
};

function getTodayStamp(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function stringifyMeta(meta) {
  if (meta === undefined) return "";
  if (typeof meta === "string") return meta;

  try {
    return JSON.stringify(meta);
  } catch {
    return "[unserializable-meta]";
  }
}

export function createLogger(options = {}) {
  const level = (options.level || process.env.LOG_LEVEL || "info").toLowerCase();
  const minPriority = LEVEL_PRIORITY[level] || LEVEL_PRIORITY.info;
  const logsDir = options.logsDir || path.resolve(process.cwd(), "logs");

  ensureDir(logsDir);

  let activeDay = "";
  let stream = null;

  function getStream() {
    const day = getTodayStamp();
    if (stream && activeDay === day) {
      return stream;
    }

    if (stream) {
      stream.end();
    }

    activeDay = day;
    const filePath = path.join(logsDir, `${day}.log`);
    stream = fs.createWriteStream(filePath, { flags: "a" });
    return stream;
  }

  function write(levelName, message, meta) {
    const priority = LEVEL_PRIORITY[levelName];
    if (!priority || priority < minPriority) return;

    const ts = new Date().toISOString();
    const metaText = stringifyMeta(meta);
    const line = `[${ts}] [${levelName.toUpperCase()}] ${message}${metaText ? ` | ${metaText}` : ""}`;

    const method = CONSOLE_METHOD[levelName] || "log";
    console[method](line);

    try {
      getStream().write(`${line}\n`);
    } catch {
      // ignore file write failures and keep bot running
    }
  }

  return {
    debug: (message, meta) => write("debug", message, meta),
    info: (message, meta) => write("info", message, meta),
    warn: (message, meta) => write("warn", message, meta),
    error: (message, meta) => write("error", message, meta)
  };
}

export const logger = createLogger();

