// --- ROBOT CONFIG TAB LOGIC ---

const MODEL_AXIS_IDS = { x: "modelRotX", y: "modelRotY", z: "modelRotZ" };
const MODEL_AXIS_KEYS = { x: "ModelRotX", y: "ModelRotY", z: "ModelRotZ" };
const MODEL_AXIS_MAP_IDS = { x: "modelAxisSelectX", y: "modelAxisSelectY", z: "modelAxisSelectZ" };
const MODEL_AXIS_MAP_KEYS = { x: "ModelAxisX", y: "ModelAxisY", z: "ModelAxisZ" };
const MODEL_AXIS_CHOICES = ["x", "y", "z"];
const MODEL_AXIS_CODE = { x: 0, y: 1, z: 2 };
const MODEL_AXIS_FROM_CODE = { 0: "x", 1: "y", 2: "z" };
const MODEL_DIR_IDS = {
	x: { cw: "modelDirXcw", ccw: "modelDirXccw" },
	y: { cw: "modelDirYcw", ccw: "modelDirYccw" },
	z: { cw: "modelDirZcw", ccw: "modelDirZccw" }
};
const MODEL_DIR_KEYS = { x: "ModelDirX", y: "ModelDirY", z: "ModelDirZ" };

const GPIO_PIN_MIN = -1;
const GPIO_PIN_MAX = 48;
const GPIO_SELECT_PREFIX = "gpioField-";
const GPIO_FIELD_GROUPS = [
	{
		name: "Drive Motors",
		rows: [
			{ key: "RightMotorIn1", label: "Right Motor IN1" },
			{ key: "RightMotorIn2", label: "Right Motor IN2" },
			{ key: "LeftMotorIn1", label: "Left Motor IN1" },
			{ key: "LeftMotorIn2", label: "Left Motor IN2" },
			{ key: "ArmMotorIn1", label: "Arm Motor IN1" },
			{ key: "ArmMotorIn2", label: "Arm Motor IN2" }
		]
	},
	{
		name: "Servos",
		rows: [
			{ key: "BucketServo", label: "Bucket Servo" },
			{ key: "AuxServo", label: "Aux Servo" }
		]
	},
	{
		name: "Lighting",
		rows: [
			{ key: "LedStrip", label: "Neopixel Strip" }
		]
	},
	{
		name: "I2S Microphone",
		rows: [
			{ key: "I2SMicWS", label: "WS (LRCLK)" },
			{ key: "I2SMicSD", label: "SD (DATA)" },
			{ key: "I2SMicSCK", label: "SCK (BCK)" }
		]
	},
	{
		name: "I2S Speaker",
		rows: [
			{ key: "I2SSpkBCLK", label: "BCLK" },
			{ key: "I2SSpkLRCK", label: "LRCK" },
			{ key: "I2SSpkSD", label: "SD (DATA)" },
			{ key: "I2SSpkPA", label: "PA Enable" }
		]
	},
	{
		name: "SD Card (SPI)",
		rows: [
			{ key: "SdCS", label: "CS" },
			{ key: "SdSCK", label: "SCK" },
			{ key: "SdMOSI", label: "MOSI" },
			{ key: "SdMISO", label: "MISO" }
		]
	},
	{
		name: "IMU / I2C",
		rows: [
			{ key: "I2CSDA", label: "SDA" },
			{ key: "I2CSCL", label: "SCL" }
		]
	},
	{
		name: "Camera",
		rows: [
			{ key: "CamPWDN", label: "PWDN" },
			{ key: "CamRESET", label: "RESET" },
			{ key: "CamXCLK", label: "XCLK" },
			{ key: "CamSIOD", label: "SIOD" },
			{ key: "CamSIOC", label: "SIOC" },
			{ key: "CamY9", label: "Y9" },
			{ key: "CamY8", label: "Y8" },
			{ key: "CamY7", label: "Y7" },
			{ key: "CamY6", label: "Y6" },
			{ key: "CamY5", label: "Y5" },
			{ key: "CamY4", label: "Y4" },
			{ key: "CamY3", label: "Y3" },
			{ key: "CamY2", label: "Y2" },
			{ key: "CamVSYNC", label: "VSYNC" },
			{ key: "CamHREF", label: "HREF" },
			{ key: "CamPCLK", label: "PCLK" }
		]
	}
];

let gpioTableBuilt = false;

function ensureGpioCache() {
	if (!window.cachedGpioConfig || typeof window.cachedGpioConfig !== "object") {
		window.cachedGpioConfig = {};
	}
}

function gpioOptionValues() {
	const values = [];
	for (let pin = GPIO_PIN_MIN; pin <= GPIO_PIN_MAX; pin++) {
		values.push(pin);
	}
	return values;
}

function formatGpioLabel(value) {
	if (value === -1) {
		return "-1 (Disabled)";
	}
	return `GPIO ${value}`;
}

function buildGpioConfigTable() {
	const table = document.getElementById("gpioConfigTable");
	if (!table) {
		gpioTableBuilt = false;
		return;
	}
	const tbody = table.querySelector("tbody");
	if (!tbody) {
		gpioTableBuilt = false;
		return;
	}

	// Rebuild when modal DOM is re-created (tbody comes back empty).
	if (gpioTableBuilt && tbody.children.length > 0) return;

	const values = gpioOptionValues();
	const frag = document.createDocumentFragment();

	GPIO_FIELD_GROUPS.forEach(group => {
		group.rows.forEach((row, index) => {
			const tr = document.createElement("tr");
			tr.dataset.gpioKey = row.key;

			const subsystemTd = document.createElement("td");
			subsystemTd.textContent = group.name;
			tr.appendChild(subsystemTd);

			const signalTd = document.createElement("td");
			signalTd.textContent = row.label;
			tr.appendChild(signalTd);

			const selectTd = document.createElement("td");
			const select = document.createElement("select");
			select.id = `${GPIO_SELECT_PREFIX}${row.key}`;
			select.dataset.gpioKey = row.key;

			values.forEach(val => {
				const option = document.createElement("option");
				option.value = String(val);
				option.textContent = formatGpioLabel(val);
				select.appendChild(option);
			});

			select.addEventListener("change", () => {
				ensureGpioCache();
				const num = parseInt(select.value, 10);
				window.cachedGpioConfig[row.key] = Number.isNaN(num) ? GPIO_PIN_MIN : num;
				updateGpioConflictHighlights();
			});

			selectTd.appendChild(select);
			tr.appendChild(selectTd);
			frag.appendChild(tr);
		});
	});

	tbody.innerHTML = "";
	tbody.appendChild(frag);
	gpioTableBuilt = true;
	paintGpioConfigTable();
	updateGpioConflictHighlights();
}

function paintGpioConfigTable() {
	ensureGpioCache();
	if (!gpioTableBuilt) return;
	GPIO_FIELD_GROUPS.forEach(group => {
		group.rows.forEach(row => {
			const select = document.getElementById(`${GPIO_SELECT_PREFIX}${row.key}`);
			if (!select) return;
			let value;
			if (Object.prototype.hasOwnProperty.call(window.cachedGpioConfig, row.key)) {
				value = String(window.cachedGpioConfig[row.key]);
			} else if (select.options.length > 0) {
				value = select.options[0].value;
			}
			if (typeof value !== "undefined") {
				select.value = value;
			}
		});
	});
}

function gatherGpioConfig() {
	ensureGpioCache();
	const snapshot = {};
	GPIO_FIELD_GROUPS.forEach(group => {
		group.rows.forEach(row => {
			const select = document.getElementById(`${GPIO_SELECT_PREFIX}${row.key}`);
			if (select) {
				const num = parseInt(select.value, 10);
				snapshot[row.key] = Number.isNaN(num) ? GPIO_PIN_MIN : num;
			} else if (window.cachedGpioConfig.hasOwnProperty(row.key)) {
				snapshot[row.key] = window.cachedGpioConfig[row.key];
			} else {
				snapshot[row.key] = GPIO_PIN_MIN;
			}
		});
	});
	return snapshot;
}

function findGpioConflicts(config) {
	const seen = new Map();
	const conflicts = new Set();
	Object.entries(config || {}).forEach(([key, value]) => {
		const num = Number(value);
		if (Number.isNaN(num) || num < 0) return;
		if (!seen.has(num)) {
			seen.set(num, []);
		}
		const arr = seen.get(num);
		arr.push(key);
	});
	seen.forEach((keys) => {
		if (keys.length > 1) {
			keys.forEach(k => conflicts.add(k));
		}
	});
	return conflicts;
}

function updateGpioConflictHighlights() {
	if (!gpioTableBuilt) return;
	const config = gatherGpioConfig();
	const conflicts = findGpioConflicts(config);
	GPIO_FIELD_GROUPS.forEach(group => {
		group.rows.forEach(row => {
			const select = document.getElementById(`${GPIO_SELECT_PREFIX}${row.key}`);
			const rowEl = select ? select.closest("tr") : null;
			if (!select || !rowEl) return;
			if (conflicts.has(row.key)) {
				select.classList.add("conflict");
				rowEl.classList.add("gpio-conflict-row");
			} else {
				select.classList.remove("conflict");
				rowEl.classList.remove("gpio-conflict-row");
			}
		});
	});
	return conflicts;
}

window.applyGpioConfigSnapshot = function(snapshot) {
	ensureGpioCache();
	if (!snapshot || typeof snapshot !== "object") return;
	Object.entries(snapshot).forEach(([key, value]) => {
		const num = Number(value);
		if (!Number.isNaN(num)) {
			window.cachedGpioConfig[key] = num;
		}
	});
	paintGpioConfigTable();
	updateGpioConflictHighlights();
};

window.cachedModelOrientation = window.cachedModelOrientation || { x: 0, y: 0, z: 0 };
window.cachedModelOrientationDir = window.cachedModelOrientationDir || { x: 1, y: 1, z: 1 };
window.cachedModelAxisMap = window.cachedModelAxisMap || { x: "x", y: "y", z: "z" };
window.cachedGpioConfig = window.cachedGpioConfig || {};
window.cachedTelemetryMaxKB = window.cachedTelemetryMaxKB || 2048;
window.cachedSerialLogRateMs = window.cachedSerialLogRateMs || 40;
window.cachedSerialLogKeepLines = window.cachedSerialLogKeepLines || 200;

function sanitizeTelemetryMaxKB(raw) {
	let n = parseInt(raw, 10);
	if (Number.isNaN(n)) n = 2048;
	if (n < 128) n = 128;
	if (n > 10240) n = 10240;
	return n;
}

function sanitizeSerialLogRateMs(raw) {
	let n = parseInt(raw, 10);
	if (Number.isNaN(n)) n = 40;
	const allowed = [0, 20, 40, 80, 120, 200, 500];
	if (!allowed.includes(n)) n = 40;
	return n;
}

function sanitizeSerialLogKeepLines(raw) {
	let n = parseInt(raw, 10);
	if (Number.isNaN(n)) n = 200;
	if (n < 50) n = 50;
	if (n > 600) n = 600;
	return n;
}

function refreshRobotConfigFromBackend() {
	try {
		fetch('/getsettings').then(r => r.json()).then(data => {
			if (typeof data.darkMode !== 'undefined') {
				const darkToggle = document.getElementById("darkToggle");
				if (darkToggle) darkToggle.checked = (data.darkMode == 1);
			}
			if (typeof data.horizontalScreen !== 'undefined') {
				const horizontalToggle = document.getElementById("horizontalToggle");
				if (horizontalToggle) horizontalToggle.checked = (data.horizontalScreen == 1);
			}
			if (typeof data.holdBucket !== 'undefined') {
				const holdBucketToggle = document.getElementById("holdBucketToggle");
				if (holdBucketToggle) holdBucketToggle.checked = (data.holdBucket == 1);
			}
			if (typeof data.holdAux !== 'undefined') {
				const holdAuxToggle = document.getElementById("holdAuxToggle");
				if (holdAuxToggle) holdAuxToggle.checked = (data.holdAux == 1);
			}
			if (typeof data.RecordTelemetry !== 'undefined') {
				const recordTelemetryToggle = document.getElementById("recordTelemetryToggle");
				if (recordTelemetryToggle) recordTelemetryToggle.checked = (data.RecordTelemetry == 1);
			}
			if (typeof data.SystemSounds !== 'undefined') {
				window.cachedSystemSounds = (data.SystemSounds == 1);
			}
			if (typeof data.SystemVolume !== 'undefined') {
				window.cachedSystemVolume = data.SystemVolume;
			}
			if (typeof data.WsRebootOnDisconnect !== 'undefined') {
				window.cachedWsRebootOnDisconnect = (data.WsRebootOnDisconnect == 1);
				const wsRebootToggle = document.getElementById("wsRebootOnDisconnectToggle");
				if (wsRebootToggle) wsRebootToggle.checked = window.cachedWsRebootOnDisconnect;
			}
			if (typeof data.SerialLogRateMs !== 'undefined') {
				window.cachedSerialLogRateMs = sanitizeSerialLogRateMs(data.SerialLogRateMs);
				const serialLogRateSelect = document.getElementById("serialLogRateMs");
				if (serialLogRateSelect) serialLogRateSelect.value = String(window.cachedSerialLogRateMs);
			}
			if (typeof data.SerialLogKeepLines !== 'undefined') {
				window.cachedSerialLogKeepLines = sanitizeSerialLogKeepLines(data.SerialLogKeepLines);
				const serialLogKeepInput = document.getElementById("serialLogKeepLines");
				if (serialLogKeepInput) serialLogKeepInput.value = String(window.cachedSerialLogKeepLines);
			}
			if (typeof data.ModelRotX !== 'undefined') {
				setModelOrientationValue('x', data.ModelRotX);
			}
			if (typeof data.ModelRotY !== 'undefined') {
				setModelOrientationValue('y', data.ModelRotY);
			}
			if (typeof data.ModelRotZ !== 'undefined') {
				setModelOrientationValue('z', data.ModelRotZ);
			}
			if (typeof data.ModelDirX !== 'undefined') {
				setModelDirectionValue('x', data.ModelDirX);
			}
			if (typeof data.ModelDirY !== 'undefined') {
				setModelDirectionValue('y', data.ModelDirY);
			}
			if (typeof data.ModelDirZ !== 'undefined') {
				setModelDirectionValue('z', data.ModelDirZ);
			}
			let axisUpdated = false;
			if (typeof data.ModelAxisX !== 'undefined') {
				setModelAxisMapping('x', data.ModelAxisX, { skipValidation: true, skipApply: true, updateSelect: false });
				axisUpdated = true;
			}
			if (typeof data.ModelAxisY !== 'undefined') {
				setModelAxisMapping('y', data.ModelAxisY, { skipValidation: true, skipApply: true, updateSelect: false });
				axisUpdated = true;
			}
			if (typeof data.ModelAxisZ !== 'undefined') {
				setModelAxisMapping('z', data.ModelAxisZ, { skipValidation: true, skipApply: true, updateSelect: false });
				axisUpdated = true;
			}
			if (typeof data.TelemetryMaxKB !== 'undefined') {
				window.cachedTelemetryMaxKB = sanitizeTelemetryMaxKB(data.TelemetryMaxKB);
			}
			const telemetryMaxInput = document.getElementById("telemetryMaxKB");
			if (telemetryMaxInput) {
				telemetryMaxInput.value = sanitizeTelemetryMaxKB(window.cachedTelemetryMaxKB);
			}
			paintRobotAudioControls();
			paintModelDirectionControls();
			if (axisUpdated) {
				paintModelAxisSelects();
				if (typeof window.applyModelOrientationOffsets === "function") {
					window.applyModelOrientationOffsets();
				}
				if (typeof window.update3DOrientation === "function") {
					const roll = (typeof window.rollDeg === "number") ? window.rollDeg : 0;
					const pitch = (typeof window.pitchDeg === "number") ? window.pitchDeg : 0;
					const heading = (typeof window.headingDeg === "number") ? window.headingDeg : 0;
					window.update3DOrientation(roll, pitch, heading);
				}
			} else {
				validateModelAxisMapping();
			}
		}).catch(() => {});
	} catch (_) {}
}


function saveRobotConfig() {
	if (!validateModelAxisMapping({ warn: true })) {
		return;
	}

	const recordTelemetrySwitch = document.getElementById("recordTelemetryToggle");
	if (recordTelemetrySwitch) {
		sendButtonInput("RecordTelemetry", recordTelemetrySwitch.checked ? 1 : 0);
	}
	const serialLogRateSelect = document.getElementById("serialLogRateMs");
	if (serialLogRateSelect) {
		const nextRate = sanitizeSerialLogRateMs(serialLogRateSelect.value);
		window.cachedSerialLogRateMs = nextRate;
		serialLogRateSelect.value = String(nextRate);
		sendButtonInput("SerialLogRateMs", nextRate);
	}
	const serialLogKeepInput = document.getElementById("serialLogKeepLines");
	if (serialLogKeepInput) {
		const nextLines = sanitizeSerialLogKeepLines(serialLogKeepInput.value);
		window.cachedSerialLogKeepLines = nextLines;
		serialLogKeepInput.value = String(nextLines);
		sendButtonInput("SerialLogKeepLines", nextLines);
	}

	const snapshot = gatherGpioConfig();
	const conflicts = updateGpioConflictHighlights();
	if (conflicts && conflicts.size) {
		alert("Two or more subsystems share the same GPIO. Please resolve the highlighted fields before saving.");
		return;
	}

	ensureGpioCache();
	Object.assign(window.cachedGpioConfig, snapshot);

	const pairs = Object.entries(snapshot).map(([key, value]) => `${key}:${value}`);
	const payload = `GPIO,${pairs.join(";")}`;

	if (websocketCarInput && websocketCarInput.readyState === WebSocket.OPEN) {
		websocketCarInput.send(payload);
		showToast("GPIO configuration sent");
	} else {
		showToast("WebSocket not connected", true);
	}

	["x","y","z"].forEach(axis => {
		const key = MODEL_AXIS_KEYS[axis];
		const val = window.cachedModelOrientation?.[axis];
		if (!key || typeof val !== "number" || Number.isNaN(val)) return;
		sendButtonInput(key, val);
	});

	["x","y","z"].forEach(axis => {
		const key = MODEL_DIR_KEYS[axis];
		const val = window.cachedModelOrientationDir?.[axis];
		if (!key || typeof val !== "number" || Number.isNaN(val)) return;
		sendButtonInput(key, val);
	});

	["x","y","z"].forEach(axis => {
		const key = MODEL_AXIS_MAP_KEYS[axis];
		if (!key) return;
		const map = window.cachedModelAxisMap || {};
		const choice = map[axis] || axis;
		const code = (choice in MODEL_AXIS_CODE) ? MODEL_AXIS_CODE[choice] : MODEL_AXIS_CODE[axis];
		sendButtonInput(key, code);
	});

	const telemetryMaxInput = document.getElementById("telemetryMaxKB");
	if (telemetryMaxInput) {
		const kb = sanitizeTelemetryMaxKB(telemetryMaxInput.value);
		telemetryMaxInput.value = kb;
		window.cachedTelemetryMaxKB = kb;
		sendButtonInput("TelemetryMaxKB", kb);
	}
}


window.initRobotConfigTab = function() {
	buildGpioConfigTable();
	paintGpioConfigTable();
	updateGpioConflictHighlights();

	// Reset pairing clear UI each time tab opens
	setPairPrefsStatus("Removes saved dock pairing and re-enables discovery.", false);
	const clearBtn = document.getElementById("clearPairPrefsBtn");
	if (clearBtn) clearBtn.disabled = false;

  // Dark Mode
  const darkToggle = document.getElementById("darkToggle");
  if (darkToggle) {
    darkToggle.checked = (localStorage.getItem("darkMode") === "1");
    darkToggle.onchange = function() {
      toggleDarkMode(this.checked);
    };
  }

  // Horizontal Screen
  const horizontalToggle = document.getElementById("horizontalToggle");
  if (horizontalToggle) {
    horizontalToggle.onchange = function() {
      sendButtonInput("Switch", this.checked ? 1 : 0);
    };
  }

  // Hold Bucket
  const holdBucketSwitch = document.getElementById("holdBucketToggle");
  if (holdBucketSwitch) {
    holdBucketSwitch.onchange = function() {
      sendButtonInput("HoldBucket", this.checked ? 1 : 0);
    };
  }

  // Hold Aux
  const holdAuxSwitch = document.getElementById("holdAuxToggle");
  if (holdAuxSwitch) {
    holdAuxSwitch.onchange = function() {
      sendButtonInput("HoldAux", this.checked ? 1 : 0);
    };
  }

	// Record Telemetry
	const recordTelemetrySwitch = document.getElementById("recordTelemetryToggle");
	if (recordTelemetrySwitch) {
		recordTelemetrySwitch.onchange = function() {
			sendButtonInput("RecordTelemetry", this.checked ? 1 : 0);
		};
	}

	// System Sounds Toggle
	const systemSoundsToggle = document.getElementById("systemSoundsToggle");
	if (systemSoundsToggle) {
		if (typeof window.cachedSystemSounds === "boolean") {
			systemSoundsToggle.checked = window.cachedSystemSounds;
		}
		systemSoundsToggle.onchange = function () {
			const nextState = !!this.checked;
			window.cachedSystemSounds = nextState;
			sendButtonInput("SystemSounds", nextState ? 1 : 0);
		};
	}

	// System Volume Slider
	const systemVolume = document.getElementById("systemVolume");
	const systemVolumeLabel = document.getElementById("systemVolumeLabel");
	if (systemVolume && systemVolumeLabel) {
		if (typeof window.cachedSystemVolume !== "undefined") {
			systemVolume.value = window.cachedSystemVolume;
			systemVolumeLabel.innerText = window.cachedSystemVolume;
		}
		systemVolume.oninput = function () {
			const val = this.value;
			window.cachedSystemVolume = val;
			systemVolumeLabel.innerText = val;
			sendButtonInput("SystemVolume", val);
		};
	}
	const serialLogKeepInput = document.getElementById("serialLogKeepLines");
	if (serialLogKeepInput) {
		serialLogKeepInput.value = String(sanitizeSerialLogKeepLines(window.cachedSerialLogKeepLines));
		const applyKeepLines = () => {
			const nextLines = sanitizeSerialLogKeepLines(serialLogKeepInput.value);
			serialLogKeepInput.value = String(nextLines);
			window.cachedSerialLogKeepLines = nextLines;
			sendButtonInput("SerialLogKeepLines", nextLines);
		};
		serialLogKeepInput.onchange = applyKeepLines;
		serialLogKeepInput.onblur = applyKeepLines;
	}

	// WebSocket disconnect reboot watchdog
	const wsRebootOnDisconnectToggle = document.getElementById("wsRebootOnDisconnectToggle");
	if (wsRebootOnDisconnectToggle) {
		if (typeof window.cachedWsRebootOnDisconnect === "boolean") {
			wsRebootOnDisconnectToggle.checked = window.cachedWsRebootOnDisconnect;
		}
		wsRebootOnDisconnectToggle.onchange = function () {
			const nextState = !!this.checked;
			window.cachedWsRebootOnDisconnect = nextState;
			sendButtonInput("WsRebootOnDisconnect", nextState ? 1 : 0);
			fetch('/set_ws_reboot_watchdog?value=' + (nextState ? 1 : 0), { cache: 'no-store' }).catch(() => {});
		};
	}

	const serialLogRateSelect = document.getElementById("serialLogRateMs");
	if (serialLogRateSelect) {
		serialLogRateSelect.value = String(sanitizeSerialLogRateMs(window.cachedSerialLogRateMs));
		serialLogRateSelect.onchange = function () {
			const nextRate = sanitizeSerialLogRateMs(this.value);
			this.value = String(nextRate);
			window.cachedSerialLogRateMs = nextRate;
			sendButtonInput("SerialLogRateMs", nextRate);
		};
	}

	paintRobotAudioControls();

	["x","y","z"].forEach(axis => {
		const inputId = MODEL_AXIS_IDS[axis];
		const input = document.getElementById(inputId);
		if (!input) return;

		const cached = window.cachedModelOrientation?.[axis];
		if (typeof cached === "number" && !Number.isNaN(cached)) {
			input.value = cached;
		}

		if (!input.dataset.bound) {
			input.dataset.bound = "1";
			const handler = () => handleModelOrientationInput(axis, input.value);
			input.addEventListener("change", handler);
			input.addEventListener("blur", handler);
		}

		const dirIds = MODEL_DIR_IDS[axis];
		const cwBox = dirIds ? document.getElementById(dirIds.cw) : null;
		const ccwBox = dirIds ? document.getElementById(dirIds.ccw) : null;
		if (cwBox && !cwBox.dataset.bound) {
			cwBox.dataset.bound = "1";
			cwBox.addEventListener("change", () => handleModelDirectionInput(axis, 1));
		}
		if (ccwBox && !ccwBox.dataset.bound) {
			ccwBox.dataset.bound = "1";
			ccwBox.addEventListener("change", () => handleModelDirectionInput(axis, -1));
		}

		const selectId = MODEL_AXIS_MAP_IDS[axis];
		const select = selectId ? document.getElementById(selectId) : null;
		if (select) {
			const cached = window.cachedModelAxisMap?.[axis];
			const normalized = normalizeAxisChoice(
				typeof cached === "undefined" ? axis : cached,
				axis
			);
			select.value = normalized;
			if (!select.dataset.bound) {
				select.dataset.bound = "1";
				select.addEventListener("change", () => {
					setModelAxisMapping(axis, select.value);
				});
			}
		}
	});

	paintModelDirectionControls();
	paintModelAxisSelects();
	validateModelAxisMapping();

	const telemetryMaxInput = document.getElementById("telemetryMaxKB");
	if (telemetryMaxInput) {
		telemetryMaxInput.value = sanitizeTelemetryMaxKB(window.cachedTelemetryMaxKB);
		if (!telemetryMaxInput.dataset.bound) {
			telemetryMaxInput.dataset.bound = "1";
			telemetryMaxInput.addEventListener("change", () => {
				const kb = sanitizeTelemetryMaxKB(telemetryMaxInput.value);
				telemetryMaxInput.value = kb;
				window.cachedTelemetryMaxKB = kb;
			});
			telemetryMaxInput.addEventListener("blur", () => {
				const kb = sanitizeTelemetryMaxKB(telemetryMaxInput.value);
				telemetryMaxInput.value = kb;
				window.cachedTelemetryMaxKB = kb;
			});
		}
	}
	refreshRobotConfigFromBackend();
};


function paintRobotAudioControls() {
	const toggle = document.getElementById("systemSoundsToggle");
	if (toggle && typeof window.cachedSystemSounds === "boolean") {
		toggle.checked = window.cachedSystemSounds;
	}
	const volume = document.getElementById("systemVolume");
	const label = document.getElementById("systemVolumeLabel");
	if (volume && label) {
		let val;
		if (typeof window.cachedSystemVolume !== "undefined") {
			val = parseInt(window.cachedSystemVolume, 10);
		} else {
			val = parseInt(volume.value, 10);
		}
		if (Number.isNaN(val)) val = 0;
		volume.value = val;
		label.innerText = val;
	}
}

window.paintRobotAudioControls = paintRobotAudioControls;

function handleModalWebSocketMessage(key, value) {
	if (key === "darkMode") {
		const darkToggle = document.getElementById('darkToggle');
		if (darkToggle) darkToggle.checked = (value == "1");
		toggleDarkMode(value == "1");
	}
	if (key === "holdBucket") {
		const el = document.getElementById('holdBucketToggle');
		if (el) el.checked = (value == "1");
	}
	if (key === "holdAux") {
		const el = document.getElementById('holdAuxToggle');
		if (el) el.checked = (value == "1");
	}
	if (key === "horizontalScreen") {
		const el = document.getElementById('horizontalToggle');
		if (el) el.checked = (value == "1");
	}
	if (key === "SystemSounds") {
		window.cachedSystemSounds = (value == "1");
		const el = document.getElementById('systemSoundsToggle');
		if (el) el.checked = window.cachedSystemSounds;
		paintRobotAudioControls();
	}
	if (key === "SystemVolume") {
		window.cachedSystemVolume = value;
		const el = document.getElementById('systemVolume');
		const label = document.getElementById('systemVolumeLabel');
		if (el) el.value = value;
		if (label) label.innerText = value;
		paintRobotAudioControls();
	}
	if (key === "RecordTelemetry") {
		const el = document.getElementById('recordTelemetryToggle');
		if (el) el.checked = (value == "1");
	}
	if (key === "WsRebootOnDisconnect") {
		window.cachedWsRebootOnDisconnect = (value == "1");
		const el = document.getElementById('wsRebootOnDisconnectToggle');
		if (el) el.checked = window.cachedWsRebootOnDisconnect;
	}
	if (key === "SerialLogRateMs") {
		window.cachedSerialLogRateMs = sanitizeSerialLogRateMs(value);
		const el = document.getElementById('serialLogRateMs');
		if (el) el.value = String(window.cachedSerialLogRateMs);
	}
	if (key === "SerialLogKeepLines") {
		window.cachedSerialLogKeepLines = sanitizeSerialLogKeepLines(value);
		const el = document.getElementById('serialLogKeepLines');
		if (el) el.value = String(window.cachedSerialLogKeepLines);
	}
	if (key === "ModelRotX" || key === "ModelRotY" || key === "ModelRotZ") {
		const axis = key === "ModelRotX" ? "x" : (key === "ModelRotY" ? "y" : "z");
		setModelOrientationValue(axis, value);
	}
	if (key === "ModelDirX" || key === "ModelDirY" || key === "ModelDirZ") {
		const axis = key === "ModelDirX" ? "x" : (key === "ModelDirY" ? "y" : "z");
		setModelDirectionValue(axis, value);
	}
	if (key === "ModelAxisX" || key === "ModelAxisY" || key === "ModelAxisZ") {
		const axis = key === "ModelAxisX" ? "x" : (key === "ModelAxisY" ? "y" : "z");
		setModelAxisMapping(axis, value);
	}
	if (key === "TelemetryMaxKB") {
		window.cachedTelemetryMaxKB = sanitizeTelemetryMaxKB(value);
		const el = document.getElementById('telemetryMaxKB');
		if (el) el.value = window.cachedTelemetryMaxKB;
	}
}



window.toggleDarkMode = function(isDark) {
	// Always safe
	document.body.classList.toggle("dark", isDark);

	// Only toggle if present (null check)
	[".left", ".right", ".header"].forEach(sel => {
	const el = document.querySelector(sel);
	if (el) el.classList.toggle("dark", isDark);
	});

	localStorage.setItem("darkMode", isDark ? "1" : "0");
	if (window.websocketCarInput && websocketCarInput.readyState === WebSocket.OPEN) {
	websocketCarInput.send("DarkMode," + (isDark ? 1 : 0));
	}
};



function syncDarkToggleCheckbox() {
	const darkToggle = document.getElementById("darkToggle");
	if (darkToggle) {
	darkToggle.checked = (localStorage.getItem("darkMode") === "1");
	}
}

function sanitizeModelOrientationValue(raw) {
	const num = parseFloat(raw);
	if (Number.isNaN(num)) return 0;
	const clamped = Math.max(-360, Math.min(360, Math.round(num)));
	return clamped;
}

function setModelOrientationValue(axis, value) {
	const target = sanitizeModelOrientationValue(value);
	window.cachedModelOrientation = window.cachedModelOrientation || { x: 0, y: 0, z: 0 };
	const previous = window.cachedModelOrientation[axis];
	window.cachedModelOrientation[axis] = target;

	const inputId = MODEL_AXIS_IDS[axis];
	if (inputId) {
		const input = document.getElementById(inputId);
		if (input) {
			input.value = target;
		}
	}

	if (typeof window.applyModelOrientationOffsets === "function") {
		window.applyModelOrientationOffsets();
	}

	return { target, previous };
}

function sendModelOrientation(axis, value) {
	const key = MODEL_AXIS_KEYS[axis];
	if (!key) return;
	sendButtonInput(key, value);
}

function handleModelOrientationInput(axis, rawValue) {
	const result = setModelOrientationValue(axis, rawValue);
	if (result.previous === result.target) return;
	sendModelOrientation(axis, result.target);
}

window.swapModelOrientation = function(axis) {
	const current = window.cachedModelOrientation?.[axis];
	const currentVal = (typeof current === "number" && !Number.isNaN(current)) ? current : 0;
	const nextVal = currentVal === 0 ? 0 : -currentVal;
	const result = setModelOrientationValue(axis, nextVal);
	sendModelOrientation(axis, result.target);
};

function coerceModelDirection(value) {
	if (typeof value === "string") {
		const lower = value.toLowerCase();
		if (lower === "ccw" || lower === "-1") return -1;
		return 1;
	}
	const num = parseInt(value, 10);
	if (Number.isNaN(num)) return 1;
	return num < 0 ? -1 : 1;
}

function setModelDirectionValue(axis, value) {
	const dir = coerceModelDirection(value);
	window.cachedModelOrientationDir = window.cachedModelOrientationDir || { x: 1, y: 1, z: 1 };
	const previous = window.cachedModelOrientationDir[axis] ?? 1;
	window.cachedModelOrientationDir[axis] = dir;

	paintModelDirectionControls();

	if (typeof window.applyModelOrientationOffsets === "function") {
		window.applyModelOrientationOffsets();
	}

	return { target: dir, previous };
}

function sendModelDirection(axis, value) {
	const key = MODEL_DIR_KEYS[axis];
	if (!key) return;
	sendButtonInput(key, value);
}

function handleModelDirectionInput(axis, rawValue) {
	const result = setModelDirectionValue(axis, rawValue);
	if (result.previous === result.target) return;
	sendModelDirection(axis, result.target);
}

function paintModelDirectionControls() {
	const dirs = window.cachedModelOrientationDir || { x: 1, y: 1, z: 1 };
	["x","y","z"].forEach(axis => {
		const dirIds = MODEL_DIR_IDS[axis];
		if (!dirIds) return;
		const cwBox = document.getElementById(dirIds.cw);
		const ccwBox = document.getElementById(dirIds.ccw);
		const value = dirs[axis] ?? 1;
		if (cwBox) cwBox.checked = (value >= 0);
		if (ccwBox) ccwBox.checked = (value < 0);
	});
}

function normalizeAxisChoice(value, fallbackAxis) {
	const fallback = MODEL_AXIS_CHOICES.includes(fallbackAxis) ? fallbackAxis : "x";
	if (typeof value === "number" && Number.isInteger(value)) {
		return MODEL_AXIS_FROM_CODE.hasOwnProperty(value) ? MODEL_AXIS_FROM_CODE[value] : fallback;
	}
	if (typeof value === "string") {
		const trimmed = value.trim().toLowerCase();
		if (MODEL_AXIS_CHOICES.includes(trimmed)) {
			return trimmed;
		}
		const parsed = parseInt(trimmed, 10);
		if (!Number.isNaN(parsed) && MODEL_AXIS_FROM_CODE.hasOwnProperty(parsed)) {
			return MODEL_AXIS_FROM_CODE[parsed];
		}
	}
	return fallback;
}

function markAxisSelectConflicts(conflicts) {
	const conflictSet = conflicts instanceof Set ? conflicts : new Set();
	MODEL_AXIS_CHOICES.forEach(axis => {
		const selectId = MODEL_AXIS_MAP_IDS[axis];
		const select = selectId ? document.getElementById(selectId) : null;
		if (!select) return;
		if (conflictSet.has(axis)) {
			select.style.outline = "2px solid #ff6b6b";
			select.style.backgroundColor = "rgba(255, 107, 107, 0.12)";
		} else {
			select.style.outline = "";
			select.style.backgroundColor = "";
		}
	});
}

function paintModelAxisSelects() {
	window.cachedModelAxisMap = window.cachedModelAxisMap || { x: "x", y: "y", z: "z" };
	MODEL_AXIS_CHOICES.forEach(axis => {
		const selectId = MODEL_AXIS_MAP_IDS[axis];
		const select = selectId ? document.getElementById(selectId) : null;
		if (!select) return;
		const choice = normalizeAxisChoice(window.cachedModelAxisMap[axis], axis);
		if (select.value !== choice) {
			select.value = choice;
		}
	});
	validateModelAxisMapping();
}

function validateModelAxisMapping(options = {}) {
	const warn = !!options.warn;
	window.cachedModelAxisMap = window.cachedModelAxisMap || { x: "x", y: "y", z: "z" };
	const seen = new Map();
	const conflicts = new Set();

	MODEL_AXIS_CHOICES.forEach(axis => {
		const choice = normalizeAxisChoice(window.cachedModelAxisMap[axis], axis);
		window.cachedModelAxisMap[axis] = choice;
		if (seen.has(choice)) {
			conflicts.add(axis);
			conflicts.add(seen.get(choice));
		} else {
			seen.set(choice, axis);
		}
	});

	markAxisSelectConflicts(conflicts);

	if (conflicts.size && warn) {
		const label = { x: "X", y: "Y", z: "Z" };
		const summary = Array.from(conflicts).map(a => label[a] || a.toUpperCase()).join(", ");
		alert(`Each 3D model axis must map to a unique sensor axis.\nConflicting selections: ${summary}.`);
	}
	return conflicts.size === 0;
}

function setModelAxisMapping(axis, value, options = {}) {
	const normalizedAxis = MODEL_AXIS_CHOICES.includes(axis) ? axis : "x";
	const choice = normalizeAxisChoice(value, normalizedAxis);
	window.cachedModelAxisMap = window.cachedModelAxisMap || { x: "x", y: "y", z: "z" };
	window.cachedModelAxisMap[normalizedAxis] = choice;

	if (options.updateSelect !== false) {
		const selectId = MODEL_AXIS_MAP_IDS[normalizedAxis];
		const select = selectId ? document.getElementById(selectId) : null;
		if (select) {
			select.value = choice;
		}
	}

	if (!options.skipValidation) {
		validateModelAxisMapping();
	}

	if (!options.skipApply) {
		if (typeof window.applyModelOrientationOffsets === "function") {
			window.applyModelOrientationOffsets();
		}
		if (typeof window.update3DOrientation === "function") {
			const roll = (typeof window.rollDeg === "number") ? window.rollDeg : 0;
			const pitch = (typeof window.pitchDeg === "number") ? window.pitchDeg : 0;
			const heading = (typeof window.headingDeg === "number") ? window.headingDeg : 0;
			window.update3DOrientation(roll, pitch, heading);
		}
	}

	return choice;
}

window.paintModelDirectionControls = paintModelDirectionControls;
window.setModelDirectionValue = setModelDirectionValue;
window.paintModelAxisSelects = paintModelAxisSelects;
window.validateModelAxisMapping = validateModelAxisMapping;
window.setModelAxisMapping = setModelAxisMapping;

function setPairPrefsStatus(message, isError = false) {
	const statusEl = document.getElementById("clearPairPrefsStatus");
	if (!statusEl) return;
	statusEl.textContent = message || "";
	statusEl.style.color = isError ? "#ff9c9c" : "#aac";
}

async function clearPairedPrefs() {
	const btn = document.getElementById("clearPairPrefsBtn");
	if (btn) btn.disabled = true;
	setPairPrefsStatus("Clearing saved pairing...", false);

	try {
		const res = await fetch("/clear_paired_prefs", { method: "POST" });
		if (!res.ok) {
			throw new Error(`HTTP ${res.status}`);
		}
		let data = {};
		try { data = await res.json(); } catch (e) { data = {}; }
		const discoveryOn = data && typeof data.discovery_enabled !== "undefined"
			? !!data.discovery_enabled
			: true;
		const suffix = discoveryOn ? " Discovery re-enabled." : "";
		setPairPrefsStatus("Paired prefs cleared." + suffix, false);
		if (typeof showToast === "function") {
			showToast("Paired prefs cleared");
		}
	} catch (err) {
		setPairPrefsStatus("Failed to clear pairing. Try again.", true);
		if (typeof showToast === "function") {
			showToast(`Failed to clear pairing: ${err.message || err}`, "error");
		}
	} finally {
		if (btn) btn.disabled = false;
	}
}

window.clearPairedPrefs = clearPairedPrefs;

