import assert from "node:assert/strict";
import fs from "node:fs";
import { createCommandRouter } from "../core/router.js";
import { createAbuseGuard } from "../core/abuse-guard.js";
import { createModularCommands, createModularPassiveHandlers } from "../commands/modular/index.js";

function normalizeReminderTime(input = "") {
  const v = String(input || "").trim();
  const m = v.match(/^([01]?\d|2[0-3])[:.]([0-5]\d)$/);
  if (!m) return null;
  const hh = String(Number(m[1])).padStart(2, "0");
  const mm = String(Number(m[2])).padStart(2, "0");
  return `${hh}:${mm}`;
}

function formatReminderListItem(r) {
  const state = r.enabled === false ? "off" : "on";
  return `- [${r.id}] ${r.time} (${state}) ${r.message}`;
}

function createDeps() {
  const reminders = [];
  const confirmationStore = new Map();
  const ytSearchCache = new Map();
  const ytChoiceCache = new Map();
  const knowledgeAliases = {};
  const stats = {
    startedAt: Date.now(),
    totals: { ok: 0, fail: 0 },
    downloader: { ok: 0, fail: 0 },
    commands: new Map()
  };

  const parseTargetKnowledgeScope = (input, currentScopeId) => ({
    scopeId: currentScopeId,
    input,
    hasOverride: false,
    error: ""
  });
  const normalizeJid = (jid = "") => String(jid).replace(/[^0-9]/g, "");
  const getConfirmationKey = (jid, sender) => `${jid}:${sender}`;

  return {
    fs,
    getContentType: message => (message ? Object.keys(message)[0] : undefined),
    downloadMediaMessage: async () => Buffer.from("media"),
    makeSticker: async () => Buffer.from("sticker"),
    logWarn: () => {},
    isValidImageBuffer: () => true,
    stickerToImage: async () => Buffer.from("image"),
    ytSearch: async query =>
      Array.from({ length: 5 }, (_, idx) => ({
        title: `${query} #${idx + 1}`,
        url: `https://youtu.be/video${idx + 1}`
      })),
    ytSearchCache,
    ytChoiceCache,
    searchYouTubeMusic: async query =>
      Array.from({ length: 5 }, (_, idx) => ({
        title: `${query} music #${idx + 1}`,
        duration: "3:00",
        channel: "Test Channel",
        url: `https://youtu.be/music${idx + 1}`
      })),
    enforceRateLimit: async () => false,
    normalizeYouTubeUrl: url => String(url || "").trim(),
    enqueueDownloaderTask: (_name, worker) => ({ position: 1, promise: Promise.resolve().then(worker) }),
    downloadYouTubeAudio: async () => "audio.mp3",
    safeDeleteFile: async () => {},
    downloadYouTubeVideo: async () => "video.mp4",
    downloadTikTok: async () => ({ video: "tt.mp4", title: "TikTok", author: "Author" }),
    downloadInstagram: async () => "ig.mp4",
    getWeatherTomorrow: async () => ({
      date: new Date().toISOString(),
      lokasi: "Tasikmalaya",
      provinsi: "Jawa Barat",
      weather_desc: "Cerah",
      tMin: 22,
      tMax: 30,
      rainChance: 30,
      humidityAvg: 70,
      windAvg: 10,
      _cache: { hit: true, ageSec: 1 }
    }),
    formatDateIndo: () => "Senin, 01 Januari",
    getWeatherIcon: () => "☀️",
    getWeatherBMKG: async () => ({
      lokasi: "Tasikmalaya",
      provinsi: "Jawa Barat",
      cuacaSekarang: {
        local_datetime: new Date().toISOString(),
        weather_desc: "Cerah",
        t: 28,
        hu: 70,
        ws: 10
      },
      prakiraan: []
    }),
    parseImageFlags: text => ({ safeMode: !String(text).includes("--unsafe"), query: String(text).replace("--unsafe", "").trim() }),
    parseOwnerIds: () => new Set(["6281234567890"]),
    getSenderIds: async () => ["6281234567890"],
    searchImage: async () => "https://example.com/image.jpg",
    enqueueImageSearch: async worker => worker(),
    downloadImage: async () => ({ buffer: Buffer.from("img"), mimetype: "image/jpeg" }),
    createQuoteImageBuffer: async () => Buffer.from("quote"),
    formatUptime: () => "1m",
    formatBytes: () => "128 MB",
    pingUrl: async () => 42,
    getDownloaderQueueSnapshot: () => ({ waiting: 0, active: null, total: 0 }),
    getDownloaderQueueSize: () => 0,
    runtimeStats: stats,
    tts: async () => Buffer.from("voice"),
    ttsCooldown: new Map(),
    TTS_DELAY: 0,
    tagAll: async () => {},
    tagAdmin: async () => {},
    logInfo: () => {},
    logError: () => {},
    getErrorMessage: err => err?.message || String(err),
    logCommandResult: () => {},
    getCategoryMap: () => new Map([["System", [{names: ["help"], description: "Help"}]]]),
    getAllCategories: () => ["System"],
    getReminders: () => reminders,
    setReminders: next => {
      reminders.length = 0;
      reminders.push(...next);
    },
    saveReminders: () => {},
    normalizeReminderTime,
    formatReminderListItem,
    getAccessContext: async () => ({
      ownerIds: new Set(["6281234567890"]),
      senderIds: ["6281234567890"],
      isOwner: true,
      isGroupAdmin: true,
      isPrivileged: true
    }),
    getContextInfo: () => null,
    getQuotedText: () => "",
    getBotIdSet: () => new Set(),
    BOT_FOOTER: "> *pesan otomatis dari bot*",
    saveBotState: () => {},
    botState: { maintenance: { enabled: false, enabledAt: null, enabledBy: "", reason: "" } },
    expandParticipantCandidates: async () => [],
    tryDeleteByKey: async () => ({ ok: true, via: "sendMessage" }),
    hasKnowledgeEditAccess: () => false,
    normalizeJid,
    getAIConversationId: () => "private:test",
    getAIKnowledgeScopeId: () => "private:test",
    parseTargetKnowledgeScope,
    formatScopeLabel: scope => scope,
    getAIConfirmation: (jid, sender) => confirmationStore.get(getConfirmationKey(jid, sender)) || null,
    clearAIConfirmation: (jid, sender) => {
      confirmationStore.delete(getConfirmationKey(jid, sender));
    },
    setAIConfirmation: (jid, sender, value) => {
      confirmationStore.set(getConfirmationKey(jid, sender), value);
    },
    setStoredFact: () => ({ key: "x", value: "y" }),
    appendKnowledgeAudit: () => {},
    getAIHistorySize: () => 0,
    clearAIHistory: () => {},
    normalizeAliasName: name => String(name).toLowerCase().trim(),
    normalizeKnowledgeScopeId: scope => String(scope || "").trim(),
    saveKnowledgeAliases: () => {},
    tokenizeKnowledgeLookup: query => String(query || "").toLowerCase().split(/\s+/).filter(Boolean),
    normalizeKnowledgeLookup: input => String(input || "").toLowerCase(),
    getMentionedOrQuotedIds: () => [],
    getIdVariants: id => [id],
    addKnowledgeEditor: () => ({ added: true }),
    removeKnowledgeEditor: () => true,
    listKnowledgeEditors: () => [],
    clearKnowledgeEditors: () => 0,
    listKnowledgeScopes: () => [],
    exportKnowledgeSnapshot: () => ({}),
    formatKnowledgeFactsText: () => "",
    listStoredFacts: () => [],
    readQuotedDocumentText: async () => "",
    parseKnowledgeImportText: () => [],
    readKnowledgeAudit: () => [],
    extractKnowledgeFact: async () => ({ shouldSave: false, key: "", value: "", source: "heuristic", confidence: 0 }),
    extractKnowledgeMutation: async () => ({ action: "none", key: "", value: "", source: "heuristic", confidence: 0 }),
    resolveStoredFactKey: () => ({ ambiguous: false, alternatives: [], found: false, key: "", value: null }),
    deleteStoredFact: () => false,
    getStoredFact: () => "",
    getStoredFactMeta: () => null,
    isAIKnowledgeMutationRequest: () => false,
    getFeatureRedirect: () => "",
    buildFactsContext: () => "",
    askAI: async () => ({ content: "halo", model: "test-model", historySize: 2 }),
    knowledgeAliases,
    YT_CHOICE_TTL_MS: 2 * 60 * 1000,
    YT_SEARCH_TTL_MS: 5 * 60 * 1000
  };
}

function createRouter() {
  const deps = createDeps();
  const commands = createModularCommands(deps);
  const passiveHandlers = createModularPassiveHandlers(deps);
  const guard = createAbuseGuard({
    maxInputLength: 1200,
    defaultCooldownMs: 0,
    blockedUsers: new Set(),
    ownerNumber: "6281234567890"
  });
  const logger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {}
  };

  return createCommandRouter({
    prefix: "!",
    commands,
    passiveHandlers,
    guard,
    logger,
    ownerNumber: "6281234567890"
  });
}

async function runCommand(router, text) {
  const replies = [];
  const msg = {
    key: {
      remoteJid: "6281234567890@s.whatsapp.net",
      participant: "6281234567890@s.whatsapp.net",
      fromMe: false
    },
    pushName: "Tester",
    message: {}
  };
  const sock = {};
  const handled = await router.handle({
    sock,
    msg,
    text,
    sender: msg.key.participant,
    jid: msg.key.remoteJid,
    reply: async (_sock, _msg, payload) => {
      replies.push(payload);
      return payload;
    }
  });

  return { handled, replies };
}

async function main() {
  const router = createRouter();

  const menu = await runCommand(router, "!menu");
  assert.equal(menu.handled, true);
  assert.match(String(menu.replies[0] || ""), /HELP MENU/i);

  const ping = await runCommand(router, "!ping");
  assert.equal(ping.handled, true);
  assert.ok(ping.replies.length >= 2);

  const ai = await runCommand(router, "!ai");
  assert.equal(ai.handled, true);
  assert.match(String(ai.replies[0] || ""), /!ai <pertanyaan>/i);

  const suara = await runCommand(router, "!suara halo dunia");
  assert.equal(suara.handled, true);
  assert.equal(typeof suara.replies[0], "object");
  assert.ok(Buffer.isBuffer(suara.replies[0].audio));

  const jadwal = await runCommand(router, "!jadwal list");
  assert.equal(jadwal.handled, true);
  assert.match(String(jadwal.replies[0] || ""), /Belum ada jadwal/i);

  const stiker = await runCommand(router, "!stiker");
  assert.equal(stiker.handled, true);
  assert.match(String(stiker.replies[0] || ""), /Reply gambar atau video/i);

  const cuaca = await runCommand(router, "!cuaca");
  assert.equal(cuaca.handled, true);
  assert.match(String(cuaca.replies[0] || ""), /Cara pakai/i);

  const ytsearch = await runCommand(router, "!ytsearch lagu test");
  assert.equal(ytsearch.handled, true);
  assert.match(String(ytsearch.replies[0] || ""), /Hasil YouTube/i);

  const ytChoiceSet = await runCommand(router, "!yt https://youtu.be/testing");
  assert.equal(ytChoiceSet.handled, true);
  assert.match(String(ytChoiceSet.replies[0] || ""), /Pilih format/i);

  const ytChoicePick = await runCommand(router, "1");
  assert.equal(ytChoicePick.handled, true);
  assert.match(String(ytChoicePick.replies[0] || ""), /Mengambil audio/i);
  assert.ok(
    ytChoicePick.replies.some(item => typeof item === "object" && item?.audio?.url === "audio.mp3")
  );

  const ytsearchPick = await runCommand(router, "3");
  assert.equal(ytsearchPick.handled, true);
  assert.match(String(ytsearchPick.replies[0] || ""), /Mengambil audio/i);
  assert.ok(
    ytsearchPick.replies.some(item => typeof item === "object" && item?.audio?.url === "audio.mp3")
  );

  const spinStats = await runCommand(router, "!spin stats");
  assert.equal(spinStats.handled, true);
  assert.match(String(spinStats.replies[0] || ""), /SPIN STATS/i);

  console.log("Smoke modular commands: PASS");
}

main().catch(err => {
  console.error("Smoke modular commands: FAIL");
  console.error(err);
  process.exitCode = 1;
});
