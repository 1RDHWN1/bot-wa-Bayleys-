import {
  buildLocationQueryVariants,
  extractLocationTokens,
  formatHour,
  formatLocationName,
  getIndonesiaTimezoneLabel,
  getWeatherIcon
} from "../common.js";

function weatherCodeText(code) {
  const c = Number(code);

  if (c === 0) return "Cerah";
  if (c === 1) return "Cerah berawan";
  if (c === 2) return "Berawan";
  if (c === 3) return "Mendung";
  if (c === 45 || c === 48) return "Berkabut";
  if (c === 51 || c === 53 || c === 55) return "Gerimis";
  if (c === 56 || c === 57) return "Gerimis beku";
  if (c === 61 || c === 63 || c === 65) return "Hujan";
  if (c === 66 || c === 67) return "Hujan beku";
  if (c === 71 || c === 73 || c === 75) return "Salju";
  if (c === 77) return "Butiran salju";
  if (c === 80 || c === 81 || c === 82) return "Hujan lokal";
  if (c === 85 || c === 86) return "Salju lokal";
  if (c === 95) return "Badai petir";
  if (c === 96 || c === 99) return "Badai petir + hujan es";

  return "Cuaca tidak diketahui";
}

function normalizeConditionFromCode(code) {
  const text = weatherCodeText(code);
  return `${getWeatherIcon(text)} ${text}`.trim();
}

function scorePlace(place, tokens = []) {
  const haystack = [
    place?.name,
    place?.admin1,
    place?.admin2,
    place?.admin3,
    place?.admin4,
    place?.country
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  let score = 0;
  for (const token of tokens) {
    if (!token) continue;
    if (haystack.includes(token)) score += 1;
  }

  const name = String(place?.name || "").toLowerCase().trim();
  if (name && ["kota", "city", "regency"].includes(name)) {
    score -= 2;
  }

  if (name && tokens.some(t => name === t)) {
    score += 2;
  }

  if (/indonesia/i.test(place?.country || "")) {
    score += 0.5;
  }

  return score;
}

async function geocodeWithOptions(query, countryCode) {
  const countryParam = countryCode ? `&countryCode=${encodeURIComponent(countryCode)}` : "";
  const url =
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}` +
    `&count=10&language=id&format=json${countryParam}`;
  const res = await fetch(url);
  if (!res.ok) {
    return [];
  }

  const data = await res.json();
  return Array.isArray(data?.results) ? data.results : [];
}

async function geocodeLocation(query) {
  const variants = buildLocationQueryVariants(query);
  const tokenSet = extractLocationTokens(query);

  for (const candidate of variants) {
    const indoResults = await geocodeWithOptions(candidate, "ID");
    const globalResults = await geocodeWithOptions(candidate);
    const all = [...indoResults, ...globalResults];

    if (!all.length) continue;

    const sorted = [...all].sort((a, b) => scorePlace(b, tokenSet) - scorePlace(a, tokenSet));
    const best = sorted[0];

    if (!best) continue;
    if (scorePlace(best, tokenSet) < 1.5) continue;

    return {
      name: best.name,
      region: best.admin1 || best.admin2 || best.admin3 || "",
      country: best.country || "",
      latitude: best.latitude,
      longitude: best.longitude
    };
  }

  throw new Error("Lokasi tidak ditemukan (Open-Meteo)");
}

async function fetchForecast(lat, lon) {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    "&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m" +
    "&hourly=temperature_2m,weather_code,precipitation_probability" +
    "&timezone=auto&forecast_days=1&wind_speed_unit=kmh";

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error("Gagal mengambil forecast (Open-Meteo)");
  }
  return res.json();
}

function buildHourlyFromOpenMeteo(hourly, currentTime, limit = 6) {
  const times = hourly?.time || [];
  const temps = hourly?.temperature_2m || [];
  const codes = hourly?.weather_code || [];
  const rainChance = hourly?.precipitation_probability || [];

  const startIndex = Math.max(0, times.findIndex(t => t >= currentTime));

  const output = [];
  for (let i = startIndex; i < times.length && output.length < limit; i++) {
    const conditionText = weatherCodeText(codes[i]);
    output.push({
      time: formatHour(times[i]),
      temp: temps[i],
      condition: conditionText,
      icon: getWeatherIcon(conditionText),
      rainChance: rainChance[i] ?? 0
    });
  }

  return output;
}

export async function getWeatherFromOpenMeteo(query, options = {}) {
  const place = await geocodeLocation(query);
  const forecast = await fetchForecast(place.latitude, place.longitude);

  const current = forecast?.current || {};
  const currentTime = current.time || "";
  const hourly = buildHourlyFromOpenMeteo(forecast.hourly, currentTime, options.hours || 6);

  return {
    source: "openmeteo",
    location: formatLocationName([place.name, place.region, place.country]),
    lat: place.latitude,
    lon: place.longitude,
    timezone: getIndonesiaTimezoneLabel(forecast.timezone || ""),
    temp: current.temperature_2m,
    feels: current.apparent_temperature,
    condition: normalizeConditionFromCode(current.weather_code),
    humidity: current.relative_humidity_2m,
    wind: current.wind_speed_10m,
    rain: current.precipitation ?? 0,
    hourly
  };
}

export async function getHourlyFromOpenMeteo(lat, lon, hours = 6) {
  const forecast = await fetchForecast(lat, lon);
  const currentTime = forecast?.current?.time || "";
  const hourly = buildHourlyFromOpenMeteo(forecast.hourly, currentTime, hours);

  return {
    source: "openmeteo",
    timezone: getIndonesiaTimezoneLabel(forecast.timezone || ""),
    hourly
  };
}
