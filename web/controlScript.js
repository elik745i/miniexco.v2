let keyMap = {};  // Dynamic key-to-action map

const UI_TO_FW = {
  forward:"forward", backward:"backward", left:"left", right:"right",
  stop:"stop",
  armUp:"arm_up", armDown:"arm_down",
  bucketUp:"bucket_up", bucketDown:"bucket_down",
  auxUp:"aux_up", auxDown:"aux_down",
  led:"light_toggle", beacon:"beacon",
  emergency:"emergency",            // <- was "emergency_toggle"
  horn:"horn"
};

const FW_TO_UI = Object.fromEntries(Object.entries(UI_TO_FW).map(([ui, fw]) => [fw, ui]));

// Reuse UI_TO_FW from the keyboard section.
// (UI action -> firmware action name)
const UI_TO_FW_JOY = UI_TO_FW;

// A friendly catalog of joystick inputs.
// Values are the tokens the backend will store (e.g., "DPAD_UP", "A", "R1", etc.)
const JOY_BUTTONS = [
  // Face buttons
  { val: "A", label: "A" },
  { val: "B", label: "B" },
  { val: "X", label: "X" },
  { val: "Y", label: "Y" },

  // Bumpers / triggers (digital clicks for triggers)
  { val: "L1", label: "LB / L1" },
  { val: "R1", label: "RB / R1" },
  { val: "L2_CLICK", label: "LT (click)" },
  { val: "R2_CLICK", label: "RT (click)" },

  // Sticks (clicks) + optional digital directions
  { val: "L3", label: "Left Stick Click (L3)" },
  { val: "R3", label: "Right Stick Click (R3)" },
  { val: "LS_UP", label: "Left Stick Up" },
  { val: "LS_DOWN", label: "Left Stick Down" },
  { val: "LS_LEFT", label: "Left Stick Left" },
  { val: "LS_RIGHT", label: "Left Stick Right" },
  { val: "RS_UP", label: "Right Stick Up" },
  { val: "RS_DOWN", label: "Right Stick Down" },
  { val: "RS_LEFT", label: "Right Stick Left" },
  { val: "RS_RIGHT", label: "Right Stick Right" },

  // D-Pad
  { val: "DPAD_UP", label: "D-Pad Up" },
  { val: "DPAD_DOWN", label: "D-Pad Down" },
  { val: "DPAD_LEFT", label: "D-Pad Left" },
  { val: "DPAD_RIGHT", label: "D-Pad Right" },

  // Menu buttons
  { val: "BTN_START", label: "Start / Menu" },
  { val: "BTN_BACK", label: "Back / Select" },
];

// Simple default layout (matches what we discussed earlier)
const JOY_DEFAULTS = {
  forward: "DPAD_UP",
  backward: "DPAD_DOWN",
  left: "DPAD_LEFT",
  right: "DPAD_RIGHT",
  stop: "BTN_BACK",

  armUp: "LS_UP",
  armDown: "LS_DOWN",
  bucketUp: "R1",
  bucketDown: "L1",
  auxUp: "R2_CLICK",
  auxDown: "L2_CLICK",

  led: "X",
  beacon: "Y",
  emergency: "B",
  horn: "A",
};

// List of UI actions a button can perform (for button-centric UI)
const JOY_ACTIONS = [
  { val: "forward",   label: "Forward" },
  { val: "backward",  label: "Backward" },
  { val: "left",      label: "Left" },
  { val: "right",     label: "Right" },
  { val: "stop",      label: "Stop" },
  { val: "armUp",     label: "Arm Up" },
  { val: "armDown",   label: "Arm Down" },
  { val: "bucketUp",  label: "Bucket Up" },
  { val: "bucketDown",label: "Bucket Down" },
  { val: "auxUp",     label: "AUX Up" },
  { val: "auxDown",   label: "AUX Down" },
  { val: "led",       label: "LED Toggle" },
  { val: "beacon",    label: "Beacon Toggle" },
  { val: "emergency", label: "Emergency Toggle" },
  { val: "horn",      label: "Horn" },
];

function uiKeyToWire(k) {
  if (k === " ") return " ";
  // ArrowUp -> arrowup (backend stores lowercase)
  if (k.startsWith("Arrow")) return k.toLowerCase();
  return k.length === 1 ? k.toLowerCase() : k;
}
function wireKeyToUi(k) {
  if (k === " ") return " ";
  if (k.startsWith("arrow")) {
    const tail = k.slice(5);                    // "up" | "down" | "left" | "right"
    return "Arrow" + tail.charAt(0).toUpperCase() + tail.slice(1);
  }
  return k;
}

const allKeys = [
  " ", "w", "a", "s", "d", "u", "j", "i", "k", "l", "b", "e",
  "q", "z", "x", "c", "v", "n", "m", "h",
  "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"
];

// --- WS proxy so legacy `ws.send(...)` never throws ---
(function () {
  // Queue for early sends
  window._wsQueue = window._wsQueue || [];

  // Create the socket on demand (single instance)
  window.ensureCarSocket = window.ensureCarSocket || function () {
    if (window.wsCarInput && window.wsCarInput.readyState <= 1) return window.wsCarInput;
    const s = new WebSocket(`ws://${location.host}/CarInput`);
    window.wsCarInput = s;
    window.websocketCarInput = s; // legacy alias
    s.addEventListener("open", () => {
      // flush anything queued before open
      const q = window._wsQueue.splice(0);
      q.forEach(m => s.send(m));
      window.dispatchEvent(new Event("car-socket-ready"));
    });
    return s;
  };

  // Global `ws` object that forwards to the live socket
  // Use a proxy-like object so `ws.send()` is always defined.
  window.ws = {
    send(msg) {
      const s = window.wsCarInput || window.websocketCarInput || window.ensureCarSocket();
      if (!s) return console.warn("car socket not available; dropped:", msg);
      if (s.readyState === WebSocket.OPEN) return s.send(msg);
      // Not open yet → queue and flush on open
      window._wsQueue.push(msg);
      const onOpen = () => { 
        const q = window._wsQueue.splice(0); 
        q.forEach(m => s.send(m)); 
        s.removeEventListener("open", onOpen); 
      };
      s.addEventListener("open", onOpen, { once: true });
    }
  };
})();


document.addEventListener("DOMContentLoaded", () => {
  loadKeyMappings();
  setupKeyInputValidation();
});

// 🧪 DEBUG: log every key pressed
document.addEventListener("keydown", e => console.log("Key pressed:", e.key));

// Map between UI tokens and stored/normalized keys
function uiToKey(v) {
  if (!v) return " ";
  if (v === "Space") return " ";
  if (v.startsWith("Arrow")) return v.toLowerCase();   // ArrowUp -> arrowup
  return v.length === 1 ? v.toLowerCase() : v;          // Letters -> lowercase
}
function keyToUI(k) {
  if (!k) return "Space";
  if (k === " ") return "Space";
  if (k.startsWith("arrow")) {
    const tail = k.slice(5);
    return "Arrow" + tail.charAt(0).toUpperCase() + tail.slice(1);
  }
  return k;
}

function controlsTabKeydown(e) {
  // Only active while the settings modal is open
  if (!window.isModalOpen || !window.isModalOpen()) return;

  // (Optional) keep preventDefault so arrows/space don't scroll the modal
  let key = e.key;
  if (key.length === 1) key = key.toLowerCase();
  if (["arrowup","arrowdown","arrowleft","arrowright"," "].includes(key)) {
    e.preventDefault();
  }

  // We intentionally DO NOT send any robot commands from here.
  // This script is for mapping UI only.
}

// Attach when the file loads
document.addEventListener("keydown", controlsTabKeydown);

// Make sure it’s removed when the modal closes (commonScript calls this)
window.onunloadModal = function () {
  document.removeEventListener("keydown", controlsTabKeydown);
};

function populateKeyDropdowns() {
  const selects = document.querySelectorAll("#keyMappingInputs select");
  selects.forEach(select => {
    select.innerHTML = "";
    allKeys.forEach(key => {
      const option = document.createElement("option");
      option.value = key;
      option.textContent = key === " " ? "Space" : key;
      select.appendChild(option);
    });
  });
}

function loadKeyMappings() {
  populateKeyDropdowns();
  fetch("/get_keymap")
    .then(res => res.json())
		.then(map => {
			keyMap = {};
			Object.entries(map).forEach(([fwAction, key]) => {
				const uiAction = FW_TO_UI[fwAction] || fwAction;     // snake_case -> camelCase
				const select = document.querySelector(`select[data-action="${uiAction}"]`);
				if (select) select.value = wireKeyToUi(key);          // arrowup -> ArrowUp
				keyMap[uiKeyToWire(key)] = uiAction;                  // keep keyMap normalized
			});
			console.log("Keymap loaded:", keyMap);
		});
}



function saveKeyMappings() {
	const selects = document.querySelectorAll("#keyMappingInputs select");
	const tempMap = {};
	let hasDuplicate = false;

	selects.forEach(select => {
		const ui = select.value.trim();
		const norm = uiToKey(ui);                  // normalize (space/arrow/letters → stored form)
		const action = select.dataset.action;
		const warn = select.nextElementSibling;
		warn.textContent = "";
		warn.style.color = "";

		if (!norm) return;
		if (tempMap[norm]) {
			warn.textContent = "⚠️ Duplicate";
			warn.style.color = "red";
			hasDuplicate = true;
		} else {
			tempMap[norm] = action;                  // use normalized key as the map key
		}
	});

  if (hasDuplicate) {
    document.getElementById("keySaveStatus").textContent = "Fix duplicates first!";
    document.getElementById("keySaveStatus").style.color = "red";
    return;
  }

	// Convert { normalizedKey: action } → { action: normalizedKey }
	const finalMap = {};
	Object.entries(tempMap).forEach(([key, action]) => {
		const fw = UI_TO_FW[action] || action;
		finalMap[fw] = uiKeyToWire(key);
	});

	fetch("/set_keymap", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(finalMap)
	})
		.then(res => res.text())
		.then(msg => {
			document.getElementById("keySaveStatus").textContent = "✔️ Saved!";
			document.getElementById("keySaveStatus").style.color = "lightgreen";
			loadKeyMappings();                         // repaint the dropdowns
			if (window.refreshRuntimeKeymap) window.refreshRuntimeKeymap(); // <-- add this
		});

}


function setupKeyInputValidation() {
  const selects = document.querySelectorAll("#keyMappingInputs select");

  selects.forEach(select => {
    select.addEventListener("change", () => {
      const seen = {};
      selects.forEach(sel => {
        const key = uiToKey(sel.value.trim());  // ✅ Preserve casing for correct duplicate detection
        const warn = sel.nextElementSibling;
        warn.textContent = "";
        warn.style.color = "";

        if (key && seen[key]) {
          warn.textContent = "⚠️ Duplicate";
          warn.style.color = "red";
        } else {
          seen[key] = true;
        }
      });
    });
  });
}


function resetToDefaultKeymap() {
  const defaultMap = {
    forward: "w",
    backward: "s",
    left: "a",
    right: "d",
    stop: " ",
    armUp: "n",
    armDown: "m",    
    bucketUp: "u",
    bucketDown: "j",
    auxUp: "i",
    auxDown: "k",
    led: "l",
    beacon: "b",
    emergency: "e",
		horn: "h"
  };

  const selects = document.querySelectorAll("#keyMappingInputs select");
  selects.forEach(select => {
    const action = select.dataset.action;
    if (defaultMap[action] !== undefined) {
      select.value = defaultMap[action];
    }
  });

  document.getElementById("keySaveStatus").textContent = "Default keys loaded. Click Save to apply.";
  document.getElementById("keySaveStatus").style.color = "orange";
}


// Fill joystick dropdowns depending on markup:
//  - if select has data-btn => OPTIONS = actions (button -> action)
//  - else                   => OPTIONS = buttons (action -> button)  [kept for compatibility]
function populateJoyDropdowns() {
  const root = document.getElementById("joyMappingInputs");
  if (!root) return;

  root.querySelectorAll("select").forEach(sel => {
    sel.innerHTML = "";
    const isButtonCentric = !!sel.dataset.btn;

    // For button-centric UI (each select = a physical button) we choose an ACTION.
    // Offer a "(none)" to leave a button unassigned.
    const OPTIONS = isButtonCentric
      ? [{ val: "", label: "(none)" }, ...JOY_ACTIONS]
      : JOY_BUTTONS;

    OPTIONS.forEach(o => {
      const opt = document.createElement("option");
      opt.value = o.val;
      opt.textContent = o.label;
      sel.appendChild(opt);
    });
  });
}


// Paint values from backend (if available) or defaults.
// Backend format is action->button (firmware names).
function loadJoyMappings() {
  populateJoyDropdowns();
  const root = document.getElementById("joyMappingInputs");
  if (!root) return;

  fetch("/get_joymap")
    .then(r => {
      if (!r.ok) throw new Error("no joymap endpoint");
      return r.json();
    })
    .then(map => {
      // map: { fwAction: "BUTTON" }
      // Build UI action -> button
      const a2b = {};
      Object.entries(map).forEach(([fwAction, btn]) => {
        const uiAction = FW_TO_UI[fwAction] || fwAction;
        a2b[uiAction] = btn;
      });

      // If button-centric, set each button select to the action that claims it.
      // If action-centric, set each action select to its button.
      root.querySelectorAll("select").forEach(sel => {
        const btnName = sel.dataset.btn;           // e.g. "X" if button-centric
        const uiAction = sel.dataset.joy || sel.dataset.action;

        if (btnName) {
          // Find which action uses this button
          const match = Object.entries(a2b).find(([, b]) => b === btnName);
          sel.value = match ? match[0] : "";
        } else if (uiAction) {
          // Old style: choose the button for this action
          sel.value = a2b[uiAction] || "";
        }
      });
      console.log("Joymap loaded:", map);
    })
    .catch(() => {
      // Defaults (action -> button)
      const defaults = { ...JOY_DEFAULTS };

      root.querySelectorAll("select").forEach(sel => {
        const btnName = sel.dataset.btn;
        const uiAction = sel.dataset.joy || sel.dataset.action;

        if (btnName) {
          // Which action uses this button in defaults?
          const match = Object.entries(defaults).find(([, b]) => b === btnName);
          sel.value = match ? match[0] : "";
        } else if (uiAction) {
          sel.value = defaults[uiAction] || "";
        }
      });
      console.log("Joymap endpoint not found; painted defaults.");
    });
}

// Show “duplicate action” warnings for button-centric UI
function setupJoyValidationJoy() {
  const root = document.getElementById("joyMappingInputs");
  if (!root) return;

  // Only validate the button-centric selects
  const selects = root.querySelectorAll('select[data-btn]');
  const status  = document.getElementById("joySaveStatus");

  const repaint = () => {
    const seen = {};
    let dup = false;

    selects.forEach(sel => {
      const warn = sel.nextElementSibling;
      if (warn && warn.classList.contains("dupWarn")) {
        warn.textContent = "";
        warn.style.color = "";
      }

      const chosenAction = (sel.value || "").trim(); // action name (or "")
      if (!chosenAction) return;                     // ignore (none)

      if (seen[chosenAction]) {
        dup = true;
        if (warn) { warn.textContent = "⚠️ Duplicate"; warn.style.color = "red"; }
      } else {
        seen[chosenAction] = true;
      }
    });

    if (status) {
      status.textContent = dup ? "Fix duplicates first!" : "";
      status.style.color = dup ? "red" : "";
    }
    return !dup;
  };

  selects.forEach(sel => sel.addEventListener("change", repaint));
  repaint();
}


// Build payload and POST to backend.
// We always send backend format: { fwAction: "BUTTON" }.
function saveJoyMappings() {
  const root = document.getElementById("joyMappingInputs");
  if (!root) return;
  const status = document.getElementById("joySaveStatus");

  // Button-centric form: each select has data-btn="X|A|…", and value is an ACTION
  const buttonSelects = root.querySelectorAll("select[data-btn]");
  const actionSelects = root.querySelectorAll("select[data-joy], select[data-action]");

  const out = {};

  if (buttonSelects.length) {
    // Validate (no duplicate actions)
    const seen = {};
    for (const sel of buttonSelects) {
      const act = (sel.value || "").trim();
      const warn = sel.nextElementSibling;
      if (warn && warn.classList.contains("dupWarn")) { warn.textContent = ""; warn.style.color = ""; }
      if (act) {
        if (seen[act]) { if (warn) { warn.textContent = "⚠️ Duplicate"; warn.style.color = "red"; } if (status) { status.textContent = "Fix duplicates first!"; status.style.color = "red"; } return; }
        seen[act] = true;
        const fw = UI_TO_FW_JOY[act] || act;            // action -> fw name
        out[fw] = sel.dataset.btn;                      // set that action to this BUTTON
      }
    }
  } else if (actionSelects.length) {
    // Old action-centric UI (kept for compatibility)
    actionSelects.forEach(sel => {
      const act = sel.dataset.joy || sel.dataset.action;
      const fw  = UI_TO_FW_JOY[act] || act;
      out[fw]   = sel.value;
    });
  }

  fetch("/set_joymap", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(out),
  })
    .then(r => r.text())
    .then(() => {
      if (status) { status.textContent = "✔️ Saved!"; status.style.color = "lightgreen"; }
      if (window.ws && typeof window.ws.send === "function") {
        try { window.ws.send(JSON.stringify({ t: "joymap_refresh" })); } catch {}
      }
      loadJoyMappings();
    })
    .catch(() => {
      if (status) { status.textContent = "❌ Save failed"; status.style.color = "red"; }
    });
}

function resetToDefaultJoymap() {
  const root = document.getElementById("joyMappingInputs");
  if (!root) return;

  const status = document.getElementById("joySaveStatus");

  const btnSelects = root.querySelectorAll("select[data-btn]");
  if (btnSelects.length) {
    // Invert JOY_DEFAULTS (action -> button) to button -> action
    const b2a = {};
    Object.entries(JOY_DEFAULTS).forEach(([act, btn]) => { b2a[btn] = act; });
    btnSelects.forEach(sel => { sel.value = b2a[sel.dataset.btn] || ""; });
  } else {
    // Old action-centric
    Object.entries(JOY_DEFAULTS).forEach(([act, btn]) => {
      const sel =
        root.querySelector(`select[data-joy="${act}"]`) ||
        root.querySelector(`select[data-action="${act}"]`);
      if (sel) sel.value = btn;
    });
  }

  if (status) { status.textContent = "Default joystick map loaded. Click Save to apply."; status.style.color = "orange"; }
}

// Expose to HTML buttons
window.loadJoyMappings = loadJoyMappings;
window.saveJoyMappings = saveJoyMappings;
window.resetToDefaultJoymap = resetToDefaultJoymap;

// Auto-init when the DOM has the joystick pane
document.addEventListener("DOMContentLoaded", () => {
  if (document.getElementById("joyMappingInputs")) {
    loadJoyMappings();
    setupJoyValidationJoy();
  }
});

// Optional helper the modal can call when the sub-tab is shown
window.initJoystickSubtab = function () {
  loadJoyMappings();
  setupJoyValidationJoy();
};

function syncGamepadToggle(enabled) {
  const sw = document.getElementById("gamepadToggle");
  if (sw) {
    sw.checked = !!enabled;
  }
}

function initGamepadSwitch() {
  const sw = document.getElementById("gamepadToggle");
  if (!sw) return;

  const applyState = (next) => {
    const enabled = !!next;
    window.cachedGamepadEnabled = enabled;
    if (typeof window.handleGamepadUiState === "function") {
      window.handleGamepadUiState(enabled);
    } else {
      syncGamepadToggle(enabled);
    }
  };

  if (typeof window.cachedGamepadEnabled === "boolean") {
    applyState(window.cachedGamepadEnabled);
  } else {
    fetch("/getsettings")
      .then(r => r.json())
      .then(s => {
        const raw = ("BluepadEnabled" in s)
          ? s.BluepadEnabled
          : (("GamepadEnabled" in s) ? s.GamepadEnabled : 0);
        applyState(Number(raw) === 1);
      })
      .catch(() => {
        syncGamepadToggle(false);
      });
  }

  if (!sw.dataset.boundGamepad) {
    sw.dataset.boundGamepad = "1";
    sw.addEventListener("change", () => {
      const nextState = !!sw.checked;
      applyState(nextState);
      if (typeof sendButtonInput === "function") {
        sendButtonInput("GamepadEnabled", nextState ? 1 : 0);
      } else if (window.ws && typeof window.ws.send === "function") {
        window.ws.send(`GamepadEnabled,${nextState ? 1 : 0}`);
      }
    });
  }
}

window.handleGamepadUiState = function(enabled) {
  syncGamepadToggle(enabled);
};
