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
function cacheAgeLabel(savedAt) {
  if (!Number.isFinite(savedAt) || savedAt <= 0) return "возраст неизвестен";
  const ageMs = Math.max(0, Date.now() - savedAt);
  const minutes = Math.floor(ageMs / 60000);
  if (minutes < 1) return "только что";
  if (minutes < 60) return `${minutes} мин. назад`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ч. назад`;
  const days = Math.floor(hours / 24);
  return `${days} дн. назад`;
}

function updateSeasonEvents() {
  // Meeus, Astronomical Algorithms: polynomial estimate plus 24 periodic corrections.
  // Calculated in UTC and then displayed in Novosibirsk local time.
  const eventTypes = [
    { index: 0, name: "Весеннее равноденствие" },
    { index: 1, name: "Летнее солнцестояние" },
    { index: 2, name: "Осеннее равноденствие" },
    { index: 3, name: "Зимнее солнцестояние" }
  ];
  const coefficients = [
    [2451623.80984, 365242.37404, 0.05169, -0.00411, -0.00057],
    [2451716.56767, 365241.62603, 0.00325, 0.00888, -0.00030],
    [2451810.21715, 365242.01767, -0.11575, 0.00337, 0.00078],
    [2451900.05952, 365242.74049, -0.06223, -0.00823, 0.00032]
  ];
  const periodicTerms = [
    [485,324.96,1934.136],[203,337.23,32964.467],[199,342.08,20.186],
    [182,27.85,445267.112],[156,73.14,45036.886],[136,171.52,22518.443],
    [77,222.54,65928.934],[74,296.72,3034.906],[70,243.58,9037.513],
    [58,119.81,33718.147],[52,297.17,150.678],[50,21.02,2281.226],
    [45,247.54,29929.562],[44,325.15,31555.956],[29,60.93,443.417],
    [18,155.12,67555.328],[17,288.79,4562.452],[18,198.04,62894.029],
    [14,199.76,31436.921],[12,95.39,14577.848],[12,287.11,31931.756],
    [12,320.81,34777.259],[9,227.73,1222.114],[8,15.45,16859.074]
  ];
  const julianDayToDate = (jd) => new Date((jd - 2440587.5) * 86400000);
  const eventDate = (year, type) => {
    const y = (year - 2000) / 1000;
    const [a,b,c,d,e] = coefficients[type.index];
    const jde0 = a + b*y + c*y*y + d*y*y*y + e*y*y*y*y;
    const T = (jde0 - 2451545) / 36525;
    const W = (35999.373*T - 2.47) * Math.PI / 180;
    const denominator = 1 + 0.0334*Math.cos(W) + 0.0007*Math.cos(2*W);
    const S = periodicTerms.reduce((sum, [A,B,C]) =>
      sum + A*Math.cos((B + C*T) * Math.PI / 180), 0);
    const jde = jde0 + 0.00001*S/denominator;
    // Approximate TT−UTC (Delta T); sufficient for a local calendar display.
    const deltaTSeconds = 69;
    return julianDayToDate(jde - deltaTSeconds / 86400);
  };
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: LOCATION.timezone, year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(now);
  const part = (type) => parts.find((item) => item.type === type).value;
  const localToday = Date.UTC(Number(part("year")), Number(part("month")) - 1, Number(part("day")));
  const events = [];
  for (let year = Number(part("year")); year <= Number(part("year")) + 1; year++) {
    for (const type of eventTypes) {
      const date = eventDate(year, type);
      const localParts = new Intl.DateTimeFormat("en-GB", {
        timeZone: LOCATION.timezone, year: "numeric", month: "2-digit", day: "2-digit"
      }).formatToParts(date);
      const getPart = (key) => Number(localParts.find((item) => item.type === key).value);
      const localDay = Date.UTC(getPart("year"), getPart("month") - 1, getPart("day"));
      events.push({ ...type, year, date, days: Math.round((localDay - localToday) / 86400000) });
    }
  }
  events.sort((a, b) => a.date - b.date);
  const next = events.find((event) => event.date >= now);
  if (!next) return;
  const nextName = $("seasonNextName");
  const nextDate = $("seasonNextDate");
  const countdown = $("seasonNextCountdown");
  const dateTimeOptions = {
    timeZone: LOCATION.timezone, day: "numeric", month: "long", year: "numeric",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  };
  if (nextName) nextName.textContent = next.name;
  if (nextDate) nextDate.textContent = new Intl.DateTimeFormat("ru-RU", dateTimeOptions).format(next.date) + " (время Новосибирска)";
  if (countdown) countdown.textContent = next.days === 0 ? "Сегодня" :
    next.days === 1 ? "Остался 1 день" : `Осталось ${next.days} ${next.days % 10 >= 2 && next.days % 10 <= 4 && !(next.days % 100 >= 12 && next.days % 100 <= 14) ? "дня" : "дней"}`;
  const list = $("seasonEventsList");
  if (list) {
    list.replaceChildren();
    for (const event of events.filter((item) => item.date >= now).slice(0, 4)) {
      const row = document.createElement("div");
      row.className = "season-event-row";
      const label = document.createElement("span");
      label.textContent = event.name;
      const value = document.createElement("strong");
      value.textContent = new Intl.DateTimeFormat("ru-RU", {
        timeZone: LOCATION.timezone, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23"
      }).format(event.date);
      row.append(label, value);
      list.append(row);
    }
  }
}
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
  const count = kind === "rain" ? 28 : 18;
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

/* Star positions are projected from a small bright-star catalogue for Novosibirsk's actual local sidereal time. */
const SKY_STARS = [
 ["Polaris",2.5303,89.264,2.0],["Kochab",14.845,74.156,2.1],["Pherkad",15.345,71.834,3.0],
 ["Dubhe",11.062,61.751,1.8],["Merak",11.031,56.382,2.4],["Phecda",11.897,53.694,2.4],["Megrez",12.257,57.033,3.3],["Alioth",12.900,55.960,1.8],["Mizar",13.399,54.925,2.2],["Alkaid",13.792,49.313,1.9],
 ["Schedar",0.675,56.537,2.2],["Caph",0.153,59.150,2.3],["Gamma Cas",0.945,60.717,2.5],["Ruchbah",1.430,60.235,2.7],["Segin",1.907,63.670,3.4],
 ["Vega",18.615,38.784,0.0],["Deneb",20.690,45.280,1.3],["Altair",19.846,8.868,0.8],["Albireo",19.512,27.960,3.1],
 ["Capella",5.278,45.998,0.1],["Aldebaran",4.599,16.509,0.9],["Elnath",5.438,28.608,1.7],["Rigel",5.242,-8.202,0.1],["Betelgeuse",5.919,7.407,0.5],["Bellatrix",5.419,6.350,1.6],["Mintaka",5.533,-0.299,2.2],["Alnilam",5.603,-1.202,1.7],["Alnitak",5.679,-1.943,1.8],["Saiph",5.796,-9.670,2.1],
 ["Procyon",7.655,5.225,0.4],["Sirius",6.752,-16.716,-1.5],["Pollux",7.755,28.026,1.1],["Castor",7.577,31.888,1.6],
 ["Arcturus",14.261,19.182,0.0],["Spica",13.420,-11.161,1.0],["Regulus",10.139,11.967,1.4],["Denebola",11.818,14.572,2.1],
 ["Fomalhaut",22.961,-29.622,1.2],["Markab",23.079,15.205,2.5],["Scheat",23.063,28.083,2.4],["Algenib",0.220,15.183,2.8],["Enif",21.736,9.875,2.4],
 ["Mirfak",3.405,49.861,1.8],["Algol",3.136,40.956,2.1],["Hamal",2.120,23.462,2.0],["Alpheratz",0.139,29.091,2.1],
 ["Nunki",18.921,-26.297,2.0],["Kaus Australis",18.403,-34.384,1.8],["Antares",16.490,-26.432,1.1],["Rasalhague",17.582,12.560,2.1]
];

function julianDate(date){return date.getTime()/86400000+2440587.5}
function renderActualNightSky(){
 const host=$("skyStars"); if(!host)return;
 const now=new Date(), jd=julianDate(now), t=(jd-2451545)/36525;
 const gmst=(280.46061837+360.98564736629*(jd-2451545)+0.000387933*t*t-t*t*t/38710000+360)%360;
 const lst=((gmst+LOCATION.longitude)%360+360)%360, lat=LOCATION.latitude*Math.PI/180;
 const points={};
 for(const [name,raHours,decDeg,mag] of SKY_STARS){
  const ha=((lst-raHours*15+540)%360-180)*Math.PI/180, dec=decDeg*Math.PI/180;
  const sinAlt=Math.sin(lat)*Math.sin(dec)+Math.cos(lat)*Math.cos(dec)*Math.cos(ha);
  const alt=Math.asin(Math.max(-1,Math.min(1,sinAlt)));
  if(alt<5*Math.PI/180 || mag>2.35)continue;
  const az=Math.atan2(-Math.sin(ha)*Math.cos(dec),Math.sin(dec)*Math.cos(lat)-Math.cos(dec)*Math.sin(lat)*Math.cos(ha));
  const azDeg=(az*180/Math.PI+360)%360;
  const x=azDeg/360*100, y=61-(alt*180/Math.PI)/90*53;
  points[name]={x,y,mag};
 }
 const ns="http://www.w3.org/2000/svg", svg=document.createElementNS(ns,"svg");
 const width=Math.max(host.clientWidth,1), height=Math.max(host.clientHeight,1);
 svg.setAttribute("viewBox","0 0 1000 530");svg.setAttribute("preserveAspectRatio","none");svg.setAttribute("aria-hidden","true");
 // Keep stars circular in CSS pixels even when the SVG is stretched on narrow mobile screens.
 for(const [name,p] of Object.entries(points)){
  const radius=Math.max(.8,2.05-p.mag*.48);
  const star=document.createElementNS(ns,"ellipse");
  star.setAttribute("class","star");
  star.setAttribute("cx",p.x*10);
  star.setAttribute("cy",p.y*5.3);
  star.setAttribute("rx",radius*1000/width);
  star.setAttribute("ry",radius*530/height);
  star.setAttribute("opacity",String(Math.max(.38,1-p.mag*.19)));
  star.setAttribute("data-star",name);
  svg.append(star);
 }
 host.replaceChildren(svg);
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
  hero.classList.toggle("sunset-passed", sunset !== null && minuteOfDay >= sunset);
  const hasSolarTimes = sunrise !== null && sunset !== null && sunset > sunrise;
  const daylightProgress = hasSolarTimes
    ? Math.max(0, Math.min(1, (minuteOfDay - sunrise) / (sunset - sunrise)))
    : Math.max(0, Math.min(1, (minuteOfDay - 360) / 720));
  // Anchor the sun to the horizon before sunrise and after sunset; keep the halo on the same center.
  const sunX = 12 + daylightProgress * 76;
  const sunY = phase === "night" ? 64
    : hasSolarTimes && minuteOfDay < sunrise ? 64
    : hasSolarTimes && minuteOfDay >= sunset ? 64
    : 52 - Math.sin(Math.PI * daylightProgress) * 34;
  hero.style.setProperty("--sun-x", `${sunX}%`);
  hero.style.setProperty("--sun-y", `${Math.max(14, Math.min(64, sunY))}%`);
  const cutout = phase === "night" ? "#172b49" : phase === "dawn" || phase === "evening" ? "#bd8490" : "#39749a";
  hero.style.setProperty("--moon-cutout", cutout);
  // Use the Moon's real topocentric position for Novosibirsk, not the Sun's coordinates.
  if (window.SunCalc && $("moonDisc")) {
    const moonPosition = SunCalc.getMoonPosition(new Date(), 55.0084, 82.9357);
    const moonAltitude = moonPosition.altitude;
    const moonAzimuth = moonPosition.azimuth; // SunCalc: 0=south, negative=east, positive=west.
    // Map the visible southern sky from east to west across the hero.
    const moonVisible = moonAltitude > 0 && Math.abs(moonAzimuth) <= Math.PI / 2;
    const moonX = 50 + Math.max(-1, Math.min(1, moonAzimuth / (Math.PI / 2))) * 39;
    const moonY = 57 - Math.max(0, Math.min(1, moonAltitude / (Math.PI / 2))) * 43;
    hero.style.setProperty("--moon-x", `${moonX}%`);
    hero.style.setProperty("--moon-y", `${Math.max(13, Math.min(66, moonY))}%`);
    hero.classList.toggle("moon-above-horizon", moonVisible);
  }
  const info = weatherInfo(latestWeatherCode);
  $("weatherSymbol").textContent = phase === "night" && info.theme === "clear" ? "✦" : info.icon;
}

function daylightMinutes(daily, index) {
  const sunrise = minutesFromLocalTime(daily.sunrise?.[index]);
  const sunset = minutesFromLocalTime(daily.sunset?.[index]);
  if (sunrise === null || sunset === null || sunset <= sunrise) return null;
  return sunset - sunrise;
}

function daylightChangeLabel(daily) {
  const firstDate = daily.time?.[0];
  const baseDate = new Date(`${firstDate}T12:00:00Z`);
  if (!Number.isFinite(baseDate.getTime())) return "Продолжительность светового дня";

  const dateKey = (offset) => {
    const date = new Date(baseDate);
    date.setUTCDate(date.getUTCDate() + offset);
    return date.toISOString().slice(0, 10);
  };
  const apiDaylight = (key) => {
    const index = daily.time?.indexOf(key) ?? -1;
    return index >= 0 ? daylightMinutes(daily, index) : null;
  };
  const calculatedDaylight = (key) => {
    const date = new Date(`${key}T12:00:00+07:00`);
    if (window.SunCalc) {
      const times = SunCalc.getTimes(date, LOCATION.latitude, LOCATION.longitude);
      if (times.sunrise instanceof Date && times.sunset instanceof Date &&
          Number.isFinite(times.sunrise.getTime()) && Number.isFinite(times.sunset.getTime())) {
        return Math.round((times.sunset.getTime() - times.sunrise.getTime()) / 60000);
      }
    }
    // NOAA-style solar declination fallback, used for BOTH dates to keep
    // the comparison internally consistent instead of mixing models.
    const dayOfYear = Math.floor((Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) -
      Date.UTC(date.getUTCFullYear(), 0, 0)) / 86400000);
    const latitude = LOCATION.latitude * Math.PI / 180;
    const declination = 0.4091 * Math.sin((2 * Math.PI / 365) * dayOfYear - 1.405);
    const denominator = Math.cos(latitude) * Math.cos(declination);
    const hourAngleCos = (Math.sin(-0.833 * Math.PI / 180) -
      Math.sin(latitude) * Math.sin(declination)) / denominator;
    if (!Number.isFinite(hourAngleCos) || hourAngleCos < -1 || hourAngleCos > 1) return null;
    return Math.round(2 * Math.acos(hourAngleCos) * 720 / Math.PI);
  };

  // Prefer the API for today's actual forecast, but use the same solar model
  // for both days whenever the past date is missing from the API.
  let today = apiDaylight(dateKey(0));
  let yesterday = apiDaylight(dateKey(-1));
  if (yesterday === null) {
    today = calculatedDaylight(dateKey(0));
    yesterday = calculatedDaylight(dateKey(-1));
  }
  if (today === null || yesterday === null) return "Сравнение со вчерашним днём недоступно";
  const difference = Math.round(today - yesterday);
  if (difference === 0) return "Световой день — без изменений со вчера";
  const minutes = Math.abs(difference);
  const duration = minutes >= 60
    ? `${Math.floor(minutes / 60)} ч ${minutes % 60 ? `${minutes % 60} мин` : ""}`.trim()
    : `${minutes} мин`;
  return `Световой день ${difference > 0 ? "длиннее" : "короче"} на ${duration}, чем вчера`;
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
  const daylightChange = $("daylightChange");
  if (daylightChange) daylightChange.textContent = daylightChangeLabel(daily);
  setEffects(info.effect);
  updateAtmosphere();
}

function isValidDateString(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isValidDateTimeString(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return false;
  const [date, time] = value.split("T");
  const [hour, minute] = time.split(":").map(Number);
  return isValidDateString(date) && hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;
}

function isOrderedTimeArray(times, pattern) {
  return Array.isArray(times) &&
    times.length > 0 &&
    times.every((time, index) =>
      typeof time === "string" &&
      pattern.test(time) &&
      (time.includes("T") ? isValidDateTimeString(time) : isValidDateString(time)) &&
      (index === 0 || time >= times[index - 1])
    );
}

function areSunTimesValid(date, sunrise, sunset) {
  if (sunrise === null && sunset === null) return true;
  if (!isValidDateTimeString(sunrise) || !isValidDateTimeString(sunset)) return false;
  if (sunrise.slice(0, 10) !== date || sunset.slice(0, 10) !== date) return false;
  const sunriseMinutes = minutesFromLocalTime(sunrise);
  const sunsetMinutes = minutesFromLocalTime(sunset);
  const daylightMinutes = sunsetMinutes - sunriseMinutes;
  return sunriseMinutes >= 0 && sunriseMinutes < 12 * 60 &&
    sunsetMinutes > 12 * 60 && sunsetMinutes < 24 * 60 &&
    daylightMinutes >= 5 * 60 && daylightMinutes <= 19 * 60;
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

function renderWeatherForecast(data, cached = false, cacheSavedAt = null) {
  const hourly = data.hourly;
  const daily = data.daily;
  const hourlyFields = ["temperature_2m", "weather_code", "precipitation_probability"];
  const dailyFields = ["temperature_2m_max", "temperature_2m_min", "weather_code", "sunrise", "sunset", "uv_index_max", "precipitation_probability_max", "precipitation_sum"];
  const hourlyInvalid = !isOrderedTimeArray(hourly?.time, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/) ||
    hourlyFields.some((key) => !Array.isArray(hourly[key]) || hourly[key].length < hourly.time.length) ||
    hourlyFields.some((key) => Array.isArray(hourly[key]) &&
      hourly[key].slice(0, hourly.time.length).some((value) => value !== null && !Number.isFinite(value)));
  const dailyInvalid = !isOrderedTimeArray(daily?.time, /^\d{4}-\d{2}-\d{2}$/) ||
    daily.time.length < 3 ||
    dailyFields.some((key) => !Array.isArray(daily[key]) || daily[key].length < daily.time.length) ||
    ["temperature_2m_max", "temperature_2m_min", "weather_code", "uv_index_max", "precipitation_probability_max", "precipitation_sum"].some((key) =>
      Array.isArray(daily[key]) && daily[key].slice(0, daily.time.length).some((value) => value !== null && !Number.isFinite(value))) ||
    ["sunrise", "sunset"].some((key) =>
      Array.isArray(daily[key]) && daily[key].slice(0, daily.time.length).some((value) => value !== null && (typeof value !== "string" || !isValidDateTimeString(value)))) ||
    daily.time.some((date, index) => !areSunTimesValid(date, daily.sunrise[index], daily.sunset[index]));
  const currentTimeValid = isValidDateTimeString(data.current?.time);
  if (!data.current || !currentTimeValid ||
      !Number.isFinite(data.current.temperature_2m) || hourlyInvalid || dailyInvalid) {
    throw new Error("Weather data is incomplete or has invalid time data");
  }

  updateHero(data.current, data.daily);
  updateMetrics(data.current, data.hourly, data.daily);
  renderTomorrow(data.daily);
  hasLoadedWeather = true;
  lastSuccessfulUpdate = data.current.time;
  if (!cached) lastWeatherFetchAt = Date.now();
  const cacheAge = cached ? cacheAgeLabel(cacheSavedAt) : "";
  const cacheIsOld = cached && (!Number.isFinite(cacheSavedAt) || Date.now() - cacheSavedAt > 6 * 60 * 60 * 1000);
  $("statusText").textContent = cached
    ? (cacheIsOld ? `Сохранённый прогноз устарел · ${cacheAge}` : `Сохранённый прогноз · ${cacheAge}`)
    : "Данные актуальны";
  document.querySelector(".live-dot")?.classList.remove("is-error", "is-loading");
  $("updatedAt").textContent = (cached ? `Сохранено ${cacheAge} · ` : "Обновлено · ") + timeOnly(data.current.time);
  $("errorMessage").hidden = true;
}

function loadCachedWeather() {
  try {
    const cached = JSON.parse(localStorage.getItem(WEATHER_CACHE_KEY) || "null");
    if (cached?.data) renderWeatherForecast(cached.data, true, cached.savedAt);
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
renderActualNightSky();
window.setInterval(updateAtmosphere, 60 * 1000);
window.setInterval(renderActualNightSky, 60 * 1000);
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
let airQualityRequestInFlight = false;

function airQualityInfo(value) {
  if (!Number.isFinite(value)) return {label:"Нет данных",advice:"Индекс качества воздуха сейчас недоступен.",className:""};
  if (value <= 20) return {label:"Хорошее",advice:"Качество воздуха благоприятное для обычной активности на улице.",className:"aqi-good"};
  if (value <= 40) return {label:"Удовлетворительное",advice:"В целом условия приемлемые. Очень чувствительным людям стоит следить за самочувствием.",className:"aqi-fair"};
  if (value <= 60) return {label:"Умеренное",advice:"Чувствительным людям стоит сократить длительную интенсивную нагрузку на улице.",className:"aqi-moderate"};
  if (value <= 80) return {label:"Плохое",advice:"Людям с повышенной чувствительностью лучше уменьшить длительную активность на улице.",className:"aqi-poor"};
  if (value <= 100) return {label:"Очень плохое",advice:"Рекомендуется ограничить продолжительную физическую активность на открытом воздухе.",className:"aqi-very-poor"};
  return {label:"Крайне плохое",advice:"По возможности сократите пребывание на улице и интенсивную физическую нагрузку.",className:"aqi-extreme"};
}

function renderAirQuality(data, cached = false, cacheSavedAt = null) {
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
  const cacheAge = cached ? cacheAgeLabel(cacheSavedAt) : "";
  const cacheIsOld = cached && (!Number.isFinite(cacheSavedAt) || Date.now() - cacheSavedAt > 3 * 60 * 60 * 1000);
  $("airUpdated").textContent = (cached ? `Сохранено ${cacheAge} · ` : "Время модели · ") + timeOnly(current.time);
  $("airQualityStatus").textContent = cached
    ? (cacheIsOld ? `Сохранённые данные устарели · ${cacheAge}` : `Сохранённые данные · ${cacheAge}`)
    : "Данные Open-Meteo";

}

function loadCachedAirQuality() {
  try {
    const cached = JSON.parse(localStorage.getItem(AIR_QUALITY_CACHE_KEY) || "null");
    if (cached?.data) renderAirQuality(cached.data, true, cached.savedAt);
  } catch (error) {
    console.warn("Не удалось прочитать сохранённые данные качества воздуха:", error);
  }
}

async function loadAirQuality() {
  if (airQualityRequestInFlight) return;
  airQualityRequestInFlight = true;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(AIR_QUALITY_API_URL, {signal:controller.signal});
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
    $("airQualityStatus").textContent = error.name === "AbortError"
      ? "Источник отвечает слишком долго"
      : "Нет связи с источником";
    if (!$("airAqi").textContent || $("airAqi").textContent === "—") {
      $("airCategory").textContent = "Данные пока недоступны";
      $("airAdvice").textContent = "Не удалось загрузить качество воздуха. Попробуем снова автоматически.";
    }
  } finally {
    window.clearTimeout(timeout);
    airQualityRequestInFlight = false;
  }
}

loadCachedAirQuality();
loadAirQuality();
window.setInterval(loadAirQuality, AIR_QUALITY_REFRESH_MS);


/* Moon phase is calculated locally. Eclipse data refreshes from a scheduled public catalog. */
const LUNAR_MONTH_DAYS = 29.530588853;
const KNOWN_NEW_MOON_UTC = Date.UTC(2000, 0, 6, 18, 14);
const NOVOSIBIRSK_ECLIPSES = {
  lunar: [
    { date: "2027-02-20", type: "Полутеневое лунное затмение", time: null, detail: "По данным каталога затмений", visibility: "Видно в Новосибирске" },
    { date: "2028-01-12", type: "Полутеневое лунное затмение", time: null, detail: "По данным каталога затмений", visibility: "Видно в Новосибирске" },
    { date: "2028-07-06", type: "Частное лунное затмение", time: null, detail: "По данным каталога затмений", visibility: "Видно в Новосибирске" },
    { date: "2028-12-31", type: "Полное лунное затмение", time: null, detail: "По данным каталога затмений", visibility: "Видно в Новосибирске" },
    { date: "2029-12-20", type: "Полное лунное затмение", time: null, detail: "По данным каталога затмений", visibility: "Видно в Новосибирске" },
    { date: "2030-06-15", type: "Частное лунное затмение", time: null, detail: "По данным каталога затмений", visibility: "Видно в Новосибирске" },
    { date: "2030-12-09", type: "Полутеневое лунное затмение", time: null, detail: "По данным каталога затмений", visibility: "Видно в Новосибирске" },
    { date: "2032-04-25", type: "Полное лунное затмение", time: null, detail: "По данным каталога затмений", visibility: "Видно в Новосибирске" },
    { date: "2032-10-18", type: "Полное лунное затмение", time: null, detail: "По данным каталога затмений", visibility: "Видно в Новосибирске" },
    { date: "2033-04-14", type: "Полное лунное затмение", time: null, detail: "По данным каталога затмений", visibility: "Видно в Новосибирске" },
    { date: "2033-10-08", type: "Частное лунное затмение", time: null, detail: "По данным каталога затмений", visibility: "Видно в Новосибирске" },
    { date: "2034-04-03", type: "Полутеневое лунное затмение", time: null, detail: "По данным каталога затмений", visibility: "Видно в Новосибирске" },
    { date: "2034-09-28", type: "Полутеневое лунное затмение", time: null, detail: "По данным каталога затмений", visibility: "Видно в Новосибирске" },
    { date: "2035-08-18", type: "Полутеневое лунное затмение", time: null, detail: "По данным каталога затмений", visibility: "Видно в Новосибирске" }
  ],
  solar: [
    { date: "2030-06-01", type: "Частное солнечное затмение", time: null, detail: "По данным каталога затмений", visibility: "Видно в Новосибирске" },
    { date: "2032-11-03", type: "Частное солнечное затмение", time: null, detail: "По данным каталога затмений", visibility: "Видно в Новосибирске" },
    { date: "2034-03-20", type: "Частное солнечное затмение", time: null, detail: "По данным каталога затмений", visibility: "Видно в Новосибирске" },
    { date: "2035-09-02", type: "Частное солнечное затмение", time: null, detail: "По данным каталога затмений", visibility: "Видно в Новосибирске" }
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
    $(ids.visibility).textContent = "";
    $(ids.visibility).hidden = true;
    return;
  }
  $(ids.title).textContent = formatEclipseDate(next.date);
  $(ids.details).textContent = next.time
    ? `${next.type}. ${next.detail}: ${next.time} по местному времени.`
    : `${next.type}. ${next.detail}.`;
  $(ids.visibility).textContent = next.visibility || "";
  $(ids.visibility).hidden = !next.visibility;
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

async function loadEclipseData() {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(
      "https://raw.githubusercontent.com/kinodoc/novosibirsk-weather/main/eclipse-data.json",
      { cache: "no-store", signal: controller.signal }
    );
    if (!response.ok) throw new Error(`Eclipse catalog returned HTTP ${response.status}`);
    const data = await response.json();
    const nextEvents = {};

    for (const kind of ["lunar", "solar"]) {
      if (!Array.isArray(data[kind])) throw new Error(`Missing ${kind} eclipse data`);
      nextEvents[kind] = data[kind]
        .filter((event) => {
          if (!event || typeof event !== "object" ||
              typeof event.date !== "string" ||
              !/^\d{4}-\d{2}-\d{2}$/.test(event.date) ||
              typeof event.type !== "string" || !event.type.trim()) return false;
          const parsedDate = new Date(`${event.date}T00:00:00Z`);
          return Number.isFinite(parsedDate.getTime()) &&
            parsedDate.toISOString().slice(0, 10) === event.date;
        })
        .map((event) => ({
          date: event.date,
          type: event.type.trim(),
          time: null,
          detail: "Данные из обновляемого каталога",
          visibility: ""
        }))
        .sort((a, b) => a.date.localeCompare(b.date));
      if (!nextEvents[kind].length) throw new Error(`No valid ${kind} eclipses in catalog`);
    }

    NOVOSIBIRSK_ECLIPSES.lunar = nextEvents.lunar;
    NOVOSIBIRSK_ECLIPSES.solar = nextEvents.solar;
    updateEclipses();
  } catch (error) {
    console.warn(
      error.name === "AbortError"
        ? "Истёк тайм-аут обновления каталога затмений; используется сохранённый список."
        : "Не удалось обновить список затмений; используется сохранённый список.",
      error
    );
  } finally {
    window.clearTimeout(timeout);
  }
}

updateSeasonEvents();
updateMoonPhase();
updateEclipses();
loadEclipseData();
window.setInterval(loadEclipseData, 24 * 60 * 60 * 1000);

window.setInterval(updateMoonPhase, 60 * 60 * 1000);
window.setInterval(updateEclipses, 60 * 60 * 1000);
