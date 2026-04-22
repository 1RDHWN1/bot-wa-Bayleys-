export function getWeatherIcon(text = "") {
  const t = String(text).toLowerCase();

  if (t.includes("thunder")) return "⛈️";
  if (t.includes("rain") || t.includes("drizzle")) return "🌧️";
  if (t.includes("snow")) return "❄️";
  if (t.includes("mist") || t.includes("fog")) return "🌫️";
  if (t.includes("cloud")) return "☁️";
  if (t.includes("clear") || t.includes("cerah")) return "☀️";

  return "🌤️";
}

export function getIndonesiaTimezoneLabel(tz = "") {
  if (tz === "Asia/Jakarta") return "WIB";
  if (tz === "Asia/Makassar") return "WITA";
  if (tz === "Asia/Jayapura") return "WIT";
  return tz;
}

const LOCATION_STOP_WORDS = new Set([
  "kota",
  "kab",
  "kabupaten",
  "kec",
  "kecamatan",
  "kel",
  "kelurahan",
  "desa",
  "prov",
  "provinsi",
  "kotaadm",
  "kotaadministratif"
]);

function normalizeAdminTerms(text = "") {
  return String(text)
    .toLowerCase()
    .replace(/\bkab\.\s*/g, "kabupaten ")
    .replace(/\bkec\.\s*/g, "kecamatan ")
    .replace(/\bprov\.\s*/g, "provinsi ")
    .replace(/[^\p{L}\p{N}\s,]/gu, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function sanitizeLocationQuery(query = "") {
  const normalized = normalizeAdminTerms(query);
  if (!normalized) return "";

  const tokens = normalized
    .split(/[\s,]+/)
    .map(v => v.trim())
    .filter(Boolean)
    .filter(v => !LOCATION_STOP_WORDS.has(v));

  return tokens.join(" ").trim();
}

export function extractLocationTokens(query = "") {
  return sanitizeLocationQuery(query)
    .split(/\s+/)
    .map(v => v.trim())
    .filter(v => v.length >= 3);
}

export function buildLocationQueryVariants(query = "") {
  const raw = String(query || "").trim();
  if (!raw) return [];

  const clean = sanitizeLocationQuery(raw);
  const segments = raw
    .split(",")
    .map(v => sanitizeLocationQuery(v))
    .filter(Boolean);

  const variants = [
    raw,
    clean,
    clean ? `${clean} indonesia` : "",
    segments.join(" "),
    segments.slice(0, 2).join(" "),
    segments.slice(-2).join(" "),
    segments[0] || "",
    segments[1] || "",
    segments[2] || ""
  ].filter(Boolean);

  // Add fallback that prioritizes most-specific words (last 2 tokens)
  const cleanTokens = clean.split(/\s+/).filter(Boolean);
  if (cleanTokens.length >= 2) {
    variants.push(cleanTokens.slice(0, 2).join(" "));
    variants.push(cleanTokens.slice(-2).join(" "));
  }

  return [...new Set(variants)];
}

export function formatLocationName(parts = []) {
  return parts
    .map(v => String(v || "").trim())
    .filter(Boolean)
    .join(", ");
}

export function hourFromDateTimeString(value = "") {
  const match = String(value).match(/(\d{2}):\d{2}$/);
  return match ? Number(match[1]) : 0;
}

export function formatHour(value = "") {
  const match = String(value).match(/(\d{2}:\d{2})$/);
  return match ? match[1] : String(value).slice(-5);
}
