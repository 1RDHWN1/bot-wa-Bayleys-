import fs from "fs";
import path from "path";

const DATA_DIR = path.resolve("./data");
const DATA_FILE = path.join(DATA_DIR, "knowledge.json");
const ACL_FILE = path.join(DATA_DIR, "knowledge_acl.json");
const AUDIT_FILE = path.join(DATA_DIR, "knowledge_audit.log");

let store = null;
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

function getScopeData(scopeId) {
  ensureLoaded();
  const scope = normScope(scopeId);

  if (!store[scope] || typeof store[scope] !== "object") {
    store[scope] = {};
  }

  return store[scope];
}

function tokenize(text) {
  return Array.from(
    new Set(
      String(text || "")
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter(token => token.length >= 3)
    )
  );
}

export function setStoredFact(scopeId, key, value) {
  const k = normKey(key);
  const v = String(value || "").trim();

  if (!k) throw new Error("Kunci data kosong.");
  if (!v) throw new Error("Nilai data kosong.");

  const scopeData = getScopeData(scopeId);
  scopeData[k] = v;
  persist();

  return { key: k, value: v };
}

export function getStoredFact(scopeId, key) {
  const k = normKey(key);
  if (!k) return null;
  const scopeData = getScopeData(scopeId);
  return scopeData[k] || null;
}

export function deleteStoredFact(scopeId, key) {
  const k = normKey(key);
  if (!k) return false;

  const scope = normScope(scopeId);
  const scopeData = getScopeData(scope);
  if (!(k in scopeData)) return false;

  delete scopeData[k];

  if (Object.keys(scopeData).length === 0) {
    delete store[scope];
  }

  persist();
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
    const hay = `${item.key} ${item.value}`.toLowerCase();
    const score = tokens.reduce((acc, token) => (hay.includes(token) ? acc + 1 : acc), 0);
    return { ...item, score };
  });

  const sorted = withScore.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.key.localeCompare(b.key);
  });

  const selected = sorted
    .filter((item, idx) => item.score > 0 || (tokens.length === 0 && idx < maxEntries))
    .slice(0, maxEntries);

  const source = selected.length ? selected : sorted.slice(0, maxEntries);

  let output = "";
  for (const item of source) {
    const line = `- ${item.key}: ${item.value}\n`;
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
