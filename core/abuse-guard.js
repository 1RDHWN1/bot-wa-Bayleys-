function jidToNumber(jid = "") {
  return String(jid).replace(/[^\d]/g, "");
}

export function createAbuseGuard(config) {
  const cooldownStore = new Map();
  const defaultCooldownMs = config.defaultCooldownMs || 0;

  function isBlocked(senderJid) {
    const number = jidToNumber(senderJid);
    if (!number) return false;
    return config.blockedUsers.has(number);
  }

  function checkInputLength(input, maxLength = config.maxInputLength) {
    if (!input) return { ok: true };
    if (input.length <= maxLength) return { ok: true };

    return {
      ok: false,
      reason: "input_too_long",
      maxLength,
      actualLength: input.length
    };
  }

  function checkCooldown(senderJid, commandName, cooldownMs = defaultCooldownMs) {
    if (!cooldownMs || cooldownMs <= 0) return { ok: true };

    const number = jidToNumber(senderJid) || senderJid;
    const key = `${number}:${commandName}`;
    const now = Date.now();
    const last = cooldownStore.get(key) || 0;
    const remaining = cooldownMs - (now - last);

    if (remaining > 0) {
      return { ok: false, reason: "cooldown", remainingMs: remaining };
    }

    cooldownStore.set(key, now);
    return { ok: true };
  }

  function clearUserCooldown(senderJid) {
    const number = jidToNumber(senderJid);
    if (!number) return;

    for (const key of cooldownStore.keys()) {
      if (key.startsWith(`${number}:`)) {
        cooldownStore.delete(key);
      }
    }
  }

  return {
    isBlocked,
    checkInputLength,
    checkCooldown,
    clearUserCooldown
  };
}

export function normalizeNumberFromJid(jid) {
  return jidToNumber(jid);
}

