const WEATHER_API_URLS = [
  "https://194.87.186.159/weather-api/forecast"
];
const WEATHER_REFRESH_MS = 30 * 60 * 1000;
const WEATHER_CACHE_KEY = "sever-weather-cache-v1";
const LOCATION = { latitude: 55.0084, longitude: 82.9357, timezone: "Asia/Novosibirsk" };

let requestInFlight = false;
let hasLoadedWeather = false;
let lastSuccessfulUpdate = null;
let lastWeatherFetchAt = 0;
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
}

function renderDayForecast(daily, index, ids) {
  const info = weatherInfo(daily.weather_code?.[index]);
  $(ids.condition).textContent = info.label;
  $(ids.symbol).textContent = info.icon;
  $(ids.temp).textContent = roundTemp(daily.temperature_2m_max?.[index]);
  $(ids.range).textContent = roundTemp(daily.temperature_2m_min?.[index]) + " / " + roundTemp(daily.temperature_2m_max?.[index]);
  const rawRain = daily.precipitation_probability_max?.[index];
  const rawSum = daily.precipitation_sum?.[index];
  const rain = Number.isFinite(rawRain) ? Math.max(0, Math.min(100, rawRain)) + "%" : "—";
  const sum = Number.isFinite(rawSum) ? number(rawSum, 1) + " мм" : "—";
  $(ids.summary).textContent = "Вероятность осадков — " + rain + ". Количество осадков: " + sum +
    ". Восход в " + timeOnly(daily.sunrise?.[index]) + ", закат в " + timeOnly(daily.sunset?.[index]) + ".";
}

function renderTomorrow(daily) {
  renderDayForecast(daily, 1, {
    condition: "tomorrowCondition", symbol: "tomorrowSymbol", temp: "tomorrowTemp",
    range: "tomorrowRange", summary: "tomorrowSummary"
  });
  if ($("dayAfterCondition")) {
    renderDayForecast(daily, 2, {
      condition: "dayAfterCondition", symbol: "dayAfterSymbol", temp: "dayAfterTemp",
      range: "dayAfterRange", summary: "dayAfterSummary"
    });
  }
}
function numeric(value) {
  const result = Number.parseFloat(value);
  return Number.isFinite(result) ? result : NaN;
}

function wwoToWmo(code) {
  const value = Number(code);
  if (value === 113) return 0;
  if (value === 116) return 2;
  if ([119, 122].includes(value)) return 3;
  if ([143, 248, 260].includes(value)) return 45;
  if ([176, 263, 266, 281, 284, 293, 296].includes(value)) return 61;
  if ([299, 302].includes(value)) return 63;
  if ([305, 308].includes(value)) return 65;
  if ([311, 314, 317].includes(value)) return 66;
  if ([179, 323, 326, 368, 371].includes(value)) return 71;
  if ([182, 185, 320, 329, 332].includes(value)) return 73;
  if ([335, 338].includes(value)) return 75;
  if ([350, 362, 365, 374, 377].includes(value)) return 77;
  if (value === 353) return 80;
  if (value === 356) return 81;
  if (value === 359) return 82;
  if ([200, 386, 389, 392, 395].includes(value)) return 95;
  return 3;
}

function parseWttrTime(value) {
  const match = String(value || "").trim().match(/^(\d{1,2}):?(\d{2})\s*(AM|PM)?$/i);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const meridiem = match[3]?.toUpperCase();
  if (meridiem) {
    if (hour === 12) hour = 0;
    if (meridiem === "PM") hour += 12;
  }
  return String(hour).padStart(2, "0") + ":" + String(minute).padStart(2, "0");
}

function wttrHourTime(day, item) {
  const raw = String(item.time ?? "0").padStart(4, "0");
  return day.date + "T" + raw.slice(0, 2) + ":" + raw.slice(2, 4);
}

function wttrToForecast(source) {
  const condition = source.current_condition?.[0];
  const days = source.weather;
  if (!condition || !Array.isArray(days) || days.length < 3) {
    throw new Error("wttr.in returned an incomplete forecast");
  }

  const now = localClockParts();
  const currentTime = String(now.year) + "-" + String(now.month).padStart(2, "0") + "-" +
    String(now.day).padStart(2, "0") + "T" + String(now.hour).padStart(2, "0") + ":" +
    String(now.minute).padStart(2, "0");
  const current = {
    time: currentTime,
    temperature_2m: numeric(condition.temp_C),
    apparent_temperature: numeric(condition.FeelsLikeC),
    relative_humidity_2m: numeric(condition.humidity),
    precipitation: numeric(condition.precipMM),
    weather_code: wwoToWmo(condition.weatherCode),
    pressure_msl: numeric(condition.pressure),
    wind_speed_10m: numeric(condition.windspeedKmph) / 3.6,
    wind_direction_10m: numeric(condition.winddirDegree),
    wind_gusts_10m: numeric(condition.WindGustKmph) / 3.6
  };
  const hourly = { time: [], temperature_2m: [], precipitation_probability: [], precipitation: [], weather_code: [], wind_speed_10m: [] };
  const daily = {
    time: [], weather_code: [], temperature_2m_max: [], temperature_2m_min: [],
    sunrise: [], sunset: [], uv_index_max: [], precipitation_probability_max: [], precipitation_sum: []
  };

  for (const day of days) {
    const hours = Array.isArray(day.hourly) ? day.hourly : [];
    if (!hours.length) throw new Error("wttr.in forecast day has no hourly data");
    const noon = hours.find((hour) => Number(hour.time) === 1200) || hours[Math.floor(hours.length / 2)];
    const astronomy = day.astronomy?.[0] || {};
    const sunrise = parseWttrTime(astronomy.sunrise);
    const sunset = parseWttrTime(astronomy.sunset);
    const rainChances = [];
    const precipAmounts = [];
    const uvValues = [];

    daily.time.push(day.date);
    daily.weather_code.push(wwoToWmo(noon.weatherCode));
    daily.temperature_2m_max.push(numeric(day.maxtempC));
    daily.temperature_2m_min.push(numeric(day.mintempC));
    daily.sunrise.push(sunrise ? day.date + "T" + sunrise : null);
    daily.sunset.push(sunset ? day.date + "T" + sunset : null);

    for (const hour of hours) {
      const chanceRain = numeric(hour.chanceofrain);
      const chanceSnow = numeric(hour.chanceofsnow);
      const chance = Number.isFinite(chanceRain) || Number.isFinite(chanceSnow)
        ? Math.max(Number.isFinite(chanceRain) ? chanceRain : 0, Number.isFinite(chanceSnow) ? chanceSnow : 0)
        : NaN;
      const amount = numeric(hour.precipMM);
      const uv = numeric(hour.uvIndex);
      if (Number.isFinite(chance)) rainChances.push(chance);
      if (Number.isFinite(amount)) precipAmounts.push(amount);
      if (Number.isFinite(uv)) uvValues.push(uv);
      hourly.time.push(wttrHourTime(day, hour));
      hourly.temperature_2m.push(numeric(hour.tempC));
      hourly.precipitation_probability.push(chance);
      hourly.precipitation.push(amount);
      hourly.weather_code.push(wwoToWmo(hour.weatherCode));
      hourly.wind_speed_10m.push(numeric(hour.windspeedKmph) / 3.6);
    }

    daily.uv_index_max.push(uvValues.length ? Math.max(...uvValues) : NaN);
    daily.precipitation_probability_max.push(rainChances.length ? Math.max(...rainChances) : NaN);
    daily.precipitation_sum.push(precipAmounts.length ? precipAmounts.reduce((sum, amount) => sum + amount, 0) : NaN);
  }

  if (!Number.isFinite(current.temperature_2m)) throw new Error("wttr.in current temperature is missing");
  return { current: current, hourly: hourly, daily: daily };
}

function openMeteoToForecast(source) {
  const current = source.current;
  const hourly = source.hourly;
  const daily = source.daily;
  if (!current || !hourly || !daily ||
      !Array.isArray(hourly.time) || !Array.isArray(daily.time) ||
      daily.time.length < 3) {
    throw new Error("Open-Meteo returned an incomplete forecast");
  }
  return {
    current: {
      time: current.time,
      temperature_2m: current.temperature_2m,
      apparent_temperature: current.apparent_temperature,
      relative_humidity_2m: current.relative_humidity_2m,
      precipitation: current.precipitation,
      weather_code: current.weather_code,
      pressure_msl: current.pressure_msl,
      wind_speed_10m: current.wind_speed_10m,
      wind_direction_10m: current.wind_direction_10m,
      wind_gusts_10m: current.wind_gusts_10m
    },
    hourly: {
      time: hourly.time,
      temperature_2m: hourly.temperature_2m,
      precipitation_probability: hourly.precipitation_probability,
      precipitation: hourly.precipitation,
      weather_code: hourly.weather_code,
      wind_speed_10m: hourly.wind_speed_10m
    },
    daily: {
      time: daily.time,
      weather_code: daily.weather_code,
      temperature_2m_max: daily.temperature_2m_max,
      temperature_2m_min: daily.temperature_2m_min,
      sunrise: daily.sunrise,
      sunset: daily.sunset,
      uv_index_max: daily.uv_index_max,
      precipitation_probability_max: daily.precipitation_probability_max,
      precipitation_sum: daily.precipitation_sum
    }
  };
}

function renderWeatherForecast(data, cached = false) {
  const hourly = data.hourly;
  const daily = data.daily;
  const hourlyFields = ["temperature_2m", "weather_code", "precipitation_probability"];
  const dailyFields = ["temperature_2m_max", "temperature_2m_min", "weather_code", "sunrise", "sunset", "uv_index_max", "precipitation_probability_max", "precipitation_sum"];
  const hourlyInvalid = !isOrderedTimeArray(hourly?.time, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/) ||
    hourlyFields.some((key) => !Array.isArray(hourly[key]) || hourly[key].length < hourly.time.length);
  const dailyInvalid = !isOrderedTimeArray(daily?.time, /^\d{4}-\d{2}-\d{2}$/) ||
    daily.time.length < 3 ||
    dailyFields.some((key) => !Array.isArray(daily[key]) || daily[key].length < daily.time.length);
  if (!data.current || typeof data.current.time !== "string" ||
      !Number.isFinite(data.current.temperature_2m) || hourlyInvalid || dailyInvalid) {
    throw new Error("Weather data is incomplete or has invalid time data");
  }

  updateHero(data.current, data.daily);
  updateMetrics(data.current, data.hourly, data.daily);
  renderTomorrow(data.daily);
  hasLoadedWeather = true;
  lastSuccessfulUpdate = data.current.time;
  if (!cached) lastWeatherFetchAt = Date.now();
  $("statusText").textContent = cached ? "Показан сохранённый прогноз" : "Данные актуальны";
  document.querySelector(".live-dot")?.classList.remove("is-error", "is-loading");
  $("updatedAt").textContent = (cached ? "Сохранено ранее · " : "Обновлено · ") + timeOnly(data.current.time);
  $("errorMessage").hidden = true;
}

function loadCachedWeather() {
  try {
    const cached = JSON.parse(localStorage.getItem(WEATHER_CACHE_KEY) || "null");
    if (cached?.data) renderWeatherForecast(cached.data, true);
  } catch (error) {
    console.warn("Не удалось прочитать сохранённый прогноз:", error);
  }
}

async function loadWeather() {
  if (requestInFlight) return;
  requestInFlight = true;
  let lastError;
  try {
    let sourceData = null;
    for (const url of WEATHER_API_URLS) {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 12000);
      try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error("Weather API returned " + response.status);
        sourceData = await response.json();
        break;
      } catch (error) {
        lastError = error;
        console.warn("Не удалось получить погоду с " + url + ":", error);
      } finally {
        window.clearTimeout(timeout);
      }
    }
    if (!sourceData) throw lastError || new Error("Weather services are unavailable");

    const forecast = openMeteoToForecast(sourceData);
    renderWeatherForecast(forecast, false);
    try {
      localStorage.setItem(WEATHER_CACHE_KEY, JSON.stringify({ savedAt: Date.now(), data: forecast }));
    } catch (error) {
      console.warn("Не удалось сохранить прогноз локально:", error);
    }
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
      $("updatedAt").textContent = "Последнее успешное обновление · " + timeOnly(lastSuccessfulUpdate);
    }
  } finally {
    requestInFlight = false;
  }
}
loadCachedWeather();
loadWeather();
window.setInterval(loadWeather, WEATHER_REFRESH_MS);
updateAtmosphere();
window.setInterval(updateAtmosphere, 60 * 1000);
function refreshWhenPageReturns() {
  if (document.hidden) return;
  updateAtmosphere();
  const now = Date.now();
  // Mobile browsers throttle timers while a tab is in the background. Refresh stale data on return.
  if (now - lastWeatherFetchAt >= WEATHER_REFRESH_MS) loadWeather();
}

document.addEventListener("visibilitychange", refreshWhenPageReturns);
window.addEventListener("pageshow", refreshWhenPageReturns);


const AIR_QUALITY_API_URL = "https://194.87.186.159/weather-api/air-quality";
const AIR_QUALITY_CACHE_KEY = "sever-air-quality-cache-v1";
const AIR_QUALITY_REFRESH_MS = 30 * 60 * 1000;

function airQualityInfo(value) {
  if (!Number.isFinite(value)) return {label:"Нет данных",advice:"Индекс качества воздуха сейчас недоступен.",className:""};
  if (value <= 20) return {label:"Хорошее",advice:"Качество воздуха благоприятное для обычной активности на улице.",className:"aqi-good"};
  if (value <= 40) return {label:"Удовлетворительное",advice:"В целом условия приемлемые. Очень чувствительным людям стоит следить за самочувствием.",className:"aqi-fair"};
  if (value <= 60) return {label:"Умеренное",advice:"Чувствительным людям стоит сократить длительную интенсивную нагрузку на улице.",className:"aqi-moderate"};
  if (value <= 80) return {label:"Плохое",advice:"Людям с повышенной чувствительностью лучше уменьшить длительную активность на улице.",className:"aqi-poor"};
  if (value <= 100) return {label:"Очень плохое",advice:"Рекомендуется ограничить продолжительную физическую активность на открытом воздухе.",className:"aqi-very-poor"};
  return {label:"Крайне плохое",advice:"По возможности сократите пребывание на улице и интенсивную физическую нагрузку.",className:"aqi-extreme"};
}

function renderAirQuality(data, cached = false) {
  const current = data?.current;
  if (!current || !Number.isFinite(current.european_aqi) || typeof current.time !== "string") {
    throw new Error("Open-Meteo returned incomplete air-quality data");
  }
  const info = airQualityInfo(current.european_aqi);
  const panel = $("airQualitySection");
  const summary = panel?.querySelector(".air-quality-summary");
  if (!panel || !summary) return;
  summary.classList.remove("aqi-good","aqi-fair","aqi-moderate","aqi-poor","aqi-very-poor","aqi-extreme");
  if (info.className) summary.classList.add(info.className);
  $("airAqi").textContent = Math.round(current.european_aqi);
  $("airCategory").textContent = info.label;
  $("airAdvice").textContent = info.advice;
  $("airUpdated").textContent = (cached ? "Сохранённые данные · " : "Время модели · ") + timeOnly(current.time);
  $("airQualityStatus").textContent = cached ? "Последние сохранённые данные" : "Данные Open-Meteo";

}

function loadCachedAirQuality() {
  try {
    const cached = JSON.parse(localStorage.getItem(AIR_QUALITY_CACHE_KEY) || "null");
    if (cached?.data) renderAirQuality(cached.data, true);
  } catch (error) {
    console.warn("Не удалось прочитать сохранённые данные качества воздуха:", error);
  }
}

async function loadAirQuality() {
  try {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 12000);
    let response;
    try {
      response = await fetch(AIR_QUALITY_API_URL, {signal:controller.signal});
    } finally {
      window.clearTimeout(timeout);
    }
    if (!response.ok) throw new Error("Air-quality API returned " + response.status);
    const data = await response.json();
    renderAirQuality(data, false);
    try {
      localStorage.setItem(AIR_QUALITY_CACHE_KEY, JSON.stringify({savedAt:Date.now(),data}));
    } catch (error) {
      console.warn("Не удалось сохранить качество воздуха локально:", error);
    }
  } catch (error) {
    console.warn("Не удалось обновить качество воздуха:", error);
    $("airQualityStatus").textContent = "Нет связи с источником";
    if (!$("airAqi").textContent || $("airAqi").textContent === "—") {
      $("airCategory").textContent = "Данные пока недоступны";
      $("airAdvice").textContent = "Не удалось загрузить качество воздуха. Попробуем снова автоматически.";
    }
  }
}

loadCachedAirQuality();
loadAirQuality();
window.setInterval(loadAirQuality, AIR_QUALITY_REFRESH_MS);


/* Moon phase is calculated locally; eclipse dates are precomputed for Novosibirsk. */
const LUNAR_MONTH_DAYS = 29.530588853;
const KNOWN_NEW_MOON_UTC = Date.UTC(2000, 0, 6, 18, 14);
const NOVOSIBIRSK_ECLIPSES = {
  lunar: [
    { at: "2027-02-21T06:12:44+07:00", date: "2027-02-21", type: "Полутеневое лунное затмение", time: "06:12", detail: "Максимум затмения", visibility: "Видно в Новосибирске" },
    { at: "2027-07-18T23:02:55+07:00", date: "2027-07-18", type: "Полутеневое лунное затмение", time: "23:02", detail: "Максимум затмения", visibility: "Видно в Новосибирске" },
    { at: "2028-01-12T09:56:00+07:00", date: "2028-01-12", type: "Полутеневое лунное затмение", time: "09:56", detail: "Максимум видимой фазы; Луна у горизонта", visibility: "Частично видно в Новосибирске" },
    { at: "2028-07-07T01:19:38+07:00", date: "2028-07-07", type: "Частное лунное затмение", time: "01:19", detail: "Максимум затмения", visibility: "Видно в Новосибирске" },
    { at: "2028-12-31T23:51:55+07:00", date: "2028-12-31", type: "Полное лунное затмение", time: "23:51", detail: "Максимум затмения", visibility: "Видно в Новосибирске" },
    { at: "2029-12-21T05:41:55+07:00", date: "2029-12-21", type: "Полное лунное затмение", time: "05:41", detail: "Максимум затмения", visibility: "Видно в Новосибирске" },
    { at: "2030-06-15T01:00:00+07:00", date: "2030-06-15", type: "Частное лунное затмение", time: null, detail: "Время уточняется", visibility: "Видимость подтверждена для Новосибирска" }
  ],
  solar: [
    { at: "2030-06-01T13:32:00+07:00", date: "2030-06-01", type: "Частное солнечное затмение", time: "13:32", detail: "Максимум затмения", visibility: "Видно в Новосибирске" },
    { at: "2032-11-03T12:00:00+07:00", date: "2032-11-03", type: "Частное солнечное затмение", time: null, detail: "Местное время уточняется", visibility: "Видимость указана в каталоге затмений" },
    { at: "2034-03-20T12:00:00+07:00", date: "2034-03-20", type: "Частное солнечное затмение", time: null, detail: "Местное время уточняется", visibility: "Видимость указана в каталоге затмений" },
    { at: "2035-09-02T12:00:00+07:00", date: "2035-09-02", type: "Частное солнечное затмение", time: null, detail: "Местное время уточняется", visibility: "Видимость указана в каталоге затмений" }
  ]
};

function moonPhaseAt(date = new Date()) {
  const age = ((date.getTime() - KNOWN_NEW_MOON_UTC) / 86400000 % LUNAR_MONTH_DAYS + LUNAR_MONTH_DAYS) % LUNAR_MONTH_DAYS;
  const fraction = age / LUNAR_MONTH_DAYS;
  const illumination = (1 - Math.cos(2 * Math.PI * fraction)) / 2;
  let name;
  if (fraction < 0.035 || fraction >= 0.965) name = "Новолуние";
  else if (fraction < 0.215) name = "Растущий серп";
  else if (fraction < 0.285) name = "Первая четверть";
  else if (fraction < 0.465) name = "Растущая Луна";
  else if (fraction < 0.535) name = "Полнолуние";
  else if (fraction < 0.715) name = "Убывающая Луна";
  else if (fraction < 0.785) name = "Последняя четверть";
  else name = "Убывающий серп";
  return { fraction, illumination, waxing: fraction < 0.5, name };
}

function updateMoonPhase() {
  const moon = $("moonDisc");
  const shadow = $("moonShadow");
  if (!moon || !shadow) return;
  const phase = moonPhaseAt();
  const radius = 29;
  const offset = 2 * radius * phase.illumination;
  const shadowX = 32 + (phase.waxing ? -offset : offset);
  shadow.setAttribute("cx", String(shadowX));
  moon.setAttribute("aria-label", `${phase.name}; освещено ${Math.round(phase.illumination * 100)} процентов`);
  moon.setAttribute("title", `${phase.name} · ${Math.round(phase.illumination * 100)}% освещённости`);
}

function formatEclipseDate(dateString) {
  const date = new Date(`${dateString}T12:00:00+07:00`);
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric", month: "long", year: "numeric", timeZone: LOCATION.timezone
  }).format(date);
}

function renderNextEclipse(kind, ids) {
  const events = NOVOSIBIRSK_ECLIPSES[kind];
  const next = events.find((event) => Date.parse(event.time ? event.at : event.date + "T23:59:59+07:00") > Date.now());
  if (!next) {
    $(ids.title).textContent = "Дата следующего события уточняется";
    $(ids.details).textContent = "Список событий будет дополнен.";
    $(ids.visibility).textContent = "Новосибирск";
    return;
  }
  $(ids.title).textContent = formatEclipseDate(next.date);
  $(ids.details).textContent = next.time
    ? `${next.type}. ${next.detail}: ${next.time} по местному времени.`
    : `${next.type}. ${next.detail}.`;
  $(ids.visibility).textContent = next.visibility;
}

function updateEclipses() {
  renderNextEclipse("lunar", {
    title: "lunarEclipseTitle",
    details: "lunarEclipseDetails",
    visibility: "lunarEclipseVisibility"
  });
  renderNextEclipse("solar", {
    title: "solarEclipseTitle",
    details: "solarEclipseDetails",
    visibility: "solarEclipseVisibility"
  });
}

updateMoonPhase();
updateEclipses();
window.setInterval(updateMoonPhase, 60 * 60 * 1000);
window.setInterval(updateEclipses, 60 * 60 * 1000);
