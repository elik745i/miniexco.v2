// batteryGraph.js
(function () {
  if (window.batteryGraphLoaded) return;
  window.batteryGraphLoaded = true;

  function createBatteryPopup() {
    if (document.getElementById("batteryPopupOverlay")) return;
    const overlay = document.createElement("div");
    overlay.id = "batteryPopupOverlay";
    overlay.innerHTML = `
      <div id="batteryPopupContent">
        <button id="batteryPopupClose" title="Close">&times;</button>
        <div style="font-weight:bold; font-size:1.15em;">Battery Voltage History</div>
        <div id="batteryPopupGraph"></div>
      </div>
    `;
    document.body.appendChild(overlay);

    document.getElementById("batteryPopupClose").onclick = () => overlay.classList.remove("active");
    overlay.addEventListener("mousedown", e => {
      if (e.target === overlay) overlay.classList.remove("active");
    });
  }

  function getGraphState() {
    if (!window.batteryGraphState) {
      window.batteryGraphState = {
        files: [],
        currentFileIdx: -1,
        cache: new Map(),
      };
    }
    return window.batteryGraphState;
  }

  function telemetryFileNumber(path) {
    const m = String(path || "").match(/telemetry_(\d+)\.csv$/i);
    return m ? parseInt(m[1], 10) : -1;
  }

  function sortTelemetryFilesAsc(files) {
    return files.slice().sort((a, b) => {
      const na = telemetryFileNumber(a);
      const nb = telemetryFileNumber(b);
      if (na >= 0 && nb >= 0 && na !== nb) return na - nb;
      return String(a).localeCompare(String(b));
    });
  }

  async function fetchTelemetryFiles() {
    let files = [];
    try {
      const r = await fetch("/list_telemetry_files");
      if (r.ok) {
        const arr = await r.json();
        if (Array.isArray(arr)) files = arr;
      }
    } catch (_) {}

    if (!files.length) {
      try {
        const r = await fetch("/list_sd_files?path=%2Ftelemetry&showSystem=1&start=0&count=500");
        if (r.ok) {
          const rows = await r.json();
          if (Array.isArray(rows)) {
            files = rows
              .filter(x => x && !x.isFolder && typeof x.name === "string" && x.name.toLowerCase().endsWith(".csv"))
              .map(x => x.name);
          }
        }
      } catch (_) {}
    }

    files = files
      .map(f => String(f || "").trim())
      .filter(Boolean)
      .map(f => (f.startsWith("/") ? f : `/telemetry/${f}`));

    return sortTelemetryFilesAsc(files);
  }

  function parseTelemetryCsv(csv) {
    const out = [];
    const lines = String(csv || "").split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const cols = line.split(",");
      if (cols.length < 3) continue;
      const ts = Number(String(cols[1]).trim());
      const v = Number(String(cols[2]).trim());
      const charger = cols.length > 4 ? Number(String(cols[4]).trim()) : NaN;
      if (!Number.isFinite(ts) || !Number.isFinite(v) || ts <= 0) continue;
      out.push({ ts, v, charger: Number.isFinite(charger) ? charger : NaN });
    }
    out.sort((a, b) => a.ts - b.ts);
    return out;
  }

  async function fetchTextWithProgress(url, onProgress) {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const lenHeader = resp.headers.get("content-length");
    const total = lenHeader ? parseInt(lenHeader, 10) : 0;
    if (!resp.body || !Number.isFinite(total) || total <= 0) {
      const txt = await resp.text();
      if (onProgress) onProgress(100);
      return txt;
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let loaded = 0;
    let text = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        loaded += value.byteLength;
        text += decoder.decode(value, { stream: true });
        if (onProgress) {
          const pct = Math.max(0, Math.min(100, Math.round((loaded * 100) / total)));
          onProgress(pct);
        }
      }
    }
    text += decoder.decode();
    if (onProgress) onProgress(100);
    return text;
  }

  function formatTs(ms) {
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return "";
    const p2 = n => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
  }

  function drawLoadingPlaceholder(chartDiv, pct, text) {
    const p = Number.isFinite(pct) ? Math.max(0, Math.min(100, Math.round(pct))) : null;
    chartDiv.innerHTML = `
      <div style="height:300px; position:relative; background:#11161e; border-radius:8px; border:1px solid #222a36;">
        <div style="position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:10px; color:#b9c6d6;">
          <div style="width:220px; height:10px; background:#232c38; border-radius:999px; overflow:hidden;">
            <div style="height:100%; width:${p === null ? 15 : p}%; background:#45aaff; transition:width .15s;"></div>
          </div>
          <div style="font-size:14px;">${text || "Loading telemetry..."}${p === null ? "" : ` ${p}%`}</div>
        </div>
      </div>
    `;
  }

  async function loadFilePointsByIndex(idx, opts = {}) {
    const state = getGraphState();
    if (idx < 0 || idx >= state.files.length) return null;
    const path = state.files[idx];
    const force = !!opts.force;
    if (!force && state.cache.has(path)) return state.cache.get(path);

    const chartDiv = document.getElementById("voltageChart");
    if (chartDiv) drawLoadingPlaceholder(chartDiv, 0, "Loading telemetry");

    const url = force ? `${path}?t=${Date.now()}` : path;
    const csv = await fetchTextWithProgress(url, pct => {
      const el = document.getElementById("voltageChart");
      if (el) drawLoadingPlaceholder(el, pct, "Loading telemetry");
    });

    const points = parseTelemetryCsv(csv);
    const model = { path, points };
    state.cache.set(path, model);
    return model;
  }

  function voltageToPct(v) {
    const lo = 6.6;
    const hi = 8.4;
    const p = ((v - lo) * 100) / (hi - lo);
    return Math.max(0, Math.min(100, p));
  }

  function linearSlopePerMin(tsSec, vals) {
    const N = vals.length;
    if (N < 3) return 0;
    const t0 = tsSec[0];
    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
    for (let i = 0; i < N; i++) {
      const x = (tsSec[i] - t0) / 60.0;
      const y = vals[i];
      sumX += x; sumY += y; sumXY += x * y; sumXX += x * x;
    }
    const den = (N * sumXX - sumX * sumX);
    if (!Number.isFinite(den) || Math.abs(den) < 1e-9) return 0;
    return (N * sumXY - sumX * sumY) / den;
  }

  function buildStatusText(points, pctArr) {
    const last = points[points.length - 1] || null;
    const isChargingNow = !!(last && Number.isFinite(last.charger) && last.charger >= 4.2);
    const peak = pctArr.length ? Math.round(Math.max(...pctArr)) : 0;
    return `Last charged to ${peak}%<br>${isChargingNow ? "Charging now" : "Stopped charging now"}`;
  }

  function setupChartControls(uplot, bounds, navHandlers) {
    const zoomInBtn = document.getElementById("voltageZoomIn");
    const zoomOutBtn = document.getElementById("voltageZoomOut");
    const resetBtn = document.getElementById("voltageResetZoom");
    const leftBtn = document.getElementById("voltagePanLeft");
    const rightBtn = document.getElementById("voltagePanRight");

    const xMinBound = bounds.xMin;
    const xMaxBound = bounds.xMax;
    const minWindow = 60 * 1000;
    const zoomFactor = 1.4;

    function readXScale() {
      const min = Number(uplot?.scales?.x?.min);
      const max = Number(uplot?.scales?.x?.max);
      if (Number.isFinite(min) && Number.isFinite(max) && max > min) return { min, max };
      return { min: xMinBound, max: xMaxBound };
    }

    function clampWindow(minX, maxX) {
      let lo = minX;
      let hi = maxX;
      if (lo < xMinBound) lo = xMinBound;
      if (hi > xMaxBound) hi = xMaxBound;
      if ((hi - lo) < minWindow) {
        const c = (lo + hi) / 2;
        lo = c - minWindow / 2;
        hi = c + minWindow / 2;
        if (lo < xMinBound) { lo = xMinBound; hi = Math.min(xMaxBound, lo + minWindow); }
        if (hi > xMaxBound) { hi = xMaxBound; lo = Math.max(xMinBound, hi - minWindow); }
      }
      if (hi <= lo) hi = Math.min(xMaxBound, lo + 1000);
      return { min: lo, max: hi };
    }

    function setX(win) {
      if (!win || !Number.isFinite(win.min) || !Number.isFinite(win.max) || win.max <= win.min) return;
      try { uplot.setScale("x", win); } catch (_) {}
    }

    const canZoom = xMaxBound > xMinBound;
    if (zoomInBtn) {
      zoomInBtn.disabled = !canZoom;
      zoomInBtn.onclick = () => {
        if (!canZoom) return;
        const s = readXScale();
        const range = Math.max(1, s.max - s.min);
        const c = (s.min + s.max) / 2;
        const win = clampWindow(c - Math.max(minWindow, range / zoomFactor) / 2, c + Math.max(minWindow, range / zoomFactor) / 2);
        setX(win);
      };
    }
    if (zoomOutBtn) {
      zoomOutBtn.disabled = !canZoom;
      zoomOutBtn.onclick = () => {
        if (!canZoom) return;
        const s = readXScale();
        const range = Math.max(1, s.max - s.min);
        const c = (s.min + s.max) / 2;
        const maxRange = Math.max(minWindow, xMaxBound - xMinBound);
        const win = clampWindow(c - Math.min(maxRange, range * zoomFactor) / 2, c + Math.min(maxRange, range * zoomFactor) / 2);
        setX(win);
      };
    }
    if (resetBtn) resetBtn.onclick = () => window.drawVoltageHistoryInPopup();

    if (leftBtn) {
      leftBtn.onclick = async () => {
        const s = readXScale();
        const range = Math.max(minWindow, s.max - s.min);
        const step = Math.max(minWindow, range * 0.8);
        const nextMin = s.min - step;
        const nextMax = s.max - step;
        if (nextMin < xMinBound + 1) {
          if (navHandlers && navHandlers.onNeedOlderFile) await navHandlers.onNeedOlderFile();
          return;
        }
        setX(clampWindow(nextMin, nextMax));
      };
    }
    if (rightBtn) {
      rightBtn.onclick = async () => {
        const s = readXScale();
        const range = Math.max(minWindow, s.max - s.min);
        const step = Math.max(minWindow, range * 0.8);
        const nextMin = s.min + step;
        const nextMax = s.max + step;
        if (nextMax > xMaxBound - 1) {
          if (navHandlers && navHandlers.onNeedNewerFile) await navHandlers.onNeedNewerFile();
          return;
        }
        setX(clampWindow(nextMin, nextMax));
      };
    }
  }

  async function renderFromFileIndex(idx, opts = {}) {
    const state = getGraphState();
    if (idx < 0 || idx >= state.files.length) return false;

    const estimateDiv = document.getElementById("voltageEstimate");
    const captionDiv = document.getElementById("voltageCaption");
    const chartDiv = document.getElementById("voltageChart");
    if (!estimateDiv || !captionDiv || !chartDiv) return false;

    let model;
    try {
      model = await loadFilePointsByIndex(idx, { force: !!opts.force });
    } catch (e) {
      estimateDiv.textContent = "Could not load telemetry log!";
      captionDiv.textContent = "";
      return false;
    }
    if (!model || !Array.isArray(model.points) || !model.points.length) {
      estimateDiv.textContent = "No data in telemetry log!";
      captionDiv.textContent = "";
      return false;
    }

    state.currentFileIdx = idx;

    const pts = model.points;
    const lastTs = pts[pts.length - 1].ts;
    const minTs = lastTs - 20 * 60;
    let filtered = pts.filter(p => p.ts >= minTs);
    if (filtered.length < 6) filtered = pts;

    const tsSec = filtered.map(p => p.ts);
    const tsMs = tsSec.map(t => t * 1000);
    const pct = filtered.map(p => voltageToPct(p.v));
    const charging = filtered.map(p => Number.isFinite(p.charger) && p.charger >= 4.2);

    let xMin = tsMs[0];
    let xMax = tsMs[tsMs.length - 1];
    if (!Number.isFinite(xMin) || !Number.isFinite(xMax)) {
      estimateDiv.textContent = "Not enough data.";
      captionDiv.textContent = "";
      return false;
    }
    if (xMax <= xMin) {
      xMin -= 60 * 1000;
      xMax += 60 * 1000;
    }

    const yMin = 0;
    const yMax = 100;

    // Split bars by status to color charging vs normal.
    const normalBars = [];
    const chargingBars = [];
    for (let i = 0; i < pct.length; i++) {
      if (charging[i]) {
        normalBars.push(null);
        chargingBars.push(pct[i]);
      } else {
        normalBars.push(pct[i]);
        chargingBars.push(null);
      }
    }

    // Estimated projection (grey), based on recent trend.
    const est = new Array(pct.length).fill(null);
    const recentN = Math.min(20, pct.length);
    const tsRecent = tsSec.slice(-recentN);
    const pctRecent = pct.slice(-recentN);
    let slope = linearSlopePerMin(tsRecent, pctRecent); // pct per minute
    if (!Number.isFinite(slope)) slope = 0;

    const xAll = tsMs.slice();
    const normalAll = normalBars.slice();
    const chargingAll = chargingBars.slice();
    const estAll = est.slice();

    if (Math.abs(slope) > 0.02 && pct.length > 0) {
      const lastPct = pct[pct.length - 1];
      const target = slope > 0 ? 100 : 0;
      const minsToTarget = Math.max(5, Math.min(240, Math.round(Math.abs((target - lastPct) / slope))));
      const stepMin = Math.max(2, Math.ceil(minsToTarget / 24));
      for (let m = stepMin; m <= minsToTarget; m += stepMin) {
        const t = tsSec[tsSec.length - 1] + m * 60;
        const p = Math.max(0, Math.min(100, lastPct + slope * m));
        xAll.push(t * 1000);
        normalAll.push(null);
        chargingAll.push(null);
        estAll.push(p);
      }
      xMax = xAll[xAll.length - 1];
    }

    chartDiv.innerHTML = "";
    const hasBarsPath = !!(uPlot.paths && uPlot.paths.bars);
    const barsPath = hasBarsPath ? uPlot.paths.bars({ size: [0.8], align: 1 }) : null;
    const uplotOpts = {
      width: 600,
      height: 300,
      series: [
        {},
        {
          label: "Battery level",
          stroke: "#47d7f7",
          fill: "#47d7f7",
          width: 1,
          paths: barsPath || undefined,
          points: { show: false },
        },
        {
          label: "Charging",
          stroke: "#63e36d",
          fill: "#63e36d",
          width: 1,
          paths: barsPath || undefined,
          points: { show: false },
        },
        {
          label: "Estimated battery level",
          stroke: "#9ea6b3",
          fill: "rgba(158,166,179,0.45)",
          width: 2,
          points: { show: false },
        },
      ],
      axes: [
        {
          label: "",
          stroke: "#bbb",
          grid: { stroke: "#333" },
          values: (u, vals) => vals.map(v => formatTs(v)),
          space: 42,
          font: "13px sans-serif",
          ticks: { stroke: "#666" },
          size: 60,
          rotate: -35,
        },
        {
          label: "%",
          stroke: "#bbb",
          grid: { stroke: "#333" },
          scale: "y",
          space: 48,
          values: (u, vals) => vals.map(v => `${Math.round(v)}%`),
          font: "13px sans-serif",
          ticks: { stroke: "#666" },
        },
      ],
      scales: {
        x: { min: xMin, max: xMax },
        y: { min: yMin, max: yMax },
      },
      cursor: { drag: { x: true, y: false }, focus: { prox: 24 } },
      hooks: {
        drawClear: [
          (u) => {
            u.ctx.save();
            u.ctx.fillStyle = "#181818";
            u.ctx.fillRect(0, 0, u.bbox.width, u.bbox.height);
            u.ctx.restore();
          },
        ],
      },
    };

    const uplot = new uPlot(uplotOpts, [xAll, normalAll, chargingAll, estAll], chartDiv);
    window.voltageChartObj = uplot;

    setupChartControls(uplot, { xMin, xMax }, {
      onNeedOlderFile: async () => {
        const next = state.currentFileIdx - 1;
        if (next >= 0) await renderFromFileIndex(next);
      },
      onNeedNewerFile: async () => {
        const next = state.currentFileIdx + 1;
        if (next < state.files.length) await renderFromFileIndex(next);
      },
    });

    estimateDiv.innerHTML = buildStatusText(filtered, pct);
    captionDiv.innerHTML = `
      <span style="display:inline-flex;align-items:center;gap:6px;margin-right:10px;"><span style="width:10px;height:10px;border-radius:50%;background:#47d7f7;display:inline-block;"></span>Battery level</span>
      <span style="display:inline-flex;align-items:center;gap:6px;margin-right:10px;"><span style="width:10px;height:10px;border-radius:50%;background:#63e36d;display:inline-block;"></span>Charging</span>
      <span style="display:inline-flex;align-items:center;gap:6px;"><span style="width:10px;height:10px;border-radius:50%;background:#9ea6b3;display:inline-block;"></span>Estimated battery level</span>
      <div style="margin-top:6px;opacity:.9;">${model.path} | ${formatTs(tsMs[0])} -> ${formatTs(tsMs[tsMs.length - 1])}</div>
    `;
    return true;
  }

  window.drawVoltageHistoryInPopup = async function () {
    const graphDiv = document.getElementById("batteryPopupGraph");
    if (!graphDiv) return;

    graphDiv.innerHTML = `
      <div id="voltageEstimate"></div>
      <div id="voltageChart"></div>
      <div id="voltageButtonBar">
        <button id="voltagePanLeft" title="Older">←</button>
        <button id="voltageZoomIn" title="Zoom In">+</button>
        <button id="voltageZoomOut" title="Zoom Out">-</button>
        <button id="voltageResetZoom" title="Refresh">⭯</button>
        <button id="voltagePanRight" title="Newer">→</button>
      </div>
      <div id="voltageCaption">Voltage and charge trend will be shown here.</div>
    `;

    const estimateDiv = document.getElementById("voltageEstimate");
    const captionDiv = document.getElementById("voltageCaption");
    const chartDiv = document.getElementById("voltageChart");
    if (!estimateDiv || !captionDiv || !chartDiv) return;

    estimateDiv.textContent = "Loading telemetry...";
    drawLoadingPlaceholder(chartDiv, 0, "Scanning telemetry files");

    const state = getGraphState();
    let files = [];
    try {
      files = await fetchTelemetryFiles();
    } catch (_) {
      files = [];
    }
    state.files = files;
    state.currentFileIdx = files.length - 1;

    if (!files.length) {
      estimateDiv.textContent = "No telemetry logs found!";
      captionDiv.textContent = "";
      drawLoadingPlaceholder(chartDiv, null, "No telemetry files");
      return;
    }

    const ok = await renderFromFileIndex(state.currentFileIdx, { force: true });
    if (!ok) {
      estimateDiv.textContent = "Could not render telemetry graph.";
      if (!captionDiv.textContent) captionDiv.textContent = "";
    }
  };

  window.showBatteryPopup = function () {
    ensureBatteryGraphCssLoaded();
    createBatteryPopup();
    document.getElementById("batteryPopupOverlay").classList.add("active");
    setTimeout(window.drawVoltageHistoryInPopup, 200);
  };

  function ensureBatteryGraphCssLoaded() {
    if (!document.getElementById("batteryGraphCss")) {
      const link = document.createElement("link");
      link.id = "batteryGraphCss";
      link.rel = "stylesheet";
      link.href = "/graph.css?v=" + Date.now();
      document.head.appendChild(link);
    }
  }
})();
