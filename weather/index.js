import { getHourlyFromOpenMeteo, getWeatherFromOpenMeteo } from "./providers/openmeteo.js";
import { getHourlyFromWeatherAPI, getWeatherFromWeatherAPI } from "./providers/weatherapi.js";

function normalizeProviderName(name = "") {
  const key = String(name).trim().toLowerCase();
  if (key === "open-meteo") return "openmeteo";
  if (key === "weather-api") return "weatherapi";
  return key;
}

function getProviderOrder() {
  const chainRaw = process.env.WEATHER_PROVIDER_CHAIN;
  if (chainRaw && chainRaw.trim()) {
    const chain = chainRaw
      .split(",")
      .map(v => normalizeProviderName(v))
      .filter(Boolean);
    if (chain.length) return [...new Set(chain)];
  }

  const primary = normalizeProviderName(process.env.WEATHER_PROVIDER || "openmeteo");
  const fallback = normalizeProviderName(process.env.WEATHER_FALLBACK || "weatherapi");

  const order = [primary, fallback].filter(Boolean);
  return [...new Set(order)];
}

async function callProviderForWeather(providerName, query, options) {
  if (providerName === "openmeteo") {
    return getWeatherFromOpenMeteo(query, options);
  }

  if (providerName === "weatherapi") {
    return getWeatherFromWeatherAPI(query, options);
  }

  throw new Error(`Provider tidak dikenal: ${providerName}`);
}

async function callProviderForHourly(providerName, lat, lon, hours) {
  if (providerName === "openmeteo") {
    return getHourlyFromOpenMeteo(lat, lon, hours);
  }

  if (providerName === "weatherapi") {
    return getHourlyFromWeatherAPI(lat, lon, hours);
  }

  throw new Error(`Provider tidak dikenal: ${providerName}`);
}

export async function getWeatherData(query, options = {}) {
  const providers = options.providers || getProviderOrder();
  const errors = [];

  for (const provider of providers) {
    try {
      return await callProviderForWeather(provider, query, options);
    } catch (err) {
      errors.push(`${provider}: ${err?.message || String(err)}`);
    }
  }

  throw new Error(`Semua provider cuaca gagal. ${errors.join(" | ")}`);
}

export async function getHourlyWeatherData(lat, lon, hours = 6, options = {}) {
  const providers = options.providers || getProviderOrder();
  const errors = [];

  for (const provider of providers) {
    try {
      return await callProviderForHourly(provider, lat, lon, hours);
    } catch (err) {
      errors.push(`${provider}: ${err?.message || String(err)}`);
    }
  }

  throw new Error(`Semua provider cuaca gagal. ${errors.join(" | ")}`);
}
