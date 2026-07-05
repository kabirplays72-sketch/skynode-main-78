/*
  extra.js
  ------------------------------------------------------------
  Additive features only. script.js (the main telemetry/camera/map
  engine) is left untouched. This file:

    1. Camera zoom (in/out) + invert (mirror) controls.
       (The 4:3 ratio and the narrower feed width are pure CSS.)

    2. A "predicted weather" graph — not a raw plot of the live
       sensor line. It eases a simulated trend line toward the live
       temperature/humidity/pressure readings, so it reads like a
       forecast model rather than an oscilloscope trace.

    3. A fully automatic spoof/backup system covering every
       telemetry value shown on the dashboard (temperature, humidity,
       pressure, altitude, battery, voltage, lat/lon, satellites,
       signal, packet count). There is no manual button — as soon as
       a field looks dead (missing/NaN/unreachable), this script
       fills it with a plausible value derived from the last
       known-good reading instead of leaving it stuck on "--". A
       small "DATA: LIVE / DATA: BACKUP" indicator by the map
       controls shows which mode is currently active.

  It polls /telemetry on its own timer, independent of script.js, and
  writes into the same DOM elements script.js uses — this script just
  runs right behind it and fills in anything still dead.
*/
(function () {
  "use strict";

  const TELEMETRY_URL = "/telemetry";
  const POLL_MS = 120;

  // ---------------------------------------------------------
  // 1. CAMERA — zoom + invert
  // ---------------------------------------------------------
  const videoShell = document.getElementById("videoShell");
  const zoomInBtn = document.getElementById("camZoomIn");
  const zoomOutBtn = document.getElementById("camZoomOut");
  const invertBtn = document.getElementById("camInvert");

  let zoom = 1;
  const ZOOM_MIN = 1;
  const ZOOM_MAX = 3;
  const ZOOM_STEP = 0.25;
  let inverted = false;

  function applyZoom() {
    if (!videoShell) return;
    videoShell.style.setProperty("--cam-zoom", zoom.toFixed(2));
  }

  function applyInvert() {
    if (!videoShell) return;
    videoShell.style.setProperty("--cam-flip", inverted ? "-1" : "1");
    if (invertBtn) invertBtn.classList.toggle("is-active", inverted);
  }

  if (zoomInBtn) {
    zoomInBtn.addEventListener("click", () => {
      zoom = Math.min(ZOOM_MAX, +(zoom + ZOOM_STEP).toFixed(2));
      applyZoom();
    });
  }

  if (zoomOutBtn) {
    zoomOutBtn.addEventListener("click", () => {
      zoom = Math.max(ZOOM_MIN, +(zoom - ZOOM_STEP).toFixed(2));
      applyZoom();
    });
  }

  if (invertBtn) {
    invertBtn.addEventListener("click", () => {
      inverted = !inverted;
      applyInvert();
    });
  }

  applyZoom();
  applyInvert();

  // ---------------------------------------------------------
  // 2 & 3. TELEMETRY-DEPENDENT FEATURES
  // ---------------------------------------------------------
  const graphCanvas = document.getElementById("weatherGraph");
  const ctx = graphCanvas ? graphCanvas.getContext("2d") : null;
  const trendEl = document.getElementById("weatherTrend");
  const outlookEl = document.getElementById("weatherOutlook");
  const confidenceEl = document.getElementById("weatherConfidence");
  const sourceEl = document.getElementById("weatherSource");
  const weatherHealthEl = document.getElementById("weatherHealth");
  const spoofIndicator = document.getElementById("spoofIndicator");
  const altTapeCanvas = document.getElementById("altitudeTape");
  const altTapeCtx = altTapeCanvas ? altTapeCanvas.getContext("2d") : null;
  const hdgTapeCanvas = document.getElementById("headingTape");
  const hdgTapeCtx = hdgTapeCanvas ? hdgTapeCanvas.getContext("2d") : null;
  const pills = {
    telemetry: document.getElementById("pillTelemetry"),
    gps: document.getElementById("pillGps"),
    imu: document.getElementById("pillImu"),
    camera: document.getElementById("pillCamera"),
    forecast: document.getElementById("pillForecast"),
    backup: document.getElementById("pillBackup")
  };

  const HISTORY_LEN = 48;
  const predicted = []; // simulated forecast trend, seeded off live readings

  function isDead(value) {
    return value === null || value === undefined || Number.isNaN(Number(value));
  }

  // Deterministic-ish drift off the last known-good value, so a
  // backup reading doesn't jump around randomly between polls but is
  // never presented as if it were a fresh live sensor sample.
  function spoofFrom(base, spread) {
    if (base === null || base === undefined) return null;
    const wobble = Math.sin(Date.now() / 9000 + base) * spread;
    return base + wobble;
  }

  function fmt(v, decimals) {
    return isDead(v) ? "--" : v.toFixed(decimals);
  }

  function setText(id, value) {
    const node = document.getElementById(id);
    if (!node) return;
    node.textContent = String(value);
  }

  // One entry per telemetry value shown anywhere on the dashboard.
  // `read` pulls the raw live value out of a packet; `spread` sizes
  // the backup drift; `write` pushes a value (live or backup) into
  // every DOM node that displays that value, using each node's own
  // formatting.
  const fields = {
    temperature: {
      read: (p) => Number(p.temperature ?? p.temp),
      spread: 0.6,
      last: null,
      current: null,
      write: (v) => setText("temperature", fmt(v, 1))
    },
    humidity: {
      read: (p) => Number(p.humidity ?? p.hum),
      spread: 1.5,
      last: null,
      current: null,
      write: (v) => setText("humidity", fmt(v, 0))
    },
    pressure: {
      read: (p) => Number(p.pressure ?? p.pres),
      spread: 0.8,
      last: null,
      current: null,
      write: (v) => setText("pressure", fmt(v, 0))
    },
    altitude: {
      read: (p) => Number(p.altitude ?? p.alt),
      spread: 2,
      last: null,
      current: null,
      write: (v) => {
        setText("altitude", fmt(v, 1));
        setText("headerAltitude", fmt(v, 1));
      }
    },
    battery: {
      read: (p) => Number(p.battery ?? p.batt),
      spread: 1.2,
      last: null,
      current: null,
      write: (v) => setText("headerBattery", fmt(v, 0))
    },
    voltage: {
      read: (p) => Number(p.voltage),
      spread: 0.05,
      last: null,
      current: null,
      write: (v) => setText("batteryMeta", isDead(v) ? "-- V" : v.toFixed(2) + " V")
    },
    latitude: {
      read: (p) => Number(p.latitude ?? p.lat),
      spread: 0.0004,
      last: null,
      current: null,
      write: (v) => setText("lat", isDead(v) ? "--" : v.toFixed(6))
    },
    longitude: {
      read: (p) => Number(p.longitude ?? p.lon),
      spread: 0.0004,
      last: null,
      current: null,
      write: (v) => setText("lon", isDead(v) ? "--" : v.toFixed(6))
    },
    satellites: {
      read: (p) => Number(p.gps_satellites ?? p.sats),
      spread: 0,
      last: null,
      current: null,
      write: (v) => setText("satellites", isDead(v) ? "--" : Math.max(0, Math.round(v)))
    },
    signal: {
      read: (p) => Number(p.signal ?? p.rssi),
      spread: 3,
      last: null,
      current: null,
      write: (v) => {
        const t = isDead(v) ? "--%" : Math.max(0, Math.min(100, Math.round(v))) + "%";
        setText("signalStrength", t);
        setText("footerSignal", t);
        setText("feedSignal", "SIG " + t);
      }
    },
    packets: {
      read: (p) => Number(p.packets ?? p.packet),
      spread: 0,
      last: null,
      current: null,
      write: (v) => {
        const t = isDead(v) ? "--" : Math.round(v).toLocaleString("en-US");
        setText("packetCount", t);
        setText("footerPackets", t);
      }
    },
    heading: {
      read: (p) => Number(p.yaw),
      spread: 4,
      last: null,
      current: null,
      write: (v) => setText("yaw", fmt(((v % 360) + 360) % 360, 0))
    }
  };

  // Runs every field through live-or-backup resolution for one
  // telemetry packet. Returns true if ANY field had to fall back to
  // a backup reading this cycle.
  function resolveAll(packet) {
    let anySpoofed = false;

    Object.values(fields).forEach((field) => {
      const live = field.read(packet);
      const dead = isDead(live);

      if (!dead) {
        field.last = live;
        field.current = live;
        field.write(live);
        return;
      }

      if (field.last !== null) {
        const backup = spoofFrom(field.last, field.spread);
        field.current = backup;
        field.write(backup);
        anySpoofed = true;
      } else {
        field.current = null;
        field.write(NaN);
      }
    });

    return anySpoofed;
  }

  function setSpoofUi(active) {
    if (spoofIndicator) {
      spoofIndicator.textContent = active ? "DATA: BACKUP" : "DATA: LIVE";
      spoofIndicator.classList.toggle("is-active", active);
    }
    if (sourceEl) sourceEl.textContent = active ? "BACKUP" : "LIVE";
  }

  // A gentle "forecast" model: rather than plotting the raw sensor
  // line, we ease a synthetic trend point toward the current reading
  // and add a slow drifting wave, so the graph reads as a weather
  // prediction rather than an exact telemetry replay.
  function stepPrediction(temp, humidity, pressure) {
    const t = Number.isFinite(temp) ? temp : (predicted.length ? predicted[predicted.length - 1].temp : 20);
    const h = Number.isFinite(humidity) ? humidity : (predicted.length ? predicted[predicted.length - 1].humidity : 50);
    const p = Number.isFinite(pressure) ? pressure : (predicted.length ? predicted[predicted.length - 1].pressure : 1013);

    const prev = predicted.length ? predicted[predicted.length - 1] : { temp: t, humidity: h, pressure: p };
    const drift = Math.sin(Date.now() / 60000) * 0.6;

    const next = {
      temp: prev.temp + (t - prev.temp) * 0.08 + drift * 0.15,
      humidity: prev.humidity + (h - prev.humidity) * 0.08 + drift * 0.4,
      pressure: prev.pressure + (p - prev.pressure) * 0.05 + drift * 0.2
    };

    predicted.push(next);
    if (predicted.length > HISTORY_LEN) predicted.shift();
    return next;
  }

  function classifyOutlook(latest) {
    if (!latest) return { label: "ANALYZING", confidence: 0 };
    const { humidity, pressure } = latest;
    let label = "CLEAR";
    let confidence = 62;

    if (pressure < 1000 && humidity > 70) {
      label = "STORM LIKELY";
      confidence = 74;
    } else if (pressure < 1008 && humidity > 60) {
      label = "RAIN POSSIBLE";
      confidence = 66;
    } else if (humidity > 80) {
      label = "FOG / MIST";
      confidence = 58;
    } else if (pressure > 1020 && humidity < 40) {
      label = "CLEAR & DRY";
      confidence = 70;
    }

    return { label, confidence };
  }

  function drawGraph(spoofed) {
    if (!ctx || !graphCanvas) return;
    const w = graphCanvas.width;
    const h = graphCanvas.height;
    ctx.clearRect(0, 0, w, h);

    if (predicted.length < 2) return;

    const temps = predicted.map((p) => p.temp);
    const min = Math.min(...temps);
    const max = Math.max(...temps);
    const range = Math.max(0.5, max - min);

    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 1;
    for (let gy = 0; gy <= 4; gy += 1) {
      const y = (h / 4) * gy;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    ctx.strokeStyle = spoofed ? "#ffc861" : "#63ff9f";
    ctx.lineWidth = 2;
    ctx.beginPath();
    predicted.forEach((point, i) => {
      const x = (i / (HISTORY_LEN - 1)) * w;
      const y = h - ((point.temp - min) / range) * (h - 12) - 6;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.font = "10px monospace";
    ctx.fillText("PREDICTED TREND — NOT A LIVE PLOT", 6, 12);
  }

  function drawAltitudeTape(altitude, spoofed) {
    if (!altTapeCtx || !altTapeCanvas) return;
    const w = altTapeCanvas.width;
    const h = altTapeCanvas.height;
    const ctx2 = altTapeCtx;
    ctx2.clearRect(0, 0, w, h);

    if (!Number.isFinite(altitude)) {
      ctx2.fillStyle = "rgba(255,255,255,0.4)";
      ctx2.font = "10px monospace";
      ctx2.fillText("--", 6, h / 2);
      return;
    }

    const pxPerUnit = 6; // vertical pixels per 1m
    const center = h / 2;
    const step = 5; // meters between minor ticks
    const range = Math.ceil((h / 2 / pxPerUnit) / step) + 1;
    const base = Math.round(altitude / step) * step;

    ctx2.strokeStyle = "rgba(255,255,255,0.35)";
    ctx2.fillStyle = "rgba(232,255,244,0.8)";
    ctx2.font = "9px monospace";
    ctx2.lineWidth = 1;

    for (let i = -range; i <= range; i += 1) {
      const value = base + i * step;
      if (value < 0) continue;
      const y = center - (value - altitude) * pxPerUnit;
      if (y < 0 || y > h) continue;
      const major = value % (step * 2) === 0;
      const tickLen = major ? 14 : 8;
      ctx2.beginPath();
      ctx2.moveTo(w - tickLen, y);
      ctx2.lineTo(w, y);
      ctx2.stroke();
      if (major) {
        ctx2.fillText(String(value), 4, y + 3);
      }
    }

    // Center pointer box showing current altitude
    ctx2.fillStyle = spoofed ? "#ffc861" : "#63ff9f";
    ctx2.fillRect(0, center - 8, w, 16);
    ctx2.fillStyle = "#020605";
    ctx2.font = "bold 10px monospace";
    ctx2.textAlign = "center";
    ctx2.fillText(altitude.toFixed(0), w / 2, center + 3);
    ctx2.textAlign = "left";
  }

  function drawHeadingTape(heading, spoofed) {
    if (!hdgTapeCtx || !hdgTapeCanvas) return;
    const w = hdgTapeCanvas.width;
    const h = hdgTapeCanvas.height;
    const ctx2 = hdgTapeCtx;
    ctx2.clearRect(0, 0, w, h);

    if (!Number.isFinite(heading)) {
      ctx2.fillStyle = "rgba(255,255,255,0.4)";
      ctx2.font = "10px monospace";
      ctx2.fillText("--", w / 2 - 8, h / 2 + 3);
      return;
    }

    const pxPerDeg = 4;
    const center = w / 2;
    const compass = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

    ctx2.strokeStyle = "rgba(255,255,255,0.35)";
    ctx2.fillStyle = "rgba(232,255,244,0.8)";
    ctx2.font = "9px monospace";
    ctx2.lineWidth = 1;

    for (let deg = 0; deg < 360; deg += 15) {
      let delta = deg - heading;
      delta = ((delta + 180) % 360 + 360) % 360 - 180;
      const x = center + delta * pxPerDeg;
      if (x < -20 || x > w + 20) continue;
      const major = deg % 45 === 0;
      const tickLen = major ? 14 : 8;
      ctx2.beginPath();
      ctx2.moveTo(x, h);
      ctx2.lineTo(x, h - tickLen);
      ctx2.stroke();
      if (major) {
        const label = compass[deg / 45];
        ctx2.textAlign = "center";
        ctx2.fillText(label, x, h - tickLen - 4);
      }
    }
    ctx2.textAlign = "left";

    // Center pointer showing current heading in degrees
    ctx2.fillStyle = spoofed ? "#ffc861" : "#63ff9f";
    ctx2.beginPath();
    ctx2.moveTo(center - 8, 0);
    ctx2.lineTo(center + 8, 0);
    ctx2.lineTo(center, 8);
    ctx2.closePath();
    ctx2.fill();
    ctx2.fillStyle = "#e8fff4";
    ctx2.font = "bold 11px monospace";
    ctx2.textAlign = "center";
    ctx2.fillText(Math.round(((heading % 360) + 360) % 360) + "°", center, h - 2);
    ctx2.textAlign = "left";
  }

  function setPill(pill, state) {
    if (!pill) return;
    pill.classList.remove("is-live", "is-warn");
    if (state === "live") pill.classList.add("is-live");
    else if (state === "warn") pill.classList.add("is-warn");
  }

  function updatePills(anySpoofed) {
    const telemetryText = (document.getElementById("telemetryStatus") || {}).textContent || "";
    setPill(pills.telemetry, telemetryText.trim() === "CONNECTED" ? "live" : "warn");

    const gpsText = (document.getElementById("gpsStatus") || {}).textContent || "";
    setPill(pills.gps, gpsText.trim() === "LOCKED" ? "live" : "warn");

    const pitchText = (document.getElementById("pitch") || {}).textContent || "--";
    setPill(pills.imu, pitchText.trim() !== "--" ? "live" : "warn");

    const cameraOnline = document.body.getAttribute("data-camera") === "online";
    setPill(pills.camera, cameraOnline ? "live" : "warn");

    const forecastText = (weatherHealthEl || {}).textContent || "";
    setPill(pills.forecast, forecastText.trim() === "MODEL ACTIVE" ? "live" : "warn");

    setPill(pills.backup, anySpoofed ? "warn" : "live");
  }

  async function poll() {
    try {
      const res = await fetch(TELEMETRY_URL, { cache: "no-store" });
      if (!res.ok) throw new Error("bad status");
      const packet = await res.json();

      const anySpoofed = resolveAll(packet);
      setSpoofUi(anySpoofed);

      const latest = stepPrediction(fields.temperature.last, fields.humidity.last, fields.pressure.last);
      const outlook = classifyOutlook(latest);

      if (outlookEl) outlookEl.textContent = outlook.label;
      if (confidenceEl) confidenceEl.textContent = outlook.confidence + "%";
      if (trendEl) {
        const prevTemp = predicted.length > 1 ? predicted[predicted.length - 2].temp : latest.temp;
        const delta = latest.temp - prevTemp;
        trendEl.textContent = (delta >= 0 ? "▲ " : "▼ ") + Math.abs(delta).toFixed(2) + " C";
      }
      if (weatherHealthEl) weatherHealthEl.textContent = "MODEL ACTIVE";

      drawGraph(anySpoofed);
      drawAltitudeTape(fields.altitude.current, isDead(fields.altitude.read(packet)));
      drawHeadingTape(fields.heading.current, isDead(fields.heading.read(packet)));
      updatePills(anySpoofed);
    } catch (err) {
      // Telemetry endpoint unreachable entirely — script.js already
      // shows the dashboard as disconnected; nothing more to spoof
      // here since there's no packet at all this cycle.
      if (weatherHealthEl) weatherHealthEl.textContent = "MODEL WAIT";
    }
  }

  poll();
  setInterval(poll, POLL_MS);
})();
