function parseIntSafe(value, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

function parseBlockedUsers(raw) {
  if (!raw) return new Set();
  const values = raw
    .split(",")
    .map(v => v.trim())
    .filter(Boolean)
    .map(v => v.replace(/[^\d]/g, ""));

  return new Set(values);
}

export const appConfig = {
  prefix: process.env.BOT_PREFIX || "!",
  footerText: process.env.BOT_FOOTER || "> *pesan otomatis dari bot*",
  maxInputLength: parseIntSafe(process.env.MAX_INPUT_LENGTH, 1200),
  defaultCooldownMs: parseIntSafe(process.env.DEFAULT_COOLDOWN_MS, 2000),
  blockedUsers: parseBlockedUsers(process.env.BLOCKED_USERS || ""),
  ownerNumber: (process.env.OWNER_NUMBER || "").replace(/[^\d]/g, ""),
  logLevel: process.env.LOG_LEVEL || "info"
};

export function validateStartupConfig(logger) {
  const errors = [];
  const warnings = [];

  const required = ["OPENROUTER_API_KEY", "AI_MODEL", "OWNER_NUMBER", "BOT_NAME"];
  for (const key of required) {
    if (!process.env[key] || !process.env[key].trim()) {
      errors.push(`${key} belum diset`);
    }
  }

  const optionalButRecommended = [
    "GOOGLE_API_KEY",
    "GOOGLE_CSE_ID",
    "WEATHERAPI_KEY",
    "ELEVEN_API_KEY"
  ];

  for (const key of optionalButRecommended) {
    if (!process.env[key] || !process.env[key].trim()) {
      warnings.push(`${key} kosong (fitur terkait bisa gagal)`);
    }
  }

  if (appConfig.maxInputLength < 100) {
    warnings.push("MAX_INPUT_LENGTH terlalu kecil, disarankan >= 100");
  }

  if (appConfig.defaultCooldownMs < 0) {
    errors.push("DEFAULT_COOLDOWN_MS tidak valid");
  }

  warnings.forEach(item => logger.warn("Config warning", { message: item }));
  errors.forEach(item => logger.error("Config error", { message: item }));

  if (errors.length > 0) {
    throw new Error(`Validasi config gagal (${errors.length} error)`);
  }
}

