import {
  buildLocationQueryVariants,
  extractLocationTokens,
  formatHour,
  formatLocationName,
  getIndonesiaTimezoneLabel,
  getWeatherIcon,
  hourFromDateTimeString
} from "../common.js";

function normalizeCurrentCondition(text = "") {
  return `${getWeatherIcon(text)} ${text}`.trim();
}

function locationScoreFromTokens(location, tokens = []) {
  const haystack = [
    location?.name,
    location?.region,
    location?.country
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  let score = 0;
  for (const token of tokens) {
    if (haystack.includes(token)) score += 1;
  }

  const name = String(location?.name || "").toLowerCase().trim();
  if (name && tokens.some(t => name === t)) {
    score += 2;
  }

  if (name && ["kota", "city", "regency"].includes(name)) {
    score -= 2;
  }

  if (/indonesia/i.test(location?.country || "")) {
    score += 0.5;
  }

  return score;
}

function buildHourlyFromWeatherAPI(hours = [], currentHour = 0, limit = 6) {
  return hours
    .filter(item => hourFromDateTimeString(item.time) >= currentHour)
    .slice(0, limit)
    .map(item => ({
      time: formatHour(item.time),
      temp: item.temp_c,
      condition: item.condition?.text || "-",
      icon: getWeatherIcon(item.condition?.text || ""),
      rainChance: item.chance_of_rain ?? 0
    }));
}

function assertWeatherApiKey() {
  const apiKey = process.env.WEATHERAPI_KEY;
  if (!apiKey) {
    throw new Error("WEATHERAPI_KEY belum diset");
  }
  return apiKey;
}

async function fetchForecast(apiKey, q, days, lang) {
  const url = `https://api.weatherapi.com/v1/forecast.json?key=${apiKey}&q=${encodeURIComponent(
    q
  )}&days=${days}&lang=${lang}`;

  const res = await fetch(url);
  if (!res.ok) {
    return null;
  }

  return res.json();
}

function pickBestSearchResult(results = [], tokens = []) {
  if (!Array.isArray(results) || !results.length) return null;

  const sorted = [...results].sort(
    (a, b) => locationScoreFromTokens(b, tokens) - locationScoreFromTokens(a, tokens)
  );
  const best = sorted[0];
  if (!best) return null;
  if (locationScoreFromTokens(best, tokens) < 1.5) return null;
  return best;
}

async function resolveForecastData(apiKey, query, days, lang) {
  const tokens = extractLocationTokens(query);
  const variants = buildLocationQueryVariants(query);

  for (const variant of variants) {
    const direct = await fetchForecast(apiKey, variant, days, lang);
    if (direct && locationScoreFromTokens(direct.location, tokens) >= 1.5) {
      return direct;
    }
  }

  // fallback: use search endpoint first, then forecast by coordinates
  for (const variant of variants) {
    const searchUrl = `https://api.weatherapi.com/v1/search.json?key=${apiKey}&q=${encodeURIComponent(variant)}`;
    const searchRes = await fetch(searchUrl);
    if (!searchRes.ok) continue;

    const searchData = await searchRes.json();
    const best = pickBestSearchResult(searchData, tokens);
    if (!best) continue;

    const data = await fetchForecast(apiKey, `${best.lat},${best.lon}`, days, lang);
    if (data) {
      return data;
    }
  }

  throw new Error("Lokasi tidak ditemukan (WeatherAPI)");
}

export async function getWeatherFromWeatherAPI(query, options = {}) {
  const apiKey = assertWeatherApiKey();
  const lang = options.lang || "id";
  const days = options.days || 1;
  const limit = options.hours || 6;
  const data = await resolveForecastData(apiKey, query, days, lang);
  const localTime = data.location?.localtime || "";
  const currentHour = hourFromDateTimeString(localTime);
  const hourlyRaw = data.forecast?.forecastday?.[0]?.hour || [];
  const hourly = buildHourlyFromWeatherAPI(hourlyRaw, currentHour, limit);

  return {
    source: "weatherapi",
    location: formatLocationName([
      data.location?.name,
      data.location?.region,
      data.location?.country
    ]),
    lat: data.location?.lat,
    lon: data.location?.lon,
    timezone: getIndonesiaTimezoneLabel(data.location?.tz_id || ""),
    temp: data.current?.temp_c,
    feels: data.current?.feelslike_c,
    condition: normalizeCurrentCondition(data.current?.condition?.text || ""),
    humidity: data.current?.humidity,
    wind: data.current?.wind_kph,
    rain: data.current?.precip_mm,
    hourly
  };
}

export async function getHourlyFromWeatherAPI(lat, lon, hours = 6) {
  const apiKey = assertWeatherApiKey();
  const url = `https://api.weatherapi.com/v1/forecast.json?key=${apiKey}&q=${lat},${lon}&lang=id`;

  const res = await fetch(url);
  if (!res.ok) throw new Error("Gagal ambil forecast (WeatherAPI)");

  const data = await res.json();
  const localTime = data.location?.localtime || "";
  const currentHour = hourFromDateTimeString(localTime);
  const hourlyRaw = data.forecast?.forecastday?.[0]?.hour || [];
  const hourly = buildHourlyFromWeatherAPI(hourlyRaw, currentHour, hours);

  return {
    source: "weatherapi",
    timezone: getIndonesiaTimezoneLabel(data.location?.tz_id || ""),
    hourly
  };
}
