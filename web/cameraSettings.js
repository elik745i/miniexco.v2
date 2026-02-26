// --- CAMERA TAB LOGIC ---

window.loadCameraTab = function() {
  // Load all current camera settings from backend and update UI
  fetchCamSettings();

  // Wire up Apply/Save button
  const applyBtn = document.getElementById("camApplyBtn");
  if (applyBtn) applyBtn.onclick = applyCamSettings;

  // (Optional) Attach other event handlers here if needed
  // Example: document.getElementById("resetBtn").onclick = ...
};


function applyCamSettings() {
	// Get values from switches/radios/sliders:
	const getRadio = (name) => document.querySelector(`input[name="${name}"]:checked`)?.value;
	const getSwitch = (id) => document.getElementById(id).checked ? 1 : 0;
	const getVal = (id) => document.getElementById(id)?.value || 0;

	// ROTATE logic (radio group: camRotate)
	const rotateVal = getRadio("camRotate") || 0;
	const hmirror = [0,1,0,1][rotateVal];
	const vflip   = [0,0,1,1][rotateVal];

	// Persist settings (for /setsettings POST)
	const persistPayload = {
	fps: parseInt(getVal("camFPS")),
	res: parseInt(getVal("camResolution")),
	quality: parseInt(getVal("camQuality")),
	saturation: parseInt(getVal("camSaturation")),
	brightness: parseInt(getVal("camBrightness")),
	contrast: parseInt(getVal("camContrast")),
	sharpness: parseInt(getVal("camSharpness")),
	led: parseInt(getVal("ledBrightness")),
	gamma: parseInt(getVal("camGamma")),
	compression: parseInt(getVal("camCompression")),
	dcw: getSwitch("camDenoise"),
	gainceiling: parseInt(getRadio("camGainceiling")),
	colorbar: getSwitch("camColorbar"),
	gray: getSwitch("camGrayscale"),
	hmirror: hmirror,
	vflip: vflip,
	awb: getSwitch("camAWB"),
	awb_gain: getSwitch("camAWBGain"),
	agc: getSwitch("camAGC"),
	agc_gain: parseInt(getVal("camAGCGain")),
	aec: getSwitch("camAEC"),
	aec2: getSwitch("camAEC2"),
	aec_value: parseInt(getVal("camAECValue")),
	bpc: getSwitch("camBPC"),
	wpc: getSwitch("camWPC"),
	raw_gma: getSwitch("camRawGMA"),
	lenc: getSwitch("camLENC"),
	special_effect: parseInt(getRadio("camSpecialEffect")),
	wb_mode: parseInt(getRadio("camWBMode")),
	ae_level: parseInt(getVal("camAELevel")),
  auto_res: getSwitch("camAutoRes"),
  adaptive_q: getSwitch("camAdaptiveQ"),
	};

	// POST to /setsettings
	fetch("/setsettings", {
	method: "POST",
	headers: { "Content-Type": "application/json" },
	body: JSON.stringify(persistPayload)
	})
	.then(r => r.json())
	.then(r => {
	if (r.status === "saved") {
		showToast("✅ Camera settings applied & saved");
		reloadCameraStream();
	} else {
		showToast("⚠️ Some settings failed", true);
	}
	})
	.catch(err => {
	console.error("Camera settings error:", err);
	showToast("❌ Failed to apply settings", true);
	});
}


function fetchCamSettings() {
	fetch(`/getsettings`)
	.then(r => r.json())
	.then(data => {
		
		// New: Set model name if provided by backend
		if (data.model && document.getElementById('camModelName')) {
			document.getElementById('camModelName').textContent = data.model;
		}			
		setVal("camResolution", data.res);
		setVal("camFPS", data.fps ?? data.xclk, 10);
		setVal("camQuality", data.quality, 10);
		setVal("camSaturation", data.saturation, 0);
		setVal("camBrightness", data.brightness, 0);
		setVal("camContrast", data.contrast, 0);
		setVal("camSharpness", data.sharpness ?? data.sharp, 2);
		setVal("ledBrightness", data.led, 0);
		setVal("camGamma", data.gamma, 0);
		setVal("camCompression", data.compression, 12);
		setVal("camAGCGain", data.agc_gain, 0);
		setVal("camAECValue", data.aec_value, 0);
		setVal("camAELevel", data.ae_level, 0);

		setChecked("camDenoise", data.dcw, 1);
		setChecked("camColorbar", data.colorbar, 0);
		setChecked("camGrayscale", data.gray, 0);
		setChecked("camAWB", data.awb, 1);
		setChecked("camAWBGain", data.awb_gain, 1);
		setChecked("camAGC", data.agc, 1);
		setChecked("camAEC", data.aec, 1);
		setChecked("camAEC2", data.aec2, 1);
		setChecked("camBPC", data.bpc, 0);
		setChecked("camWPC", data.wpc, 0);
		setChecked("camRawGMA", data.raw_gma, 0);
		setChecked("camLENC", data.lenc, 1);
		
		setChecked("camAutoRes", data.auto_res, 0);  
    setChecked("camAdaptiveQ", data.adaptive_q, 1); 

		setRadio("camGainceiling", data.gainceiling, 0);
		setRadio("camSpecialEffect", data.special_effect, 0);
		setRadio("camWBMode", data.wb_mode, 0);

		// --- ROTATE: combine hmirror+vflip if provided, else use rot
		let rot = typeof data.rot !== 'undefined'
		? data.rot
		: ((data.hmirror ? 1 : 0) | (data.vflip ? 2 : 0));
		setRadio("camRotate", rot, 0);

		document.getElementById('settingsModal').style.display = 'block';
	})
	.catch(err => {
		console.error("Failed to load camera settings", err);
		showToast("❌ Cannot load current settings", true);
	});
}


function reloadCameraStream() {
  if (typeof window.applyCameraStreamState === "function") {
    window.applyCameraStreamState(true, 120);
    return;
  }

  const stream = document.getElementById("cameraStream");
  if (!stream) return;
  const url = "http://" + location.hostname + ":81/stream?t=" + Date.now();
  stream.src = url;
}




window.openCamSettings = function() {
	fetchCamSettings();
}
