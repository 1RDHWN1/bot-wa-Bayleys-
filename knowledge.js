import fs from "fs";
import path from "path";

const DATA_DIR = path.resolve("./data");
const DATA_FILE = path.join(DATA_DIR, "knowledge.json");
const META_FILE = path.join(DATA_DIR, "knowledge_meta.json");
const ACL_FILE = path.join(DATA_DIR, "knowledge_acl.json");
const AUDIT_FILE = path.join(DATA_DIR, "knowledge_audit.log");

let store = null;
let metaStore = null;
let aclStore = null;

function ensureLoaded() {
  if (store) return;

  try {
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    const parsed = JSON.parse(raw);
    store = parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    store = {};
  }
}

function persist() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  const tempFile = `${DATA_FILE}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(store, null, 2), "utf8");
  fs.renameSync(tempFile, DATA_FILE);
}

function ensureMetaLoaded() {
  if (metaStore) return;

  try {
    const raw = fs.readFileSync(META_FILE, "utf8");
    const parsed = JSON.parse(raw);
    metaStore = parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    metaStore = {};
  }
}

function persistMeta() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  const tempFile = `${META_FILE}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(metaStore, null, 2), "utf8");
  fs.renameSync(tempFile, META_FILE);
}

function ensureAclLoaded() {
  if (aclStore) return;

  try {
    const raw = fs.readFileSync(ACL_FILE, "utf8");
    const parsed = JSON.parse(raw);
    const editors = Array.isArray(parsed?.editors) ? parsed.editors : [];
    aclStore = { editors };
  } catch {
    aclStore = { editors: [] };
  }
}

function persistAcl() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  const tempFile = `${ACL_FILE}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(aclStore, null, 2), "utf8");
  fs.renameSync(tempFile, ACL_FILE);
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function normScope(scopeId) {
  const scope = String(scopeId || "global").trim();
  return scope || "global";
}

function normKey(key) {
  return String(key || "").trim().toLowerCase();
}

function normUserId(userId) {
  return String(userId || "").replace(/[^0-9]/g, "");
}

const SEARCH_STOPWORDS = new Set([
  "aku",
  "apa",
  "atau",
  "bagaimana",
  "bagi",
  "buat",
  "bisa",
  "boleh",
  "cara",
  "dalam",
  "dan",
  "dari",
  "dengan",
  "di",
  "dong",
  "itu",
  "jadi",
  "kalau",
  "kan",
  "kapan",
  "ke",
  "lagi",
  "mau",
  "mohon",
  "nya",
  "pada",
  "pakai",
  "saja",
  "sama",
  "saya",
  "sebutkan",
  "siapa",
  "tolong",
  "untuk",
  "yang"
]);

function normalizeSearchText(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stemToken(token) {
  let t = String(token || "").toLowerCase();
  for (const suffix of ["nya", "kan", "lah", "pun"]) {
    if (t.length > suffix.length + 3 && t.endsWith(suffix)) {
      t = t.slice(0, -suffix.length);
      break;
    }
  }
  return t;
}

function getScopeData(scopeId) {
  ensureLoaded();
  const scope = normScope(scopeId);

  if (!store[scope] || typeof store[scope] !== "object") {
    store[scope] = {};
  }

  return store[scope];
}

function getScopeMeta(scopeId) {
  ensureMetaLoaded();
  const scope = normScope(scopeId);

  if (!metaStore[scope] || typeof metaStore[scope] !== "object") {
    metaStore[scope] = {};
  }

  return metaStore[scope];
}

function tokenize(text) {
  const tokens = new Set();
  for (const raw of normalizeSearchText(text).split(/\s+/)) {
    if (raw.length < 3 || SEARCH_STOPWORDS.has(raw)) continue;
    tokens.add(raw);

    const stemmed = stemToken(raw);
    if (stemmed.length >= 3 && !SEARCH_STOPWORDS.has(stemmed)) {
      tokens.add(stemmed);
    }
  }
  return Array.from(tokens);
}

export function setStoredFact(scopeId, key, value, meta = {}) {
  const k = normKey(key);
  const v = String(value || "").trim();

  if (!k) throw new Error("Kunci data kosong.");
  if (!v) throw new Error("Nilai data kosong.");

  const scopeData = getScopeData(scopeId);
  scopeData[k] = v;
  persist();

  const scopeMeta = getScopeMeta(scopeId);
  const prev = scopeMeta[k] && typeof scopeMeta[k] === "object" ? scopeMeta[k] : {};
  scopeMeta[k] = {
    ...prev,
    ...meta,
    updatedAt: new Date().toISOString()
  };
  persistMeta();

  return { key: k, value: v };
}

export function getStoredFact(scopeId, key) {
  const k = normKey(key);
  if (!k) return null;
  const scopeData = getScopeData(scopeId);
  return scopeData[k] || null;
}

export function getStoredFactMeta(scopeId, key) {
  const k = normKey(key);
  if (!k) return null;
  const scopeMeta = getScopeMeta(scopeId);
  return scopeMeta[k] || null;
}

export function deleteStoredFact(scopeId, key) {
  const k = normKey(key);
  if (!k) return false;

  const scope = normScope(scopeId);
  const scopeData = getScopeData(scope);
  if (!(k in scopeData)) return false;

  delete scopeData[k];
  const scopeMeta = getScopeMeta(scope);
  delete scopeMeta[k];

  if (Object.keys(scopeData).length === 0) {
    delete store[scope];
  }

  if (Object.keys(scopeMeta).length === 0) {
    delete metaStore[scope];
  }

  persist();
  persistMeta();
  return true;
}

export function listStoredFacts(scopeId) {
  const scopeData = getScopeData(scopeId);
  return Object.entries(scopeData)
    .map(([key, value]) => ({ key, value }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

export function buildFactsContext(scopeId, query = "", maxEntries = 8, maxChars = 1200) {
  const facts = listStoredFacts(scopeId);
  if (!facts.length) return "";

  const tokens = tokenize(query);
  const withScore = facts.map(item => {
    const key = normalizeSearchText(item.key);
    const value = normalizeSearchText(item.value);
    const hay = `${key} ${value}`;
    const score = tokens.reduce((acc, token) => {
      if (key === token || key.includes(` ${token} `)) return acc + 4;
      if (key.includes(token)) return acc + 3;
      if (value.includes(token)) return acc + 1;
      return acc;
    }, 0);
    return { ...item, score };
  });

  const sorted = withScore.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.key.localeCompare(b.key);
  });

  const source = (tokens.length === 0 ? sorted : sorted.filter(item => item.score > 0))
    .slice(0, maxEntries);
  if (!source.length) return "";

  let output = "";
  const scopeMeta = getScopeMeta(scopeId);
  for (const item of source) {
    const meta = scopeMeta[item.key] || {};
    const by = meta.updatedBy ? ` (diupdate oleh ${meta.updatedBy})` : "";
    const line = `- ${item.key}: ${item.value}${by}\n`;
    if ((output + line).length > maxChars) break;
    output += line;
  }

  return output.trim();
}

export function listKnowledgeEditors() {
  ensureAclLoaded();
  return Array.from(new Set(aclStore.editors.map(normUserId).filter(Boolean))).sort();
}

export function isKnowledgeEditor(userId) {
  const target = normUserId(userId);
  if (!target) return false;
  return listKnowledgeEditors().includes(target);
}

export function addKnowledgeEditor(userId) {
  ensureAclLoaded();
  const target = normUserId(userId);
  if (!target) throw new Error("Nomor editor tidak valid.");

  const exists = aclStore.editors.map(normUserId).includes(target);
  if (!exists) {
    aclStore.editors.push(target);
    persistAcl();
  }

  return { added: !exists, userId: target };
}

export function removeKnowledgeEditor(userId) {
  ensureAclLoaded();
  const target = normUserId(userId);
  if (!target) return false;

  const before = aclStore.editors.length;
  aclStore.editors = aclStore.editors
    .map(normUserId)
    .filter(id => id && id !== target);

  if (aclStore.editors.length !== before) {
    persistAcl();
    return true;
  }

  return false;
}

export function clearKnowledgeEditors() {
  ensureAclLoaded();
  const count = listKnowledgeEditors().length;
  aclStore.editors = [];
  persistAcl();
  return count;
}

export function appendKnowledgeAudit(entry = {}) {
  ensureDataDir();
  const row = {
    ts: new Date().toISOString(),
    ...entry
  };
  fs.appendFileSync(AUDIT_FILE, `${JSON.stringify(row)}\n`, "utf8");
}
