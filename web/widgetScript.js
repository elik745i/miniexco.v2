// widgetScript.js - extracted widget subsystem from commonScript.js

const memoryUiState = {
  open: null,
  lastReportTs: 0,
  batteryRenderPending: false,
  batteryRenderAt: 0,
  expandLiftActive: false,
  expandLiftBaseY: null,
  expandLiftTimerIds: []
};
const memoryExpansionLiftState = { active: false, offsets: {} };
const FPS_BAR_MAX = 30;
const UPTIME_BAR_MAX_SECS = 24 * 60 * 60;
const MEMORY_FRAME_MARGIN = 12;
const MEMORY_FRAME_LOCAL_KEY = "memoryFrameStateV1";
const WIDGET_FRAME_LOCAL_KEY = "widgetFrameStatesV1";
const VIEW_GRAVITY_FX_LOCAL_KEY = "viewGravityFxEnabledV1";
const VIEW_OVERLAP_FX_LOCAL_KEY = "viewOverlapFxEnabledV1";
const VIEW_SNAP_FX_LOCAL_KEY = "viewSnapFxEnabledV1";
const VIEW_GRAVITY_STRENGTH_LOCAL_KEY = "viewGravityFxStrengthV1";
const memoryFrameState = {
  x: null,
  y: null,
  visible: true,
  dragArmed: false,
  dragUseGravity: true,
  dragging: false,
  dragOffsetX: 0,
  dragOffsetY: 0,
  pendingSettle: false,
  pendingRoll: 1,
  longPressTimer: null,
  menuEl: null
};
const overlayWidgetStates = {
  imu: {
    id: "imuOverlay",
    visible: true,
    x: null,
    y: null,
    dragArmed: false,
    dragUseGravity: true,
    dragging: false,
    dragOffsetX: 0,
    dragOffsetY: 0,
    pendingSettle: false,
    pendingRoll: 1,
    wsVisible: "ImuVisible",
    wsX: "ImuX",
    wsY: "ImuY",
    paletteId: "viewWidgetImu"
  },
  media: {
    id: "mediaControlsWrap",
    visible: true,
    x: null,
    y: null,
    dragArmed: false,
    dragUseGravity: true,
    dragging: false,
    dragOffsetX: 0,
    dragOffsetY: 0,
    pendingSettle: false,
    pendingRoll: 1,
    wsVisible: "MediaVisible",
    wsX: "MediaX",
    wsY: "MediaY",
    paletteId: "viewWidgetMedia"
  },
  path: {
    id: "pathControlsWrap",
    visible: true,
    x: null,
    y: null,
    dragArmed: false,
    dragUseGravity: true,
    dragging: false,
    dragOffsetX: 0,
    dragOffsetY: 0,
    pendingSettle: false,
    pendingRoll: 1,
    wsVisible: "PathVisible",
    wsX: "PathX",
    wsY: "PathY",
    paletteId: "viewWidgetPath"
  },
  model: {
    id: "model3DWrap",
    visible: true,
    x: null,
    y: null,
    dragArmed: false,
    dragUseGravity: true,
    dragging: false,
    dragOffsetX: 0,
    dragOffsetY: 0,
    pendingSettle: false,
    pendingRoll: 1,
    wsVisible: "Model3DVisible",
    wsX: "Model3DX",
    wsY: "Model3DY",
    paletteId: "viewWidgetModel"
  }
};
const viewWidgetSourceIds = {
  indicators: "memoryMetersWrap",
  imu: "imuOverlay",
  media: "mediaControlsWrap",
  path: "pathControlsWrap",
  model: "model3DWrap"
};
let viewWidgetMiniRenderPending = false;
let gravityEffectEnabled = true;
let overlapEffectEnabled = true;
let snapEffectEnabled = true;
let gravityEffectStrength = 55;

try {
  const saved = localStorage.getItem(VIEW_GRAVITY_FX_LOCAL_KEY);
  if (saved !== null) gravityEffectEnabled = (saved === "1");
} catch (_) {}
try {
  const saved = localStorage.getItem(VIEW_OVERLAP_FX_LOCAL_KEY);
  if (saved !== null) overlapEffectEnabled = (saved === "1");
} catch (_) {}
try {
  const saved = localStorage.getItem(VIEW_SNAP_FX_LOCAL_KEY);
  if (saved !== null) snapEffectEnabled = (saved === "1");
} catch (_) {}
try {
  const saved = localStorage.getItem(VIEW_GRAVITY_STRENGTH_LOCAL_KEY);
  const n = Number(saved);
  if (Number.isFinite(n)) gravityEffectStrength = Math.max(0, Math.min(100, Math.round(n)));
} catch (_) {}

function syncGravityToggleUi() {
  const gravityEl = document.getElementById("viewGravityFxToggle");
  if (gravityEl) gravityEl.checked = !!gravityEffectEnabled;
  const overlapEl = document.getElementById("viewOverlapFxToggle");
  if (overlapEl) overlapEl.checked = !!overlapEffectEnabled;
  const snapEl = document.getElementById("viewSnapFxToggle");
  if (snapEl) snapEl.checked = !!snapEffectEnabled;
  const strengthEl = document.getElementById("viewGravityStrength");
  if (strengthEl) strengthEl.value = String(gravityEffectStrength);
}

window.setGravityEffectEnabled = function (enabled) {
  gravityEffectEnabled = !!enabled;
  try {
    localStorage.setItem(VIEW_GRAVITY_FX_LOCAL_KEY, gravityEffectEnabled ? "1" : "0");
  } catch (_) {}
  if (typeof sendButtonInput === "function") {
    sendButtonInput("ViewGravityFx", gravityEffectEnabled ? 1 : 0);
  }
  syncGravityToggleUi();
};

window.getGravityEffectEnabled = function () {
  return !!gravityEffectEnabled;
};

window.setOverlapEffectEnabled = function (enabled) {
  overlapEffectEnabled = !!enabled;
  try {
    localStorage.setItem(VIEW_OVERLAP_FX_LOCAL_KEY, overlapEffectEnabled ? "1" : "0");
  } catch (_) {}
  if (typeof sendButtonInput === "function") {
    sendButtonInput("ViewOverlapFx", overlapEffectEnabled ? 1 : 0);
  }
  syncGravityToggleUi();
};

window.setSnapEffectEnabled = function (enabled) {
  snapEffectEnabled = !!enabled;
  try {
    localStorage.setItem(VIEW_SNAP_FX_LOCAL_KEY, snapEffectEnabled ? "1" : "0");
  } catch (_) {}
  if (typeof sendButtonInput === "function") {
    sendButtonInput("ViewSnapFx", snapEffectEnabled ? 1 : 0);
  }
  syncGravityToggleUi();
};

window.setGravityEffectStrength = function (value) {
  const n = Number(value);
  gravityEffectStrength = Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 55;
  try {
    localStorage.setItem(VIEW_GRAVITY_STRENGTH_LOCAL_KEY, String(gravityEffectStrength));
  } catch (_) {}
  if (typeof sendButtonInput === "function") {
    sendButtonInput("ViewGravityStr", gravityEffectStrength);
  }
  syncGravityToggleUi();
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
  const battery = document.getElementById("batteryMeter");
  const heap = document.getElementById("heapOverlay");
  const psram = document.getElementById("psramOverlay");
  if (!battery || !heap || !psram) return;

  memoryUiState.open = (memoryUiState.open === kind) ? null : kind;
  battery.classList.toggle("telemetry-meter--open", memoryUiState.open === "battery");
  heap.classList.toggle("telemetry-meter--open", memoryUiState.open === "heap");
  psram.classList.toggle("telemetry-meter--open", memoryUiState.open === "psram");

  if (memoryUiState.open === "battery") {
    ensureMemoryFrameExpandedPanelVisible();
    applyMemoryExpansionLift();
    if (typeof window.renderBatteryInlineGraph === "function") {
      window.renderBatteryInlineGraph();
    }
  } else if (memoryUiState.open) {
    ensureMemoryFrameExpandedPanelVisible();
    applyMemoryExpansionLift();
    fetchAndRenderHeapReport();
  } else {
    clearMemoryExpandLiftTimers();
    restoreMemoryFrameAfterExpandCollapse();
    clearMemoryExpansionLift();
  }
}

function clearMemoryExpandLiftTimers() {
  const arr = memoryUiState.expandLiftTimerIds;
  if (!Array.isArray(arr) || !arr.length) return;
  for (let i = 0; i < arr.length; i++) {
    try { clearTimeout(arr[i]); } catch (_) {}
  }
  memoryUiState.expandLiftTimerIds = [];
}

function ensureMemoryFrameExpandedPanelVisible() {
  if (!memoryUiState.open) return;
  const wrap = getMemoryFrameWrap();
  const host = getMemoryFrameHost();
  if (!wrap || !host || !memoryFrameState.visible) return;

  const adjustOnce = () => {
    if (!memoryUiState.open) return;
    const hostRect = host.getBoundingClientRect();
    const wrapRect = wrap.getBoundingClientRect();
    const bottomLimit = hostRect.bottom - MEMORY_FRAME_MARGIN;
    const overflowBottom = Math.max(0, Math.ceil(wrapRect.bottom - bottomLimit));
    if (overflowBottom <= 0) return;
    if (!memoryUiState.expandLiftActive) {
      memoryUiState.expandLiftActive = true;
      memoryUiState.expandLiftBaseY = Number(memoryFrameState.y);
    }

    const newY = Math.max(
      MEMORY_FRAME_MARGIN,
      Math.round((Number(memoryFrameState.y) || MEMORY_FRAME_MARGIN) - overflowBottom - 2)
    );
    if (newY === memoryFrameState.y) return;
    memoryFrameState.y = newY;
    applyMemoryFramePosition(false);
    applyMemoryExpansionLift();
  };

  // Run a few passes to account for CSS max-height transitions and async graph render.
  adjustOnce();
  requestAnimationFrame(adjustOnce);
  clearMemoryExpandLiftTimers();
  const t1 = setTimeout(adjustOnce, 160);
  const t2 = setTimeout(adjustOnce, 360);
  memoryUiState.expandLiftTimerIds.push(t1, t2);
}

function restoreMemoryFrameAfterExpandCollapse() {
  if (!memoryUiState.expandLiftActive) return;
  const baseY = Number(memoryUiState.expandLiftBaseY);
  memoryUiState.expandLiftActive = false;
  memoryUiState.expandLiftBaseY = null;
  if (!Number.isFinite(baseY)) return;

  const restorePass = () => {
    if (memoryUiState.open) return;
    memoryFrameState.y = baseY;
    applyMemoryFramePosition(true);
  };

  // The details panel collapses with CSS transition; restore after shrink to avoid jitter.
  const t1 = setTimeout(restorePass, 220);
  const t2 = setTimeout(restorePass, 420);
  memoryUiState.expandLiftTimerIds.push(t1, t2);
}

function getMemoryExpansionLiftOffset(type) {
  if (!memoryExpansionLiftState.active) return 0;
  return Math.max(0, Number(memoryExpansionLiftState.offsets[type]) || 0);
}

function clearMemoryExpansionLift() {
  memoryExpansionLiftState.active = false;
  memoryExpansionLiftState.offsets = {};
  Object.keys(overlayWidgetStates).forEach((type) => applyOverlayWidgetPosition(type, false));
}

function applyMemoryExpansionLift() {
  if (!memoryUiState.open) {
    clearMemoryExpansionLift();
    return;
  }
  const host = getMemoryFrameHost();
  const wrap = getMemoryFrameWrap();
  if (!host || !wrap || !memoryFrameState.visible) return;

  const hostRect = host.getBoundingClientRect();
  const minX = getControlsAvoidLeftPx();
  const memPos = getRenderedWidgetPos(wrap, hostRect, minX);
  const memBox = {
    x: memPos.x,
    y: memPos.y,
    w: Math.max(1, wrap.offsetWidth || 1),
    h: Math.max(1, wrap.offsetHeight || 1)
  };

  const widgets = [];
  Object.keys(overlayWidgetStates).forEach((type) => {
    const st = overlayWidgetStates[type];
    const el = getOverlayWidgetEl(type);
    if (!st || !el || !st.visible) return;
    const p = getRenderedWidgetPos(el, hostRect, minX);
    widgets.push({
      type,
      x: p.x,
      y: p.y,
      w: Math.max(1, el.offsetWidth || 1),
      h: Math.max(1, el.offsetHeight || 1)
    });
  });

  if (!widgets.length) {
    clearMemoryExpansionLift();
    return;
  }

  // Process bottom-up: if a lower widget is lifted, widgets above are lifted too.
  widgets.sort((a, b) => b.y - a.y);
  const blockers = [memBox];
  const nextOffsets = {};
  const gap = 8;

  for (let i = 0; i < widgets.length; i++) {
    const w = widgets[i];
    let y = w.y;
    for (let j = 0; j < blockers.length; j++) {
      const b = blockers[j];
      if (!rectsOverlap({ x: w.x, y, w: w.w, h: w.h }, b, gap)) continue;
      const candidateY = b.y - w.h - gap;
      if (candidateY < y) y = candidateY;
    }
    y = Math.max(MEMORY_FRAME_MARGIN, Math.round(y));
    nextOffsets[w.type] = Math.max(0, w.y - y);
    blockers.push({ x: w.x, y, w: w.w, h: w.h });
  }

  memoryExpansionLiftState.active = true;
  memoryExpansionLiftState.offsets = nextOffsets;
  Object.keys(overlayWidgetStates).forEach((type) => applyOverlayWidgetPosition(type, false));
}

function initMemoryPanels() {
  const battery = document.getElementById("batteryMeter");
  const batteryDetails = document.getElementById("batteryDetails");
  const heap = document.getElementById("heapOverlay");
  const psram = document.getElementById("psramOverlay");
  if (battery && !battery.dataset.bound) {
    battery.dataset.bound = "1";
    battery.addEventListener("click", () => setMemoryPanelOpen("battery"));
  }
  if (batteryDetails && !batteryDetails.dataset.bound) {
    batteryDetails.dataset.bound = "1";
    batteryDetails.addEventListener("click", (e) => e.stopPropagation());
  }
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

function getControlsAvoidLeftPx() {
  const host = getMemoryFrameHost();
  const leftPanel = document.querySelector(".overlay-layout > .left");
  if (!host || !leftPanel) return MEMORY_FRAME_MARGIN;
  const hostRect = host.getBoundingClientRect();
  const panelRect = leftPanel.getBoundingClientRect();
  const boundary = Math.round(panelRect.right - hostRect.left + MEMORY_FRAME_MARGIN);
  return Math.max(MEMORY_FRAME_MARGIN, boundary);
}

function getOverlayWidgetState(type) {
  return overlayWidgetStates[type] || null;
}

function getOverlayWidgetEl(type) {
  const st = getOverlayWidgetState(type);
  if (!st) return null;
  return document.getElementById(st.id);
}

function defaultOverlayWidgetPos(type) {
  const host = getMemoryFrameHost();
  const el = getOverlayWidgetEl(type);
  if (!host || !el) return { x: MEMORY_FRAME_MARGIN, y: MEMORY_FRAME_MARGIN };

  if (type === "imu") {
    const y = Math.max(MEMORY_FRAME_MARGIN, host.clientHeight - el.offsetHeight - 100);
    return { x: MEMORY_FRAME_MARGIN, y };
  }
  if (type === "media") {
    const x = Math.max(MEMORY_FRAME_MARGIN, host.clientWidth - el.offsetWidth - MEMORY_FRAME_MARGIN);
    const y = Math.max(MEMORY_FRAME_MARGIN, host.clientHeight - el.offsetHeight - 90);
    return { x, y };
  }
  if (type === "path") {
    const x = Math.max(MEMORY_FRAME_MARGIN, host.clientWidth - el.offsetWidth - MEMORY_FRAME_MARGIN);
    const y = Math.max(MEMORY_FRAME_MARGIN, host.clientHeight - el.offsetHeight - 340);
    return { x, y };
  }
  if (type === "model") {
    const x = Math.max(MEMORY_FRAME_MARGIN, Math.round((host.clientWidth - el.offsetWidth) / 2));
    const y = Math.max(MEMORY_FRAME_MARGIN, host.clientHeight - el.offsetHeight - 90);
    return { x, y };
  }
  return { x: MEMORY_FRAME_MARGIN, y: MEMORY_FRAME_MARGIN };
}

function clampOverlayWidgetStoredPos(type, x, y) {
  const host = getMemoryFrameHost();
  const el = getOverlayWidgetEl(type);
  if (!host || !el) return { x: x || 0, y: y || 0 };
  const minX = MEMORY_FRAME_MARGIN;
  const maxX = Math.max(0, host.clientWidth - el.offsetWidth - MEMORY_FRAME_MARGIN);
  const maxY = Math.max(0, host.clientHeight - el.offsetHeight - MEMORY_FRAME_MARGIN);
  return {
    x: Math.max(minX, Math.min(maxX, Math.round(Number(x) || 0))),
    y: Math.max(MEMORY_FRAME_MARGIN, Math.min(maxY, Math.round(Number(y) || 0)))
  };
}

function resolveOverlayWidgetRenderPos(type, x, y) {
  const clamped = clampOverlayWidgetStoredPos(type, x, y);
  const minX = getControlsAvoidLeftPx();
  return {
    x: Math.max(minX, clamped.x),
    y: clamped.y
  };
}

function applyOverlayWidgetVisibility(type) {
  const st = getOverlayWidgetState(type);
  const el = getOverlayWidgetEl(type);
  if (!st || !el) return;
  el.classList.toggle("widget-hidden", !st.visible);
}

function applyOverlayWidgetPosition(type, animated) {
  const st = getOverlayWidgetState(type);
  const el = getOverlayWidgetEl(type);
  if (!st || !el) return;
  if (st.x === null || st.y === null) {
    const def = defaultOverlayWidgetPos(type);
    st.x = def.x;
    st.y = def.y;
  }
  const stored = clampOverlayWidgetStoredPos(type, st.x, st.y);
  st.x = stored.x;
  st.y = stored.y;
  const pos = resolveOverlayWidgetRenderPos(type, st.x, st.y);
  if (animated) el.style.transition = "left 220ms ease, top 220ms ease, opacity 180ms ease";
  el.style.right = "auto";
  el.style.bottom = "auto";
  el.style.left = pos.x + "px";
  el.style.top = Math.max(MEMORY_FRAME_MARGIN, pos.y - getMemoryExpansionLiftOffset(type)) + "px";
  if (animated) setTimeout(() => { el.style.transition = ""; }, 240);
}

function persistOverlayWidgetState(type, sendToDevice) {
  const st = getOverlayWidgetState(type);
  if (!st) return;
  try {
    const raw = localStorage.getItem(WIDGET_FRAME_LOCAL_KEY);
    const bag = raw ? JSON.parse(raw) : {};
    bag[type] = { x: st.x, y: st.y, visible: st.visible ? 1 : 0 };
    localStorage.setItem(WIDGET_FRAME_LOCAL_KEY, JSON.stringify(bag));
  } catch (_) {}
  if (sendToDevice && typeof sendButtonInput === "function") {
    sendButtonInput(st.wsVisible, st.visible ? 1 : 0);
    if (Number.isFinite(st.x)) sendButtonInput(st.wsX, Math.round(st.x));
    if (Number.isFinite(st.y)) sendButtonInput(st.wsY, Math.round(st.y));
  }
}

function restoreOverlayWidgetStateFromLocal(type) {
  const st = getOverlayWidgetState(type);
  if (!st) return;
  try {
    const raw = localStorage.getItem(WIDGET_FRAME_LOCAL_KEY);
    if (!raw) return;
    const bag = JSON.parse(raw);
    const item = bag ? bag[type] : null;
    if (!item) return;
    if (Number.isFinite(item.x) && Number.isFinite(item.y)) {
      st.x = item.x;
      st.y = item.y;
    }
    if (typeof item.visible !== "undefined") {
      st.visible = Number(item.visible) === 1;
    }
  } catch (_) {}
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

function clampMemoryFrameStoredPos(x, y) {
  const wrap = getMemoryFrameWrap();
  const host = getMemoryFrameHost();
  if (!wrap || !host) return { x: x || 0, y: y || 0 };
  const minX = MEMORY_FRAME_MARGIN;
  const maxX = Math.max(0, host.clientWidth - wrap.offsetWidth - MEMORY_FRAME_MARGIN);
  const maxY = Math.max(0, host.clientHeight - wrap.offsetHeight - MEMORY_FRAME_MARGIN);
  return {
    x: Math.max(minX, Math.min(maxX, Math.round(Number(x) || 0))),
    y: Math.max(MEMORY_FRAME_MARGIN, Math.min(maxY, Math.round(Number(y) || 0)))
  };
}

function resolveMemoryFrameRenderPos(x, y) {
  const stored = clampMemoryFrameStoredPos(x, y);
  const minX = getControlsAvoidLeftPx();
  return {
    x: Math.max(minX, stored.x),
    y: stored.y
  };
}

function rectsOverlap(a, b, gap) {
  const pad = Number.isFinite(gap) ? gap : 8;
  return !(
    a.x + a.w + pad <= b.x ||
    b.x + b.w + pad <= a.x ||
    a.y + a.h + pad <= b.y ||
    b.y + b.h + pad <= a.y
  );
}

function findWidgetLayoutSpot(item, placed, host, minX) {
  const maxX = Math.max(minX, host.clientWidth - item.w - MEMORY_FRAME_MARGIN);
  const maxY = Math.max(MEMORY_FRAME_MARGIN, host.clientHeight - item.h - MEMORY_FRAME_MARGIN);
  let x = Math.max(minX, Math.min(maxX, Math.round(item.desiredX)));
  let y = Math.max(MEMORY_FRAME_MARGIN, Math.min(maxY, Math.round(item.desiredY)));
  const scanStep = 10;

  for (let guard = 0; guard < 240; guard++) {
    const hit = placed.find((p) => rectsOverlap({ x, y, w: item.w, h: item.h }, p, 8));
    if (!hit) return { x, y };

    const nextY = hit.y + hit.h + 8;
    if (nextY <= maxY) {
      y = nextY;
      continue;
    }

    x += scanStep;
    if (x > maxX) {
      x = minX;
      y += scanStep;
      if (y > maxY) y = MEMORY_FRAME_MARGIN;
    } else {
      y = MEMORY_FRAME_MARGIN;
    }
  }

  return { x, y };
}

function findRenderOnlyPanelSpot(item, placed, host, minX) {
  const gap = 8;
  const maxX = Math.max(minX, host.clientWidth - item.w - MEMORY_FRAME_MARGIN);
  const maxY = Math.max(MEMORY_FRAME_MARGIN, host.clientHeight - item.h - MEMORY_FRAME_MARGIN);
  const base = clampWidgetPosToBounds(host, minX, item.w, item.h, item.desiredX, item.desiredY);
  let x = base.x;
  let y = base.y;

  for (let guard = 0; guard < 160; guard++) {
    const hit = placed.find((p) => rectsOverlap({ x, y, w: item.w, h: item.h }, p, gap));
    if (!hit) return { x, y };

    const downY = hit.y + hit.h + gap;
    if (downY <= maxY) {
      y = downY;
      continue;
    }

    const rightX = hit.x + hit.w + gap;
    if (rightX <= maxX) {
      x = rightX;
      y = base.y;
      continue;
    }

    const leftX = hit.x - item.w - gap;
    if (leftX >= minX) {
      x = leftX;
      y = base.y;
      continue;
    }

    // Keep nearest bounded position instead of wrapping to top.
    return { x, y };
  }

  return { x, y };
}

function resolvePanelReflowPositions(items, host, minX) {
  const gap = 8;
  const entries = items.map((item) => {
    const p = clampWidgetPosToBounds(host, minX, item.w, item.h, item.desiredX, item.desiredY);
    return {
      type: item.type,
      x: p.x,
      y: p.y,
      w: item.w,
      h: item.h,
      desiredX: item.desiredX,
      desiredY: item.desiredY,
      maxX: Math.max(minX, host.clientWidth - item.w - MEMORY_FRAME_MARGIN),
      maxY: Math.max(MEMORY_FRAME_MARGIN, host.clientHeight - item.h - MEMORY_FRAME_MARGIN)
    };
  });

  entries.sort((a, b) => (a.desiredX !== b.desiredX ? a.desiredX - b.desiredX : a.desiredY - b.desiredY));

  for (let pass = 0; pass < 48; pass++) {
    let moved = false;
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const a = entries[i];
        const b = entries[j];
        if (!rectsOverlap(a, b, gap)) continue;

        let left = a;
        let right = b;
        if (
          a.desiredX > b.desiredX ||
          (a.desiredX === b.desiredX && a.x > b.x)
        ) {
          left = b;
          right = a;
        }

        const pushedX = left.x + left.w + gap;
        if (pushedX <= right.maxX) {
          if (pushedX > right.x) {
            right.x = pushedX;
            moved = true;
          }
        } else {
          const pushedY = Math.max(right.y, left.y + left.h + gap);
          if (pushedY <= right.maxY && pushedY !== right.y) {
            right.y = pushedY;
            moved = true;
          }
        }

        right.x = Math.max(minX, Math.min(right.maxX, right.x));
        right.y = Math.max(MEMORY_FRAME_MARGIN, Math.min(right.maxY, right.y));
      }
    }
    if (!moved) break;
  }

  const out = {};
  entries.forEach((e) => {
    out[e.type] = { x: e.x, y: e.y };
  });
  return out;
}

function resolvePanelHorizontalCascadePositions(items, host, minX) {
  const gap = 8;
  const entries = items.map((item, idx) => {
    const p = clampWidgetPosToBounds(host, minX, item.w, item.h, item.desiredX, item.desiredY);
    const maxY = Math.max(MEMORY_FRAME_MARGIN, host.clientHeight - item.h - MEMORY_FRAME_MARGIN);
    const baseStoredX = Number.isFinite(item.storedX) ? Math.round(item.storedX) : Math.round(item.desiredX);
    const baseStoredY = Number.isFinite(item.storedY) ? Math.round(item.storedY) : Math.round(item.desiredY);
    return {
      type: item.type,
      x: p.x,
      y: p.y,
      w: item.w,
      h: item.h,
      storedX: Math.max(MEMORY_FRAME_MARGIN, Math.min(host.clientWidth - item.w - MEMORY_FRAME_MARGIN, baseStoredX)),
      storedY: Math.max(MEMORY_FRAME_MARGIN, Math.min(maxY, baseStoredY)),
      orderX: Number.isFinite(item.storedX) ? item.storedX : item.desiredX,
      orderY: Number.isFinite(item.storedY) ? item.storedY : item.desiredY,
      orderI: idx,
      maxX: Math.max(minX, host.clientWidth - item.w - MEMORY_FRAME_MARGIN),
      maxY
    };
  });

  // Preserve original stored order from left to right; never flip positions.
  entries.sort((a, b) => {
    if (a.orderX !== b.orderX) return a.orderX - b.orderX;
    if (a.orderY !== b.orderY) return a.orderY - b.orderY;
    return a.orderI - b.orderI;
  });

  entries.forEach((e) => {
    e.x = Math.max(minX, Math.min(e.maxX, e.x));
  });

  const intentionallyOverlapped = (a, b) => {
    return rectsOverlap(
      { x: a.storedX, y: a.storedY, w: a.w, h: a.h },
      { x: b.storedX, y: b.storedY, w: b.w, h: b.h },
      gap
    );
  };

  // Resolve only panel-induced overlaps; preserve intentional stacked overlaps.
  for (let pass = 0; pass < 48; pass++) {
    let moved = false;
    for (let i = 0; i < entries.length; i++) {
      const left = entries[i];
      for (let j = i + 1; j < entries.length; j++) {
        const right = entries[j];
        if (intentionallyOverlapped(left, right)) continue;
        if (!rectsOverlap(left, right, gap)) continue;

        const needX = left.x + left.w + gap;
        if (needX <= right.maxX) {
          if (right.x < needX) {
            right.x = needX;
            moved = true;
          }
          continue;
        }

        const downY = left.y + left.h + gap;
        if (downY <= right.maxY && right.y < downY) {
          right.y = downY;
          moved = true;
        }
      }
    }
    if (!moved) break;
  }

  const out = {};
  entries.forEach((e) => {
    out[e.type] = { x: e.x, y: e.y };
  });
  return out;
}

function applyUnifiedWidgetLayout(anchorType, animated, commitStored, opts) {
  const options = opts || {};
  const preserveOthers = !!options.preserveOthers;
  const panelOnly = !!options.panelOnly;
  const host = getMemoryFrameHost();
  if (!host) return;
  const minX = getControlsAvoidLeftPx();
  const hostRect = host.getBoundingClientRect();
  const items = [];

  const memoryWrap = getMemoryFrameWrap();
  if (memoryWrap && memoryFrameState.visible) {
    if (memoryFrameState.x === null || memoryFrameState.y === null) {
      const def = memoryFrameDefaultPos();
      memoryFrameState.x = def.x;
      memoryFrameState.y = def.y;
    }
    const stored = clampMemoryFrameStoredPos(memoryFrameState.x, memoryFrameState.y);
    memoryFrameState.x = stored.x;
    memoryFrameState.y = stored.y;
    const desired = resolveMemoryFrameRenderPos(memoryFrameState.x, memoryFrameState.y);
    items.push({
      type: "indicators",
      el: memoryWrap,
      w: Math.max(1, memoryWrap.offsetWidth || 1),
      h: Math.max(1, memoryWrap.offsetHeight || 1),
      storedX: memoryFrameState.x,
      storedY: memoryFrameState.y,
      desiredX: desired.x,
      desiredY: desired.y
    });
  }

  Object.keys(overlayWidgetStates).forEach((type) => {
    const st = overlayWidgetStates[type];
    const el = getOverlayWidgetEl(type);
    if (!st || !el || !st.visible) return;
    if (st.x === null || st.y === null) {
      const def = defaultOverlayWidgetPos(type);
      st.x = def.x;
      st.y = def.y;
    }
    const stored = clampOverlayWidgetStoredPos(type, st.x, st.y);
    st.x = stored.x;
    st.y = stored.y;
    const desired = resolveOverlayWidgetRenderPos(type, st.x, st.y);
    items.push({
      type,
      el,
      w: Math.max(1, el.offsetWidth || 1),
      h: Math.max(1, el.offsetHeight || 1),
      storedX: st.x,
      storedY: st.y,
      desiredX: desired.x,
      desiredY: desired.y
    });
  });

  if (!items.length) return;

  const finalPosByType = {};
  if (panelOnly) {
    Object.assign(finalPosByType, resolvePanelHorizontalCascadePositions(items, host, minX));
  } else if (preserveOthers && anchorType) {
    const anchor = items.find((it) => it.type === anchorType);
    const placed = [];

    items.forEach((item) => {
      if (item.type === anchorType) return;
      const r = item.el.getBoundingClientRect();
      const maxX = Math.max(minX, host.clientWidth - item.w - MEMORY_FRAME_MARGIN);
      const maxY = Math.max(MEMORY_FRAME_MARGIN, host.clientHeight - item.h - MEMORY_FRAME_MARGIN);
      const p = {
        x: Math.max(minX, Math.min(maxX, Math.round(r.left - hostRect.left))),
        y: Math.max(MEMORY_FRAME_MARGIN, Math.min(maxY, Math.round(r.top - hostRect.top))),
        w: item.w,
        h: item.h,
        type: item.type
      };
      placed.push(p);
      finalPosByType[item.type] = { x: p.x, y: p.y };
    });

    if (anchor) {
      const anchorPos = findWidgetLayoutSpot(anchor, placed, host, minX);
      finalPosByType[anchor.type] = anchorPos;
    }
  } else {
    items.sort((a, b) => {
      if (anchorType && a.type === anchorType && b.type !== anchorType) return -1;
      if (anchorType && b.type === anchorType && a.type !== anchorType) return 1;
      if (a.desiredY !== b.desiredY) return a.desiredY - b.desiredY;
      return a.desiredX - b.desiredX;
    });

    const placed = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const fixed = anchorType && item.type === anchorType;
      const maxX = Math.max(minX, host.clientWidth - item.w - MEMORY_FRAME_MARGIN);
      const maxY = Math.max(MEMORY_FRAME_MARGIN, host.clientHeight - item.h - MEMORY_FRAME_MARGIN);
      let pos = {
        x: Math.max(minX, Math.min(maxX, Math.round(item.desiredX))),
        y: Math.max(MEMORY_FRAME_MARGIN, Math.min(maxY, Math.round(item.desiredY)))
      };
      if (!fixed) {
        pos = findWidgetLayoutSpot(item, placed, host, minX);
      }
      placed.push({ x: pos.x, y: pos.y, w: item.w, h: item.h, type: item.type });
      finalPosByType[item.type] = pos;
    }
  }

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const pos = finalPosByType[item.type] || { x: item.desiredX, y: item.desiredY };
    if (animated) item.el.style.transition = "left 220ms ease, top 220ms ease, opacity 180ms ease";
    item.el.style.right = "auto";
    item.el.style.bottom = "auto";
    item.el.style.left = pos.x + "px";
    item.el.style.top = Math.max(MEMORY_FRAME_MARGIN, pos.y - getMemoryExpansionLiftOffset(item.type)) + "px";
    if (animated) setTimeout(() => { item.el.style.transition = ""; }, 240);

    if (!commitStored) continue;
    if (preserveOthers && anchorType && item.type !== anchorType) continue;
    if (item.type === "indicators") {
      memoryFrameState.x = pos.x;
      memoryFrameState.y = pos.y;
    } else {
      const st = getOverlayWidgetState(item.type);
      if (st) {
        st.x = pos.x;
        st.y = pos.y;
      }
    }
  }
}

function persistAllWidgetStates(sendToDevice) {
  persistMemoryFrameState(sendToDevice);
  Object.keys(overlayWidgetStates).forEach((type) => persistOverlayWidgetState(type, sendToDevice));
}

function applyPanelAvoidanceLayout(animated) {
  applyUnifiedWidgetLayout(null, animated, false, { panelOnly: true });
  if (memoryUiState.open) applyMemoryExpansionLift();
}

function getRenderedWidgetPos(el, hostRect, minX) {
  const r = el.getBoundingClientRect();
  const x = Math.max(minX, Math.round(r.left - hostRect.left));
  const y = Math.max(MEMORY_FRAME_MARGIN, Math.round(r.top - hostRect.top));
  return { x, y };
}

function clampWidgetPosToBounds(host, minX, w, h, x, y) {
  const maxX = Math.max(minX, host.clientWidth - w - MEMORY_FRAME_MARGIN);
  const maxY = Math.max(MEMORY_FRAME_MARGIN, host.clientHeight - h - MEMORY_FRAME_MARGIN);
  return {
    x: Math.max(minX, Math.min(maxX, Math.round(x))),
    y: Math.max(MEMORY_FRAME_MARGIN, Math.min(maxY, Math.round(y)))
  };
}

function overlapsAnyRect(candidate, others) {
  return others.some((o) => rectsOverlap(candidate, o, 8));
}

function getWidgetPhysicsHandle(kind) {
  if (kind === "indicators") return memoryFrameState;
  return getOverlayWidgetState(kind);
}

function getWidgetPhysicsEl(kind) {
  if (kind === "indicators") return getMemoryFrameWrap();
  return getOverlayWidgetEl(kind);
}

function collectObstacleRects(kind, hostRect, minX) {
  const out = [];
  const pushRect = (type, el) => {
    if (!el || type === kind) return;
    const r = el.getBoundingClientRect();
    out.push({
      x: Math.max(minX, Math.round(r.left - hostRect.left)),
      y: Math.max(MEMORY_FRAME_MARGIN, Math.round(r.top - hostRect.top)),
      w: Math.max(1, Math.round(r.width)),
      h: Math.max(1, Math.round(r.height))
    });
  };

  if (memoryFrameState.visible) pushRect("indicators", getMemoryFrameWrap());
  Object.keys(overlayWidgetStates).forEach((type) => {
    const st = overlayWidgetStates[type];
    if (!st || !st.visible) return;
    pushRect(type, getOverlayWidgetEl(type));
  });
  return out;
}

function getWidgetSupportState(kind, x, y) {
  const host = getMemoryFrameHost();
  const el = getWidgetPhysicsEl(kind);
  if (!host || !el) return { stable: true, supported: true, ratio: 1, rollDir: 1 };

  const hostRect = host.getBoundingClientRect();
  const minX = getControlsAvoidLeftPx();
  const w = Math.max(1, el.offsetWidth || 1);
  const h = Math.max(1, el.offsetHeight || 1);
  const maxX = Math.max(minX, host.clientWidth - w - MEMORY_FRAME_MARGIN);
  const maxY = Math.max(MEMORY_FRAME_MARGIN, host.clientHeight - h - MEMORY_FRAME_MARGIN);
  const px = Math.max(minX, Math.min(maxX, Number(x) || minX));
  const py = Math.max(MEMORY_FRAME_MARGIN, Math.min(maxY, Number(y) || MEMORY_FRAME_MARGIN));
  const obstacles = collectObstacleRects(kind, hostRect, minX);

  let best = null;
  for (let i = 0; i < obstacles.length; i++) {
    const o = obstacles[i];
    const supportDist = Math.abs((py + h) - o.y);
    if (supportDist > 14) continue;
    const overlapW = Math.min(px + w, o.x + o.w) - Math.max(px, o.x);
    if (overlapW <= 0) continue;
    const ratio = Math.max(0, Math.min(1, overlapW / Math.max(1, w)));
    if (!best || ratio > best.ratio) best = { rect: o, ratio };
  }

  if (!best) {
    return {
      stable: false,
      supported: false,
      ratio: 0,
      centerInside: false,
      rollDir: 1
    };
  }

  const cx = px + w * 0.5;
  const centerInside = (cx >= best.rect.x && cx <= (best.rect.x + best.rect.w));
  const stable = !!(centerInside && best.ratio >= 0.5);
  const rollDir = (cx < (best.rect.x + best.rect.w * 0.5)) ? -1 : 1;
  return {
    stable,
    supported: true,
    ratio: best.ratio,
    centerInside,
    rollDir
  };
}

function shouldRunGravitySettle(kind, x, y) {
  const host = getMemoryFrameHost();
  const el = getWidgetPhysicsEl(kind);
  if (!host || !el) return false;

  const h = Math.max(1, el.offsetHeight || 1);
  const maxY = Math.max(MEMORY_FRAME_MARGIN, host.clientHeight - h - MEMORY_FRAME_MARGIN);
  const py = Number(y);
  if (!Number.isFinite(py)) return false;

  // If not touching any support and not resting on the bottom boundary, it is suspended.
  if (py < (maxY - 1)) {
    const support = getWidgetSupportState(kind, x, y);
    if (!support.supported) return true;
    if (!support.stable) return true;
    return false;
  }
  return false;
}

function startWidgetMatterSimulation(kind, rollDir) {
  const M = window.Matter;
  if (!M || !M.Engine || !M.World || !M.Bodies || !M.Body) return false;

  const st = getWidgetPhysicsHandle(kind);
  const el = getWidgetPhysicsEl(kind);
  const host = getMemoryFrameHost();
  if (!st || !el || !host) return false;

  if (st.physicsRaf) {
    cancelAnimationFrame(st.physicsRaf);
    st.physicsRaf = null;
  }

  const support = getWidgetSupportState(kind, st.x, st.y);
  if (support.stable) {
    if (typeof el.animate === "function") {
      const amp = Math.max(0.6, 2.2 * (1 - support.ratio));
      try {
        el.animate(
          [
            { transform: `rotate(${amp}deg)` },
            { transform: `rotate(${-amp * 0.65}deg)` },
            { transform: "rotate(0deg)" }
          ],
          { duration: 220, easing: "ease-out" }
        );
      } catch (_) {}
    }
    persistAllWidgetStates(true);
    return true;
  }

  const hostRect = host.getBoundingClientRect();
  const minX = getControlsAvoidLeftPx();
  const w = Math.max(1, el.offsetWidth || 1);
  const h = Math.max(1, el.offsetHeight || 1);
  const maxX = Math.max(minX, host.clientWidth - w - MEMORY_FRAME_MARGIN);
  const maxY = Math.max(MEMORY_FRAME_MARGIN, host.clientHeight - h - MEMORY_FRAME_MARGIN);
  const strengthNorm = Math.max(0, Math.min(100, gravityEffectStrength)) / 100;

  const engine = M.Engine.create();
  engine.world.gravity.x = 0;
  engine.world.gravity.y = 0.82 + 2.4 * strengthNorm;

  const wallThickness = 80;
  const worldBodies = [];

  const addStaticRect = (x, y, width, height) => {
    worldBodies.push(
      M.Bodies.rectangle(x, y, width, height, {
        isStatic: true,
        friction: 0.6,
        restitution: 0.08
      })
    );
  };

  addStaticRect((minX + maxX + w) * 0.5, maxY + h + wallThickness * 0.5, (maxX - minX + w) + wallThickness * 2, wallThickness); // floor
  addStaticRect(minX - wallThickness * 0.5, (MEMORY_FRAME_MARGIN + maxY + h) * 0.5, wallThickness, (maxY + h - MEMORY_FRAME_MARGIN) + wallThickness * 2); // left wall
  addStaticRect(maxX + w + wallThickness * 0.5, (MEMORY_FRAME_MARGIN + maxY + h) * 0.5, wallThickness, (maxY + h - MEMORY_FRAME_MARGIN) + wallThickness * 2); // right wall
  addStaticRect((minX + maxX + w) * 0.5, MEMORY_FRAME_MARGIN - wallThickness * 0.5, (maxX - minX + w) + wallThickness * 2, wallThickness); // top

  const obstacles = collectObstacleRects(kind, hostRect, minX);
  obstacles.forEach((o) => {
    addStaticRect(o.x + o.w * 0.5, o.y + o.h * 0.5, o.w, o.h);
  });

  const startX = Math.max(minX, Math.min(maxX, Number(st.x) || minX));
  const startY = Math.max(MEMORY_FRAME_MARGIN, Math.min(maxY, Number(st.y) || MEMORY_FRAME_MARGIN));
  const body = M.Bodies.rectangle(startX + w * 0.5, startY + h * 0.5, w, h, {
    friction: 0.5 + 0.25 * (1 - strengthNorm),
    frictionAir: 0.016 + 0.028 * (1 - strengthNorm),
    restitution: 0.11 + 0.3 * strengthNorm,
    density: 0.0024
  });

  M.World.add(engine.world, worldBodies);
  M.World.add(engine.world, body);

  const instability = support.supported
    ? Math.max(0.12, Math.min(1, (0.56 - support.ratio) / 0.56 + (support.centerInside ? 0 : 0.35)))
    : 1;
  const roll = support.supported ? (support.rollDir || 1) : (rollDir < 0 ? -1 : 1);
  const vx0 = (30 + 160 * strengthNorm) * 0.01 * roll * (0.5 + instability);
  const av0 = (0.004 + 0.028 * strengthNorm) * roll * (0.5 + instability);
  const vy0 = support.supported ? 0.02 : (0.08 + 0.08 * strengthNorm);
  M.Body.setVelocity(body, { x: vx0, y: vy0 });
  M.Body.setAngularVelocity(body, av0);

  let last = performance.now();
  let settleFrames = 0;

  const stop = () => {
    st.physicsRaf = null;
    const sx = Math.max(minX, Math.min(maxX, Math.round(body.position.x - w * 0.5)));
    const sy = Math.max(MEMORY_FRAME_MARGIN, Math.min(maxY, Math.round(body.position.y - h * 0.5)));
    st.x = sx;
    st.y = sy;
    st.pendingSettle = false;
    el.style.left = sx + "px";
    el.style.top = sy + "px";
    el.style.right = "auto";
    el.style.bottom = "auto";
    el.style.transform = "";
    try {
      M.World.clear(engine.world, false);
      M.Engine.clear(engine);
    } catch (_) {}
    persistAllWidgetStates(true);
    refreshViewWidgetPalette();
  };

  const tick = (now) => {
    const dtMs = Math.max(8, Math.min(33, now - last));
    last = now;
    M.Engine.update(engine, dtMs);

    const drawX = Math.max(minX, Math.min(maxX, body.position.x - w * 0.5));
    const drawY = Math.max(MEMORY_FRAME_MARGIN, Math.min(maxY, body.position.y - h * 0.5));
    el.style.left = Math.round(drawX) + "px";
    el.style.top = Math.round(drawY) + "px";
    el.style.transform = `rotate(${(body.angle * 180 / Math.PI).toFixed(2)}deg)`;

    const v = body.velocity;
    const speed = Math.sqrt(v.x * v.x + v.y * v.y);
    const onBottom = drawY >= (maxY - 1.5);
    const supportNow = getWidgetSupportState(kind, drawX, drawY);
    const onSurface = onBottom || supportNow.supported;
    if (speed < 0.28 && Math.abs(body.angularVelocity) < 0.014 && onSurface) settleFrames += 1;
    else settleFrames = 0;

    if (settleFrames >= 10) {
      stop();
      return;
    }
    st.physicsRaf = requestAnimationFrame(tick);
  };

  st.physicsRaf = requestAnimationFrame(tick);
  return true;
}

function startWidgetFallSimulation(kind, rollDir) {
  if (startWidgetMatterSimulation(kind, rollDir)) return;

  const st = getWidgetPhysicsHandle(kind);
  const el = getWidgetPhysicsEl(kind);
  const host = getMemoryFrameHost();
  if (!st || !el || !host) return;

  if (st.physicsRaf) {
    cancelAnimationFrame(st.physicsRaf);
    st.physicsRaf = null;
  }

  const hostRect = host.getBoundingClientRect();
  const minX = getControlsAvoidLeftPx();
  const w = Math.max(1, el.offsetWidth || 1);
  const h = Math.max(1, el.offsetHeight || 1);
  const maxX = Math.max(minX, host.clientWidth - w - MEMORY_FRAME_MARGIN);
  const maxY = Math.max(MEMORY_FRAME_MARGIN, host.clientHeight - h - MEMORY_FRAME_MARGIN);
  const obstacles = collectObstacleRects(kind, hostRect, minX);

  const strengthNorm = Math.max(0, Math.min(100, gravityEffectStrength)) / 100;
  const gravityAcc = 420 + 1500 * Math.pow(strengthNorm, 1.8);
  const tiltTorqueBase = 55 + 330 * Math.pow(strengthNorm, 1.5);
  const rebound = 0.07 + 0.22 * strengthNorm;

  let x = Math.max(minX, Math.min(maxX, Number(st.x) || minX));
  let y = Math.max(MEMORY_FRAME_MARGIN, Math.min(maxY, Number(st.y) || MEMORY_FRAME_MARGIN));
  let vx = 0;
  let vy = 0;
  let angle = 0;
  let angV = 0;
  let last = performance.now();
  let settleFrames = 0;
  let phase = "tilt";

  const findSupport = (px, py) => {
    let best = null;
    for (let i = 0; i < obstacles.length; i++) {
      const o = obstacles[i];
      const supportDist = Math.abs((py + h) - o.y);
      if (supportDist > 14) continue;
      const overlapW = Math.min(px + w, o.x + o.w) - Math.max(px, o.x);
      if (overlapW <= 0) continue;
      const ratio = Math.max(0, Math.min(1, overlapW / Math.max(1, w)));
      if (!best || ratio > best.ratio) best = { o, ratio };
    }
    if (!best) return null;
    const cx = px + w * 0.5;
    return {
      rect: best.o,
      ratio: best.ratio,
      centerInside: (cx >= best.o.x && cx <= (best.o.x + best.o.w))
    };
  };

  const support0 = findSupport(x, y);
  const ratio0 = support0 ? support0.ratio : 0;
  const stable = !!(support0 && support0.centerInside && ratio0 >= 0.5);

  if (stable) {
    if (typeof el.animate === "function") {
      const amp = Math.max(0.8, 2.8 * (1 - ratio0));
      try {
        el.animate(
          [
            { transform: `rotate(${amp}deg)` },
            { transform: `rotate(${-amp * 0.6}deg)` },
            { transform: "rotate(0deg)" }
          ],
          { duration: 240, easing: "ease-out" }
        );
      } catch (_) {}
    }
    persistAllWidgetStates(true);
    return;
  }

  const instability = support0
    ? Math.max(0.12, Math.min(1, (0.55 - ratio0) / 0.55 + (support0.centerInside ? 0 : 0.35)))
    : 1;
  const dir = support0
    ? ((x + w * 0.5) < (support0.rect.x + support0.rect.w * 0.5) ? -1 : 1)
    : (rollDir < 0 ? -1 : 1);
  const tiltTargetDeg = (9 + 48 * instability * (0.4 + strengthNorm)) * dir;
  const tiltLift = 2 + 8 * instability;

  const applyVisual = () => {
    el.style.left = Math.round(x) + "px";
    el.style.top = Math.round(y) + "px";
    el.style.transform = `rotate(${angle.toFixed(2)}deg)`;
  };

  const stop = () => {
    st.physicsRaf = null;
    st.x = Math.round(x);
    st.y = Math.round(y);
    st.pendingSettle = false;
    el.style.left = st.x + "px";
    el.style.top = st.y + "px";
    el.style.right = "auto";
    el.style.bottom = "auto";
    el.style.transform = "";
    persistAllWidgetStates(true);
    refreshViewWidgetPalette();
  };

  const tick = (now) => {
    const dt = Math.min(0.033, Math.max(0.008, (now - last) / 1000));
    last = now;

    if (phase === "tilt") {
      // Rotational acceleration from gravity moment about support edge.
      angV += tiltTorqueBase * instability * dt;
      angle += angV * dt * dir;

      const progress = Math.min(1, Math.abs(angle) / Math.max(1, Math.abs(tiltTargetDeg)));
      x += dir * (14 * instability) * dt;
      y = Math.min(maxY, y + tiltLift * progress * dt);

      if (Math.abs(angle) >= Math.abs(tiltTargetDeg)) {
        phase = "fall";
        vx = dir * (8 + 72 * instability * (0.35 + strengthNorm));
        vy = 18 + 26 * instability;
      }
    } else {
      vy += gravityAcc * dt;
      x += vx * dt;
      y += vy * dt;
      angle += (angV * 0.35) * dt * dir;
      vx *= 0.994;
      angV *= 0.98;
    }

    // World bounds.
    if (x < minX) {
      x = minX;
      vx = Math.abs(vx) * 0.28;
    } else if (x > maxX) {
      x = maxX;
      vx = -Math.abs(vx) * 0.28;
    }
    if (y < MEMORY_FRAME_MARGIN) {
      y = MEMORY_FRAME_MARGIN;
      vy = Math.abs(vy) * 0.1;
    } else if (y > maxY) {
      y = maxY;
      vy = -Math.abs(vy) * rebound;
      vx *= 0.82;
      angV *= 0.8;
    }

    // Obstacle collisions.
    for (let i = 0; i < obstacles.length; i++) {
      const o = obstacles[i];
      const overlapX = Math.min(x + w, o.x + o.w) - Math.max(x, o.x);
      const overlapY = Math.min(y + h, o.y + o.h) - Math.max(y, o.y);
      if (overlapX <= 0 || overlapY <= 0) continue;

      if (overlapY <= overlapX) {
        if (y + h * 0.5 < o.y + o.h * 0.5) {
          y = o.y - h;
          vy = -Math.abs(vy) * (rebound * 0.8);
          const c = x + w * 0.5;
          const oc = o.x + o.w * 0.5;
          vx += (c - oc) * 0.12;
        } else {
          y = o.y + o.h;
          vy = Math.abs(vy) * 0.1;
        }
      } else {
        if (x + w * 0.5 < o.x + o.w * 0.5) {
          x = o.x - w;
          vx = -Math.abs(vx) * 0.22;
        } else {
          x = o.x + o.w;
          vx = Math.abs(vx) * 0.22;
        }
      }
    }

    applyVisual();

    const supportNow = findSupport(x, y);
    const nearRest = Math.abs(vx) < 4 && Math.abs(vy) < 6 && Math.abs(angV) < 7;
    const onSurface = y >= maxY - 1 || !!supportNow;
    if (nearRest && onSurface) settleFrames += 1;
    else settleFrames = 0;

    if (settleFrames >= 7) {
      stop();
      return;
    }

    st.physicsRaf = requestAnimationFrame(tick);
  };

  applyVisual();
  st.physicsRaf = requestAnimationFrame(tick);
}

function canPlaceAnchorWithoutOverlap(anchorType, desiredX, desiredY) {
  const host = getMemoryFrameHost();
  if (!host) return null;
  const minX = getControlsAvoidLeftPx();
  const hostRect = host.getBoundingClientRect();

  let anchorEl = null;
  if (anchorType === "indicators") anchorEl = getMemoryFrameWrap();
  else anchorEl = getOverlayWidgetEl(anchorType);
  if (!anchorEl) return null;

  const w = Math.max(1, anchorEl.offsetWidth || 1);
  const h = Math.max(1, anchorEl.offsetHeight || 1);
  const p0 = clampWidgetPosToBounds(host, minX, w, h, desiredX, desiredY);
  const candidate = { x: p0.x, y: p0.y, w, h };

  if (!overlapEffectEnabled) {
    return { x: candidate.x, y: candidate.y, snapped: false, rollDir: 1 };
  }

  const others = [];
  const mem = getMemoryFrameWrap();
  if (mem && memoryFrameState.visible && anchorType !== "indicators") {
    const p = getRenderedWidgetPos(mem, hostRect, minX);
    others.push({ x: p.x, y: p.y, w: Math.max(1, mem.offsetWidth || 1), h: Math.max(1, mem.offsetHeight || 1) });
  }
  Object.keys(overlayWidgetStates).forEach((type) => {
    if (type === anchorType) return;
    const st = overlayWidgetStates[type];
    const el = getOverlayWidgetEl(type);
    if (!st || !el || !st.visible) return;
    const p = getRenderedWidgetPos(el, hostRect, minX);
    others.push({ x: p.x, y: p.y, w: Math.max(1, el.offsetWidth || 1), h: Math.max(1, el.offsetHeight || 1) });
  });

  if (!overlapsAnyRect(candidate, others)) {
    return { x: candidate.x, y: candidate.y, snapped: false, rollDir: 1 };
  }

  if (!snapEffectEnabled) {
    return null;
  }

  // Snap to nearest valid parking spot around blockers.
  const gap = 8;
  let best = null;
  const consider = (x, y) => {
    const p = clampWidgetPosToBounds(host, minX, w, h, x, y);
    const c = { x: p.x, y: p.y, w, h };
    if (overlapsAnyRect(c, others)) return;
    const dx = c.x - candidate.x;
    const dy = c.y - candidate.y;
    const score = dx * dx + dy * dy;
    if (!best || score < best.score) best = { x: c.x, y: c.y, score };
  };

  others.forEach((o) => {
    consider(o.x - w - gap, candidate.y);   // left
    consider(o.x + o.w + gap, candidate.y); // right
    consider(candidate.x, o.y - h - gap);   // above
    consider(candidate.x, o.y + o.h + gap); // below
    // Corner options help when dense.
    consider(o.x - w - gap, o.y - h - gap);
    consider(o.x + o.w + gap, o.y - h - gap);
    consider(o.x - w - gap, o.y + o.h + gap);
    consider(o.x + o.w + gap, o.y + o.h + gap);
  });

  if (!best) return null;
  return {
    x: best.x,
    y: best.y,
    snapped: true,
    rollDir: best.x < candidate.x ? -1 : 1
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
  const stored = clampMemoryFrameStoredPos(memoryFrameState.x, memoryFrameState.y);
  memoryFrameState.x = stored.x;
  memoryFrameState.y = stored.y;
  const next = resolveMemoryFrameRenderPos(memoryFrameState.x, memoryFrameState.y);
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
  refreshViewWidgetPalette();
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
  memoryFrameState.dragUseGravity = true;
  memoryFrameState.dragging = false;
  if (wrap) wrap.classList.remove("memory-meters--drag-armed", "memory-meters--dragging");
}

function armMemoryDragMode(useGravity) {
  const wrap = getMemoryFrameWrap();
  if (!wrap || !memoryFrameState.visible) return;
  memoryFrameState.dragArmed = true;
  memoryFrameState.dragUseGravity = (useGravity !== false);
  wrap.classList.add("memory-meters--drag-armed");
}

function disarmOverlayWidgetDrag(type) {
  const st = getOverlayWidgetState(type);
  const el = getOverlayWidgetEl(type);
  if (!st) return;
  st.dragArmed = false;
  st.dragUseGravity = true;
  st.dragging = false;
  if (el) el.classList.remove("widget--drag-armed", "widget--dragging");
}

function armOverlayWidgetDrag(type, useGravity) {
  const st = getOverlayWidgetState(type);
  const el = getOverlayWidgetEl(type);
  if (!st || !el || !st.visible) return;
  st.dragArmed = true;
  st.dragUseGravity = (useGravity !== false);
  el.classList.add("widget--drag-armed");
}

function openWidgetContextMenu(type, clientX, clientY) {
  closeMemoryContextMenu();
  const menu = document.createElement("div");
  menu.className = "memory-context-menu";
  menu.innerHTML = [
    '<button type="button" data-action="gravity-drag">🌍 gravityDrag</button>',
    '<button type="button" data-action="default">🏠 Default</button>',
    '<button type="button" data-action="delete">🗑 Delete</button>',
    '<button type="button" data-action="drag">✋ Drag</button>'
  ].join("");
  document.body.appendChild(menu);

  const maxLeft = Math.max(6, window.innerWidth - menu.offsetWidth - 6);
  const maxTop = Math.max(6, window.innerHeight - menu.offsetHeight - 6);
  menu.style.left = Math.max(6, Math.min(maxLeft, Math.round(clientX))) + "px";
  menu.style.top = Math.max(6, Math.min(maxTop, Math.round(clientY))) + "px";

  menu.addEventListener("click", (e) => {
    const action = e.target && e.target.getAttribute("data-action");
    if (!action) return;
    if (type === "indicators") {
      if (action === "gravity-drag") {
        armMemoryDragMode(true);
      } else if (action === "drag") {
        armMemoryDragMode(false);
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
    } else {
      const st = getOverlayWidgetState(type);
      if (!st) return;
      if (action === "gravity-drag") {
        armOverlayWidgetDrag(type, true);
      } else if (action === "drag") {
        armOverlayWidgetDrag(type, false);
      } else if (action === "default") {
        st.visible = true;
        const def = defaultOverlayWidgetPos(type);
        st.x = def.x;
        st.y = def.y;
        applyOverlayWidgetVisibility(type);
        applyUnifiedWidgetLayout(type, true, true);
        disarmOverlayWidgetDrag(type);
        persistAllWidgetStates(true);
      } else if (action === "delete") {
        st.visible = false;
        applyOverlayWidgetVisibility(type);
        disarmOverlayWidgetDrag(type);
        persistOverlayWidgetState(type, true);
      }
    }
    refreshViewWidgetPalette();
    closeMemoryContextMenu();
  });

  memoryFrameState.menuEl = menu;
}

function openMemoryContextMenu(clientX, clientY) {
  const wrap = getMemoryFrameWrap();
  if (!wrap || !memoryFrameState.visible) return;
  openWidgetContextMenu("indicators", clientX, clientY);
}

function placeWidgetFromDrop(type, clientX, clientY) {
  const host = getMemoryFrameHost();
  if (!host) return false;
  const hostRect = host.getBoundingClientRect();
  if (clientX < hostRect.left || clientX > hostRect.right || clientY < hostRect.top || clientY > hostRect.bottom) {
    return false;
  }

  if (type === "indicators") {
    const wrap = getMemoryFrameWrap();
    if (!wrap) return false;
    memoryFrameState.visible = true;
    memoryFrameState.x = clientX - hostRect.left - Math.round(wrap.offsetWidth / 2);
    memoryFrameState.y = clientY - hostRect.top - Math.round(wrap.offsetHeight / 2);
    applyMemoryFrameVisibility();
    const dropSafe = canPlaceAnchorWithoutOverlap("indicators", memoryFrameState.x, memoryFrameState.y);
    if (dropSafe) {
      memoryFrameState.x = dropSafe.x;
      memoryFrameState.y = dropSafe.y;
      const gravityPending = gravityEffectEnabled && shouldRunGravitySettle("indicators", memoryFrameState.x, memoryFrameState.y);
      memoryFrameState.pendingSettle = !!dropSafe.snapped || gravityPending;
      const supportState = getWidgetSupportState("indicators", memoryFrameState.x, memoryFrameState.y);
      memoryFrameState.pendingRoll = dropSafe.rollDir || supportState.rollDir || 1;
    }
    applyUnifiedWidgetLayout("indicators", false, true, { preserveOthers: true });
    if (memoryFrameState.pendingSettle && gravityEffectEnabled) {
      startWidgetFallSimulation("indicators", memoryFrameState.pendingRoll || 1);
      memoryFrameState.pendingSettle = false;
    } else {
      persistAllWidgetStates(true);
    }
    refreshViewWidgetPalette();
    return true;
  }

  const st = getOverlayWidgetState(type);
  const el = getOverlayWidgetEl(type);
  if (!st || !el) return false;
  st.visible = true;
  st.x = clientX - hostRect.left - Math.round(el.offsetWidth / 2);
  st.y = clientY - hostRect.top - Math.round(el.offsetHeight / 2);
  applyOverlayWidgetVisibility(type);
  const dropSafe = canPlaceAnchorWithoutOverlap(type, st.x, st.y);
  if (dropSafe) {
    st.x = dropSafe.x;
    st.y = dropSafe.y;
    const gravityPending = gravityEffectEnabled && shouldRunGravitySettle(type, st.x, st.y);
    st.pendingSettle = !!dropSafe.snapped || gravityPending;
    const supportState = getWidgetSupportState(type, st.x, st.y);
    st.pendingRoll = dropSafe.rollDir || supportState.rollDir || 1;
  }
  applyUnifiedWidgetLayout(type, false, true, { preserveOthers: true });
  if (st.pendingSettle && gravityEffectEnabled) {
    startWidgetFallSimulation(type, st.pendingRoll || 1);
    st.pendingSettle = false;
  } else {
    persistAllWidgetStates(true);
  }
  refreshViewWidgetPalette();
  return true;
}

function initOverlayWidgetFrame(type) {
  const st = getOverlayWidgetState(type);
  const el = getOverlayWidgetEl(type);
  const host = getMemoryFrameHost();
  if (!st || !el || !host || el.dataset.frameBound === "1") return;
  el.dataset.frameBound = "1";
  restoreOverlayWidgetStateFromLocal(type);

  const startDrag = (clientX, clientY) => {
    if (!st.dragArmed || !st.visible) return;
    const rect = el.getBoundingClientRect();
    st.dragging = true;
    el.classList.add("widget--dragging");
    st.dragOffsetX = clientX - rect.left;
    st.dragOffsetY = clientY - rect.top;
  };

  const moveDrag = (clientX, clientY) => {
    if (!st.dragging) return;
    const hostRect = host.getBoundingClientRect();
    const desiredX = clientX - hostRect.left - st.dragOffsetX;
    const desiredY = clientY - hostRect.top - st.dragOffsetY;
    const safe = canPlaceAnchorWithoutOverlap(type, desiredX, desiredY);
    if (!safe) return;
    st.x = safe.x;
    st.y = safe.y;
    const gravityPending = st.dragUseGravity && gravityEffectEnabled && shouldRunGravitySettle(type, st.x, st.y);
    st.pendingSettle = st.dragUseGravity ? (!!safe.snapped || gravityPending) : false;
    const supportState = getWidgetSupportState(type, st.x, st.y);
    st.pendingRoll = safe.rollDir || supportState.rollDir || 1;
    applyUnifiedWidgetLayout(type, false, true, { preserveOthers: true });
  };

  const endDrag = () => {
    if (!st.dragging) return;
    const useGravity = !!st.dragUseGravity;
    st.dragging = false;
    disarmOverlayWidgetDrag(type);
    if (useGravity && !st.pendingSettle && gravityEffectEnabled) {
      const gravityPending = shouldRunGravitySettle(type, st.x, st.y);
      if (gravityPending) {
        st.pendingSettle = true;
        const supportState = getWidgetSupportState(type, st.x, st.y);
        st.pendingRoll = supportState.rollDir || st.pendingRoll || 1;
      }
    }
    if (useGravity && st.pendingSettle && gravityEffectEnabled) {
      startWidgetFallSimulation(type, st.pendingRoll || 1);
      st.pendingSettle = false;
      return;
    }
    st.pendingSettle = false;
    persistAllWidgetStates(true);
    refreshViewWidgetPalette();
  };

  el.addEventListener("contextmenu", (e) => {
    if (!st.visible) return;
    e.preventDefault();
    openWidgetContextMenu(type, e.clientX, e.clientY);
  });

  el.addEventListener("mousedown", (e) => {
    if (e.button !== 0 || !st.dragArmed) return;
    e.preventDefault();
    e.stopPropagation();
    startDrag(e.clientX, e.clientY);
  }, true);
  window.addEventListener("mousemove", (e) => moveDrag(e.clientX, e.clientY));
  window.addEventListener("mouseup", endDrag);

  el.addEventListener("touchstart", (e) => {
    const touch = e.touches && e.touches[0];
    if (!touch) return;
    if (st.dragArmed) {
      e.preventDefault();
      startDrag(touch.clientX, touch.clientY);
      return;
    }
    clearMemoryLongPress();
    memoryFrameState.longPressTimer = setTimeout(() => {
      openWidgetContextMenu(type, touch.clientX, touch.clientY);
    }, 560);
  }, { passive: false });
  el.addEventListener("touchmove", (e) => {
    const touch = e.touches && e.touches[0];
    if (!touch) return;
    clearMemoryLongPress();
    if (!st.dragging) return;
    e.preventDefault();
    moveDrag(touch.clientX, touch.clientY);
  }, { passive: false });
  el.addEventListener("touchend", () => {
    clearMemoryLongPress();
    endDrag();
  });
  el.addEventListener("touchcancel", () => {
    clearMemoryLongPress();
    endDrag();
  });

  applyOverlayWidgetVisibility(type);
  applyOverlayWidgetPosition(type, false);
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
    const desiredX = clientX - hostRect.left - memoryFrameState.dragOffsetX;
    const desiredY = clientY - hostRect.top - memoryFrameState.dragOffsetY;
    const safe = canPlaceAnchorWithoutOverlap("indicators", desiredX, desiredY);
    if (!safe) return;
    memoryFrameState.x = safe.x;
    memoryFrameState.y = safe.y;
    const gravityPending = memoryFrameState.dragUseGravity && gravityEffectEnabled && shouldRunGravitySettle("indicators", memoryFrameState.x, memoryFrameState.y);
    memoryFrameState.pendingSettle = memoryFrameState.dragUseGravity ? (!!safe.snapped || gravityPending) : false;
    const supportState = getWidgetSupportState("indicators", memoryFrameState.x, memoryFrameState.y);
    memoryFrameState.pendingRoll = safe.rollDir || supportState.rollDir || 1;
    applyUnifiedWidgetLayout("indicators", false, true, { preserveOthers: true });
  };

  const endDrag = () => {
    if (!memoryFrameState.dragging) return;
    const useGravity = !!memoryFrameState.dragUseGravity;
    memoryFrameState.dragging = false;
    disarmMemoryDragMode();
    if (useGravity && !memoryFrameState.pendingSettle && gravityEffectEnabled) {
      const gravityPending = shouldRunGravitySettle("indicators", memoryFrameState.x, memoryFrameState.y);
      if (gravityPending) {
        memoryFrameState.pendingSettle = true;
        const supportState = getWidgetSupportState("indicators", memoryFrameState.x, memoryFrameState.y);
        memoryFrameState.pendingRoll = supportState.rollDir || memoryFrameState.pendingRoll || 1;
      }
    }
    if (useGravity && memoryFrameState.pendingSettle && gravityEffectEnabled) {
      startWidgetFallSimulation("indicators", memoryFrameState.pendingRoll || 1);
      memoryFrameState.pendingSettle = false;
      return;
    }
    memoryFrameState.pendingSettle = false;
    persistAllWidgetStates(true);
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
  window.addEventListener("resize", () => applyPanelAvoidanceLayout(false));

  if (!host.dataset.viewWidgetDropBound) {
    host.dataset.viewWidgetDropBound = "1";
    host.addEventListener("dragover", (e) => {
      const dt = e.dataTransfer;
      if (!dt) return;
      if (Array.from(dt.types || []).includes("application/x-miniexco-widget")) {
        e.preventDefault();
        dt.dropEffect = "move";
      }
    });
    host.addEventListener("drop", (e) => {
      const dt = e.dataTransfer;
      if (!dt) return;
      const type = dt.getData("application/x-miniexco-widget");
      if (!type) return;
      if (placeWidgetFromDrop(type, e.clientX, e.clientY)) e.preventDefault();
    });
  }
  if (!document.body.dataset.viewWidgetGlobalDropBound) {
    document.body.dataset.viewWidgetGlobalDropBound = "1";
    document.addEventListener("dragover", (e) => {
      const dt = e.dataTransfer;
      if (!dt) return;
      if (Array.from(dt.types || []).includes("application/x-miniexco-widget")) {
        e.preventDefault();
        dt.dropEffect = "move";
      }
    });
    document.addEventListener("drop", (e) => {
      const dt = e.dataTransfer;
      if (!dt) return;
      const type = dt.getData("application/x-miniexco-widget");
      if (!type) return;
      if (placeWidgetFromDrop(type, e.clientX, e.clientY)) {
        e.preventDefault();
      }
    });
  }

  applyMemoryFrameVisibility();
  applyMemoryFramePosition(false);
  initOverlayWidgetFrame("imu");
  initOverlayWidgetFrame("media");
  initOverlayWidgetFrame("path");
  initOverlayWidgetFrame("model");
  initViewWidgetPalette();
}

function refreshViewWidgetPalette() {
  syncGravityToggleUi();
  const widgets = Array.from(document.querySelectorAll(".view-widget[data-widget]"));
  widgets.forEach((widget) => {
    const type = widget.getAttribute("data-widget");
    let visible = true;
    if (type === "indicators") visible = memoryFrameState.visible;
    else {
      const st = getOverlayWidgetState(type);
      visible = st ? st.visible : true;
    }
    const enabled = !visible;
    widget.classList.toggle("view-widget--available", enabled);
    widget.classList.toggle("view-widget--disabled", !enabled);
    widget.setAttribute("draggable", enabled ? "true" : "false");
    const stateEl = widget.querySelector(".view-widget__state");
    if (stateEl) stateEl.textContent = enabled ? "Available" : "On Screen";
  });
  refreshViewWidgetMiniaturesSoon();
}

function initViewWidgetPalette() {
  syncGravityToggleUi();
  const widgets = Array.from(document.querySelectorAll(".view-widget[data-widget]"));
  widgets.forEach((widget) => {
    if (widget.dataset.bound === "1") return;
    widget.dataset.bound = "1";
    widget.addEventListener("dragstart", (e) => {
      const type = widget.getAttribute("data-widget");
      if (!type) return;
      let visible = true;
      if (type === "indicators") visible = memoryFrameState.visible;
      else {
        const st = getOverlayWidgetState(type);
        visible = st ? st.visible : true;
      }
      if (visible) {
        e.preventDefault();
        return;
      }
      const dt = e.dataTransfer;
      if (!dt) return;
      dt.effectAllowed = "move";
      dt.setData("application/x-miniexco-widget", type);
      dt.setData("text/plain", type);
    });
  });
  refreshViewWidgetPalette();
  refreshViewWidgetMiniaturesSoon();
}
window.initViewWidgetPalette = initViewWidgetPalette;

function sanitizeMiniClone(root) {
  if (!root) return;
  if (root.id) root.removeAttribute("id");
  root.classList.remove(
    "widget-hidden",
    "widget--drag-armed",
    "widget--dragging",
    "memory-meters-hidden",
    "memory-meters--drag-armed",
    "memory-meters--dragging"
  );
  root.removeAttribute("draggable");
  root.style.pointerEvents = "none";
  root.style.position = "static";
  root.style.left = "0";
  root.style.top = "0";
  root.style.right = "auto";
  root.style.bottom = "auto";
  root.style.margin = "0";
  root.style.zIndex = "1";

  const all = root.querySelectorAll("*");
  all.forEach((el) => {
    if (el.id) el.removeAttribute("id");
    el.removeAttribute("draggable");
    if (el.classList) {
      el.classList.remove(
        "widget-hidden",
        "widget--drag-armed",
        "widget--dragging",
        "memory-meters-hidden",
        "memory-meters--drag-armed",
        "memory-meters--dragging"
      );
    }
    el.style.pointerEvents = "none";
    el.style.userSelect = "none";
    el.tabIndex = -1;
  });
}

function replaceCanvasesWithImages(srcRoot, cloneRoot) {
  const srcCanvases = srcRoot ? srcRoot.querySelectorAll("canvas") : [];
  const cloneCanvases = cloneRoot ? cloneRoot.querySelectorAll("canvas") : [];
  const n = Math.min(srcCanvases.length, cloneCanvases.length);
  for (let i = 0; i < n; i++) {
    const src = srcCanvases[i];
    const cloneCanvas = cloneCanvases[i];
    try {
      const dataUrl = src.toDataURL("image/png");
      const img = document.createElement("img");
      img.src = dataUrl;
      img.alt = "";
      img.width = src.width || cloneCanvas.width || 0;
      img.height = src.height || cloneCanvas.height || 0;
      img.style.width = (src.width || cloneCanvas.width || 0) + "px";
      img.style.height = (src.height || cloneCanvas.height || 0) + "px";
      img.style.display = "block";
      cloneCanvas.replaceWith(img);
    } catch (_) {
      // Keep canvas clone if snapshot is unavailable.
    }
  }
}

function refreshViewWidgetMiniatures() {
  const viewTab = document.getElementById("viewTab");
  if (!viewTab || viewTab.style.display === "none") return;

  const widgets = Array.from(document.querySelectorAll(".view-widget[data-widget]"));
  widgets.forEach((card) => {
    const type = card.getAttribute("data-widget");
    const sourceId = viewWidgetSourceIds[type];
    const sourceEl = sourceId ? document.getElementById(sourceId) : null;
    const preview = card.querySelector(".view-widget__preview");
    if (!preview || !sourceEl) return;

    const srcRect = sourceEl.getBoundingClientRect();
    const srcW = Math.max(1, Math.round(srcRect.width || sourceEl.offsetWidth || 240));
    const srcH = Math.max(1, Math.round(srcRect.height || sourceEl.offsetHeight || 120));
    const scale = 0.5;
    const miniW = Math.max(120, Math.round(srcW * scale));
    const miniH = Math.max(68, Math.round(srcH * scale));

    const clone = sourceEl.cloneNode(true);
    sanitizeMiniClone(clone);
    replaceCanvasesWithImages(sourceEl, clone);
    clone.classList.add("view-widget__miniature-content");
    clone.style.width = srcW + "px";
    clone.style.maxWidth = srcW + "px";
    clone.style.transform = `scale(${scale})`;
    clone.style.transformOrigin = "top left";

    preview.innerHTML = "";
    const mini = document.createElement("div");
    mini.className = "view-widget__miniature";
    mini.style.width = miniW + "px";
    mini.style.height = miniH + "px";
    mini.appendChild(clone);
    preview.appendChild(mini);
  });
}
window.refreshViewWidgetMiniatures = refreshViewWidgetMiniatures;

function refreshViewWidgetMiniaturesSoon() {
  if (viewWidgetMiniRenderPending) return;
  viewWidgetMiniRenderPending = true;
  setTimeout(() => {
    viewWidgetMiniRenderPending = false;
    refreshViewWidgetMiniatures();
  }, 80);
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
  refreshViewWidgetPalette();
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
  refreshViewWidgetPalette();
};

function wireBatteryText() {
  const batteryText = document.getElementById("batteryText");
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
    if (typeof window.drawVoltageHistoryInPopup === "function") return true;

    let script = document.getElementById("batteryGraphJs");
    if (script) script.remove();

    return new Promise((resolve) => {
      script = document.createElement("script");
      script.id = "batteryGraphJs";
      script.src = "/batteryGraph.js?v=" + Date.now();
      script.addEventListener("load", () => {
        resolve(typeof window.drawVoltageHistoryInPopup === "function");
      }, { once: true });
      script.addEventListener("error", () => resolve(false), { once: true });
      document.body.appendChild(script);
    });
  }

  async function renderBatteryInlineGraph() {
    if (memoryUiState.batteryRenderPending) return;
    const graphRoot = document.getElementById("batteryPopupGraph");
    if (!graphRoot) return;
    memoryUiState.batteryRenderPending = true;

    if (!document.getElementById("uPlotCss")) {
      const link = document.createElement("link");
      link.id = "uPlotCss";
      link.rel = "stylesheet";
      link.href = "/uPlot.min.css";
      document.head.appendChild(link);
    }

    const uplotOk = await loadUPlotJs();
    if (!uplotOk) {
      showToast("Battery graph failed to load (uPlot).", "error");
      memoryUiState.batteryRenderPending = false;
      return;
    }

    const graphOk = await loadBatteryGraphScript();
    if (!graphOk) {
      showToast("Battery graph script failed to load.", "error");
      memoryUiState.batteryRenderPending = false;
      return;
    }

    try {
      await window.drawVoltageHistoryInPopup();
      memoryUiState.batteryRenderAt = Date.now();
      ensureMemoryFrameExpandedPanelVisible();
    } finally {
      memoryUiState.batteryRenderPending = false;
    }
  }
  window.renderBatteryInlineGraph = renderBatteryInlineGraph;

}
