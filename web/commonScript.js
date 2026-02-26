window.cachedSystemSounds = (typeof window.cachedSystemSounds === "boolean") ? window.cachedSystemSounds : undefined;
window.cachedGamepadEnabled = (typeof window.cachedGamepadEnabled === "boolean") ? window.cachedGamepadEnabled : undefined;
window.cachedSystemVolume = (typeof window.cachedSystemVolume !== "undefined") ? window.cachedSystemVolume : undefined;
window.cachedWsRebootOnDisconnect = (typeof window.cachedWsRebootOnDisconnect === "boolean") ? window.cachedWsRebootOnDisconnect : undefined;

var websocketCarInput;
var auxSlider;
var bucketSlider;
var lastFPSUpdate = Date.now();
let emergencyOn = false;
let beaconActive = false;
let drawMode = false;
let drawingPoints = [];
let canvas = null;
let ctx = null;
let drawingActive = false;
let currentPath = [];
let svgOverlay;
let keymap = {};  // 🆕 Will hold dynamic keyboard mappings
// Make the same object visible via window for other scripts
window.keymap = keymap;

let imuScriptLoaded = false;
let ledOn = false;
let leftIndicator, rightIndicator, emergencyBtn, cameraStream;
let latestBatteryPercent = 0;
let latestBatteryVoltage = 0;
let micEnabled = false;
let micStream = null;
let micAudioElem = null;

let isRecordingVideo = false;
let videoRecordTimeout = null;

let cameraEnabled = false;

const assetTs = window.__ASSET_TS__ || Date.now();
window.__ASSET_TS__ = assetTs;

let imuScriptPending = false;
let imuScriptReadyPromise = null;

const cameraPrereqPromises = [];
function registerCameraPrereq(label, promise) {
  const wrapped = Promise.resolve(promise).catch((err) => {
    console.warn(`[CameraPrereq:${label}]`, err);
    return null;
  });
  cameraPrereqPromises.push(wrapped);
  return wrapped;
}
function waitForCameraPrereqs() {
  if (!cameraPrereqPromises.length) return Promise.resolve();
  return Promise.all(cameraPrereqPromises);
}

const CONTROLS_AUTO_HIDE_DELAY_MS = 5000;
const DIRECTIONAL_VECTORS = {
  forward: { command: "2", x: 0, y: 255 },
  backward: { command: "1", x: 0, y: -255 },
  left: { command: "3", x: -255, y: 0 },
  right: { command: "4", x: 255, y: 0 }
};
const memoryUiState = { open: null, lastReportTs: 0 };
const FPS_BAR_MAX = 30;
const UPTIME_BAR_MAX_SECS = 24 * 60 * 60;
const MEMORY_FRAME_MARGIN = 12;
const MEMORY_FRAME_LOCAL_KEY = "memoryFrameStateV1";
const memoryFrameState = {
  x: null,
  y: null,
  visible: true,
  dragArmed: false,
  dragging: false,
  dragOffsetX: 0,
  dragOffsetY: 0,
  longPressTimer: null,
  menuEl: null
};

function clampPct(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function updatePercentBar(kind, valueText, pctValue) {
  const textEl = document.getElementById(kind + "Text");
  const pctEl = document.getElementById(kind + "Pct");
  const fillEl = document.getElementById(kind + "BarFill");
  const pct = clampPct(pctValue);

  if (textEl) textEl.innerText = valueText;
  if (pctEl) pctEl.innerText = pct + "%";
  if (fillEl) fillEl.style.width = pct + "%";
}

function formatUptimeCompact(totalSecs) {
  const secs = Math.max(0, Number(totalSecs) || 0);
  const days = Math.floor(secs / 86400);
  const hours = Math.floor((secs % 86400) / 3600);
  const mins = Math.floor((secs % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function updateMemoryBar(kind, totalBytes, freeBytes) {
  const total = Number.isFinite(totalBytes) ? totalBytes : 0;
  const free = Number.isFinite(freeBytes) ? freeBytes : 0;
  const used = Math.max(0, total - free);
  const pct = (total > 0) ? clampPct((used * 100) / total) : 0;
  const totalKB = Math.round(total / 1024);
  const usedKB = Math.round(used / 1024);
  updatePercentBar(kind, usedKB + "/" + totalKB + " KB", pct);

  if (memoryUiState.open && (Date.now() - memoryUiState.lastReportTs > 3000)) {
    fetchAndRenderHeapReport();
  }
}

function fmtKb(value) {
  return Math.round((Number(value) || 0) / 1024) + " KB";
}

function renderDetailRows(containerId, rows) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = rows.map((r) =>
    `<div class="telemetry-meter__details-row"><span class="telemetry-meter__details-key">${r.k}</span><span class="telemetry-meter__details-val">${r.v}</span></div>`
  ).join("");
}

function renderTaskRows(containerId, tasks) {
  const el = document.getElementById(containerId);
  if (!el) return;
  if (!Array.isArray(tasks) || tasks.length === 0) {
    el.innerHTML = '<div class="telemetry-meter__details-row"><span class="telemetry-meter__details-key">No task stats</span><span class="telemetry-meter__details-val">-</span></div>';
    return;
  }
  const top = tasks
    .slice()
    .sort((a, b) => (a.stack_hwm_bytes || 0) - (b.stack_hwm_bytes || 0))
    .slice(0, 6);
  renderDetailRows(containerId, top.map((t) => ({
    k: (t.name || "task") + ` (P${t.priority ?? 0})`,
    v: `${fmtKb(t.stack_hwm_bytes || 0)} free`
  })));
}

async function fetchAndRenderHeapReport() {
  try {
    const r = await fetch("/heap_report?t=" + Date.now(), { cache: "no-store" });
    if (!r.ok) return;
    const data = await r.json();
    memoryUiState.lastReportTs = Date.now();

    renderDetailRows("heapDetailList", [
      { k: "Heap free", v: fmtKb(data?.heap?.free) },
      { k: "Heap largest", v: fmtKb(data?.heap?.largest_free_block) },
      { k: "Heap frag", v: String(data?.heap?.frag_pct ?? 0) + "%" },
      { k: "Internal free", v: fmtKb(data?.internal_heap?.free) },
      { k: "Internal frag", v: String(data?.internal_heap?.frag_pct ?? 0) + "%" }
    ]);

    renderDetailRows("psramDetailList", [
      { k: "PSRAM free", v: fmtKb(data?.psram?.free) },
      { k: "PSRAM largest", v: fmtKb(data?.psram?.largest_free_block) },
      { k: "PSRAM frag", v: String(data?.psram?.frag_pct ?? 0) + "%" },
      { k: "PSRAM min free", v: fmtKb(data?.psram?.min_free) }
    ]);

    renderTaskRows("heapTaskList", data?.tasks);
    renderTaskRows("psramTaskList", data?.tasks);
  } catch (_) {
    // keep UI responsive if endpoint is unavailable
  }
}

function setMemoryPanelOpen(kind) {
  const heap = document.getElementById("heapOverlay");
  const psram = document.getElementById("psramOverlay");
  if (!heap || !psram) return;

  memoryUiState.open = (memoryUiState.open === kind) ? null : kind;
  heap.classList.toggle("telemetry-meter--open", memoryUiState.open === "heap");
  psram.classList.toggle("telemetry-meter--open", memoryUiState.open === "psram");

  if (memoryUiState.open) {
    fetchAndRenderHeapReport();
  }
}

function initMemoryPanels() {
  const heap = document.getElementById("heapOverlay");
  const psram = document.getElementById("psramOverlay");
  if (heap && !heap.dataset.bound) {
    heap.dataset.bound = "1";
    heap.addEventListener("click", () => setMemoryPanelOpen("heap"));
  }
  if (psram && !psram.dataset.bound) {
    psram.dataset.bound = "1";
    psram.addEventListener("click", () => setMemoryPanelOpen("psram"));
  }
}

function getMemoryFrameWrap() {
  return document.getElementById("memoryMetersWrap");
}

function getMemoryFrameHost() {
  return document.querySelector(".right");
}

function clearMemoryLongPress() {
  if (memoryFrameState.longPressTimer) {
    clearTimeout(memoryFrameState.longPressTimer);
    memoryFrameState.longPressTimer = null;
  }
}

function closeMemoryContextMenu() {
  if (memoryFrameState.menuEl && memoryFrameState.menuEl.parentNode) {
    memoryFrameState.menuEl.parentNode.removeChild(memoryFrameState.menuEl);
  }
  memoryFrameState.menuEl = null;
}

function clampMemoryFramePos(x, y) {
  const wrap = getMemoryFrameWrap();
  const host = getMemoryFrameHost();
  if (!wrap || !host) return { x: x || 0, y: y || 0 };
  const maxX = Math.max(0, host.clientWidth - wrap.offsetWidth - MEMORY_FRAME_MARGIN);
  const maxY = Math.max(0, host.clientHeight - wrap.offsetHeight - MEMORY_FRAME_MARGIN);
  return {
    x: Math.max(MEMORY_FRAME_MARGIN, Math.min(maxX, Math.round(Number(x) || 0))),
    y: Math.max(MEMORY_FRAME_MARGIN, Math.min(maxY, Math.round(Number(y) || 0)))
  };
}

function memoryFrameDefaultPos() {
  const wrap = getMemoryFrameWrap();
  const host = getMemoryFrameHost();
  if (!wrap || !host) return { x: MEMORY_FRAME_MARGIN, y: MEMORY_FRAME_MARGIN };
  const x = Math.max(MEMORY_FRAME_MARGIN, host.clientWidth - wrap.offsetWidth - MEMORY_FRAME_MARGIN);
  return { x, y: MEMORY_FRAME_MARGIN };
}

function applyMemoryFramePosition(animated) {
  const wrap = getMemoryFrameWrap();
  if (!wrap) return;
  if (memoryFrameState.x === null || memoryFrameState.y === null) {
    const def = memoryFrameDefaultPos();
    memoryFrameState.x = def.x;
    memoryFrameState.y = def.y;
  }
  const next = clampMemoryFramePos(memoryFrameState.x, memoryFrameState.y);
  memoryFrameState.x = next.x;
  memoryFrameState.y = next.y;

  if (animated) wrap.style.transition = "left 220ms ease, top 220ms ease, opacity 180ms ease";
  wrap.style.right = "auto";
  wrap.style.left = next.x + "px";
  wrap.style.top = next.y + "px";
  if (animated) setTimeout(() => { wrap.style.transition = ""; }, 240);
}

function applyMemoryFrameVisibility() {
  const wrap = getMemoryFrameWrap();
  if (!wrap) return;
  wrap.classList.toggle("memory-meters-hidden", !memoryFrameState.visible);
}

function persistMemoryFrameState(sendToDevice) {
  try {
    localStorage.setItem(MEMORY_FRAME_LOCAL_KEY, JSON.stringify({
      x: memoryFrameState.x,
      y: memoryFrameState.y,
      visible: memoryFrameState.visible ? 1 : 0
    }));
  } catch (_) {}

  if (sendToDevice && typeof sendButtonInput === "function") {
    sendButtonInput("IndicatorsVisible", memoryFrameState.visible ? 1 : 0);
    if (Number.isFinite(memoryFrameState.x)) sendButtonInput("IndicatorsX", Math.round(memoryFrameState.x));
    if (Number.isFinite(memoryFrameState.y)) sendButtonInput("IndicatorsY", Math.round(memoryFrameState.y));
  }
}

function disarmMemoryDragMode() {
  const wrap = getMemoryFrameWrap();
  memoryFrameState.dragArmed = false;
  memoryFrameState.dragging = false;
  if (wrap) wrap.classList.remove("memory-meters--drag-armed", "memory-meters--dragging");
}

function armMemoryDragMode() {
  const wrap = getMemoryFrameWrap();
  if (!wrap || !memoryFrameState.visible) return;
  memoryFrameState.dragArmed = true;
  wrap.classList.add("memory-meters--drag-armed");
}

function openMemoryContextMenu(clientX, clientY) {
  const wrap = getMemoryFrameWrap();
  if (!wrap || !memoryFrameState.visible) return;
  closeMemoryContextMenu();

  const menu = document.createElement("div");
  menu.className = "memory-context-menu";
  menu.innerHTML = [
    '<button type="button" data-action="drag">Drag</button>',
    '<button type="button" data-action="default">Default</button>',
    '<button type="button" data-action="delete">Delete</button>'
  ].join("");
  document.body.appendChild(menu);

  const maxLeft = Math.max(6, window.innerWidth - menu.offsetWidth - 6);
  const maxTop = Math.max(6, window.innerHeight - menu.offsetHeight - 6);
  menu.style.left = Math.max(6, Math.min(maxLeft, Math.round(clientX))) + "px";
  menu.style.top = Math.max(6, Math.min(maxTop, Math.round(clientY))) + "px";

  menu.addEventListener("click", (e) => {
    const action = e.target && e.target.getAttribute("data-action");
    if (!action) return;
    if (action === "drag") {
      armMemoryDragMode();
    } else if (action === "default") {
      memoryFrameState.visible = true;
      const def = memoryFrameDefaultPos();
      memoryFrameState.x = def.x;
      memoryFrameState.y = def.y;
      applyMemoryFrameVisibility();
      applyMemoryFramePosition(true);
      disarmMemoryDragMode();
      persistMemoryFrameState(true);
    } else if (action === "delete") {
      memoryFrameState.visible = false;
      applyMemoryFrameVisibility();
      disarmMemoryDragMode();
      persistMemoryFrameState(true);
    }
    closeMemoryContextMenu();
  });

  memoryFrameState.menuEl = menu;
}

function initMemoryFrameInteractions() {
  const wrap = getMemoryFrameWrap();
  const host = getMemoryFrameHost();
  if (!wrap || !host || wrap.dataset.frameBound === "1") return;
  wrap.dataset.frameBound = "1";

  try {
    const raw = localStorage.getItem(MEMORY_FRAME_LOCAL_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && Number.isFinite(parsed.x) && Number.isFinite(parsed.y)) {
        memoryFrameState.x = parsed.x;
        memoryFrameState.y = parsed.y;
      }
      if (parsed && typeof parsed.visible !== "undefined") {
        memoryFrameState.visible = Number(parsed.visible) === 1;
      }
    }
  } catch (_) {}

  const startDrag = (clientX, clientY) => {
    if (!memoryFrameState.dragArmed || !memoryFrameState.visible) return;
    const rect = wrap.getBoundingClientRect();
    memoryFrameState.dragging = true;
    wrap.classList.add("memory-meters--dragging");
    memoryFrameState.dragOffsetX = clientX - rect.left;
    memoryFrameState.dragOffsetY = clientY - rect.top;
  };

  const moveDrag = (clientX, clientY) => {
    if (!memoryFrameState.dragging) return;
    const hostRect = host.getBoundingClientRect();
    memoryFrameState.x = clientX - hostRect.left - memoryFrameState.dragOffsetX;
    memoryFrameState.y = clientY - hostRect.top - memoryFrameState.dragOffsetY;
    applyMemoryFramePosition(false);
  };

  const endDrag = () => {
    if (!memoryFrameState.dragging) return;
    memoryFrameState.dragging = false;
    disarmMemoryDragMode();
    persistMemoryFrameState(true);
  };

  wrap.addEventListener("contextmenu", (e) => {
    if (!memoryFrameState.visible) return;
    e.preventDefault();
    openMemoryContextMenu(e.clientX, e.clientY);
  });

  wrap.addEventListener("mousedown", (e) => {
    if (e.button !== 0 || !memoryFrameState.dragArmed) return;
    e.preventDefault();
    e.stopPropagation();
    startDrag(e.clientX, e.clientY);
  }, true);
  window.addEventListener("mousemove", (e) => moveDrag(e.clientX, e.clientY));
  window.addEventListener("mouseup", endDrag);

  wrap.addEventListener("touchstart", (e) => {
    const touch = e.touches && e.touches[0];
    if (!touch) return;

    if (memoryFrameState.dragArmed) {
      e.preventDefault();
      startDrag(touch.clientX, touch.clientY);
      return;
    }

    clearMemoryLongPress();
    memoryFrameState.longPressTimer = setTimeout(() => {
      openMemoryContextMenu(touch.clientX, touch.clientY);
    }, 560);
  }, { passive: false });

  wrap.addEventListener("touchmove", (e) => {
    const touch = e.touches && e.touches[0];
    if (!touch) return;
    clearMemoryLongPress();
    if (memoryFrameState.dragging) {
      e.preventDefault();
      moveDrag(touch.clientX, touch.clientY);
    }
  }, { passive: false });

  wrap.addEventListener("touchend", () => {
    clearMemoryLongPress();
    endDrag();
  });
  wrap.addEventListener("touchcancel", () => {
    clearMemoryLongPress();
    endDrag();
  });

  document.addEventListener("click", (e) => {
    if (!memoryFrameState.menuEl) return;
    if (memoryFrameState.menuEl.contains(e.target)) return;
    closeMemoryContextMenu();
  });
  window.addEventListener("resize", () => applyMemoryFramePosition(false));

  applyMemoryFrameVisibility();
  applyMemoryFramePosition(false);
}

window.enableIndicatorsDragMode = function () {
  armMemoryDragMode();
};

window.resetIndicatorsPanelPosition = function () {
  memoryFrameState.visible = true;
  const def = memoryFrameDefaultPos();
  memoryFrameState.x = def.x;
  memoryFrameState.y = def.y;
  applyMemoryFrameVisibility();
  applyMemoryFramePosition(true);
  disarmMemoryDragMode();
  persistMemoryFrameState(true);
};

window.deleteIndicatorsPanel = function () {
  memoryFrameState.visible = false;
  applyMemoryFrameVisibility();
  disarmMemoryDragMode();
  persistMemoryFrameState(true);
};

window.restoreIndicatorsPanel = function () {
  memoryFrameState.visible = true;
  if (!Number.isFinite(memoryFrameState.x) || !Number.isFinite(memoryFrameState.y)) {
    const def = memoryFrameDefaultPos();
    memoryFrameState.x = def.x;
    memoryFrameState.y = def.y;
  }
  applyMemoryFrameVisibility();
  applyMemoryFramePosition(true);
  persistMemoryFrameState(true);
};

function ensureImuScript() {
  if (imuScriptLoaded) {
    return Promise.resolve();
  }
  if (imuScriptPending && imuScriptReadyPromise) {
    return imuScriptReadyPromise;
  }

  imuScriptPending = true;
  imuScriptReadyPromise = new Promise((resolve) => {
    const script = document.createElement("script");
    script.src = "/telemetryScript.js?v=" + assetTs;
    script.onload = () => {
      imuScriptLoaded = true;
      imuScriptPending = false;
      imuScriptReadyPromise = null;
      resolve();
    };
    script.onerror = () => {
      imuScriptPending = false;
      imuScriptReadyPromise = null;
      resolve();
    };
    (document.head || document.body || document.documentElement).appendChild(script);
  });
  return imuScriptReadyPromise;
}

let resolveCarInputReady;
registerCameraPrereq("carinput-ws", new Promise((resolve) => {
  resolveCarInputReady = () => {
    if (resolveCarInputReady) {
      resolve();
      resolveCarInputReady = null;
    }
  };
  setTimeout(() => {
    if (resolveCarInputReady) {
      resolveCarInputReady();
    }
  }, 6000);
}));

registerCameraPrereq("telemetry-script", ensureImuScript());
const DIRECTIONAL_KEYS = new Set(Object.keys(DIRECTIONAL_VECTORS));
let activeDirectionalAction = null;
let activeDirectionalSource = null;
const directionalButtonState = new WeakMap();

let controlsPanelElement = null;
let controlsPanelToggleBtn = null;
let controlsPanelAutoHideTimer = null;
let controlsPanelExpanded = true;
const controlsPanelMetrics = { panelWidth: 0, toggleWidth: 0 };

// Ensure the main stylesheet is cache-busted similarly to the previous inline script.
(function refreshMainStylesheet() {
  const mainStyle = document.getElementById('mainStyle');
  if (!mainStyle) {
    return;
  }

  const href = mainStyle.getAttribute('href') || '';
  if (href.includes('?v=')) {
    return; // already versioned, no duplicate fetch
  }

  const base = mainStyle.dataset.baseHref || href.split('?')[0];
  if (!base) {
    return;
  }

  const ts = window.__MAIN_STYLE_TS__ || Date.now();
  mainStyle.href = `${base}?v=${ts}`;
})();

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const BLANK_IMG =
  "data:image/svg+xml;utf8," + encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">
      <rect width="100%" height="100%" fill="black"/>
      <g transform="translate(320,180) scale(6.67) translate(-8,-8)">
        <path d="m 6.5 0 c -0.265625 0 -0.519531 0.105469 -0.707031 0.292969 l -1.707031 1.707031 h -1.023438 l -1.53125 -1.53125 l -1.0625 1.0625 l 14 14 l 1.0625 -1.0625 l -0.386719 -0.386719 c 0.527344 -0.539062 0.855469 -1.277343 0.855469 -2.082031 v -7 c 0 -1.644531 -1.355469 -3 -3 -3 h -1.085938 l -1.707031 -1.707031 c -0.1875 -0.1875 -0.441406 -0.292969 -0.707031 -0.292969 z m 0.414062 2 h 2.171876 l 1.707031 1.707031 c 0.1875 0.1875 0.441406 0.292969 0.707031 0.292969 h 1.5 c 0.570312 0 1 0.429688 1 1 v 7 c 0 0.269531 -0.097656 0.503906 -0.257812 0.679688 l -2.4375 -2.4375 c 0.4375 -0.640626 0.695312 -1.414063 0.695312 -2.242188 c 0 -2.199219 -1.800781 -4 -4 -4 c -0.828125 0 -1.601562 0.257812 -2.242188 0.695312 l -0.808593 -0.808593 c 0.09375 -0.046875 0.183593 -0.105469 0.257812 -0.179688 z m -6.492187 1.484375 c -0.265625 0.445313 -0.421875 0.964844 -0.421875 1.515625 v 7 c 0 1.644531 1.355469 3 3 3 h 8.9375 l -2 -2 h -6.9375 c -0.570312 0 -1 -0.429688 -1 -1 v -6.9375 z m 7.578125 2.515625 c 1.117188 0 2 0.882812 2 2 c 0 0.277344 -0.058594 0.539062 -0.15625 0.78125 l -2.625 -2.625 c 0.242188 -0.097656 0.503906 -0.15625 0.78125 -0.15625 z m -3.90625 1.15625 c -0.058594 0.273438 -0.09375 0.554688 -0.09375 0.84375 c 0 2.199219 1.800781 4 4 4 c 0.289062 0 0.570312 -0.035156 0.84375 -0.09375 z m 0 0"
              fill="#888"/>
      </g>
    </svg>
  `);





	
window.headingDeg = 0;
window.rollDeg = 0;
window.pitchDeg = 0;
window.headingCanvas = null;
window.tiltCanvas = null;
window.headingCtx = null;
window.tiltCtx = null;
window.pendingIMU = null;
window.cachedModelOrientation = window.cachedModelOrientation || { x: 0, y: 0, z: 0 };
window.cachedModelOrientationDir = window.cachedModelOrientationDir || { x: 1, y: 1, z: 1 };
window.cachedModelAxisMap = window.cachedModelAxisMap || { x: "x", y: "y", z: "z" };
window.modelOrientationDir = window.modelOrientationDir || { x: 1, y: 1, z: 1 };
window.modelOrientationOffsets = window.modelOrientationOffsets || { x: 0, y: 0, z: 0 };
window.modelAxisMap = window.modelAxisMap || { x: "x", y: "y", z: "z" };

function normalizeModelAxisChoice(value, fallbackAxis) {
	const fallback = (typeof fallbackAxis === "string" && ["x","y","z"].includes(fallbackAxis.toLowerCase()))
		? fallbackAxis.toLowerCase()
		: "x";
	if (typeof value === "number" && Number.isInteger(value)) {
		if (value === 0) return "x";
		if (value === 1) return "y";
		if (value === 2) return "z";
	}
	if (typeof value === "string") {
		const trimmed = value.trim().toLowerCase();
		if (trimmed === "x" || trimmed === "y" || trimmed === "z") {
			return trimmed;
		}
		const parsed = parseInt(trimmed, 10);
		if (!Number.isNaN(parsed)) {
			if (parsed === 0) return "x";
			if (parsed === 1) return "y";
			if (parsed === 2) return "z";
		}
	}
	return fallback;
}

window.applyModelOrientationOffsets = function() {
	const cache = window.cachedModelOrientation || { x: 0, y: 0, z: 0 };
	const dirs = window.cachedModelOrientationDir || { x: 1, y: 1, z: 1 };
	const mapRaw = window.cachedModelAxisMap || { x: "x", y: "y", z: "z" };
	window.modelAxisMap = {
		x: normalizeModelAxisChoice(mapRaw.x, "x"),
		y: normalizeModelAxisChoice(mapRaw.y, "y"),
		z: normalizeModelAxisChoice(mapRaw.z, "z")
	};
	const toRad = (val) => {
		const num = parseFloat(val);
		if (Number.isNaN(num)) return 0;
		return num * Math.PI / 180;
	};
	window.modelOrientationOffsets = {
		x: toRad(cache.x),
		y: toRad(cache.y),
		z: toRad(cache.z)
	};
	window.modelOrientationDir = {
		x: dirs.x ?? 1,
		y: dirs.y ?? 1,
		z: dirs.z ?? 1
	};
	if (
		typeof window.update3DOrientation === "function" &&
		typeof window.rollDeg === "number" &&
		typeof window.pitchDeg === "number" &&
		typeof window.headingDeg === "number"
	) {
		window.update3DOrientation(window.rollDeg, window.pitchDeg, window.headingDeg);
	}
};

window.applyModelOrientationOffsets();

if (window.update3DOrientation) {
  window.update3DOrientation(window.rollDeg, window.pitchDeg, window.headingDeg);
}


let  lastSentMotorValues = {
    Forward: 0,
    Backward: 0,
    Left: 0,
    Right: 0,
    Arm: 0,
    ArmUp: 0,
    ArmDown: 0
};

// Track current indicator states and debounce timers
let turnSignalState = {
    left: false,
    right: false,
    leftTimer: null,
    rightTimer: null,
};

let lastDriveDir = ""; // "Forward", "Backward", or ""

const sliderAnimations = {};  // Store interval handles by direction
const keysDown = {};
const joystick = document.getElementById("joystickContainer");
const knob = document.getElementById("joystickKnob");
let active = false;
const ARM_JOG_PWM = 200;

joystick.addEventListener("pointerdown", startDrag);
joystick.addEventListener("pointermove", drag);
joystick.addEventListener("pointerup", endDrag);
joystick.addEventListener("pointerleave", endDrag);


window.toggleDarkMode = function(isDark) {
	  document.body.classList.toggle("dark", isDark);
	  [".left", ".right", ".header"].forEach(sel => {
		const el = document.querySelector(sel);
		if (el) el.classList.toggle("dark", isDark);
	  });
	  localStorage.setItem("darkMode", isDark ? "1" : "0");
};

function initCollapsibleControlsPanel() {
  controlsPanelElement = document.getElementById('controlsPanel');
  controlsPanelToggleBtn = document.getElementById('controlsToggleBtn');

  if (!controlsPanelElement || !controlsPanelToggleBtn) {
    return;
  }

  controlsPanelElement.classList.remove('collapsed');
  controlsPanelToggleBtn.setAttribute('aria-expanded', 'true');
  controlsPanelToggleBtn.setAttribute('aria-label', 'Hide controls panel');

  controlsPanelToggleBtn.addEventListener('click', toggleControlsPanel);

  const interactionEvents = ['pointerdown', 'input', 'focusin', 'keydown', 'touchstart', 'wheel'];
  interactionEvents.forEach((evtName) => {
    controlsPanelElement.addEventListener(evtName, () => {
      if (controlsPanelExpanded) {
        scheduleControlsAutoHide();
      }
    }, { capture: true });
  });

  controlsPanelElement.addEventListener('mouseenter', clearControlsAutoHide);
  controlsPanelElement.addEventListener('mouseleave', () => {
    if (controlsPanelExpanded) {
      scheduleControlsAutoHide();
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      clearControlsAutoHide();
    } else if (controlsPanelExpanded) {
      scheduleControlsAutoHide();
    }
  });

  setControlsPanelExpanded(true);
  if (typeof window.requestAnimationFrame === 'function') {
    window.requestAnimationFrame(refreshControlsPanelPosition);
  } else {
    refreshControlsPanelPosition();
  }
  window.addEventListener('resize', handleControlsPanelResize);
}

function setControlsPanelExpanded(expanded, options = {}) {
  if (!controlsPanelElement || !controlsPanelToggleBtn) {
    return;
  }

  const { autoSchedule = true } = options;
  const isExpanded = Boolean(expanded);
  const collapsedOffset = computeControlsPanelCollapsedOffset();

  controlsPanelExpanded = isExpanded;
  controlsPanelElement.classList.toggle('collapsed', !isExpanded);
  controlsPanelToggleBtn.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
  controlsPanelToggleBtn.setAttribute('aria-label', isExpanded ? 'Hide controls panel' : 'Show controls panel');

  applyControlsPanelPosition(collapsedOffset, isExpanded);

  if (!isExpanded) {
    clearControlsAutoHide();
    return;
  }

  if (autoSchedule) {
    scheduleControlsAutoHide();
  } else {
    clearControlsAutoHide();
  }
}

window.toggleControlsPanel = function(event) {
  if (event && typeof event.preventDefault === 'function') {
    event.preventDefault();
  }
  const shouldExpand = !(controlsPanelExpanded === true);
  setControlsPanelExpanded(shouldExpand);
};

function scheduleControlsAutoHide() {
  if (!controlsPanelElement || !controlsPanelToggleBtn) {
    return;
  }
  if (!controlsPanelExpanded) {
    clearControlsAutoHide();
    return;
  }

  clearControlsAutoHide();
  controlsPanelAutoHideTimer = window.setTimeout(() => {
    if (!controlsPanelExpanded) {
      return;
    }

    const activeEl = document.activeElement;
    const isHoveringPanel = controlsPanelElement.matches(':hover');
    const isPanelFocused = activeEl && controlsPanelElement.contains(activeEl) && activeEl !== controlsPanelToggleBtn;

    if (document.hidden || isHoveringPanel || isPanelFocused) {
      scheduleControlsAutoHide();
      return;
    }

    setControlsPanelExpanded(false, { autoSchedule: false });
  }, CONTROLS_AUTO_HIDE_DELAY_MS);
}

function clearControlsAutoHide() {
  if (controlsPanelAutoHideTimer !== null) {
    window.clearTimeout(controlsPanelAutoHideTimer);
    controlsPanelAutoHideTimer = null;
  }
}

function computeControlsPanelCollapsedOffset() {
  if (!controlsPanelElement) {
    return 'calc(var(--controls-toggle-width) - var(--controls-panel-width))';
  }

  const panelRect = controlsPanelElement.getBoundingClientRect();
  let panelWidth = (panelRect && typeof panelRect.width === 'number')
    ? panelRect.width
    : 0;

  if (!panelWidth) {
    const panelComputed = getComputedStyle(controlsPanelElement);
    const parsedPanelWidth = parseFloat(panelComputed.width);
    if (!Number.isNaN(parsedPanelWidth) && parsedPanelWidth > 0) {
      panelWidth = parsedPanelWidth;
    } else if (controlsPanelElement.offsetWidth) {
      panelWidth = controlsPanelElement.offsetWidth;
    }
  }

  let toggleWidth = 0;
  if (controlsPanelToggleBtn) {
    const toggleRect = controlsPanelToggleBtn.getBoundingClientRect();
    if (toggleRect && typeof toggleRect.width === 'number') {
      toggleWidth = toggleRect.width;
    }
    if (!toggleWidth) {
      const toggleComputed = getComputedStyle(controlsPanelToggleBtn);
      const parsedToggleWidth = parseFloat(toggleComputed.width);
      if (!Number.isNaN(parsedToggleWidth) && parsedToggleWidth > 0) {
        toggleWidth = parsedToggleWidth;
      } else if (controlsPanelToggleBtn.offsetWidth) {
        toggleWidth = controlsPanelToggleBtn.offsetWidth;
      }
    }
  }

  if (!toggleWidth) {
    const rootStyles = getComputedStyle(document.documentElement);
    const toggleVar = parseFloat(rootStyles.getPropertyValue('--controls-toggle-width'));
    if (!Number.isNaN(toggleVar) && toggleVar > 0) {
      toggleWidth = toggleVar;
    }
  }

  controlsPanelMetrics.panelWidth = panelWidth || 0;
  controlsPanelMetrics.toggleWidth = toggleWidth || 0;

  const rootElement = document.documentElement;
  const isMobileContext = Boolean(
    window.__IS_MOBILE__ ||
    (rootElement && rootElement.classList && rootElement.classList.contains('is-mobile'))
  );

  if (isMobileContext) {
    if (panelWidth) {
      const collapsedPx = -Math.round(panelWidth * 100) / 100;
      return `${collapsedPx}px`;
    }
    return 'calc(-1 * var(--controls-panel-width))';
  }

  if (!panelWidth) {
    return 'calc(var(--controls-toggle-width) - var(--controls-panel-width))';
  }

  if (!toggleWidth) {
    const fallbackOffset = -Math.round(panelWidth * 100) / 100;
    return `${fallbackOffset}px`;
  }

  const offsetPx = toggleWidth - panelWidth;
  const rounded = Math.round(offsetPx * 100) / 100;
  return `${rounded}px`;
}

function applyControlsPanelPosition(offsetValue, isExpandedState) {
  if (!controlsPanelElement) {
    return;
  }

  const offset = offsetValue || 'calc(var(--controls-toggle-width) - var(--controls-panel-width))';
  controlsPanelElement.style.setProperty('--controls-panel-collapsed-offset', offset);
  controlsPanelElement.style.transform = '';
  controlsPanelElement.style.left = isExpandedState ? '0px' : offset;

  let overlayOffset = isExpandedState ? controlsPanelMetrics.panelWidth : controlsPanelMetrics.toggleWidth;
  if (overlayOffset && overlayOffset > 0) {
    overlayOffset = `calc(${Math.round(overlayOffset)}px + var(--controls-overlay-gap))`;
  } else {
    overlayOffset = isExpandedState
      ? 'var(--controls-overlay-left-expanded)'
      : 'var(--controls-overlay-left-collapsed)';
  }

  const docElement = document.documentElement;
  if (docElement) {
    docElement.style.setProperty('--controls-overlay-left-current', overlayOffset);
  }

  const isMobileContext = Boolean(
    (typeof window.__IS_MOBILE__ !== 'undefined' && window.__IS_MOBILE__) ||
    (docElement && docElement.classList && docElement.classList.contains('is-mobile'))
  );

  if (isMobileContext && docElement) {
    const panelWidth = controlsPanelMetrics.panelWidth ||
      (controlsPanelElement ? controlsPanelElement.offsetWidth : 0) || 0;
    const toggleWidth = controlsPanelMetrics.toggleWidth ||
      (controlsPanelToggleBtn ? controlsPanelToggleBtn.offsetWidth : 0) || 48;

    const collapsedLeft = Math.max(12, Math.round(toggleWidth * 0.4));
    const expandedLeft = Math.max(collapsedLeft, Math.round(panelWidth + Math.max(8, toggleWidth * 0.2)));
    const targetLeft = isExpandedState ? expandedLeft : collapsedLeft;

    docElement.style.setProperty('--mobile-toggle-left', `${targetLeft}px`);
  } else if (docElement) {
    docElement.style.removeProperty('--mobile-toggle-left');
  }
}

function refreshControlsPanelPosition() {
  if (!controlsPanelElement) {
    return;
  }

  const offset = computeControlsPanelCollapsedOffset();
  applyControlsPanelPosition(offset, Boolean(controlsPanelExpanded));
}

function handleControlsPanelResize() {
  refreshControlsPanelPosition();
}

function startDrag(e) {
    active = true;
    joystick.style.cursor = "grabbing";
    drag(e);
}

function drag(e) {
    if (!active) return;

    const rect = joystick.getBoundingClientRect();
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    const x = e.clientX - rect.left - centerX;
    const y = e.clientY - rect.top - centerY;

    const maxDist = rect.width / 2;
    const dist = Math.min(Math.hypot(x, y), maxDist);
    const angle = Math.atan2(y, x);
    const dx = Math.cos(angle) * dist;
    const dy = Math.sin(angle) * dist;

    knob.style.left = `${centerX + dx}px`;
    knob.style.top = `${centerY + dy}px`;

    // Normalize to -255 to +255 range
    const xVal = Math.round((dx / maxDist) * 255);
    const yVal = Math.round((-dy / maxDist) * 255); // negative = forward

    handle2DJoystick(xVal, yVal);
}

window.onload = function () {
  realOnLoad();
}



function endDrag() {
    active = false;
    knob.style.left = "50%";
    knob.style.top = "50%";

    // Explicitly force 0 speed in all directions
    lastSentMotorValues["Forward"] = -1;
    lastSentMotorValues["Backward"] = -1;
    lastSentMotorValues["Left"] = -1;
    lastSentMotorValues["Right"] = -1;
    joystick.style.cursor = "grab";
    handle2DJoystick(0, 0);
}


function handle2DJoystick(x, y) {
    x = Math.max(-255, Math.min(255, x));
    y = -Math.max(-255, Math.min(255, y)); // Invert Y

    const threshold = 20;
    let direction = null;
    let value = 0;
    let showLeft = false;
    let showRight = false;

    if (Math.abs(y) > Math.abs(x)) {
      if (y > threshold) {
        direction = "Backward";  // ⬅️ SWAPPED
        value = y;
      } else if (y < -threshold) {
        direction = "Forward";   // ⬅️ SWAPPED
        value = -y;
      }
    } else {
      if (x > threshold) {
        direction = "Right";
        value = x;
        showRight = true;
      } else if (x < -threshold) {
        direction = "Left";
        value = -x;
        showLeft = true;
      }
    }

    // Update left/right UI overlay based on direction
    const leftIndicator = document.getElementById("leftIndicator");
    const rightIndicator = document.getElementById("rightIndicator");

    if (direction === "Left") {
      leftIndicator.classList.add("visible", "blinking");
      rightIndicator.classList.remove("visible", "blinking");
    } else if (direction === "Right") {
      rightIndicator.classList.add("visible", "blinking");
      leftIndicator.classList.remove("visible", "blinking");
    } else {
      leftIndicator.classList.remove("visible", "blinking");
      rightIndicator.classList.remove("visible", "blinking");
    }

    // Send UDP trigger for turn signals (Left or Right)
    if (direction === "Left" || direction === "Right") {
      sendButtonInput("Slider", direction + "," + value);
    }

    // 🔁 Motor commands
    if (!direction) {
      sendMotorSpeed("Forward", 0);
      sendMotorSpeed("Backward", 0);
      sendMotorSpeed("Left", 0);
      sendMotorSpeed("Right", 0);
      return;
    }

    sendMotorSpeed(direction, Math.min(255, value));
}

function setJoystickKnob(x, y) {
    const rect = joystick.getBoundingClientRect();
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    const maxDist = rect.width / 2;

    // Normalize to visual scale
    const dx = (x / 255) * maxDist;
    const dy = (-y / 255) * maxDist; // negative y = up

    knob.style.left = `${centerX + dx}px`;
    knob.style.top = `${centerY + dy}px`;
}

function realOnLoad() {
  initCollapsibleControlsPanel();
  initDirectionalButtons();
  // --- DARK MODE SYNC: Fetch from backend as soon as modal & DOM are ready ---
  fetch('/getsettings')
    .then(r => r.json())
    .then(data => {
      if ("darkMode" in data) {
        window.toggleDarkMode(data.darkMode == 1);
        const darkToggle = document.getElementById("darkToggle");
        if (darkToggle) darkToggle.checked = (data.darkMode == 1);
      }
      if ("horizontalScreen" in data) {
        const horizontalToggle = document.getElementById("horizontalToggle");
        if (horizontalToggle) horizontalToggle.checked = (data.horizontalScreen == 1);
      }
      if ("holdBucket" in data) {
        const holdBucketToggle = document.getElementById("holdBucketToggle");
        if (holdBucketToggle) holdBucketToggle.checked = (data.holdBucket == 1);
      }
      if ("holdAux" in data) {
        const holdAuxToggle = document.getElementById("holdAuxToggle");
        if (holdAuxToggle) holdAuxToggle.checked = (data.holdAux == 1);
      }
      if ("RecordTelemetry" in data) {
        const recordTelemetrySwitch = document.getElementById("recordTelemetryToggle");
        if (recordTelemetrySwitch) recordTelemetrySwitch.checked = (data.RecordTelemetry == 1);
      }
      if ("SystemSounds" in data) {
        window.cachedSystemSounds = (data.SystemSounds == 1);
        const systemSoundsToggle = document.getElementById("systemSoundsToggle");
        if (systemSoundsToggle) systemSoundsToggle.checked = window.cachedSystemSounds;
      }
      const gamepadPrefRaw = ("BluepadEnabled" in data)
        ? data.BluepadEnabled
        : (("GamepadEnabled" in data) ? data.GamepadEnabled : undefined);
      if (typeof gamepadPrefRaw !== "undefined") {
        const nextGamepadState = Number(gamepadPrefRaw) === 1;
        window.cachedGamepadEnabled = nextGamepadState;
        const gamepadToggle = document.getElementById("gamepadToggle");
        if (gamepadToggle) gamepadToggle.checked = nextGamepadState;
        if (typeof window.handleGamepadUiState === "function") {
          window.handleGamepadUiState(nextGamepadState);
        }
      }
      if ("SystemVolume" in data) {
        window.cachedSystemVolume = data.SystemVolume;
        const systemVolume = document.getElementById("systemVolume");
        const systemVolumeLabel = document.getElementById("systemVolumeLabel");
        if (systemVolume) systemVolume.value = window.cachedSystemVolume;
        if (systemVolumeLabel) systemVolumeLabel.innerText = window.cachedSystemVolume;
      }
      if ("WsRebootOnDisconnect" in data) {
        window.cachedWsRebootOnDisconnect = (data.WsRebootOnDisconnect == 1);
        const wsRebootToggle = document.getElementById("wsRebootOnDisconnectToggle");
        if (wsRebootToggle) wsRebootToggle.checked = window.cachedWsRebootOnDisconnect;
      }
      if ("IndicatorsVisible" in data) {
        memoryFrameState.visible = (data.IndicatorsVisible == 1);
      }
      if ("IndicatorsX" in data && "IndicatorsY" in data) {
        const indX = parseInt(data.IndicatorsX, 10);
        const indY = parseInt(data.IndicatorsY, 10);
        if (!Number.isNaN(indX) && !Number.isNaN(indY)) {
          memoryFrameState.x = indX;
          memoryFrameState.y = indY;
        }
      }
      applyMemoryFrameVisibility();
      applyMemoryFramePosition(false);
      if ("ModelRotX" in data || "ModelRotY" in data || "ModelRotZ" in data) {
        window.cachedModelOrientation = window.cachedModelOrientation || { x: 0, y: 0, z: 0 };
        const normalize = (val) => {
          const num = parseInt(val, 10);
          return Number.isNaN(num) ? 0 : Math.max(-360, Math.min(360, num));
        };
      if ("ModelRotX" in data) window.cachedModelOrientation.x = normalize(data.ModelRotX);
      if ("ModelRotY" in data) window.cachedModelOrientation.y = normalize(data.ModelRotY);
      if ("ModelRotZ" in data) window.cachedModelOrientation.z = normalize(data.ModelRotZ);
      if (typeof window.applyModelOrientationOffsets === "function") {
        window.applyModelOrientationOffsets();
      }
      const axisIds = { x: "modelRotX", y: "modelRotY", z: "modelRotZ" };
      Object.keys(axisIds).forEach(axis => {
        const el = document.getElementById(axisIds[axis]);
        if (el) el.value = window.cachedModelOrientation[axis];
      });
    }
      if ("ModelDirX" in data || "ModelDirY" in data || "ModelDirZ" in data) {
        const dirIds = {
          x: { cw: "modelDirXcw", ccw: "modelDirXccw" },
          y: { cw: "modelDirYcw", ccw: "modelDirYccw" },
          z: { cw: "modelDirZcw", ccw: "modelDirZccw" }
        };
        window.cachedModelOrientationDir = window.cachedModelOrientationDir || { x: 1, y: 1, z: 1 };
        const normalizeDir = (val) => {
          const num = parseInt(val, 10);
          if (Number.isNaN(num)) return 1;
          return num < 0 ? -1 : 1;
        };
        const applyFallbackDir = (axis, mult) => {
          window.cachedModelOrientationDir[axis] = mult;
          const map = dirIds[axis];
          if (!map) return;
          const cwBox = document.getElementById(map.cw);
          const ccwBox = document.getElementById(map.ccw);
          if (cwBox) cwBox.checked = (mult >= 0);
          if (ccwBox) ccwBox.checked = (mult < 0);
        };
        ["x","y","z"].forEach(axis => {
          const key = axis === "x" ? "ModelDirX" : axis === "y" ? "ModelDirY" : "ModelDirZ";
          if (!(key in data)) return;
          const multiplier = normalizeDir(data[key]);
          if (typeof setModelDirectionValue === "function") {
            setModelDirectionValue(axis, multiplier);
          } else {
            applyFallbackDir(axis, multiplier);
          }
        });
        if (typeof window.applyModelOrientationOffsets === "function") {
          window.applyModelOrientationOffsets();
        }
        if (typeof window.paintModelDirectionControls === "function") {
          window.paintModelDirectionControls();
        }
      }
      if ("ModelAxisX" in data || "ModelAxisY" in data || "ModelAxisZ" in data) {
        window.cachedModelAxisMap = window.cachedModelAxisMap || { x: "x", y: "y", z: "z" };
        const nextMap = {
          x: ("ModelAxisX" in data) ? normalizeModelAxisChoice(data.ModelAxisX, window.cachedModelAxisMap.x) : window.cachedModelAxisMap.x,
          y: ("ModelAxisY" in data) ? normalizeModelAxisChoice(data.ModelAxisY, window.cachedModelAxisMap.y) : window.cachedModelAxisMap.y,
          z: ("ModelAxisZ" in data) ? normalizeModelAxisChoice(data.ModelAxisZ, window.cachedModelAxisMap.z) : window.cachedModelAxisMap.z
        };
        window.cachedModelAxisMap = nextMap;
        if (typeof window.setModelAxisMapping === "function") {
          ["x","y","z"].forEach(axis => {
            window.setModelAxisMapping(axis, nextMap[axis], { skipApply: true, skipValidation: true });
          });
          if (typeof window.paintModelAxisSelects === "function") {
            window.paintModelAxisSelects();
          } else if (typeof window.validateModelAxisMapping === "function") {
            window.validateModelAxisMapping();
          }
          if (typeof window.applyModelOrientationOffsets === "function") {
            window.applyModelOrientationOffsets();
          }
        } else if (typeof window.applyModelOrientationOffsets === "function") {
          window.applyModelOrientationOffsets();
        }
      }
      if (typeof window.paintRobotAudioControls === "function") {
        window.paintRobotAudioControls();
      }
    })
    .catch(() => {
      window.toggleDarkMode(localStorage.getItem("darkMode") === "1");
    });

  // --- Your original code follows ---
  auxSlider = document.getElementById("AUX");
  bucketSlider = document.getElementById("Bucket");
  updateSliderValue("Bucket");
  updateSliderValue("AUX");

  // Arm slider logic
  const armSlider = document.getElementById("armVerticalSlider");
  const armValueLabel = document.getElementById("armVerticalValue");
  let lastSentArmValue = 0;

  if (armSlider && armValueLabel) {
    armSlider.addEventListener("input", function () {
      let value = parseInt(armSlider.value);
      armValueLabel.textContent = value;
      if (value !== lastSentArmValue) {
        sendMotorSpeed("Arm", value);
        lastSentArmValue = value;
      }
    });

    armSlider.addEventListener("change", function () {
      armSlider.value = 0;
      armValueLabel.textContent = 0;
      sendMotorSpeed("Arm", 0);
      lastSentArmValue = 0;
    });
  }

  initArmJogButtons({
    slider: armSlider,
    label: armValueLabel,
    setLastValue: (val) => { lastSentArmValue = val; }
  });

  // Restore emergency state if needed
  const emergencyBtn = document.getElementById("emergencyBtn");
  if (emergencyBtn?.classList.contains("active")) {
    emergencyOn = true;
    document.getElementById("leftIndicator")?.classList.add("visible", "blinking");
    document.getElementById("rightIndicator")?.classList.add("visible", "blinking");
    emergencyBtn.classList.add("blinking");
  }

  initWebSocket();

  // ---------- LIVE KEYMAP SUPPORT ----------
  // Map firmware (snake_case) names to UI action names used in handleKeyDown/Up
  const FW_TO_UI = {
    forward: "forward",
    backward: "backward",
    left: "left",
    right: "right",
    stop: "stop",
    arm_up: "armUp",
    arm_down: "armDown",
    bucket_up: "bucketUp",
    bucket_down: "bucketDown",
    aux_up: "auxUp",
    aux_down: "auxDown",
    light_toggle: "led",
    beacon_toggle: "beacon",
    emergency: "emergency",          // new stored key (≤15 chars)
    emergency_toggle: "emergency",    // legacy alias (if backend still returns it)
    horn: "horn",
  };

  // Global so modal can call it: window.refreshRuntimeKeymap()
	window.refreshRuntimeKeymap = async function refreshRuntimeKeymap() {
		try {
			const data = await (await fetch('/get_keymap')).json();
			// Clear the existing object so all references stay valid
			for (const k in keymap) delete keymap[k];

			// Map fw (snake_case) -> UI action name (used by handlers)
			const FW_TO_UI = {
				forward: "forward",
				backward: "backward",
				left: "left",
				right: "right",
				stop: "stop",
				arm_up: "armUp",
				arm_down: "armDown",
				bucket_up: "bucketUp",
				bucket_down: "bucketDown",
				aux_up: "auxUp",
				aux_down: "auxDown",
				light_toggle: "led",
				beacon: "beacon",
				beacon_toggle: "beacon",      // ← back-compat alias fixes your issue
				emergency: "emergency",
				emergency_toggle: "emergency", // ← optional back-compat
				horn: "horn",
			};

			Object.entries(data).forEach(([fwAction, key]) => {
				const uiAction = FW_TO_UI[fwAction] || fwAction;
				const normKey = (key || "").toLowerCase();
				if (normKey) keymap[normKey] = uiAction;
			});

			console.log('[keymap] refreshed', keymap);
		} catch (e) {
			console.error('refreshRuntimeKeymap failed', e);
		}
	};


  // Initial load of the live keymap
  window.refreshRuntimeKeymap();

  // If the ESP broadcasts KEYMAP_UPDATED over the CarInput WS, refresh immediately.
  // (Safe to attach even if initWebSocket also sets onmessage; addEventListener coexists.)
  (function attachKeymapWsListener(retries = 10) {
    const ws = window.wsCarInput || window.websocketCarInput;
    if (ws && !ws.__keymapListenerAttached) {
      ws.addEventListener('message', (ev) => {
        // Only handle string frames here
        if (typeof ev.data !== 'string') return;
        if (ev.data === 'KEYMAP_UPDATED') {
          window.refreshRuntimeKeymap && window.refreshRuntimeKeymap();
        }
      });
      ws.__keymapListenerAttached = true;
    } else if (retries > 0) {
      setTimeout(() => attachKeymapWsListener(retries - 1), 200);
    }
  })();
  // ---------- END LIVE KEYMAP SUPPORT ----------

  // Keyboard listeners
  document.addEventListener("keydown", handleKeyDown);
  document.addEventListener("keyup", handleKeyUp);

  // Telemetry placeholders
  updatePercentBar("fps", "FPS: ...", 0);
  updatePercentBar("battery", "Batt: 0% (0.00V)", 0);
  updatePercentBar("wifi", "WiFi: 0%", 0);
  updatePercentBar("uptime", "Uptime: 0m, Temp: 0.0C", 0);
  updateMemoryBar("heap", 0, 0);
  updateMemoryBar("psram", 0, 0);
  initMemoryPanels();
  initMemoryFrameInteractions();

  // Lane overlay
  const laneOverlay = document.getElementById("laneOverlay");
  if (laneOverlay) {
    laneOverlay.style.display =
      localStorage.getItem("laneOverlayVisible") === "true" ? "block" : "none";
  }
  const startStreamAfterLoad = () => {
    window.removeEventListener('load', startStreamAfterLoad);
    waitForCameraPrereqs()
      .catch(() => {})
      .finally(() => {
        fetchCameraStatus();
      });
  };
  if (document.readyState === 'complete') {
    setTimeout(startStreamAfterLoad, 0);
  } else {
    window.addEventListener('load', startStreamAfterLoad);
  }
}



function updateLedButtonState(isOn) {
    const btn = document.getElementById("ledToggleBtn");
    ledOn = isOn;

    if (btn) {
      if (isOn) {
        btn.innerText = "💡 LED: ON";
        btn.style.backgroundColor = "#ffd700";
        btn.style.color = "black";
      } else {
        btn.innerText = "💡 LED: OFF";
        btn.style.backgroundColor = "#444";
        btn.style.color = "white";
      }
    }
}

function updateDeviceProgress(filename, elapsed, duration) {
	  if (typeof window.mediaPlayerUpdateDeviceProgress === "function") {
		window.mediaPlayerUpdateDeviceProgress(filename, elapsed, duration);
	  }
	  // Optionally: update a basic overlay, or ignore if only handled in mediaPlayer.js
	}

function setDevicePlayState(filename, isPlaying) {
	  if (typeof window.mediaPlayerSetDevicePlayState === "function") {
		window.mediaPlayerSetDevicePlayState(filename, isPlaying);
	  }
	  // Optionally: set global flags/UI outside media player if needed
}


function initWebSocket() {
  if (websocketCarInput && (websocketCarInput.readyState === WebSocket.OPEN || websocketCarInput.readyState === WebSocket.CONNECTING)) {
    return;
  }

  websocketCarInput = new WebSocket("ws://" + location.host + "/CarInput");
  window.wsCarInput = websocketCarInput;

  websocketCarInput.onopen  = () => {
    console.log("WebSocket Connected");
    if (typeof resolveCarInputReady === "function") {
      resolveCarInputReady();
    }
    window._carSocketQueue = window._carSocketQueue || [];
    if (window._carSocketQueue.length) {
      const pending = window._carSocketQueue.splice(0);
      pending.forEach(msg => websocketCarInput.send(msg));
    }
  };
  websocketCarInput.onerror = (err) => {
    console.warn("WebSocket error", err);
    if (typeof resolveCarInputReady === "function") {
      resolveCarInputReady();
    }
  };
  websocketCarInput.onclose = () => {
    if (typeof resolveCarInputReady === "function") {
      resolveCarInputReady();
    }
    setTimeout(initWebSocket, 2000);
  };

  // ✅ Robust onmessage: handles string, Blob, ArrayBuffer
  websocketCarInput.onmessage = function (event) {
    const deliver = (text) => {
      const msg = (typeof text === "string") ? text : String(text ?? "");
      try {

      // --- MEDIA PLAYER DEVICE EVENTS ---
      if (msg.startsWith("MEDIA_DEVICE_PROGRESS,")) {
        const parts = msg.split(",");
        if (parts.length >= 4) {
          const filename = decodeURIComponent(parts[1]);
          const elapsed  = parseFloat(parts[2]);
          const duration = parseFloat(parts[3]);
          updateDeviceProgress(filename, elapsed, duration);
        }
        return;
      }
      if (msg.startsWith("MEDIA_DEVICE_PLAYING,")) {
        const filename = decodeURIComponent(msg.split(",")[1] || "");
        setDevicePlayState(filename, true);
        if (typeof window.mediaPlayerSetDeviceTransportState === "function") {
          window.mediaPlayerSetDeviceTransportState("playing");
        }
        return;
      }
      if (msg.startsWith("MEDIA_DEVICE_PAUSED")) {
        if (typeof window.mediaPlayerSetDeviceTransportState === "function") {
          window.mediaPlayerSetDeviceTransportState("paused");
        }
        return;
      }
      if (msg.startsWith("MEDIA_DEVICE_STOPPED")) {
        setDevicePlayState(null, false);
        if (typeof window.mediaPlayerSetDeviceTransportState === "function") {
          window.mediaPlayerSetDeviceTransportState("stopped");
        }
        return;
      }

      // --- IMU ---
      if (msg.startsWith("IMU,")) {
        const p = msg.split(",");
        if (p.length >= 8) {
          const [_, h, r, pch, mx, my, mz, temp] = p;
          ensureImuScript().then(() => {
            if (typeof handleIMUMessage === "function") {
              handleIMUMessage(h, r, pch, mx, my, mz, temp);
            }
          });
        }
        return;
      }

      // --- General key,value CSV messages ---
      const parts = msg.split(",");
      const key   = (parts[0] || "").toString();
      const value = (parts[1] || "").toString();
      const normalizedKey = key.toUpperCase();

      if (key === "Light") {
        const on = (value === "1");
        ledOn = on;
        const btn = document.getElementById("ledToggleBtn");
        if (btn) {
          if (on) { btn.innerText = "💡 LED: ON";  btn.style.backgroundColor = "#ffd700"; btn.style.color = "black"; }
          else    { btn.innerText = "💡 LED: OFF"; btn.style.backgroundColor = "#444";    btn.style.color = "white"; }
        }
        return;
      }

      if (key === "GPIOCONF") {
        const map = {};
        value.split(";").forEach(pair => {
          const [k, raw] = pair.split(":");
          if (!k) return;
          const trimmedKey = k.trim();
          if (!trimmedKey) return;
          const num = parseInt((raw || "").trim(), 10);
          map[trimmedKey] = Number.isNaN(num) ? -1 : num;
        });
        if (!window.cachedGpioConfig || typeof window.cachedGpioConfig !== "object") {
          window.cachedGpioConfig = {};
        }
        Object.assign(window.cachedGpioConfig, map);
        if (typeof window.applyGpioConfigSnapshot === "function") {
          window.applyGpioConfigSnapshot(map);
        }
        return;
      }

      if (key === "FPS") {
        const fpsValue = parseInt(value || "0", 10);
        const safeFps = Number.isNaN(fpsValue) ? 0 : Math.max(0, fpsValue);
        const fpsPct = (safeFps * 100) / FPS_BAR_MAX;
        updatePercentBar("fps", "FPS: " + safeFps, fpsPct);
        lastFPSUpdate = Date.now();
        return;
      }
      if (key === "HEAP") {
        const totalBytes = parseInt(parts[1] || "0", 10);
        const freeBytes  = parseInt(parts[2] || "0", 10);
        updateMemoryBar("heap",
          Number.isNaN(totalBytes) ? 0 : totalBytes,
          Number.isNaN(freeBytes) ? 0 : freeBytes
        );
        return;
      }
      if (key === "PSRAM") {
        const totalBytes = parseInt(parts[1] || "0", 10);
        const freeBytes = parseInt(parts[2] || "0", 10);
        updateMemoryBar("psram",
          Number.isNaN(totalBytes) ? 0 : totalBytes,
          Number.isNaN(freeBytes) ? 0 : freeBytes
        );
        return;
      }

      if (key === "AUX") {
        auxSlider.value = parseInt(value || "0", 10);
        updateSliderValue("AUX");
        return;
      }
      if (key === "Bucket") {
        bucketSlider.value = parseInt(value || "0", 10);
        updateSliderValue("Bucket");
        return;
      }

      if (key === "BATT") {
        const batteryPercent = parseInt(parts[1] || "0", 10);
        latestBatteryPercent = batteryPercent;
        const voltage = parseFloat(parts[2] || "0");
        latestBatteryVoltage = Number.isNaN(voltage) ? 0 : voltage;
        const wifiQuality = parseInt(parts[3] || "0", 10);

        const batteryText = document.getElementById('batteryText');
        const wifiText    = document.getElementById('wifiText');

        const safeBatt = Number.isNaN(batteryPercent) ? 0 : Math.max(0, Math.min(100, batteryPercent));
        const safeWifi = Number.isNaN(wifiQuality) ? 0 : Math.max(0, Math.min(100, wifiQuality));
        updatePercentBar("battery", "Batt: " + safeBatt + "% (" + voltage.toFixed(2) + "V)", safeBatt);
        updatePercentBar("wifi", "WiFi: " + safeWifi + "%", safeWifi);

        if (batteryText) {
          batteryText.className = "telemetry-meter__value";
          if (safeBatt > 70) batteryText.classList.add('batt-green');
          else if (safeBatt > 40) batteryText.classList.add('batt-orange');
          else if (safeBatt > 20) batteryText.classList.add('batt-red');
          else batteryText.classList.add('batt-critical');
        }

        if (wifiText) {
          wifiText.className = "telemetry-meter__value";
          if (safeWifi > 70) wifiText.classList.add('wifi-green');
          else if (safeWifi > 40) wifiText.classList.add('wifi-orange');
          else wifiText.classList.add('wifi-red');
        }
        return;
      }

      if (key === "CHARGE") {
        const chargeIcon = document.getElementById("chargeIcon");
        if (!chargeIcon) return;
        const chargeState = (value || "").trim().toUpperCase();

        if (chargeState === "YES") {
          chargeIcon.style.display = "inline";
          chargeIcon.innerText = "CHG";
          if (latestBatteryVoltage >= 8.35 || latestBatteryPercent >= 100) {
            chargeIcon.style.animation = "none";
            chargeIcon.style.color = "lime";
          } else {
            chargeIcon.style.animation = "fadeCharge 1.5s infinite";
            const percent = Math.min(100, Math.max(0, Number(latestBatteryPercent) || 0));
            const red = Math.round(255 - percent * 2.55);
            const green = Math.round(percent * 2.55);
            chargeIcon.style.color = `rgb(${red}, ${green}, 0)`;
          }
        } else if (chargeState === "FAULT") {
          chargeIcon.style.display = "inline";
          chargeIcon.innerText = "ERR";
          chargeIcon.style.animation = "flashRed 1s infinite";
          chargeIcon.style.color = "red";
        } else {
          chargeIcon.style.display = "none";
          chargeIcon.style.animation = "";
        }
        return;
      }

      if (key === "STATS") {
        const uptimeSecs = parseInt(parts[1] || "0", 10);
        const chipTemp   = parseFloat(parts[2] || "0");
        const safeUptimeSecs = Number.isNaN(uptimeSecs) ? 0 : Math.max(0, uptimeSecs);
        const safeChipTemp = Number.isNaN(chipTemp) ? 0 : chipTemp;
        const uptimePct = (safeUptimeSecs * 100) / UPTIME_BAR_MAX_SECS;

        updatePercentBar(
          "uptime",
          "Uptime: " + formatUptimeCompact(safeUptimeSecs) + ", Temp: " + safeChipTemp.toFixed(1) + "C",
          uptimePct
        );

        const uptimeMeter = document.getElementById("uptimeMeter");
        if (uptimeMeter) {
          uptimeMeter.classList.remove("telemetry-meter--warn", "telemetry-meter--critical");
          if (safeChipTemp >= 70) uptimeMeter.classList.add("telemetry-meter--critical");
          else if (safeChipTemp >= 55) uptimeMeter.classList.add("telemetry-meter--warn");
        }
        return;
      }

      if (normalizedKey === "TURN_LEFT" || normalizedKey === "TURN_RIGHT") {
        const el = document.getElementById(normalizedKey === "TURN_LEFT" ? "leftIndicator" : "rightIndicator");
        if (value === "1") { if (!emergencyOn) el.classList.add("blinking","visible"); }
        else { el.classList.remove("blinking","visible"); }
        return;
      }

      if (key === "Beacon") {
        beaconActive = (value === "1");
        const btn = document.getElementById("beaconBtn");
        if (btn) btn.classList.toggle("blinking", beaconActive);
        return;
      }

      if (key === "SystemSounds") {
        window.cachedSystemSounds = (value == "1");
        const toggle = document.getElementById("systemSoundsToggle");
        if (toggle) toggle.checked = window.cachedSystemSounds;
        if (typeof window.paintRobotAudioControls === "function") {
          window.paintRobotAudioControls();
        }
        return;
      }

      if (key === "GamepadEnabled") {
        const nextState = (value === "1");
        window.cachedGamepadEnabled = nextState;
        const toggle = document.getElementById("gamepadToggle");
        if (toggle) toggle.checked = nextState;
        if (typeof window.handleGamepadUiState === "function") {
          window.handleGamepadUiState(nextState);
        }
        return;
      }

      if (key === "SystemVolume") {
        window.cachedSystemVolume = value;
        const slider = document.getElementById("systemVolume");
        const label = document.getElementById("systemVolumeLabel");
        if (slider) slider.value = value;
        if (label) label.innerText = value;
        if (typeof window.paintRobotAudioControls === "function") {
          window.paintRobotAudioControls();
        }
        return;
      }

      if (key === "ModelRotX" || key === "ModelRotY" || key === "ModelRotZ") {
        const axis = key === "ModelRotX" ? "x" : (key === "ModelRotY" ? "y" : "z");
        if (typeof setModelOrientationValue === "function") {
          setModelOrientationValue(axis, value);
        } else {
          window.cachedModelOrientation = window.cachedModelOrientation || { x: 0, y: 0, z: 0 };
          const num = parseInt(value, 10);
          window.cachedModelOrientation[axis] = Number.isNaN(num) ? 0 : Math.max(-360, Math.min(360, num));
          if (typeof window.applyModelOrientationOffsets === "function") {
            window.applyModelOrientationOffsets();
          }
          const fieldId = axis === "x" ? "modelRotX" : axis === "y" ? "modelRotY" : "modelRotZ";
          const field = document.getElementById(fieldId);
          if (field) field.value = window.cachedModelOrientation[axis];
        }
        return;
      }

      if (key === "ModelDirX" || key === "ModelDirY" || key === "ModelDirZ") {
        const axis = key === "ModelDirX" ? "x" : (key === "ModelDirY" ? "y" : "z");
        const multiplier = (() => {
          const num = parseInt(value, 10);
          if (Number.isNaN(num)) return 1;
          return num < 0 ? -1 : 1;
        })();
        if (typeof setModelDirectionValue === "function") {
          setModelDirectionValue(axis, multiplier);
        } else {
          window.cachedModelOrientationDir = window.cachedModelOrientationDir || { x: 1, y: 1, z: 1 };
          window.cachedModelOrientationDir[axis] = multiplier;
          if (typeof window.applyModelOrientationOffsets === "function") {
            window.applyModelOrientationOffsets();
          }
          const dirIds = {
            x: { cw: "modelDirXcw", ccw: "modelDirXccw" },
            y: { cw: "modelDirYcw", ccw: "modelDirYccw" },
            z: { cw: "modelDirZcw", ccw: "modelDirZccw" }
          };
          const map = dirIds[axis];
          if (map) {
            const cwBox = document.getElementById(map.cw);
            const ccwBox = document.getElementById(map.ccw);
            if (cwBox) cwBox.checked = (multiplier >= 0);
            if (ccwBox) ccwBox.checked = (multiplier < 0);
          }
        }
        if (typeof window.paintModelDirectionControls === "function") {
          window.paintModelDirectionControls();
        }
        return;
      }

      if (key === "ModelAxisX" || key === "ModelAxisY" || key === "ModelAxisZ") {
        const axis = key === "ModelAxisX" ? "x" : (key === "ModelAxisY" ? "y" : "z");
        const choice = normalizeModelAxisChoice(value, axis);
        window.cachedModelAxisMap = window.cachedModelAxisMap || { x: "x", y: "y", z: "z" };
        window.cachedModelAxisMap[axis] = choice;
        if (typeof window.setModelAxisMapping === "function") {
          window.setModelAxisMapping(axis, choice);
        } else {
          if (typeof window.applyModelOrientationOffsets === "function") {
            window.applyModelOrientationOffsets();
          }
          if (typeof window.validateModelAxisMapping === "function") {
            window.validateModelAxisMapping();
          }
        }
        return;
      }

      if (normalizedKey === "EMERGENCY") {
        emergencyOn = (value === "1");
        const left  = document.getElementById("leftIndicator");
        const right = document.getElementById("rightIndicator");
        const btn   = document.getElementById("emergencyBtn");
        if (emergencyOn) {
          left.classList.add("blinking","visible");
          right.classList.add("blinking","visible");
          if (btn) { btn.classList.add("blinking","active"); btn.innerText = "⚠️ Emergency ON"; }
        } else {
          left.classList.remove("blinking","visible");
          right.classList.remove("blinking","visible");
          if (btn) { btn.classList.remove("blinking","active"); btn.innerText = "⚠️ Emergency"; }
        }
        return;
      }

      if (key === "WsRebootOnDisconnect") {
        window.cachedWsRebootOnDisconnect = (value == "1");
        const toggle = document.getElementById("wsRebootOnDisconnectToggle");
        if (toggle) toggle.checked = window.cachedWsRebootOnDisconnect;
        return;
      }

      if (key === "IndicatorsVisible") {
        memoryFrameState.visible = (value == "1");
        applyMemoryFrameVisibility();
        persistMemoryFrameState(false);
        return;
      }
      if (key === "IndicatorsX") {
        const nextX = parseInt(value, 10);
        if (!Number.isNaN(nextX)) {
          memoryFrameState.x = nextX;
          applyMemoryFramePosition(false);
          persistMemoryFrameState(false);
        }
        return;
      }
      if (key === "IndicatorsY") {
        const nextY = parseInt(value, 10);
        if (!Number.isNaN(nextY)) {
          memoryFrameState.y = nextY;
          applyMemoryFramePosition(false);
          persistMemoryFrameState(false);
        }
        return;
      }
      } catch (e) {
        console.warn("WS message handler error:", e, msg);
      }
    };

    const d = event.data;
    if (typeof d === "string") return deliver(d);
    if (d instanceof Blob)     return d.text().then(deliver).catch((e)=>console.warn("WS blob->text failed", e));
    if (d instanceof ArrayBuffer) {
      try { return deliver(new TextDecoder().decode(new Uint8Array(d))); }
      catch (e) { console.warn("WS buffer decode failed", e); return; }
    }
    console.warn("WS: ignoring non-text frame", d);
  };
}


function isInputFocused() {
  // Returns true if the focus is on a text, number, password, textarea, or contenteditable element
  const a = document.activeElement;
  if (!a) return false;
  if (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.isContentEditable) {
    // Optionally: limit to input types where typing matters
    const types = ["text", "number", "password", "email", "search", "url"];
    return !a.disabled && !a.readOnly && (a.tagName !== "INPUT" || types.includes(a.type));
  }
  return false;
}

function isModalOpen() {
  const modal = document.getElementById("settingsModal");
  // style.display !== "none" && has "active" class, or just check display
  return modal && modal.style.display !== "none" && modal.classList.contains("active");
}

function sendButtonInput(key, value) {
  const payload = key + "," + value;
  if (websocketCarInput && websocketCarInput.readyState === WebSocket.OPEN) {
    websocketCarInput.send(payload);
    return;
  }
  window._carSocketQueue = window._carSocketQueue || [];
  window._carSocketQueue.push(payload);
  if (!websocketCarInput || websocketCarInput.readyState === WebSocket.CLOSED || websocketCarInput.readyState === WebSocket.CLOSING) {
    initWebSocket();
  }
}
function applyDirectionalInput(action, engage = true, source = "keyboard") {
  if (!DIRECTIONAL_KEYS.has(action)) return;
  const vector = DIRECTIONAL_VECTORS[action];
  if (!vector) return;

  if (engage) {
    if (activeDirectionalAction === action && activeDirectionalSource === source) {
      return;
    }
    activeDirectionalAction = action;
    activeDirectionalSource = source;
    sendButtonInput("MoveCar", vector.command);
    setJoystickKnob(vector.x, vector.y);
    return;
  }

  if (activeDirectionalAction !== action) {
    return;
  }

  if (activeDirectionalSource && activeDirectionalSource !== source) {
    return;
  }

  activeDirectionalAction = null;
  activeDirectionalSource = null;
  sendButtonInput("MoveCar", "0");
  setJoystickKnob(0, 0);
}

function initDirectionalButtons() {
  const buttons = document.querySelectorAll('.joystick-dir[data-direction]');
  if (!buttons.length) return;

  buttons.forEach((btn) => {
    const action = btn.dataset.direction;
    if (!DIRECTIONAL_KEYS.has(action)) return;

    const onPointerDown = (evt) => {
      if (directionalButtonState.get(btn) === 'pointer') return;
      evt.preventDefault();
      directionalButtonState.set(btn, 'pointer');
      if (typeof btn.setPointerCapture === 'function' && typeof evt.pointerId === 'number') {
        try { btn.setPointerCapture(evt.pointerId); } catch (err) {}
      }
      applyDirectionalInput(action, true, 'pointer');
    };

    const onPointerRelease = (evt) => {
      if (directionalButtonState.get(btn) !== 'pointer') return;
      if (evt) evt.preventDefault();
      directionalButtonState.delete(btn);
      if (evt && typeof btn.releasePointerCapture === 'function' && typeof evt.pointerId === 'number') {
        try { btn.releasePointerCapture(evt.pointerId); } catch (err) {}
      }
      applyDirectionalInput(action, false, 'pointer');
    };

    btn.addEventListener('pointerdown', onPointerDown);
    btn.addEventListener('pointerup', onPointerRelease);
    btn.addEventListener('pointercancel', onPointerRelease);
    btn.addEventListener('pointerleave', onPointerRelease);
    btn.addEventListener('lostpointercapture', onPointerRelease);

    btn.addEventListener('keydown', (evt) => {
      if (evt.key !== ' ' && evt.key !== 'Enter') return;
      evt.preventDefault();
      if (directionalButtonState.get(btn) === 'keyboard') return;
      directionalButtonState.set(btn, 'keyboard');
      applyDirectionalInput(action, true, 'keyboard');
    });

    btn.addEventListener('keyup', (evt) => {
      if (evt.key !== ' ' && evt.key !== 'Enter') return;
      evt.preventDefault();
      if (directionalButtonState.get(btn) !== 'keyboard') return;
      directionalButtonState.delete(btn);
      applyDirectionalInput(action, false, 'keyboard');
    });

    btn.addEventListener('blur', () => {
      if (directionalButtonState.get(btn) === 'keyboard') {
        directionalButtonState.delete(btn);
        applyDirectionalInput(action, false, 'keyboard');
      }
    });
  });
}


function initDirectionalButtons() {
  const buttons = document.querySelectorAll('.joystick-dir[data-direction]');
  if (!buttons.length) return;

  buttons.forEach((btn) => {
    const action = btn.dataset.direction;
    if (!DIRECTIONAL_KEYS.has(action)) return;

    const onPointerDown = (evt) => {
      if (directionalButtonState.get(btn) === 'pointer') return;
      evt.preventDefault();
      directionalButtonState.set(btn, 'pointer');
      if (typeof btn.setPointerCapture === 'function' && typeof evt.pointerId === 'number') {
        try { btn.setPointerCapture(evt.pointerId); } catch (err) {}
      }
      applyDirectionalInput(action, true, 'pointer');
    };

    const onPointerRelease = (evt) => {
      if (directionalButtonState.get(btn) !== 'pointer') return;
      if (evt) evt.preventDefault();
      directionalButtonState.delete(btn);
      if (evt && typeof btn.releasePointerCapture === 'function' && typeof evt.pointerId === 'number') {
        try { btn.releasePointerCapture(evt.pointerId); } catch (err) {}
      }
      applyDirectionalInput(action, false, 'pointer');
    };

    btn.addEventListener('pointerdown', onPointerDown);
    btn.addEventListener('pointerup', onPointerRelease);
    btn.addEventListener('pointercancel', onPointerRelease);
    btn.addEventListener('pointerleave', onPointerRelease);
    btn.addEventListener('lostpointercapture', onPointerRelease);

    btn.addEventListener('keydown', (evt) => {
      if (evt.key !== ' ' && evt.key !== 'Enter') return;
      evt.preventDefault();
      if (directionalButtonState.get(btn) === 'keyboard') return;
      directionalButtonState.set(btn, 'keyboard');
      applyDirectionalInput(action, true, 'keyboard');
    });

    btn.addEventListener('keyup', (evt) => {
      if (evt.key !== ' ' && evt.key !== 'Enter') return;
      evt.preventDefault();
      if (directionalButtonState.get(btn) !== 'keyboard') return;
      directionalButtonState.delete(btn);
      applyDirectionalInput(action, false, 'keyboard');
    });

    btn.addEventListener('blur', () => {
      if (directionalButtonState.get(btn) === 'keyboard') {
        directionalButtonState.delete(btn);
        applyDirectionalInput(action, false, 'keyboard');
      }
    });
  });
}

function sendButtonInput(key, value) {
  const payload = key + "," + value;
  if (websocketCarInput && websocketCarInput.readyState === WebSocket.OPEN) {
    websocketCarInput.send(payload);
    return;
  }
  window._carSocketQueue = window._carSocketQueue || [];
  window._carSocketQueue.push(payload);
  if (!websocketCarInput || websocketCarInput.readyState === WebSocket.CLOSED || websocketCarInput.readyState === WebSocket.CLOSING) {
    initWebSocket();
  }
}

function handleKeyDown(e) {
  if (isModalOpen() || isInputFocused()) return;  // dY^ Block controls if modal or input
  const key = e.key.toLowerCase();
  if (keysDown[key]) return; // prevent re-processing held key
  keysDown[key] = true;

  const action = keymap[key];
  if (!action) return;

  switch (action) {
    case "forward":
    case "backward":
    case "left":
    case "right":
      applyDirectionalInput(action, true, "keyboard");
      break;
    case "stop":
      activeDirectionalAction = null;
      activeDirectionalSource = null;
      sendButtonInput("MoveCar", "0");
      setJoystickKnob(0, 0);
      break;

    case "bucketUp":
      bucketSlider.value = parseInt(bucketSlider.value) + 5;
      sendButtonInput("Bucket", bucketSlider.value);
      break;
    case "bucketDown":
      bucketSlider.value = parseInt(bucketSlider.value) - 5;
      sendButtonInput("Bucket", bucketSlider.value);
      break;
    case "auxUp":
      auxSlider.value = parseInt(auxSlider.value) + 5;
      sendButtonInput("AUX", auxSlider.value);
      break;
    case "auxDown":
      auxSlider.value = parseInt(auxSlider.value) - 5;
      sendButtonInput("AUX", auxSlider.value);
      break;

    case "led":
      toggleLed();
      break;
    case "beacon":
      toggleBeacon();
      break;
    case "emergency":
      toggleEmergency();
      break;
    case "horn":
      sendButtonInput("Horn", "1");  // or your horn-on command
      break;
  }
}

function handleKeyUp(e) {
  if (isModalOpen() || isInputFocused()) return;  // dY^ Block controls if modal or input
  const key = e.key.toLowerCase();
  delete keysDown[key];

  const action = keymap[key];
  if (!action) return;

  if (DIRECTIONAL_KEYS.has(action)) {
    applyDirectionalInput(action, false, "keyboard");
  }
  if (action === "horn") {
    sendButtonInput("Horn", "0");  // or your horn-off command
  }
}

  function updateSliderValue(id) {
    const slider = document.getElementById(id);
    const span = document.getElementById(id + "Value");
    if (slider && span) {
      span.innerText = slider.value;
    }
  }

  function sendMotorSpeed(direction, value) {
    value = parseInt(value);
      //if (lastSentMotorValues[direction] === value && value !== 0) return; // allow redundant zeroes
      if (value === 0 && lastSentMotorValues[direction] === 0) return; // skip repeated 0s
      if (value !== 0 && lastSentMotorValues[direction] === value) return; // skip repeated non-0s


    lastSentMotorValues[direction] = value;

    if (websocketCarInput && websocketCarInput.readyState === WebSocket.OPEN) {
      websocketCarInput.send("Motor," + direction + "," + value);


    }
  }

  function initArmJogButtons({ slider, label, setLastValue } = {}) {
    const buttons = document.querySelectorAll(".arm-step[data-arm-step]");
    if (!buttons.length) return;

    const state = new Map();

    buttons.forEach((btn) => {
      const dir = btn.dataset.armStep === "down" ? -1 : 1;

      const updateLabel = (active) => {
        if (!label) return;
        if (active) {
          label.textContent = String(dir * ARM_JOG_PWM);
        } else if (slider) {
          label.textContent = String(slider.value);
        } else {
          label.textContent = "0";
        }
      };

      const apply = (active) => {
        const pwm = active ? dir * ARM_JOG_PWM : 0;
        if (typeof setLastValue === "function") {
          setLastValue(pwm);
        }
        sendMotorSpeed("Arm", pwm);
        updateLabel(active);
      };

      const onPointerDown = (evt) => {
        if (state.get(btn) === "pointer") return;
        evt.preventDefault();
        state.set(btn, "pointer");
        if (typeof btn.setPointerCapture === "function" && typeof evt.pointerId === "number") {
          try { btn.setPointerCapture(evt.pointerId); } catch (err) {}
        }
        btn.classList.add("active");
        apply(true);
      };

      const onPointerRelease = (evt) => {
        if (state.get(btn) !== "pointer") return;
        if (evt) evt.preventDefault();
        state.delete(btn);
        if (evt && typeof btn.releasePointerCapture === "function" && typeof evt.pointerId === "number") {
          try { btn.releasePointerCapture(evt.pointerId); } catch (err) {}
        }
        btn.classList.remove("active");
        apply(false);
      };

      btn.addEventListener("pointerdown", onPointerDown);
      btn.addEventListener("pointerup", onPointerRelease);
      btn.addEventListener("pointercancel", onPointerRelease);
      btn.addEventListener("pointerleave", onPointerRelease);
      btn.addEventListener("lostpointercapture", onPointerRelease);

      btn.addEventListener("keydown", (evt) => {
        if (evt.key !== " " && evt.key !== "Enter") return;
        evt.preventDefault();
        if (state.get(btn) === "keyboard") return;
        state.set(btn, "keyboard");
        btn.classList.add("active");
        apply(true);
      });

      btn.addEventListener("keyup", (evt) => {
        if (evt.key !== " " && evt.key !== "Enter") return;
        evt.preventDefault();
        if (state.get(btn) !== "keyboard") return;
        state.delete(btn);
        btn.classList.remove("active");
        apply(false);
      });

      btn.addEventListener("blur", () => {
        if (!state.has(btn)) return;
        state.delete(btn);
        btn.classList.remove("active");
        apply(false);
      });
    });
  }

  function resetSlider(sliderElem, direction) {
    // Cancel any existing animation for this direction
    if (sliderAnimations[direction]) {
      clearInterval(sliderAnimations[direction]);
      delete sliderAnimations[direction];
    }

    let current = parseInt(sliderElem.value);
    const max = current;
    const duration = 500; // total animation time (ms)
    const steps = 30;
    let frame = 0;

    sliderAnimations[direction] = setInterval(() => {
      // End condition
      if (frame >= steps) {
        clearInterval(sliderAnimations[direction]);
        delete sliderAnimations[direction];
        sliderElem.value = 0;

        // Force send 0
        lastSentMotorValues[direction] = -1;
        sendMotorSpeed(direction, 0);
        updateSliderValue(sliderElem.id);

        // Handle turn signal deactivation
        if (direction === "Left" || direction === "Right") {
          sendButtonInput("Slider", direction + ",0");
          const indicator = document.getElementById(direction === "Left" ? "leftIndicator" : "rightIndicator");
          indicator.classList.remove("blinking");
          indicator.classList.remove("visible");
        }
        return;
      }

      // Ease out value
      const t = frame / steps;
      const eased = max * (1 - t * t);
      const newVal = Math.round(eased);

      if (parseInt(sliderElem.value) !== newVal) {
        sliderElem.value = newVal;
        updateSliderValue(sliderElem.id);
        sendMotorSpeed(direction, newVal);
      }

      frame++;
    }, duration / steps);
  }


	function showToast(message, type = "info") {
		let toast = document.getElementById("toast");

		// If missing, create it once
		if (!toast) {
			toast = document.createElement("div");
			toast.id = "toast";
			document.body.appendChild(toast);
		} else {
			// Always make sure it's a direct child of <body>
			if (toast.parentElement !== document.body) {
				document.body.appendChild(toast);
			}
		}

		toast.innerText = message;
		toast.style.bottom = "80px";
		toast.style.zIndex = "2147483647";
		toast.style.position = "fixed";

		// Reset classes and apply type
		toast.className = ""; // clear previous
		toast.classList.add("toast-" + type);

		// Show
		toast.style.visibility = "visible";
		toast.style.opacity = "1";

		// Auto-hide
		setTimeout(() => {
			toast.style.opacity = "0";
			setTimeout(() => {
				toast.style.visibility = "hidden";
				toast.className = "";
			}, 500); // match CSS transition
		}, 3000);
	}




  function getResolutionName(code) {
    switch (code) {
      case 10: return "UXGA";
      case 6:  return "SVGA";
      case 5:  return "VGA";
      case 3:  return "QVGA";
      default: return "VGA";
    }
  }

  function controlLed(state) {
    sendButtonInput("Light", state ? 1 : 0); // ✅ Use WebSocket, not fetch()
    showToast(`💡 LED ${state ? "ON" : "OFF"}`);
  }

  setInterval(() => {
    const now = Date.now();
    const camStatus = document.getElementById("camStatusOverlay");
    if ((now - lastFPSUpdate) < 5000) {
      camStatus.style.display = "none";
    } else {
      camStatus.style.display = "block";  // No FPS in last 5 sec = Camera down
    }
  }, 2000); // Check every 2 seconds


	function updateLedBrightness(value) {
	  fetch(`/led?brightness=${value}`)
		.then(r => r.text())
		.then(txt => {
		  if (txt.startsWith("LEDSTATE:")) {
			const isOn = txt.includes("1");
			updateLedButtonState(isOn);
		  }
		  showToast(`💡 LED Brightness: ${value}`);
		})
		.catch(err => {
		  console.warn("LED brightness fetch error:", err);
		});
	}


  window.showTab = function(tabId, button = null) {
    const wrapper = document.getElementById('tabContentWrapper');
    const prev = wrapper.querySelector('.tabContent.active');
    const next = document.getElementById(tabId);

    if (prev === next) return;

    // Hide all tab contents
    document.querySelectorAll('.tabContent').forEach(div => {
      div.classList.remove('active');
      div.style.display = 'none'; // <--- HIDE explicitly
    });

    // Show selected tab
    next.classList.add('active');
    next.style.display = 'flex'; // keep tab as flex column for internal scroll regions
    next.style.flexDirection = 'column';
    next.style.minHeight = '0';

    // Animate height
    const prevHeight = prev ? prev.offsetHeight : 0;
    const nextHeight = next.offsetHeight;
    wrapper.style.height = prevHeight + 'px';

    requestAnimationFrame(() => {
      wrapper.style.height = nextHeight + 'px';
    });

    setTimeout(() => {
      wrapper.style.height = '';
    }, 300);

    // Toggle active tab button
    document.querySelectorAll('.tabButton').forEach(btn => btn.classList.remove('active'));
    if (button) button.classList.add('active');

    //requestAnimationFrame(updateFrameShape);

  }

  function toggleLed() {
    sendButtonInput("Light", 2);  // Use 2 as a toggle command
  }

  function toggleBeacon() {
    beaconActive = !beaconActive;
    sendButtonInput("Beacon", beaconActive ? 1 : 0);

    const btn = document.getElementById("beaconBtn");
    if (beaconActive) {
      btn.classList.add("blinking");
    } else {
      btn.classList.remove("blinking");
    }
  }

  function toggleEmergency() {
    emergencyOn = !emergencyOn;
    const btn = document.getElementById("emergencyBtn");
    btn.classList.toggle("active", emergencyOn);
    btn.innerText = emergencyOn ? "⚠️ Emergency ON" : "⚠️ Emergency";

    // Send UDP/WebSocket signal
    sendButtonInput("Emergency", emergencyOn ? 1 : 0);

    const left = document.getElementById("leftIndicator");
    const right = document.getElementById("rightIndicator");

    if (emergencyOn) {
      left.classList.add("visible", "blinking");
      right.classList.add("visible", "blinking");

      btn.classList.add("blinking"); // ✅ Restore blinking on Emergency button
    } else {
      left.classList.remove("visible", "blinking");
      right.classList.remove("visible", "blinking");

      btn.classList.remove("blinking"); // ✅ Stop blinking when off
    }
  }

  function toggleLaneOverlay() {
    const overlay = document.getElementById("laneOverlay");
    if (!overlay) return;

    const isVisible = overlay.style.display !== "none";
    overlay.style.display = isVisible ? "none" : "block";

    // Save state to localStorage
    localStorage.setItem("laneOverlayVisible", !isVisible);
  }


async function toggleSettingsModal() {
  // local helper (safe even if you already defined one globally)
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  const mainContent = document.getElementById('mainContent');
  const existing = document.getElementById('settingsModal');
  const isVisible = existing && existing.classList.contains('active');

  if (isVisible) {
    // remember active tab
    try {
      const active = document.querySelector('#settingsModal .tabContent.active');
      if (active) localStorage.setItem('settingsLastTab', active.id);
    } catch(_) {}

    // fade out then remove
    existing.classList.remove('active');
    setTimeout(() => {
      existing.style.display = 'none';
      existing.remove();
      if (typeof onunloadModal === 'function') onunloadModal();

      // 👉 RESUME STREAM on close
      if (cameraEnabled) {
        requestResumeStream();
        applyCameraStreamState(true);
      }
    }, 250);
    mainContent?.classList.remove('blur');

    // allow re-load next time
    window.modalScriptLoaded = false;
    return;
  }

  // 👉 PAUSE STREAM on open (BEFORE loading modal assets) + wait ~1s
  if (cameraEnabled) {
    try {
      const imgEl = document.getElementById('cameraStream');
      if (imgEl) {
        // stop the browser from reading the MJPEG immediately
        imgEl.src = 'data:image/gif;base64,R0lGODlhAQABAAAAACw='; // 1x1 transparent gif
      }
      // ask backend to pause; bound by 1s so we never hang
      await Promise.race([
        fetch(`http://${location.hostname}:81/pause_stream`, { cache: 'no-store' }).catch(() => {}),
        sleep(1000)
      ]);
      // tiny settle to reduce FS/socket contention
      await sleep(150);
    } catch (_) {}
  }

  // use one version token for HTML/CSS/JS so browser always refetches
  const v = window.appBuild || Date.now();

  // fetch fresh HTML (no cache)
  let html = '';
  try {
    const res = await fetch(`/SettingsModal.html?v=${v}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    html = await res.text();
  } catch (err) {
    console.error('Failed to load SettingsModal.html:', err);
    alert('Failed to load Settings. Check connection/SD.');
    return;
  }

  // inject markup — BUT first, strip src from heavy images so they don't auto-fetch
  const holder = document.createElement('div');
  holder.innerHTML = html;

  // Work on the element before appending (prevents immediate network requests)
  const modalEl = holder.firstElementChild;

  // Defer only the big/static images in the modal (adjust selectors if needed)
  const toDefer = modalEl.querySelectorAll(
    '#kbClawPane img, #kbLightsPane img, #joyMappingInputs img'
  );
  toDefer.forEach(img => {
    const s = img.getAttribute('src');
    if (s && !img.dataset.src) img.dataset.src = s; // remember original
    img.removeAttribute('src');                      // stop auto fetch
    img.setAttribute('loading', 'lazy');
    img.setAttribute('decoding', 'async');
  });

  // Append after deferring srcs
  document.body.appendChild(modalEl);

  // show with fade
  modalEl.style.display = 'block';
  loadModalCss(v);
  requestAnimationFrame(() => modalEl.classList.add('active'));
  mainContent?.classList.add('blur');

  // backdrop click to close
  modalEl.addEventListener('mousedown', (e) => {
    if (e.target === modalEl) toggleSettingsModal();
  });

  // close button(s)
  const closeBtn = modalEl.querySelector('.modal-close-btn, #settingsModalCloseBtn, .close');
  if (closeBtn) closeBtn.onclick = toggleSettingsModal;

  // helper: load images for currently visible panes only
  function loadVisibleModalImages() {
    const visible = modalEl.querySelectorAll(
      '#settingsModal .tabContent.active img[data-src], ' +
      '#settingsModal .subSection.active img[data-src], ' +
      '#settingsModal .subPane.active img[data-src]'
    );
    visible.forEach(img => {
      if (img.dataset.src) {
        img.src = img.dataset.src;   // trigger fetch now
        delete img.dataset.src;
      }
    });
  }

  // (re)load modal script fresh every time
  const oldScript = document.getElementById('modalScript');
  if (oldScript) oldScript.remove();

  const s = document.createElement('script');
  s.id = 'modalScript';
  s.src = `/modalScript.js?v=${v}`;
  s.onload = () => {
    window.modalScriptLoaded = true;
    console.log('✅ Modal script loaded dynamically.');

    // Wrap tab/pane functions so images load when a pane becomes visible
    const wrap = (name) => {
      const orig = window[name];
      if (typeof orig === 'function') {
        window[name] = function(...args) {
          const r = orig.apply(this, args);
          // run after classes/DOM update
          requestAnimationFrame(loadVisibleModalImages);
          return r;
        };
      }
    };
    wrap('showTab');            // main tabs
    wrap('showKeyboardPane');   // keyboard sub-sections
    wrap('showControlSubTab');  // joystick/controls sub-tabs

    // pick starting tab and load its images
    let startTab = localStorage.getItem('settingsLastTab') || 'keysTab';
    if (!document.getElementById(startTab)) startTab = 'keysTab';
    if (typeof showTab === 'function') showTab(startTab);
    requestAnimationFrame(loadVisibleModalImages);
  };
  s.onerror = () => console.error('Failed to load modalScript.js');
  document.body.appendChild(s);
}


// helper to (re)load modal CSS with cache-bust
function loadModalCss(v) {
  let link = document.getElementById('modalCssLink');
  if (!link) {
    link = document.createElement('link');
    link.id = 'modalCssLink';
    link.rel = 'stylesheet';
    document.head.appendChild(link);
  }
  link.href = `/modal.css?v=${v}`;
}




function loadModalCss() {
  if (!document.getElementById('modalCssLink')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.id = 'modalCssLink';
    link.href = '/modal.css?v=' + Date.now(); // Cache-busting
    document.head.appendChild(link);
  }
}


function toggleDrawMode() {
	// First-time load check
	if (!window.drawScriptLoaded) {
		const script = document.createElement("script");
		script.src = "/drawScript.js?v=" + Date.now();
		script.id = "drawScript";
		script.onload = () => {
			window.drawScriptLoaded = true;
			console.log("✅ Draw script loaded dynamically.");
			window.toggleDrawMode();  // Execute actual function
		};
		document.body.appendChild(script);
	} else {
		window.toggleDrawMode(); // Already loaded, just call it
	}
}

window.addEventListener("DOMContentLoaded", () => {
  const splash = document.getElementById("splashScreen");
  const text = document.getElementById("splashText");
  const main = document.getElementById("mainContent");

  const micBtn = document.getElementById("micBtn");
  micBtn.addEventListener("mousedown", () => micBtn.classList.add("pushed"));
  micBtn.addEventListener("mouseup", () => micBtn.classList.remove("pushed"));
  micBtn.addEventListener("mouseleave", () => micBtn.classList.remove("pushed"));
	
  // Main UI stays invisible and on black background until we fade in
  if (main) {
    main.style.opacity = "0";
    main.style.transition = "opacity 0.8s";
    main.style.background = "#000";
  }
  splash.style.opacity = "1";
  splash.style.transition = "opacity 1s";
  text.style.opacity = "0";
  text.style.transition = "opacity 0.7s";

  // 1. Wait 1s, fade in MINIEXCO
  setTimeout(() => {
    text.style.opacity = "1";

    // 2. Wait 1.2s, fade out MINIEXCO (over 1.4s)
    setTimeout(() => {
      text.style.transition = "opacity 1.4s"; // Set fade-out duration
      text.style.opacity = "0";

      // 3. Wait 1.4s for text to fade out, then fade out black splash (1s)
      setTimeout(() => {
        splash.style.opacity = "0";

        // 4. After splash fade (1s), show main content, keep bg black to prevent white flash
        setTimeout(() => {
          if (main) {
            main.style.background = "#000"; // Keep black background just in case
            main.style.opacity = "1";
          }
          splash.remove();

          // (Optional) After fade-in, if you want, you can set main's bg to original
          setTimeout(() => {
            if (main) main.style.background = "";
          }, 500);

        }, 1000);

      }, 1400);

    }, 1200);

  }, 1000);
	
	wireBatteryText();
});


// --- DYNAMIC MEDIA PLAYER LOADER ---

window.releaseDeviceMediaResources = function() {
  return fetch('/release_media_resources', { cache: 'no-store' }).catch(() => {});
};

window.toggleMediaPlayer = async function() {
  let modal = document.getElementById('mediaPlayerModal');
  let isVisible = modal && modal.style.display === 'block';

  if (isVisible) {
    window.releaseDeviceMediaResources();
    // Hide and remove modal, clean up
    modal.style.display = 'none';
    setTimeout(() => {
      modal.remove();
      const oldScript = document.getElementById('mediaPlayerScript');
      if (oldScript) oldScript.remove();
      window.mediaPlayerScriptLoaded = false;
    }, 200);
    if (cameraEnabled) {
      applyCameraStreamState(true, 200);
      requestResumeStream();
    }
    return;
  }

  const pauseCameraForModal = async () => {
    if (!cameraEnabled) return;
    applyCameraStreamState(false);
    await Promise.race([
      fetch(`http://${location.hostname}:81/pause_stream`, { cache: 'no-store' }).catch(() => {}),
      new Promise(r => setTimeout(r, 800))
    ]);
  };

  // --- SHOW MEDIA PLAYER: Load CSS and script as needed ---
  await pauseCameraForModal();
  // Dynamically load mediaPlayer.css if not yet loaded
  if (!document.getElementById("mediaPlayerCss")) {
    const link = document.createElement("link");
    link.id = "mediaPlayerCss";
    link.rel = "stylesheet";
    link.href = "/mediaPlayer.css?v=" + Date.now();
    document.head.appendChild(link);
  }

  // Now, load the JS as before
  if (!window.mediaPlayerScriptLoaded) {
    const oldScript = document.getElementById('mediaPlayerScript');
    if (oldScript) oldScript.remove();

    const s = document.createElement('script');
    const version = Date.now();
    s.src = '/mediaPlayer.js?v=' + version;
    s.id = 'mediaPlayerScript';
    s.onload = function() {
      window.mediaPlayerScriptLoaded = true;
      if (typeof window.toggleMediaPlayerReal === "function") {
        window.toggleMediaPlayerReal();
        requestResumeStream();
        applyCameraStreamState(true, 200);
      } else {
        showToast("Media player failed to initialize.");
      }
    };
    s.onerror = function() {
      showToast("Failed to load mediaPlayer.js from SD card!");
    };
    document.body.appendChild(s);
  } else {
    if (typeof window.toggleMediaPlayerReal === "function") {
      window.toggleMediaPlayerReal();
    } else {
      showToast("Media player script not ready!");
    }
  }
};


function toggleMic() {
  const micBtn = document.getElementById("micBtn");
  const micIcon = document.getElementById("micIcon");
  if (!micEnabled) {
    // Turn mic ON: tell backend to enable mic, pause speaker playback, start streaming mic audio
    micEnabled = true;
    micBtn.classList.add("active", "listening");
    micIcon.style.color = "#fff700";
    micBtn.title = "Listening to robot mic (click to disable)";
    // Pause media playback if needed
    pauseMediaPlayerIfPlaying();

    // Enable mic on backend
    fetch('/enable_mic')
      .then(() => {
        // Start streaming mic audio (assumes backend provides /mic_stream endpoint)
        if (micAudioElem) {
          micAudioElem.pause();
          micAudioElem.remove();
        }
        micAudioElem = document.createElement("audio");
        micAudioElem.id = "robotMicAudio";
        micAudioElem.src = `/mic_stream?${Date.now()}`; // Prevent caching
        micAudioElem.autoplay = true;
        micAudioElem.controls = false;
        micAudioElem.style.display = "none";
        document.body.appendChild(micAudioElem);
        micAudioElem.play().catch(()=>{});
      })
      .catch(() => {
        showToast("Failed to enable mic", "error");
        micBtn.classList.remove("active", "listening");
        micEnabled = false;
      });

  } else {
    // Turn mic OFF: tell backend to disable mic, stop audio stream
    micEnabled = false;
    micBtn.classList.remove("active", "listening");
    micIcon.style.color = "";
    micBtn.title = "🎤 Mic: listen to the robot audio (press to enable)";
    // Remove mic audio element
    if (micAudioElem) {
      micAudioElem.pause();
      micAudioElem.remove();
      micAudioElem = null;
    }
    fetch('/disable_mic');
  }
}


function pauseMediaPlayerIfPlaying() {
  // Pause browser media
  let mp = document.getElementById("mediaPlayerAudio");
  if (mp && !mp.paused && !mp.ended) mp.pause();

  // Pause player from dynamically loaded mediaPlayer.js if available
  if (typeof window.getPlayer === "function") {
    let player = window.getPlayer();
    if (player && !player.paused && !player.ended) player.pause();
  }

  // Always stop playback on device (ESP32)
  fetch('/stop_playback');
}




// Minimal toast implementation (if not already present)
window.showToast = window.showToast || function(msg, duration) {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    toast.style = 'visibility:hidden;min-width:250px;background:#333;color:#fff;text-align:center;border-radius:2px;padding:16px;position:fixed;z-index:2147483647;left:50%;bottom:80px;font-size:17px;opacity:0;transition:opacity 0.5s;';
    document.body.appendChild(toast);
  }
  toast.style.bottom = '80px';
  toast.style.zIndex = '2147483647';
  toast.style.position = 'fixed';
  toast.innerText = msg;
  toast.style.visibility = 'visible';
  toast.style.opacity = '1';
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => { toast.style.visibility = 'hidden'; }, 500);
  }, duration || 2200);
};




//Load Battery popup graph

function wireBatteryText() {
  const batteryText = document.getElementById("batteryText");
  const batteryOverlay = document.getElementById("batteryMeter") || document.getElementById("batteryOverlay");
  if (!batteryText) {
    setTimeout(wireBatteryText, 200);
    return;
  }
  if (batteryText.dataset.graphBound === "1") return;
  batteryText.dataset.graphBound = "1";

  batteryText.title = "Click for more info";
  batteryText.style.cursor = "pointer";

  async function loadUPlotJs() {
    if (window.uPlot) return true;

    const tryScriptTag = async () => {
      const existing = document.getElementById("uPlotJs");
      if (existing) existing.remove();
      const script = document.createElement("script");
      script.id = "uPlotJs";
      script.src = "/uPlot.iife.min.js?v=" + Date.now();
      return new Promise((resolve) => {
        let done = false;
        const finish = (ok) => {
          if (done) return;
          done = true;
          resolve(ok);
        };
        const timer = setTimeout(() => finish(!!window.uPlot), 4500);
        script.addEventListener("load", () => {
          clearTimeout(timer);
          finish(!!window.uPlot);
        }, { once: true });
        script.addEventListener("error", () => {
          clearTimeout(timer);
          finish(false);
        }, { once: true });
        document.body.appendChild(script);
      });
    };

    const tryFetchEval = async (url) => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 6000);
      try {
        const res = await fetch(`${url}?v=${Date.now()}`, { cache: "no-store", signal: controller.signal });
        if (!res.ok) return false;
        const code = await res.text();
        // Fallback path when dynamic script tag load hangs on some browsers/devices.
        (0, eval)(`${code}\n//# sourceURL=${url}`);
        return !!window.uPlot;
      } catch (_) {
        return false;
      } finally {
        clearTimeout(timeout);
      }
    };

    const scriptOk = await tryScriptTag();
    if (scriptOk || window.uPlot) return true;

    const fetchOk =
      await tryFetchEval("/uPlot.iife.min.js") ||
      await tryFetchEval("/web/uPlot.iife.min.js");
    return fetchOk || !!window.uPlot;
  }

  async function loadBatteryGraphScript() {
    if (typeof window.showBatteryPopup === "function") return true;

    let script = document.getElementById("batteryGraphJs");
    if (script) script.remove();

    return new Promise((resolve) => {
      script = document.createElement("script");
      script.id = "batteryGraphJs";
      script.src = "/batteryGraph.js?v=" + Date.now();
      script.addEventListener("load", () => {
        resolve(typeof window.showBatteryPopup === "function");
      }, { once: true });
      script.addEventListener("error", () => resolve(false), { once: true });
      document.body.appendChild(script);
    });
  }

  async function onBatteryClick() {
    if (!document.getElementById("uPlotCss")) {
      const link = document.createElement("link");
      link.id = "uPlotCss";
      link.rel = "stylesheet";
      link.href = "/uPlot.min.css";
      document.head.appendChild(link);
    }
    if (!document.getElementById("batteryGraphCss")) {
      const link = document.createElement("link");
      link.id = "batteryGraphCss";
      link.rel = "stylesheet";
      link.href = "/graph.css?v=" + Date.now();
      document.head.appendChild(link);
    }

    const uplotOk = await loadUPlotJs();
    if (!uplotOk) {
      showToast("Battery graph failed to load (uPlot).", "error");
      return;
    }

    const graphOk = await loadBatteryGraphScript();
    if (!graphOk) {
      showToast("Battery graph script failed to load.", "error");
      return;
    }

    window.showBatteryPopup();
  }

  batteryText.addEventListener("click", onBatteryClick);
  if (batteryOverlay) {
    batteryOverlay.style.pointerEvents = "auto";
  }

}



function capturePhoto() {
  fetch("/capture_photo")
    .then(r => r.json())
    .then(obj => {
      if (obj.status === "ok") {
        showToast("📸 Photo saved: " + obj.path, "success");
        // Reindex photo folder after saving
        fetch('/sd_reindex?path=' + encodeURIComponent('/media/capture/photo'), { method: 'POST' });
      } else {
        showToast("❌ Photo capture failed", "error");
      }
    })
    .catch(() => showToast("❌ Photo capture failed", "error"));
}


function toggleVideoRecording() {
  const btn = document.getElementById('videoCaptureBtn');
  if (!isRecordingVideo) {
    btn.classList.add('recording');
    btn.querySelector('.icon-record .record-outer').setAttribute('fill', '#ff3535');
    btn.querySelector('.icon-record .record-outer').setAttribute('stroke', '#fff');
    btn.childNodes[btn.childNodes.length-1].textContent = " Stop Recording";
    isRecordingVideo = true;
    fetch('/start_record_video?duration=60')
      .then(r => r.json())
      .then(resp => {
        if (resp.status !== "recording") {
          btn.classList.remove('recording');
          btn.childNodes[btn.childNodes.length-1].textContent = " Record Video";
          isRecordingVideo = false;
          showToast("❌ Failed to start recording", "error");
        }
      })
      .catch(() => {
        btn.classList.remove('recording');
        btn.childNodes[btn.childNodes.length-1].textContent = " Record Video";
        isRecordingVideo = false;
        showToast("❌ Failed to start recording", "error");
      });
  } else {
		fetch('/stop_record_video')
			.then(r => r.json())
			.then(resp => {
				btn.classList.remove('recording');
				btn.childNodes[btn.childNodes.length-1].textContent = " Record Video";
				isRecordingVideo = false;
				if (resp.status !== "stopped") {
					showToast("⚠️ Failed to stop recording", "error");
				} else {
					// Reindex video folder after recording
					fetch('/sd_reindex?path=' + encodeURIComponent('/media/capture/video'), { method: 'POST' });
				}
			})
			.catch(() => {
				btn.classList.remove('recording');
				btn.childNodes[btn.childNodes.length-1].textContent = " Record Video";
				isRecordingVideo = false;
				showToast("❌ Failed to stop recording", "error");
			});

  }
}

function updateCameraButton(state) {
  const btn = document.getElementById("cameraToggleBtn");
  cameraEnabled = !!state;
  if (btn) {
    btn.innerText = cameraEnabled ? "📷 Camera: ON" : "📷 Camera: OFF";
    btn.classList.toggle("active", cameraEnabled);
    btn.style.backgroundColor = cameraEnabled ? "#1976d2" : "#888";
  }
}

let cameraStreamRetryTimer = null;
let cameraStreamAttempt = 0;
let cameraStreamLastLoadAt = 0;

function clearCameraStreamRetry() {
  if (cameraStreamRetryTimer) {
    clearTimeout(cameraStreamRetryTimer);
    cameraStreamRetryTimer = null;
  }
}

function attachCameraStreamHandlers(img) {
  if (!img || img.__cameraHandlersAttached) return;
  img.__cameraHandlersAttached = true;

  img.addEventListener("load", () => {
    cameraStreamAttempt = 0;
    cameraStreamLastLoadAt = Date.now();
    lastFPSUpdate = Date.now();
    clearCameraStreamRetry();
    const camStatus = document.getElementById("camStatusOverlay");
    if (camStatus) camStatus.style.display = "none";
  });

  img.addEventListener("error", () => {
    if (!cameraEnabled) return;
    scheduleCameraStreamRetry();
  });
}

function scheduleCameraStreamRetry(baseDelayMs = 350) {
  if (!cameraEnabled || cameraStreamRetryTimer) return;
  cameraStreamAttempt += 1;
  const expDelay = Math.min(3000, baseDelayMs * Math.pow(1.6, Math.max(0, cameraStreamAttempt - 1)));
  const jitter = Math.floor(Math.random() * 120);
  const delay = Math.round(expDelay + jitter);
  cameraStreamRetryTimer = setTimeout(() => {
    cameraStreamRetryTimer = null;
    applyCameraStreamState(true);
  }, delay);
}

function requestResumeStream(timeoutMs = 800) {
  if (!cameraEnabled) return Promise.resolve(false);
  return Promise.race([
    fetch(`http://${location.hostname}:81/resume_stream`, { cache: "no-store" })
      .then(() => true)
      .catch(() => false),
    sleep(timeoutMs).then(() => false)
  ]);
}

function applyCameraStreamState(on, delayMs = 0) {
  const img = document.getElementById("cameraStream");
  if (!img) return;
  attachCameraStreamHandlers(img);
  const shouldEnable = !!on && cameraEnabled;
  const apply = async () => {
    clearCameraStreamRetry();
    if (!shouldEnable) {
      cameraStreamAttempt = 0;
      img.src = BLANK_IMG;
      return;
    }
    await requestResumeStream();
    const streamUrl = `http://${location.hostname}:81/stream?ts=${Date.now()}`;
    img.src = BLANK_IMG;
    setTimeout(() => { img.src = streamUrl; }, 120);
    setTimeout(() => {
      if (!cameraEnabled) return;
      if (Date.now() - cameraStreamLastLoadAt > 1800) {
        scheduleCameraStreamRetry(500);
      }
    }, 1800);
  };
  if (!on || delayMs <= 0) {
    apply();
  } else {
    setTimeout(apply, delayMs);
  }
}

function fetchCameraStatus() {
  fetch('/camera_status')
    .then(res => res.json())
    .then(data => {
      updateCameraButton(data.enabled);
      applyCameraStreamState(data.enabled);
      if (!data.enabled) {
        document.getElementById("camStatusOverlay").style.display = "none";
        updatePercentBar("fps", "FPS: 0", 0);
        updateMemoryBar("heap", 0, 0);
        updateMemoryBar("psram", 0, 0);
      }
    })
    .catch(() => {
      updateCameraButton(false);
      applyCameraStreamState(false);
    });
}

function toggleCamera() {
  const newState = !cameraEnabled;

  if (!newState) applyCameraStreamState(false);

  const btn = document.getElementById("cameraToggleBtn");
  btn?.setAttribute("disabled", "disabled");

  fetch(`/camera_enable?val=${newState ? 1 : 0}`, { cache: "no-store" })
    .then(async (res) => {
      let data = {};
      try { data = await res.json(); } catch (_) { data = {}; }
      if (!res.ok) {
        const msg = data.error || data.status || `HTTP ${res.status}`;
        throw new Error(msg);
      }
      return data;
    })
    .then(data => {
      const accepted = (data && data.ok === true && ["enabled", "disabled", "nochange"].includes(data.status));
      if (accepted) {
        updateCameraButton(!!data.enabled);
        showToast(`Camera ${data.enabled ? "enabled" : "disabled"}`, "info");
        if (newState) {
          applyCameraStreamState(true, 800);
        } else {
          applyCameraStreamState(false);
        }
      } else {
        const detail = (data && (data.error || data.status || data.camera_err))
          ? ` (${data.error || data.status || data.camera_err})`
          : "";
        showToast("Camera toggle failed" + detail, "error");
        console.warn("[camera_enable] reject", data);
        updateCameraButton(cameraEnabled);
        applyCameraStreamState(cameraEnabled);
      }
    })
    .catch((err) => {
      showToast(`Camera toggle failed (${err?.message || "request_failed"})`, "error");
      console.warn("[camera_enable] error", err);
      updateCameraButton(cameraEnabled);
      applyCameraStreamState(cameraEnabled);
    })
    .finally(() => btn?.removeAttribute("disabled"));
}


// --- 3D viewer bootstrap (lazy module import to keep first paint fast) ---
(function initMini3D() {
  const canvas = document.getElementById('model3D');
  if (!canvas) {
    registerCameraPrereq("mini3d", Promise.resolve());
    return;
  }

  const loaderUrl = '/web/GLTFLoader.js?v=' + assetTs;

  const loadPromise = import('three').then((THREE) => {
    return import(loaderUrl).then((mod) => {
      const { GLTFLoader } = mod;

      // Scene
      const scene = new THREE.Scene();
      scene.background = null; // transparent over video

      // Camera
      const camera = new THREE.PerspectiveCamera(35, canvas.width / canvas.height, 0.01, 50);
      camera.position.set(0.6, 0.4, 1.2);

      // Renderer (on existing canvas)
      const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
      renderer.setSize(canvas.width, canvas.height, false);

      // Lights (make standard/PBR materials visible)
      const amb = new THREE.AmbientLight(0xffffff, 0.6);
      const dir = new THREE.DirectionalLight(0xffffff, 0.8); dir.position.set(2, 3, 4);
      scene.add(amb, dir);

      // Obvious fallback while model loads / if it fails
      const fallback = new THREE.Mesh(
        new THREE.BoxGeometry(0.6, 0.4, 0.6),
        new THREE.MeshStandardMaterial({ color: 0xff3333, metalness: 0.0, roughness: 0.8, emissive: 0x331111 })
      );
      fallback.visible = true;
      scene.add(fallback);

      // Load model
      let modelRoot = null;
      let modelQuatOffset = null;
      const tmpEuler = new THREE.Euler();
      const gltfLoader = new GLTFLoader();

      const gltfReady = new Promise((resolve) => {
        gltfLoader.load('/model.glb?v=' + assetTs, (gltf) => {
          modelRoot = gltf.scene;
          scene.add(modelRoot);
          // Center & frame the model so it's on camera even if huge/tiny/off-center
          const box = new THREE.Box3().setFromObject(modelRoot);
          const size = box.getSize(new THREE.Vector3());
          const center = box.getCenter(new THREE.Vector3());
          modelRoot.position.sub(center); // recenter to origin

          const maxDim = Math.max(size.x, size.y, size.z) || 1;
          const zoomOut = 1.5;
          const fitDist = maxDim * 1.5 * zoomOut;
          camera.position.set(0, maxDim * 0.4 * zoomOut, fitDist);
          camera.lookAt(0, 0, 0);

          // Small emissive bump to avoid too-dark materials
          modelRoot.traverse(o => {
            if (o.isMesh && o.material && 'emissive' in o.material) o.material.emissive.multiplyScalar(0.15);
          });

          modelQuatOffset = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 2, 0, 'XYZ'));
          fallback.visible = false;
          resolve();
        }, undefined, (err) => {
          console.warn('GLB load failed, using fallback cube', err);
          resolve();
        });
      });

      // Orientation smoothing (optional)
      let smRoll = 0, smPitch = 0, smHeading = 0;
      const lerp = (a,b,t)=>a+(b-a)*t;

      // Expose a global so telemetry can push fresh angles
      window.update3DOrientation = function(rollDeg, pitchDeg, headingDeg) {
        const dirs = window.modelOrientationDir || { x: 1, y: 1, z: 1 };
        const prev = window._target3D || { roll: 0, pitch: 0, yaw: 0 };
        const toRad = (deg, mult) => THREE.MathUtils.degToRad(deg || 0) * (mult ?? 1);
        const wrapNearest = (prevAngle, nextAngle) => {
          if (typeof prevAngle !== "number") return nextAngle;
          const TWO_PI = Math.PI * 2;
          let diff = nextAngle - prevAngle;
          if (diff > Math.PI) {
            nextAngle -= TWO_PI;
          } else if (diff < -Math.PI) {
            nextAngle += TWO_PI;
          }
          return nextAngle;
        };

        const mapRaw = window.modelAxisMap || window.cachedModelAxisMap || { x: "x", y: "y", z: "z" };
        const axisMap = {
          x: normalizeModelAxisChoice(mapRaw.x, "x"),
          y: normalizeModelAxisChoice(mapRaw.y, "y"),
          z: normalizeModelAxisChoice(mapRaw.z, "z")
        };
        const telemetry = {
          x: pitchDeg,
          y: headingDeg,
          z: rollDeg
        };
        const mappedPitch = telemetry[axisMap.x] ?? pitchDeg;
        const mappedYaw = telemetry[axisMap.y] ?? headingDeg;
        const mappedRoll = telemetry[axisMap.z] ?? rollDeg;

        const nextRoll = toRad(mappedRoll, dirs.z);
        const nextPitch = toRad(mappedPitch, dirs.x);
        const nextYaw = toRad(mappedYaw, dirs.y);

        window._target3D = {
          roll: wrapNearest(prev.roll, nextRoll),
          pitch: wrapNearest(prev.pitch, nextPitch),
          yaw: wrapNearest(prev.yaw, nextYaw)
        };
      };

      function tick() {
        requestAnimationFrame(tick);

        const tgt = window._target3D || { roll:0, pitch:0, yaw:0 };
        smRoll    = lerp(smRoll,    tgt.roll,   0.18);
        smPitch   = lerp(smPitch,   tgt.pitch,  0.18);
        smHeading = lerp(smHeading, tgt.yaw,    0.12);

        const obj = modelRoot || fallback;
        const offsets = window.modelOrientationOffsets || { x: 0, y: 0, z: 0 };
        tmpEuler.set(smPitch + offsets.x, smHeading + offsets.y, smRoll + offsets.z, 'YXZ');
        obj.setRotationFromEuler(tmpEuler);
        if (obj === modelRoot && modelQuatOffset) {
          obj.quaternion.multiply(modelQuatOffset); // apply constant yaw offset after sensor rotation
        }

        renderer.render(scene, camera);
      }
      tick();

      // Keep crisp on resize / DPR changes
      const ro = new ResizeObserver(() => {
        const w = canvas.clientWidth || canvas.width;
        const h = canvas.clientHeight || canvas.height;
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      });
      ro.observe(canvas);

      // Bring to top just in case overlays hide it
      canvas.style.zIndex = '10001';
      const wrap = document.getElementById('model3DWrap');
      if (wrap) wrap.style.zIndex = '10000';

      if (typeof window.rollDeg === 'number' && typeof window.pitchDeg === 'number' && typeof window.headingDeg === 'number') {
        window.update3DOrientation(window.rollDeg, window.pitchDeg, window.headingDeg);
      }

      return gltfReady;
    });
  });

  registerCameraPrereq("mini3d", loadPromise);
})();
















