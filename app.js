const API_URL = "https://api.open-meteo.com/v1/forecast";
const AIR_API_URL = "https://air-quality-api.open-meteo.com/v1/air-quality";
const WEATHER_REFRESH_MS = 10 * 60 * 1000;
const LOCATION = { latitude: 55.0084, longitude: 82.9357, timezone: "Asia/Novosibirsk" };

let requestInFlight = false;
let hasLoadedWeather = false;
let lastSuccessfulUpdate = null;
let lastWeatherFetchAt = 0;
let airRequestInFlight = false;
let lastAirQualityFetchAt = 0;
let latestWeatherCode = null;
let latestDailyWeather = null;

const $ = (id) => document.getElementById(id);
const number = (value, digits = 0) => Number.isFinite(value) ? value.toFixed(digits).replace(".", ",") : "—";
const roundTemp = (value) => Number.isFinite(value) ? `${Math.round(value)}°` : "—°";
const timeOnly = (value) => value && value.includes("T") ? value.split("T")[1].slice(0, 5) : "—:—";

function weatherInfo(code) {
  if (code === 0) return { label: "Ясно", icon: "☀", theme: "clear", effect: "" };
  if (code === 1) return { label: "Преимущественно ясно", icon: "🌤", theme: "clear", effect: "" };
  if (code === 2) return { label: "Переменная облачность", icon: "⛅", theme: "cloudy", effect: "" };
  if (code === 3) return { label: "Облачно", icon: "☁", theme: "cloudy", effect: "" };
  if ([45, 48].includes(code)) return { label: "Туман", icon: "🌫", theme: "fog", effect: "" };
  if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return { label: "Дождь", icon: "🌧", theme: "rain", effect: "rain" };
  if ([71, 73, 75, 77, 85, 86].includes(code)) return { label: "Снег", icon: "❄", theme: "snow", effect: "snow" };
  if ([95, 96, 99].includes(code)) return { label: "Гроза", icon: "⛈", theme: "storm", effect: "rain" };
  return { label: "Переменная погода", icon: "🌤", theme: "clear", effect: "" };
}

function windDirection(degrees) {
  if (!Number.isFinite(degrees)) return "Направление —";
  const directions = ["северный", "северо-восточный", "восточный", "юго-восточный", "южный", "юго-западный", "западный", "северо-западный"];
  return directions[Math.round(degrees / 45) % 8];
}

function setMetric(id, value, barId, percent) {
  $(id).innerHTML = value;
  const safePercent = Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : 0;
  $(barId).style.width = `${safePercent}%`;
}

function setEffects(kind) {
  const root = $("weatherEffects");
  root.replaceChildren();
  if (!kind) return;
  const count = kind === "rain" ? 70 : 44;
  for (let i = 0; i < count; i++) {
    const particle = document.createElement("span");
    particle.className = kind === "rain" ? "rain-drop" : "snowflake";
    particle.style.left = `${Math.random() * 100}%`;
    particle.style.animationDelay = `${-Math.random() * 8}s`;
    particle.style.animationDuration = kind === "rain" ? `${0.7 + Math.random() * 0.8}s` : `${5 + Math.random() * 8}s`;
    if (kind === "snow") {
      const size = 2 + Math.random() * 4;
      particle.style.width = `${size}px`;
      particle.style.height = `${size}px`;
    }
    root.append(particle);
  }
}

function formatDate(dateString) {
  const date = new Date(`${dateString.slice(0, 10)}T12:00:00Z`);
  return new Intl.DateTimeFormat("ru-RU", { weekday: "long", day: "numeric", month: "long", timeZone: LOCATION.timezone }).format(date);
}

function localClockParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: LOCATION.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  return Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
}

function minutesFromLocalTime(value) {
  if (typeof value !== "string" || !/T\d{2}:\d{2}/.test(value)) return null;
  const time = value.split("T")[1];
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
}

function updateAtmosphere() {
  const hero = $("hero");
  if (!hero) return;
  const now = localClockParts();
  const minuteOfDay = now.hour * 60 + now.minute;
  const month = now.month;
  const season = month === 12 || month <= 2 ? "winter"
    : month <= 5 ? "spring"
    : month <= 8 ? "summer" : "autumn";
  const sunrise = minutesFromLocalTime(latestDailyWeather?.sunrise?.[0]);
  const sunset = minutesFromLocalTime(latestDailyWeather?.sunset?.[0]);
  let phase;
  if (sunrise !== null && sunset !== null) {
    if (minuteOfDay < sunrise - 60 || minuteOfDay >= sunset + 90) phase = "night";
    else if (minuteOfDay < sunrise) phase = "dawn";
    else if (minuteOfDay < sunrise + 90) phase = "sunrise";
    else if (minuteOfDay < sunset - 60) phase = "day";
    else phase = "evening";
  } else {
    phase = minuteOfDay < 5 * 60 || minuteOfDay >= 22 * 60 ? "night"
      : minuteOfDay < 7 * 60 ? "dawn"
      : minuteOfDay < 10 * 60 ? "sunrise"
      : minuteOfDay < 17 * 60 ? "day" : "evening";
  }
  hero.classList.remove("season-winter", "season-spring", "season-summer", "season-autumn",
    "time-night", "time-dawn", "time-sunrise", "time-day", "time-evening");
  hero.classList.add(`season-${season}`, `time-${phase}`);
  const daylightProgress = sunrise !== null && sunset !== null && sunset > sunrise
    ? Math.max(0, Math.min(1, (minuteOfDay - sunrise) / (sunset - sunrise)))
    : Math.max(0, Math.min(1, (minuteOfDay - 360) / 720));
  const sunX = 15 + daylightProgress * 70;
  const sunY = phase === "night" ? 18
    : 48 - Math.sin(Math.PI * daylightProgress) * 32;
  hero.style.setProperty("--sun-x", `${sunX}%`);
  hero.style.setProperty("--sun-y", `${Math.max(12, sunY)}%`);
  const cutout = phase === "night" ? "#172b49" : phase === "dawn" || phase === "evening" ? "#bd8490" : "#39749a";
  hero.style.setProperty("--moon-cutout", cutout);
  const info = weatherInfo(latestWeatherCode);
  $("weatherSymbol").textContent = phase === "night" && info.theme === "clear" ? "☾" : info.icon;
}

function updateHero(current, daily) {
  const info = weatherInfo(current.weather_code);
  latestWeatherCode = current.weather_code;
  latestDailyWeather = daily;
  $("hero").className = `hero weather-${info.theme}`;
  $("condition").textContent = info.label;
  $("temperature").textContent = roundTemp(current.temperature_2m);
  $("feelsLike").textContent = roundTemp(current.apparent_temperature);
  $("highLow").textContent = `Сегодня ${roundTemp(daily.temperature_2m_min?.[0])} / ${roundTemp(daily.temperature_2m_max?.[0])}`;
  $("dateLine").textContent = formatDate(current.time);
  $("sunTimes").innerHTML = `↑ Восход ${timeOnly(daily.sunrise?.[0])} <i></i> ↓ Закат ${timeOnly(daily.sunset?.[0])}`;
  setEffects(info.effect);
  updateAtmosphere();
}

function isOrderedTimeArray(times, pattern) {
  return Array.isArray(times) &&
    times.length > 0 &&
    times.every((time, index) =>
      typeof time === "string" &&
      pattern.test(time) &&
      (index === 0 || time >= times[index - 1])
    );
}

function forecastIndexAtOrAfter(times, currentTime) {
  const index = times.findIndex((time) => time >= currentTime);
  return index >= 0 ? index : Math.max(0, times.length - 1);
}

function updateMetrics(current, hourly, daily) {
  // If the current time is beyond the supplied forecast window, use its last hour.
  const hourIndex = forecastIndexAtOrAfter(hourly.time, current.time);
  const rawChance = hourly.precipitation_probability?.[hourIndex];
  const chance = Number.isFinite(rawChance) ? Math.max(0, Math.min(100, rawChance)) : null;
  const uv = daily.uv_index_max?.[0];
  setMetric("wind", `${number(current.wind_speed_10m, 1)} <small>м/с</small>`, "windBar", Number.isFinite(current.wind_speed_10m) ? current.wind_speed_10m * 4 : 0);
  $("windDirection").textContent = `Ветер ${windDirection(current.wind_direction_10m)}`;
  setMetric("humidity", `${number(current.relative_humidity_2m)}<small>%</small>`, "humidityBar", current.relative_humidity_2m);
  setMetric("pressure", `${number(Number.isFinite(current.pressure_msl) ? current.pressure_msl * 0.750061683 : NaN)} <small>мм рт. ст.</small>`, "pressureBar", Number.isFinite(current.pressure_msl) ? (current.pressure_msl - 950) / 1.1 : 0);
  setMetric("uv", number(uv, 1), "uvBar", Number.isFinite(uv) ? uv * 10 : 0);
  $("uvLabel").textContent = !Number.isFinite(uv) ? "Индекс сейчас недоступен" : uv < 3 ? "Низкий уровень" : uv < 6 ? "Умеренный уровень" : uv < 8 ? "Высокий уровень" : "Очень высокий уровень";
  setMetric("precipitation", `${number(current.precipitation, 1)} <small>мм</small>`, "precipBar", chance ?? 0);
  $("precipChance").textContent = `Вероятность осадков: ${chance === null ? "—" : `${chance}%`}`;
  setMetric("gusts", `${number(current.wind_gusts_10m, 1)} <small>м/с</small>`, "gustBar", Number.isFinite(current.wind_gusts_10m) ? current.wind_gusts_10m * 3 : 0);
}

function renderHourly(hourly, currentTime) {
  const start = forecastIndexAtOrAfter(hourly.time, currentTime);
  const list = hourly.time.slice(start, start + 24);
  $("hourlyForecast").replaceChildren();
  list.forEach((time, offset) => {
    const index = start + offset;
    const info = weatherInfo(hourly.weather_code[index]);
    const card = document.createElement("article");
    card.className = "hour-card";
    const label = offset === 0 ? "Сейчас" : timeOnly(time);
    const rawChance = hourly.precipitation_probability?.[index];
    const chance = Number.isFinite(rawChance) ? `${Math.max(0, Math.min(100, rawChance))}%` : "—";
    card.innerHTML = `<span class="hour-time">${label}</span><span class="hour-symbol" aria-hidden="true">${info.icon}</span><strong class="hour-temp">${roundTemp(hourly.temperature_2m[index])}</strong><span class="hour-rain">☂ ${chance}</span>`;
    $("hourlyForecast").append(card);
  });
}

function renderTomorrow(daily) {
  const info = weatherInfo(daily.weather_code?.[1]);
  $("tomorrowCondition").textContent = info.label;
  $("tomorrowSymbol").textContent = info.icon;
  $("tomorrowTemp").textContent = roundTemp(daily.temperature_2m_max?.[1]);
  $("tomorrowRange").textContent = `${roundTemp(daily.temperature_2m_min?.[1])} / ${roundTemp(daily.temperature_2m_max?.[1])}`;
  const rawRain = daily.precipitation_probability_max?.[1];
  const rawSum = daily.precipitation_sum?.[1];
  const rain = Number.isFinite(rawRain) ? `${Math.max(0, Math.min(100, rawRain))}%` : "—";
  const sum = Number.isFinite(rawSum) ? `${number(rawSum, 1)} мм` : "—";
  $("tomorrowSummary").textContent = `Вероятность осадков — ${rain}. Количество осадков: ${sum}. Восход в ${timeOnly(daily.sunrise?.[1])}, закат в ${timeOnly(daily.sunset?.[1])}.`;
}

async function loadWeather() {
  if (requestInFlight) return;
  requestInFlight = true;
  const params = new URLSearchParams({
    latitude: LOCATION.latitude,
    longitude: LOCATION.longitude,
    timezone: LOCATION.timezone,
    forecast_days: 2,
    forecast_hours: 25,
    current: "temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,rain,showers,snowfall,weather_code,cloud_cover,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m",
    hourly: "temperature_2m,precipitation_probability,precipitation,weather_code,wind_speed_10m",
    daily: "weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,uv_index_max,precipitation_probability_max,precipitation_sum"
  });
  try {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 12000);
    let data;
    try {
      const response = await fetch(`${API_URL}?${params}`, { cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error(`Weather API returned ${response.status}`);
      data = await response.json();
    } finally {
      // Keep the timeout active while the response body is being read, not just until headers arrive.
      window.clearTimeout(timeout);
    }
    const hourly = data.hourly;
    const daily = data.daily;
    const hourlyFields = ["temperature_2m", "weather_code", "precipitation_probability"];
    const dailyFields = ["temperature_2m_max", "temperature_2m_min", "weather_code", "sunrise", "sunset", "uv_index_max", "precipitation_probability_max", "precipitation_sum"];
    const hourlyInvalid = !isOrderedTimeArray(hourly?.time, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/) ||
      hourlyFields.some((key) => !Array.isArray(hourly[key]) || hourly[key].length < hourly.time.length);
    const dailyInvalid = !isOrderedTimeArray(daily?.time, /^\d{4}-\d{2}-\d{2}$/) ||
      daily.time.length < 2 ||
      dailyFields.some((key) => !Array.isArray(daily[key]) || daily[key].length < daily.time.length);
    if (!data.current || typeof data.current.time !== "string" ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(data.current.time) ||
        !Number.isFinite(data.current.temperature_2m) || hourlyInvalid || dailyInvalid) {
      throw new Error("Weather response is incomplete or has invalid time data");
    }
    updateHero(data.current, data.daily);
    updateMetrics(data.current, data.hourly, data.daily);
    renderHourly(data.hourly, data.current.time);
    renderTomorrow(data.daily);
    hasLoadedWeather = true;
    lastSuccessfulUpdate = data.current.time;
    lastWeatherFetchAt = Date.now();
    $("statusText").textContent = "Данные актуальны";
    document.querySelector(".live-dot")?.classList.remove("is-error", "is-loading");
    $("updatedAt").textContent = `Обновлено в ${timeOnly(data.current.time)}`;
    $("errorMessage").hidden = true;
  } catch (error) {
    console.error("Не удалось обновить погоду:", error);
    $("statusText").textContent = error.name === "AbortError" ? "Погода отвечает слишком долго" : "Нет связи с погодой";
    document.querySelector(".live-dot")?.classList.remove("is-loading");
    document.querySelector(".live-dot")?.classList.add("is-error");
    $("errorMessage").textContent = hasLoadedWeather
      ? "Не удалось обновить прогноз. На экране оставлены последние успешно полученные данные."
      : "Не удалось получить погоду. Проверьте подключение к интернету и попробуйте позже.";
    $("errorMessage").hidden = false;
    if (hasLoadedWeather && lastSuccessfulUpdate) {
      $("updatedAt").textContent = `Последнее обновление в ${timeOnly(lastSuccessfulUpdate)}`;
    }
  } finally {
    requestInFlight = false;
  }
}

loadWeather();
window.setInterval(loadWeather, WEATHER_REFRESH_MS);
updateAtmosphere();
window.setInterval(updateAtmosphere, 60 * 1000);
function refreshWhenPageReturns() {
  if (document.hidden) return;
  updateAtmosphere();
  const now = Date.now();
  // Mobile browsers throttle timers while a tab is in the background. Refresh stale data on return.
  if (now - lastWeatherFetchAt >= 5 * 60 * 1000) loadWeather();
  if (now - lastAirQualityFetchAt >= 5 * 60 * 1000) loadAirQuality();
}

document.addEventListener("visibilitychange", refreshWhenPageReturns);
window.addEventListener("pageshow", refreshWhenPageReturns);

const aqiDescription = (value) => {
  if (!Number.isFinite(value)) return "Индекс недоступен";
  if (value <= 20) return "Хорошее качество воздуха";
  if (value <= 40) return "Удовлетворительное качество";
  if (value <= 60) return "Умеренное загрязнение";
  if (value <= 80) return "Плохое качество воздуха";
  if (value <= 100) return "Очень плохое качество";
  return "Чрезвычайно плохое качество";
};

async function loadAirQuality() {
  if (airRequestInFlight) return;
  airRequestInFlight = true;
  const params = new URLSearchParams({
    latitude: LOCATION.latitude,
    longitude: LOCATION.longitude,
    timezone: LOCATION.timezone,
    current: "european_aqi,pm2_5,pm10,nitrogen_dioxide,ozone",
    hourly: "european_aqi,pm2_5,pm10,nitrogen_dioxide,ozone",
    forecast_hours: 24
  });
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(`${AIR_API_URL}?${params}`, { cache: "no-store", signal: controller.signal });
    if (!response.ok) throw new Error(`Air quality API returned ${response.status}`);
    const data = await response.json();
    const current = data.current;
    if (!current || typeof current.time !== "string" ||
        !Number.isFinite(current.european_aqi) ||
        !Number.isFinite(current.pm2_5) ||
        !Number.isFinite(current.pm10)) {
      throw new Error("Air quality response is incomplete");
    }
    lastAirQualityFetchAt = Date.now();
    const aqi = current.european_aqi;
    setMetric("airAqi", number(aqi), "airAqiBar", Math.min(100, aqi));
    $("airAqiLabel").textContent = aqiDescription(aqi);
    $("airUpdatedAt").textContent = `Модельные данные на ${timeOnly(current.time)} · Open-Meteo / CAMS`;
    setMetric("pm25", `${number(current.pm2_5, 1)} <small>мкг/м³</small>`, "pm25Bar", current.pm2_5 * 2);
    setMetric("pm10", `${number(current.pm10, 1)} <small>мкг/м³</small>`, "pm10Bar", current.pm10 / 3);
    setMetric("no2", `${number(current.nitrogen_dioxide, 1)} <small>мкг/м³</small>`, "no2Bar", current.nitrogen_dioxide / 1.5);
    setMetric("ozone", `${number(current.ozone, 1)} <small>мкг/м³</small>`, "ozoneBar", current.ozone / 1.8);
    $("airError").hidden = true;
  } catch (error) {
    console.error("Не удалось обновить качество воздуха:", error);
    $("airError").hidden = false;
    $("airError").textContent = "Не удалось получить свежие данные о качестве воздуха. Повторим попытку через 10 минут.";
    if ($("airAqi").textContent.trim() === "—") $("airAqiLabel").textContent = "Данные временно недоступны";
  } finally {
    window.clearTimeout(timeout);
    airRequestInFlight = false;
  }
}

loadAirQuality();
window.setInterval(loadAirQuality, WEATHER_REFRESH_MS);