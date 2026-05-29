import fs from "fs";
import path from "path";
import axios from "axios";
import { makeFailLogger, makeOkLogger } from "./logger.js";

const DATA_DIR = path.resolve("./data");
const SPIN_STATE_FILE = path.join(DATA_DIR, "spin_state.json");
const HYBRID_CACHE_FILE = path.join(DATA_DIR, "anime_characters_cache.json");
const LOCAL_POOL_FILE = path.resolve("./game/anime-characters.seed.json");

const JIKAN_TOP_ENDPOINT = "https://api.jikan.moe/v4/top/characters";
const JIKAN_FULL_ENDPOINT = "https://api.jikan.moe/v4/characters";
const HYBRID_SYNC_INTERVAL_MS = 12 * 60 * 60 * 1000;
const NON_OWNER_DAILY_SPIN_LIMIT = clamp(process.env.SPIN_DAILY_LIMIT || 3, 1, 20);

const RARITY_WEIGHT = {
  common: 55,
  rare: 25,
  epic: 12,
  legendary: 6,
  mythic: 2
};

const RARITY_LABEL = {
  common: "Common",
  rare: "Rare",
  epic: "Epic",
  legendary: "Legendary",
  mythic: "Mythic"
};

const RARITY_EMOJI = {
  common: "⚪",
  rare: "🔵",
  epic: "🟣",
  legendary: "🟡",
  mythic: "🌈"
};

let stateCache = null;
let localPoolCache = null;
let hybridPoolCache = null;
let hybridPoolLoadedAt = 0;
let syncInFlight = null;

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function clamp(n, min, max) {
  const v = Number(n);
  if (!Number.isFinite(v)) return min;
  return Math.max(min, Math.min(max, Math.floor(v)));
}

function normalizeSyncMode(input = "") {
  const key = String(input || "").toLowerCase().trim();
  if (key === "full") return "full";
  return "top";
}

function getSyncConfig() {
  return {
    syncEnabled: process.env.SPIN_HYBRID_SYNC !== "0",
    mode: normalizeSyncMode(process.env.SPIN_HYBRID_MODE || "top"),
    pageLimit: clamp(process.env.SPIN_HYBRID_PAGE_LIMIT || 25, 1, 25),
    maxPagesPerSync: clamp(process.env.SPIN_HYBRID_MAX_PAGES_PER_SYNC || 3, 1, 20)
  };
}

function sanitizeRarity(value = "") {
  const key = String(value || "").toLowerCase().trim();
  if (["common", "rare", "epic", "legendary", "mythic"].includes(key)) return key;
  return "common";
}

function defaultValueForRarity(rarity) {
  if (rarity === "mythic") return 220;
  if (rarity === "legendary") return 100;
  if (rarity === "epic") return 50;
  if (rarity === "rare") return 20;
  return 8;
}

function rarityFromFavorites(favorites = 0) {
  const n = Number(favorites) || 0;
  if (n >= 50000) return "mythic";
  if (n >= 15000) return "legendary";
  if (n >= 5000) return "epic";
  if (n >= 1500) return "rare";
  return "common";
}

function sanitizeCharacter(raw, fallbackIdPrefix = "local") {
  const name = String(raw?.name || "").trim();
  if (!name) return null;

  const rarity = sanitizeRarity(raw?.rarity);
  const valueNum = Number(raw?.value);
  const value = Number.isFinite(valueNum) && valueNum > 0
    ? Math.round(valueNum)
    : defaultValueForRarity(rarity);

  const id = String(
    raw?.id || `${fallbackIdPrefix}:${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`
  ).trim();
  const series = String(raw?.series || "-").trim() || "-";
  const imageUrl = String(raw?.imageUrl || raw?.image || "").trim();
  const source = String(raw?.source || fallbackIdPrefix).trim();
  const malId = Number(raw?.malId || 0) || 0;

  return {
    id,
    name,
    series,
    rarity,
    value,
    imageUrl,
    source,
    malId
  };
}

function normalizeSyncState(raw = {}) {
  const mode = normalizeSyncMode(raw?.mode || "top");
  return {
    mode,
    nextPage: clamp(raw?.nextPage || 1, 1, 100000),
    lastPageFetched: clamp(raw?.lastPageFetched || 0, 0, 100000),
    lastVisiblePage: clamp(raw?.lastVisiblePage || 0, 0, 100000),
    totalFetchedPages: clamp(raw?.totalFetchedPages || 0, 0, 10000000),
    completedCycles: clamp(raw?.completedCycles || 0, 0, 10000000),
    lastRunAt: Number(raw?.lastRunAt || 0) || 0,
    lastError: String(raw?.lastError || "")
  };
}

function getJakartaDateKey(date = new Date()) {
  return date.toLocaleDateString("sv-SE", { timeZone: "Asia/Jakarta" });
}

function prevDateKey(dateKey = "") {
  const m = String(dateKey || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return "";
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  const utc = Date.UTC(y, mo, d);
  const prev = new Date(utc - 24 * 60 * 60 * 1000);
  const yy = prev.getUTCFullYear();
  const mm = String(prev.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(prev.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function nextDateKey(dateKey = "") {
  const m = String(dateKey || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return "";
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  const utc = Date.UTC(y, mo, d);
  const next = new Date(utc + 24 * 60 * 60 * 1000);
  const yy = next.getUTCFullYear();
  const mm = String(next.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(next.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function getWibSpinResetInfo() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jakarta",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).formatToParts(new Date());

  const hh = Number(parts.find(p => p.type === "hour")?.value || 0);
  const mm = Number(parts.find(p => p.type === "minute")?.value || 0);
  const ss = Number(parts.find(p => p.type === "second")?.value || 0);
  const elapsedSec = (hh * 3600) + (mm * 60) + ss;
  const remainSec = Math.max(0, (24 * 3600) - elapsedSec);
  const remainHours = Math.floor(remainSec / 3600);
  const remainMinutes = Math.floor((remainSec % 3600) / 60);

  const today = getJakartaDateKey();
  const nextDay = nextDateKey(today);
  return {
    remainHours,
    remainMinutes,
    nextResetLabel: `${nextDay} 00:00 WIB`
  };
}

function getDailySpinCount(user, today) {
  if (!user || typeof user !== "object") return 0;
  if (String(user.lastSpinDate || "") !== today) return 0;
  return Math.max(0, Number(user.spinsToday || 0));
}

function loadSpinState() {
  if (stateCache) return stateCache;
  ensureDir();
  try {
    if (!fs.existsSync(SPIN_STATE_FILE)) {
      stateCache = { users: {} };
      return stateCache;
    }
    const raw = JSON.parse(fs.readFileSync(SPIN_STATE_FILE, "utf8"));
    stateCache = raw && typeof raw === "object" ? raw : { users: {} };
    if (!stateCache.users || typeof stateCache.users !== "object") stateCache.users = {};
  } catch {
    stateCache = { users: {} };
  }
  return stateCache;
}

function saveSpinState() {
  if (!stateCache) return;
  ensureDir();
  fs.writeFileSync(SPIN_STATE_FILE, JSON.stringify(stateCache, null, 2), "utf8");
}

function getOrInitUser(state, userId, displayName) {
  const users = state.users || (state.users = {});
  if (!users[userId]) {
    users[userId] = {
      name: displayName || userId,
      points: 0,
      totalSpins: 0,
      streak: 0,
      lastSpinDate: "",
      collection: {}
    };
  }
  users[userId].name = displayName || users[userId].name || userId;
  if (!users[userId].collection || typeof users[userId].collection !== "object") {
    users[userId].collection = {};
  }
  return users[userId];
}

function loadLocalPool() {
  if (localPoolCache) return localPoolCache;
  try {
    const parsed = JSON.parse(fs.readFileSync(LOCAL_POOL_FILE, "utf8"));
    const rows = Array.isArray(parsed) ? parsed : [];
    localPoolCache = rows.map(item => sanitizeCharacter(item, "local")).filter(Boolean);
  } catch {
    localPoolCache = [];
  }
  return localPoolCache;
}

function loadHybridCacheFile() {
  ensureDir();
  try {
    if (!fs.existsSync(HYBRID_CACHE_FILE)) {
      return {
        updatedAt: 0,
        source: "none",
        characters: [],
        sync: normalizeSyncState()
      };
    }

    const parsed = JSON.parse(fs.readFileSync(HYBRID_CACHE_FILE, "utf8"));
    return {
      updatedAt: Number(parsed?.updatedAt || 0),
      source: String(parsed?.source || "unknown"),
      characters: Array.isArray(parsed?.characters) ? parsed.characters : [],
      sync: normalizeSyncState(parsed?.sync || {})
    };
  } catch {
    return {
      updatedAt: 0,
      source: "broken",
      characters: [],
      sync: normalizeSyncState()
    };
  }
}

function saveHybridCacheFile(payload) {
  ensureDir();
  fs.writeFileSync(HYBRID_CACHE_FILE, JSON.stringify(payload, null, 2), "utf8");
}

function getCachedApiCharacters() {
  return loadHybridCacheFile().characters
    .map(item => sanitizeCharacter(item, "jikan"))
    .filter(Boolean);
}

async function fetchJikanCharactersPage({ mode, page, limit }) {
  const endpoint = mode === "full" ? JIKAN_FULL_ENDPOINT : JIKAN_TOP_ENDPOINT;
  const params = { page, limit };

  if (mode === "full") {
    params.order_by = "favorites";
    params.sort = "desc";
  }

  const res = await axios.get(endpoint, { params, timeout: 12000 });
  const rows = Array.isArray(res?.data?.data) ? res.data.data : [];
  const pagination = res?.data?.pagination || {};

  const characters = rows
    .map(item => {
      const rarity = rarityFromFavorites(item?.favorites || 0);
      const series = Array.isArray(item?.anime) && item.anime.length
        ? String(item.anime[0]?.title || "-").trim() || "-"
        : "-";
      const imageUrl = String(
        item?.images?.jpg?.image_url ||
        item?.images?.webp?.image_url ||
        ""
      ).trim();

      return sanitizeCharacter(
        {
          id: `jikan:${item?.mal_id || ""}`,
          malId: item?.mal_id || 0,
          name: item?.name || "",
          series,
          rarity,
          value: defaultValueForRarity(rarity),
          imageUrl,
          source: `jikan-${mode}`
        },
        "jikan"
      );
    })
    .filter(Boolean);

  return {
    characters,
    pagination: {
      hasNextPage: Boolean(pagination?.has_next_page),
      lastVisiblePage: Number(pagination?.last_visible_page || 0) || 0,
      currentPage: Number(pagination?.current_page || page) || page
    }
  };
}

async function syncApiCharactersIncremental({
  logWarn,
  force = false,
  steps = null,
  modeOverride = ""
}) {
  if (syncInFlight) return syncInFlight;

  syncInFlight = (async () => {
    const cfg = getSyncConfig();
    const cache = loadHybridCacheFile();
    const requestedMode = normalizeSyncMode(modeOverride || cfg.mode);
    const sync = normalizeSyncState(cache.sync || {});
    const stepCount = clamp(
      steps == null ? cfg.maxPagesPerSync : steps,
      1,
      50
    );

    let mode = requestedMode;
    let nextPage = sync.nextPage || 1;
    if (force && sync.mode !== requestedMode) {
      mode = requestedMode;
      nextPage = 1;
    } else if (!force) {
      mode = sync.mode || requestedMode;
      nextPage = sync.nextPage || 1;
    }

    const charMap = new Map(
      (Array.isArray(cache.characters) ? cache.characters : [])
        .map(item => sanitizeCharacter(item, "jikan"))
        .filter(Boolean)
        .map(item => [item.id, item])
    );

    let fetchedPages = 0;
    let currentPage = nextPage;
    let lastVisiblePage = sync.lastVisiblePage || 0;
    let completedCycles = sync.completedCycles || 0;
    let lastError = "";

    for (let i = 0; i < stepCount; i += 1) {
      try {
        const pageData = await fetchJikanCharactersPage({
          mode,
          page: currentPage,
          limit: cfg.pageLimit
        });

        for (const row of pageData.characters) {
          charMap.set(row.id, row);
        }

        fetchedPages += 1;
        lastVisiblePage = pageData.pagination.lastVisiblePage || lastVisiblePage;
        const hasNext = pageData.pagination.hasNextPage;
        const pageFetched = pageData.pagination.currentPage || currentPage;

        if (hasNext) {
          currentPage = pageFetched + 1;
        } else {
          currentPage = 1;
          completedCycles += 1;
        }

        await new Promise(resolve => setTimeout(resolve, 350));
      } catch (err) {
        lastError = err?.message || String(err);
        logWarn?.(`HYBRID SPIN SYNC PAGE FAIL | mode=${mode} page=${currentPage} | ${lastError}`);
        break;
      }
    }

    const payload = {
      updatedAt: fetchedPages > 0 ? Date.now() : Number(cache.updatedAt || 0),
      source: `jikan-${mode}`,
      characters: Array.from(charMap.values()),
      sync: normalizeSyncState({
        mode,
        nextPage: currentPage,
        lastPageFetched: fetchedPages > 0 ? currentPage - 1 || 1 : sync.lastPageFetched,
        lastVisiblePage,
        totalFetchedPages: Number(sync.totalFetchedPages || 0) + fetchedPages,
        completedCycles,
        lastRunAt: Date.now(),
        lastError
      })
    };

    saveHybridCacheFile(payload);

    if (fetchedPages === 0 && lastError) {
      return {
        ok: false,
        fetchedPages,
        totalCharacters: payload.characters.length,
        mode,
        nextPage: payload.sync.nextPage,
        lastVisiblePage: payload.sync.lastVisiblePage,
        lastError
      };
    }

    return {
      ok: true,
      fetchedPages,
      totalCharacters: payload.characters.length,
      mode,
      nextPage: payload.sync.nextPage,
      lastVisiblePage: payload.sync.lastVisiblePage,
      lastError
    };
  })();

  try {
    return await syncInFlight;
  } finally {
    syncInFlight = null;
  }
}

function mergePools(localPool, apiPool) {
  const out = new Map();
  for (const row of [...localPool, ...apiPool]) {
    if (!row?.id || !row?.name) continue;
    if (!out.has(row.id)) out.set(row.id, row);
  }
  return Array.from(out.values());
}

async function getHybridPool(logWarn, forceSync = false) {
  const now = Date.now();
  if (!forceSync && hybridPoolCache && now - hybridPoolLoadedAt < 2 * 60 * 1000) {
    return hybridPoolCache;
  }

  const localPool = loadLocalPool();
  let apiPool = getCachedApiCharacters();
  const cfg = getSyncConfig();
  const cache = loadHybridCacheFile();
  const isStale = now - Number(cache.updatedAt || 0) >= HYBRID_SYNC_INTERVAL_MS;

  if (forceSync) {
    await syncApiCharactersIncremental({ logWarn, force: true });
    apiPool = getCachedApiCharacters();
  } else if (cfg.syncEnabled && isStale && !syncInFlight) {
    syncApiCharactersIncremental({ logWarn, force: false }).catch(() => {});
  }

  hybridPoolCache = mergePools(localPool, apiPool);
  hybridPoolLoadedAt = now;
  return hybridPoolCache;
}

function pickWeightedCharacter(pool) {
  const weighted = pool.map(item => ({
    ...item,
    weight: RARITY_WEIGHT[item.rarity] || 1
  }));
  const total = weighted.reduce((acc, item) => acc + item.weight, 0);
  if (total <= 0) return null;

  let roll = Math.random() * total;
  for (const item of weighted) {
    roll -= item.weight;
    if (roll <= 0) return item;
  }
  return weighted[weighted.length - 1] || null;
}

function formatCharacterLine(item) {
  const rarity = sanitizeRarity(item?.rarity);
  return `${RARITY_EMOJI[rarity] || "⚪"} ${item?.name || "-"} [${RARITY_LABEL[rarity]}]`;
}

function normalizeName(input = "") {
  return String(input || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function resolveCharacterImageUrl(picked, pool = []) {
  const direct = String(picked?.imageUrl || "").trim();
  if (direct) return direct;

  const nameKey = normalizeName(picked?.name || "");
  if (!nameKey) return "";

  const candidate = pool.find(item => {
    if (!item?.imageUrl) return false;
    return normalizeName(item.name) === nameKey;
  });

  return String(candidate?.imageUrl || "").trim();
}

async function fetchCharacterImageFromJikanByName(name = "") {
  const query = String(name || "").trim();
  if (!query) return "";

  try {
    const res = await axios.get(JIKAN_FULL_ENDPOINT, {
      params: {
        q: query,
        order_by: "favorites",
        sort: "desc",
        page: 1,
        limit: 3
      },
      timeout: 8000
    });
    const rows = Array.isArray(res?.data?.data) ? res.data.data : [];
    const first = rows[0];
    return String(
      first?.images?.jpg?.image_url ||
      first?.images?.webp?.image_url ||
      ""
    ).trim();
  } catch {
    return "";
  }
}

function sanitizeCollectionEntries(collection = {}) {
  return Object.entries(collection || {})
    .map(([id, count]) => ({ id, count: Number(count) || 0 }))
    .filter(item => item.id && item.count > 0);
}

function formatUserId(userId = "") {
  const raw = String(userId || "");
  if (!raw) return "-";
  if (raw.length <= 6) return raw;
  return `${raw.slice(0, 3)}***${raw.slice(-3)}`;
}

function getCollectionSummary(user, poolMap) {
  const entries = sanitizeCollectionEntries(user?.collection);
  const totalOwned = entries.reduce((acc, item) => acc + item.count, 0);
  const uniqueOwned = entries.length;
  const top = entries
    .map(item => ({ ...item, char: poolMap.get(item.id) }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8)
    .map((item, idx) => {
      const name = item.char?.name || item.id;
      const rarity = sanitizeRarity(item.char?.rarity);
      return `${idx + 1}. ${RARITY_EMOJI[rarity] || "⚪"} ${name} x${item.count}`;
    })
    .join("\n");

  return {
    totalOwned,
    uniqueOwned,
    top: top || "-"
  };
}

function formatSyncStatus(cache, summary = null) {
  const sync = normalizeSyncState(cache?.sync || {});
  const updatedAt = cache?.updatedAt
    ? new Date(cache.updatedAt).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })
    : "-";
  const lastRun = sync.lastRunAt
    ? new Date(sync.lastRunAt).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })
    : "-";

  const summaryLine = summary
    ? `\n📥 Batch terakhir: ${summary.fetchedPages} page | total karakter ${summary.totalCharacters}`
    : "";

  return (
    `🛰️ *HYBRID SYNC STATUS*\n` +
    `Mode: *${sync.mode}*\n` +
    `Source: ${cache?.source || "-"}\n` +
    `Cache updated: ${updatedAt} WIB\n` +
    `Last run: ${lastRun} WIB\n` +
    `Next page: ${sync.nextPage}\n` +
    `Last visible page: ${sync.lastVisiblePage || "-"}\n` +
    `Total fetched pages: ${sync.totalFetchedPages}\n` +
    `Completed cycles: ${sync.completedCycles}\n` +
    `Last error: ${sync.lastError || "-"}${summaryLine}`
  );
}

export function createGameCommands(deps) {
  const {
    logCommandResult,
    normalizeJid,
    enforceRateLimit,
    logWarn,
    parseOwnerIds
  } = deps;
  const logOk = makeOkLogger(logCommandResult);
  const logFail = makeFailLogger(logCommandResult);

  function toCanonicalPhoneId(raw = "") {
    const id = normalizeJid(raw || "");
    if (!id) return "";
    if (id.length < 8 || id.length > 15) return "";
    if (id.startsWith("0") && id.length > 9) return `62${id.slice(1)}`;
    return id;
  }

  function extractActorId(ctx) {
    const candidates = [
      ctx?.msg?.key?.participantPn,
      ctx?.msg?.key?.participant,
      ctx?.sender,
      ctx?.msg?.participant,
      ctx?.msg?.key?.remoteJid
    ];

    for (const raw of candidates) {
      const id = toCanonicalPhoneId(raw);
      if (id) return id;
    }
    return "";
  }

  async function hasOwnerAccess(ctx) {
    if (ctx?.msg?.key?.fromMe) return true;

    const ownerIds = typeof parseOwnerIds === "function"
      ? parseOwnerIds(ctx.sock)
      : new Set();
    if (!ownerIds.size) return false;

    const actorId = extractActorId(ctx);
    if (!actorId) return false;

    const variants = new Set([actorId]);
    if (actorId.startsWith("62") && actorId.length > 10) variants.add(`0${actorId.slice(2)}`);
    if (actorId.startsWith("0") && actorId.length > 10) variants.add(`62${actorId.slice(1)}`);

    for (const v of variants) {
      if (ownerIds.has(v)) return true;
    }
    return false;
  }

  async function runSpin(ctx) {
    const senderId = extractActorId(ctx) || normalizeJid(ctx.sender) || String(ctx.sender || "");
    if (!senderId) {
      logFail(ctx, "sender invalid");
      return ctx.reply(ctx.sock, ctx.msg, "❌ ID user tidak valid.");
    }

    const ownerAccess = await hasOwnerAccess(ctx);

    if (
      !ownerAccess &&
      await enforceRateLimit({
        sock: ctx.sock,
        msg: ctx.msg,
        senderKey: senderId,
        bucket: "spin",
        limit: 5,
        windowMs: 60_000,
        commandLabel: ctx.command,
        sender: ctx.sender,
        jid: ctx.jid
      })
    ) {
      return;
    }

    const state = loadSpinState();
    const displayName = ctx.msg?.pushName || senderId;
    const user = getOrInitUser(state, senderId, displayName);
    const today = getJakartaDateKey();
    const usedToday = getDailySpinCount(user, today);
    const remainingToday = Math.max(0, NON_OWNER_DAILY_SPIN_LIMIT - usedToday);

    if (!ownerAccess && usedToday >= NON_OWNER_DAILY_SPIN_LIMIT) {
      const resetInfo = getWibSpinResetInfo();
      logFail(ctx, "spin sudah dipakai hari ini");
      return ctx.reply(
        ctx.sock,
        ctx.msg,
        `🎰 Kamu sudah spin hari ini.\n` +
        `📌 Batas harian: *${NON_OWNER_DAILY_SPIN_LIMIT}x* (terpakai: *${usedToday}x*)\n` +
        `⏳ Sisa waktu: *${resetInfo.remainHours}j ${resetInfo.remainMinutes}m*\n` +
        `🕛 Reset harian: *${resetInfo.nextResetLabel}*\n\n` +
        `Poin: *${user.points || 0}* | Streak: *${user.streak || 0}*`
      );
    }

    const pool = await getHybridPool(logWarn, false);
    if (!pool.length) {
      logFail(ctx, "pool karakter kosong");
      return ctx.reply(ctx.sock, ctx.msg, "❌ Pool karakter kosong. Coba lagi nanti.");
    }

    const picked = pickWeightedCharacter(pool);
    if (!picked) {
      logFail(ctx, "roll gagal");
      return ctx.reply(ctx.sock, ctx.msg, "❌ Gagal spin karakter. Coba lagi.");
    }

    const ownedCount = Number(user.collection[picked.id] || 0);
    const duplicateBonus = ownedCount > 0 ? Math.max(1, Math.round(picked.value * 0.25)) : 0;
    const gain = picked.value + duplicateBonus;

    const prev = String(user.lastSpinDate || "");
    if (prev !== today) {
      user.streak = prev && prev === prevDateKey(today)
        ? Number(user.streak || 0) + 1
        : 1;
      user.spinsToday = 1;
      user.lastSpinDate = today;
    } else {
      user.spinsToday = Number(user.spinsToday || 0) + 1;
    }
    user.totalSpins = Number(user.totalSpins || 0) + 1;
    user.points = Number(user.points || 0) + gain;
    user.collection[picked.id] = ownedCount + 1;
    user.lastCharacterId = picked.id;
    user.lastGain = gain;
    user.lastSpinAt = Date.now();

    saveSpinState();

    const dupLine = duplicateBonus > 0
      ? `\n♻️ Duplikat bonus: +${duplicateBonus} poin`
      : "";
    let imageUrl = resolveCharacterImageUrl(picked, pool);
    if (!imageUrl) {
      imageUrl = await fetchCharacterImageFromJikanByName(picked.name);
    }

    const caption =
      `🎰 *LUCKY SPIN*\n` +
      `${formatCharacterLine(picked)}\n` +
      `📺 Series: ${picked.series}\n` +
      `💰 Poin: +${picked.value}${dupLine}\n` +
      `🧮 Total didapat: *+${gain}*\n` +
      `🔥 Streak: ${user.streak} hari\n` +
      `${ownerAccess ? "♾️ Spin owner: tanpa batas harian\n" : `🎫 Sisa spin hari ini: ${Math.max(0, NON_OWNER_DAILY_SPIN_LIMIT - Number(user.spinsToday || 0))}/${NON_OWNER_DAILY_SPIN_LIMIT}\n`}` +
      `🏦 Total poin kamu: *${user.points}*\n\n` +
      `Tip: !koleksi untuk lihat karakter kamu.`;

    logOk(ctx, `spin ${picked.id} gain=${gain}`);

    if (imageUrl) {
      try {
        return await ctx.reply(ctx.sock, ctx.msg, {
          image: { url: imageUrl },
          caption
        });
      } catch {
        // fallback ke teks jika media URL gagal
      }
    }

    return ctx.reply(ctx.sock, ctx.msg, caption);
  }

  async function showSpinStats(ctx) {
    const senderId = normalizeJid(ctx.sender) || String(ctx.sender || "");
    const state = loadSpinState();
    const user = getOrInitUser(state, senderId, ctx.msg?.pushName || senderId);
    const today = getJakartaDateKey();
    const ownerAccess = await hasOwnerAccess(ctx);
    const usedToday = getDailySpinCount(user, today);
    const remainingToday = ownerAccess
      ? Number.POSITIVE_INFINITY
      : Math.max(0, NON_OWNER_DAILY_SPIN_LIMIT - usedToday);
    const canSpin = ownerAccess || remainingToday > 0;
    const pool = await getHybridPool(logWarn, false);
    const poolMap = new Map(pool.map(item => [item.id, item]));
    const summary = getCollectionSummary(user, poolMap);

    logOk(ctx, "spin stats");
    return ctx.reply(
      ctx.sock,
      ctx.msg,
      `📊 *SPIN STATS*\n` +
      `👤 ${user.name || senderId}\n` +
      `💰 Poin: *${user.points || 0}*\n` +
      `🎰 Total spin: ${user.totalSpins || 0}\n` +
      `🔥 Streak: ${user.streak || 0} hari\n` +
      `🧩 Koleksi unik: ${summary.uniqueOwned}\n` +
      `🎴 Total kartu: ${summary.totalOwned}\n` +
      `${ownerAccess
        ? "♾️ Batas harian: Owner (tanpa batas)"
        : `🎫 Sisa spin hari ini: ${remainingToday}/${NON_OWNER_DAILY_SPIN_LIMIT}`}\n` +
      `✅ Bisa spin: ${canSpin ? "YA" : "BESOK"}`
    );
  }

  async function showLeaderboard(ctx) {
    const state = loadSpinState();
    const rows = Object.entries(state?.users || {})
      .map(([userId, user]) => ({
        userId,
        name: String(user?.name || formatUserId(userId)),
        points: Number(user?.points || 0),
        spins: Number(user?.totalSpins || 0)
      }))
      .filter(item => item.points > 0 || item.spins > 0)
      .sort((a, b) => b.points - a.points || b.spins - a.spins)
      .slice(0, 10);

    if (!rows.length) {
      logFail(ctx, "leaderboard kosong");
      return ctx.reply(ctx.sock, ctx.msg, "🏁 Leaderboard masih kosong. Mulai dengan `!spin`.");
    }

    const lines = rows
      .map((item, idx) => `${idx + 1}. ${item.name} (${formatUserId(item.userId)})\n   💰 ${item.points} | 🎰 ${item.spins}`)
      .join("\n");

    logOk(ctx, "spin top");
    return ctx.reply(ctx.sock, ctx.msg, `🏆 *SPIN LEADERBOARD*\n${lines}`);
  }

  async function showCollection(ctx) {
    const senderId = normalizeJid(ctx.sender) || String(ctx.sender || "");
    const state = loadSpinState();
    const user = getOrInitUser(state, senderId, ctx.msg?.pushName || senderId);
    const pool = await getHybridPool(logWarn, false);
    const poolMap = new Map(pool.map(item => [item.id, item]));
    const summary = getCollectionSummary(user, poolMap);

    if (!summary.uniqueOwned) {
      logFail(ctx, "koleksi kosong");
      return ctx.reply(ctx.sock, ctx.msg, "📦 Koleksi kamu masih kosong. Coba `!spin` dulu.");
    }

    logOk(ctx, `koleksi total=${summary.uniqueOwned}`);
    return ctx.reply(
      ctx.sock,
      ctx.msg,
      `📚 *KOLEKSI KARAKTER*\n` +
      `👤 ${user.name || senderId}\n` +
      `🧩 Unik: ${summary.uniqueOwned}\n` +
      `🎴 Total: ${summary.totalOwned}\n\n` +
      `${summary.top}`
    );
  }

  async function handleSync(ctx, subInput) {
    if (!(await hasOwnerAccess(ctx))) {
      logFail(ctx, "spin sync ditolak: bukan owner");
      return ctx.reply(ctx.sock, ctx.msg, "🔒 Hanya owner yang boleh pakai `!spin sync`.");
    }

    const parts = String(subInput || "").trim().split(/\s+/).filter(Boolean);
    const action = String(parts[0] || "").toLowerCase();

    if (!action || action === "status") {
      const cache = loadHybridCacheFile();
      logOk(ctx, "spin sync status");
      return ctx.reply(ctx.sock, ctx.msg, formatSyncStatus(cache));
    }

    if (action === "top" || action === "full") {
      const summary = await syncApiCharactersIncremental({
        logWarn,
        force: true,
        modeOverride: action
      });
      const cache = loadHybridCacheFile();
      logOk(ctx, `spin sync ${action} pages=${summary.fetchedPages}`);
      return ctx.reply(ctx.sock, ctx.msg, formatSyncStatus(cache, summary));
    }

    if (action === "step") {
      const steps = clamp(parts[1] || 1, 1, 50);
      const summary = await syncApiCharactersIncremental({
        logWarn,
        force: true,
        steps
      });
      const cache = loadHybridCacheFile();
      logOk(ctx, `spin sync step=${steps} fetched=${summary.fetchedPages}`);
      return ctx.reply(ctx.sock, ctx.msg, formatSyncStatus(cache, summary));
    }

    logFail(ctx, "spin sync subcommand invalid");
    return ctx.reply(
      ctx.sock,
      ctx.msg,
      "❗ Format sync:\n• !spin sync status\n• !spin sync top\n• !spin sync full\n• !spin sync step <jumlah_page>"
    );
  }

  return [
    {
      names: ["spin"],
      execute: async ctx => {
        const sub = String(ctx.input || "").trim();
        const subLower = sub.toLowerCase();

        if (!sub) return runSpin(ctx);
        if (subLower === "whoami") {
          const actorId = extractActorId(ctx) || "-";
          const isOwner = await hasOwnerAccess(ctx);
          logOk(ctx, `spin whoami actor=${actorId} owner=${isOwner}`);
          return ctx.reply(
            ctx.sock,
            ctx.msg,
            `🆔 Actor ID: *${actorId}*\n👑 Owner access: *${isOwner ? "YA" : "TIDAK"}*`
          );
        }
        if (subLower === "stats" || subLower === "status") return showSpinStats(ctx);
        if (subLower === "top" || subLower === "leaderboard") return showLeaderboard(ctx);
        if (subLower.startsWith("sync")) {
          const rest = sub.replace(/^sync\s*/i, "");
          return handleSync(ctx, rest);
        }

        logFail(ctx, "spin subcommand invalid");
        return ctx.reply(
          ctx.sock,
          ctx.msg,
          "❗ Format:\n• !spin\n• !spin whoami\n• !spin stats\n• !spin top\n• !spin sync status (owner)\n• !spin sync top|full (owner)\n• !spin sync step <jumlah_page> (owner)"
        );
      }
    },
    {
      names: ["koleksi", "collection", "karakterku"],
      execute: async ctx => showCollection(ctx)
    }
  ];
}
