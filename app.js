const API_URL = "https://api.open-meteo.com/v1/forecast";
const WEATHER_REFRESH_MS = 10 * 60 * 1000;
const LOCATION = { latitude: 55.0084, longitude: 82.9357, timezone: "Asia/Novosibirsk" };

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
  $(barId).style.width = `${Math.max(0, Math.min(100, percent))}%`;
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

function updateHero(current, daily) {
  const info = weatherInfo(current.weather_code);
  const hour = Number(current.time?.split("T")[1]?.slice(0, 2) || 12);
  const isNight = hour < 6 || hour >= 21;
  const theme = isNight && ["clear", "cloudy"].includes(info.theme) ? "night" : info.theme;
  $("hero").className = `hero weather-${theme}`;
  $("weatherSymbol").textContent = isNight && info.theme === "clear" ? "☾" : info.icon;
  $("condition").textContent = info.label;
  $("temperature").textContent = roundTemp(current.temperature_2m);
  $("feelsLike").textContent = roundTemp(current.apparent_temperature);
  $("highLow").textContent = `Сегодня ${roundTemp(daily.temperature_2m_min?.[0])} / ${roundTemp(daily.temperature_2m_max?.[0])}`;
  $("dateLine").textContent = formatDate(current.time);
  $("sunTimes").innerHTML = `↑ Восход ${timeOnly(daily.sunrise?.[0])} <i></i> ↓ Закат ${timeOnly(daily.sunset?.[0])}`;
  setEffects(info.effect);
}

function updateMetrics(current, hourly, daily) {
  // Current observations can arrive between hourly forecast timestamps; use the next matching forecast hour.
  const matchedHour = hourly.time.findIndex((time) => time >= current.time);
  const hourIndex = matchedHour >= 0 ? matchedHour : Math.max(0, hourly.time.length - 1);
  const chance = hourly.precipitation_probability?.[hourIndex] ?? 0;
  const uv = daily.uv_index_max?.[0];
  setMetric("wind", `${number(current.wind_speed_10m, 1)} <small>м/с</small>`, "windBar", current.wind_speed_10m * 4);
  $("windDirection").textContent = `Ветер ${windDirection(current.wind_direction_10m)}`;
  setMetric("humidity", `${number(current.relative_humidity_2m)}<small>%</small>`, "humidityBar", current.relative_humidity_2m);
  setMetric("pressure", `${number(current.pressure_msl)} <small>гПа</small>`, "pressureBar", (current.pressure_msl - 950) / 1.1);
  setMetric("uv", number(uv, 1), "uvBar", (uv || 0) * 10);
  $("uvLabel").textContent = !Number.isFinite(uv) ? "Индекс сейчас недоступен" : uv < 3 ? "Низкий уровень" : uv < 6 ? "Умеренный уровень" : uv < 8 ? "Высокий уровень" : "Очень высокий уровень";
  setMetric("precipitation", `${number(current.precipitation, 1)} <small>мм</small>`, "precipBar", chance);
  $("precipChance").textContent = `Вероятность осадков: ${chance}%`;
  setMetric("gusts", `${number(current.wind_gusts_10m, 1)} <small>м/с</small>`, "gustBar", current.wind_gusts_10m * 3);
}

function renderHourly(hourly, currentTime) {
  const start = Math.max(0, hourly.time.findIndex((time) => time >= currentTime));
  const list = hourly.time.slice(start, start + 24);
  $("hourlyForecast").replaceChildren();
  list.forEach((time, offset) => {
    const index = start + offset;
    const info = weatherInfo(hourly.weather_code[index]);
    const card = document.createElement("article");
    card.className = "hour-card";
    const label = offset === 0 ? "Сейчас" : timeOnly(time);
    card.innerHTML = `<span class="hour-time">${label}</span><span class="hour-symbol" aria-hidden="true">${info.icon}</span><strong class="hour-temp">${roundTemp(hourly.temperature_2m[index])}</strong><span class="hour-rain">☂ ${hourly.precipitation_probability?.[index] ?? 0}%</span>`;
    $("hourlyForecast").append(card);
  });
}

function renderTomorrow(daily) {
  const info = weatherInfo(daily.weather_code?.[1]);
  $("tomorrowCondition").textContent = info.label;
  $("tomorrowSymbol").textContent = info.icon;
  $("tomorrowTemp").textContent = roundTemp(daily.temperature_2m_max?.[1]);
  $("tomorrowRange").textContent = `${roundTemp(daily.temperature_2m_min?.[1])} / ${roundTemp(daily.temperature_2m_max?.[1])}`;
  const rain = daily.precipitation_probability_max?.[1] ?? 0;
  const sum = daily.precipitation_sum?.[1] ?? 0;
  $("tomorrowSummary").textContent = `Вероятность осадков — ${rain}%. Ожидается ${number(sum, 1)} мм осадков. Восход в ${timeOnly(daily.sunrise?.[1])}, закат в ${timeOnly(daily.sunset?.[1])}.`;
}

async function loadWeather() {
  const params = new URLSearchParams({
    latitude: LOCATION.latitude,
    longitude: LOCATION.longitude,
    timezone: LOCATION.timezone,
    forecast_days: 2,
    forecast_hours: 24,
    current: "temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,rain,showers,snowfall,weather_code,cloud_cover,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m",
    hourly: "temperature_2m,precipitation_probability,precipitation,weather_code,wind_speed_10m",
    daily: "weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,uv_index_max,precipitation_probability_max,precipitation_sum"
  });
  try {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 12000);
    let response;
    try {
      response = await fetch(`${API_URL}?${params}`, { cache: "no-store", signal: controller.signal });
    } finally {
      window.clearTimeout(timeout);
    }
    if (!response.ok) throw new Error(`Weather API returned ${response.status}`);
    const data = await response.json();
    const hourly = data.hourly;
    const daily = data.daily;
    const hourlyFields = ["temperature_2m", "weather_code", "precipitation_probability"];
    const dailyFields = ["temperature_2m_max", "temperature_2m_min", "weather_code", "sunrise", "sunset", "uv_index_max", "precipitation_probability_max", "precipitation_sum"];
    const hourlyInvalid = !Array.isArray(hourly?.time) || hourly.time.length === 0 ||
      hourlyFields.some((key) => !Array.isArray(hourly[key]) || hourly[key].length < hourly.time.length);
    const dailyInvalid = !Array.isArray(daily?.time) || daily.time.length < 2 ||
      dailyFields.some((key) => !Array.isArray(daily[key]) || daily[key].length < daily.time.length);
    if (!data.current || typeof data.current.time !== "string" ||
        !Number.isFinite(data.current.temperature_2m) || hourlyInvalid || dailyInvalid) {
      throw new Error("Weather response is incomplete");
    }
    updateHero(data.current, data.daily);
    updateMetrics(data.current, data.hourly, data.daily);
    renderHourly(data.hourly, data.current.time);
    renderTomorrow(data.daily);
    $("statusText").textContent = "Данные актуальны";
    $("updatedAt").textContent = `Обновлено в ${timeOnly(data.current.time)}`;
    $("errorMessage").hidden = true;
  } catch (error) {
    console.error("Не удалось обновить погоду:", error);
    $("statusText").textContent = error.name === "AbortError" ? "Погода отвечает слишком долго" : "Нет связи с погодой";
    $("errorMessage").hidden = false;
    if (!$("temperature").textContent.includes("—")) $("updatedAt").textContent = "Не удалось обновить данные";
  }
}

loadWeather();
window.setInterval(loadWeather, WEATHER_REFRESH_MS);