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
  let imuScriptLoaded = false;
  let ledOn = false;
  let leftIndicator, rightIndicator, emergencyBtn, cameraStream;
  let latestBatteryPercent = 0;
  let micEnabled = false;
  let micStream = null;
  let micAudioElem = null;


	window.headingDeg = 0;
	window.rollDeg = 0;
	window.pitchDeg = 0;
	window.headingCanvas = null;
	window.tiltCanvas = null;
	window.headingCtx = null;
	window.tiltCtx = null;
	window.pendingIMU = null;


  let  lastSentMotorValues = {
    Forward: 0,
    Backward: 0,
    Left: 0,
    Right: 0,
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

	// Apply dark mode as early as possible from backend
	fetch('/getsettings')
	  .then(r => r.json())
	  .then(data => {
		if ("darkMode" in data) {
		  window.toggleDarkMode(data.darkMode == 1);
		}
	  })
	  .catch(() => {
		window.toggleDarkMode(localStorage.getItem("darkMode") === "1");
	  });


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
	  fetch('/settingsModal.html')
		.then(res => res.text())
		.then(html => {
		  // Inject the modal's HTML at the end of <body>
		  const div = document.createElement('div');
		  div.innerHTML = html;
		  document.body.appendChild(div.firstElementChild);

		  // Now that modal exists, run the main onload
		  realOnLoad();
		});
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
  // --- DARK MODE SYNC: Fetch from backend as soon as modal & DOM are ready ---
  fetch('/getsettings')
    .then(r => r.json())
    .then(data => {
      if ("darkMode" in data) {
        window.toggleDarkMode(data.darkMode == 1);
        // Optionally, sync the checkbox
        const darkToggle = document.getElementById("darkToggle");
        if (darkToggle) darkToggle.checked = (data.darkMode == 1);
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
    armSlider.addEventListener("input", function() {
      let value = parseInt(armSlider.value);
      armValueLabel.textContent = value;
      if (value !== lastSentArmValue) {
        sendMotorSpeed("Arm", value);
        lastSentArmValue = value;
      }
    });

    armSlider.addEventListener("change", function() {
      armSlider.value = 0;
      armValueLabel.textContent = 0;
      sendMotorSpeed("Arm", 0);
      lastSentArmValue = 0;
    });
  }

  // Restore emergency state if needed
  const emergencyBtn = document.getElementById("emergencyBtn");
  if (emergencyBtn?.classList.contains("active")) {
    emergencyOn = true;
    document.getElementById("leftIndicator")?.classList.add("visible", "blinking");
    document.getElementById("rightIndicator")?.classList.add("visible", "blinking");
    emergencyBtn.classList.add("blinking");
  }

  initWebSocket();

  // Keymap fetch
  fetch("/get_keymap")
    .then(r => r.json())
    .then(data => {
      keymap = {};
      Object.entries(data).forEach(([action, key]) => {
        keymap[key.toLowerCase()] = action;
      });
    })
    .catch(err => console.error("❌ Failed to load keymap:", err));

  // Keyboard listeners
  document.addEventListener("keydown", handleKeyDown);
  document.addEventListener("keyup", handleKeyUp);

  // FPS placeholder
  document.getElementById("fpsOverlay").innerText = "FPS: ...";

  // 📷 Set camera to local stream (single-board)
  const camera = document.getElementById("cameraStream");
  camera.src = "http://" + location.hostname + ":81/stream";
  document.getElementById("camStatusOverlay").style.display = "none";
  console.log("✅ Using local /stream for video (single-board mode)");

  // Lane overlay
  const laneOverlay = document.getElementById("laneOverlay");
  if (laneOverlay) {
    laneOverlay.style.display =
      localStorage.getItem("laneOverlayVisible") === "true" ? "block" : "none";
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

    websocketCarInput = new WebSocket("ws://" + location.host + "/CarInput");
	window.wsCarInput = websocketCarInput;
		
    websocketCarInput.onopen = () => console.log("WebSocket Connected");
    websocketCarInput.onclose = () => setTimeout(initWebSocket, 2000);
    websocketCarInput.onmessage = function(event) {
      var message = event.data;
      var parts = message.split(',');
      var key = parts[0];
      var value = parts[1];
      const msg = event.data;

	  // --- MEDIA PLAYER DEVICE EVENTS ---
	  if (message.startsWith("MEDIA_DEVICE_PROGRESS,")) {
		// message: MEDIA_DEVICE_PROGRESS,<filename>,<elapsed>,<duration>
		const parts = message.split(",");
		if (parts.length >= 4) {
		  const filename = decodeURIComponent(parts[1]);
		  const elapsed = parseFloat(parts[2]);
		  const duration = parseFloat(parts[3]);
		  // Update device progress bar here!
		  updateDeviceProgress(filename, elapsed, duration);
		}
		return;
	  }

	  if (message.startsWith("MEDIA_DEVICE_PLAYING,")) {
		// message: MEDIA_DEVICE_PLAYING,<filename>
		const filename = decodeURIComponent(message.split(",")[1]);
		setDevicePlayState(filename, true);
		return;
	  }

	  if (message.startsWith("MEDIA_DEVICE_STOPPED")) {
		setDevicePlayState(null, false);
		return;
	  }
  
      // Handle IMU data
      if (msg.startsWith("IMU,")) {
        //console.log("📨 Raw IMU data received:", msg);  // <--- Add this line for debug
        const parts = msg.split(",");
        if (parts.length >= 8) {
          const [_, h, r, p, mx, my, mz, temp] = parts;

          if (!imuScriptLoaded) {
            const script = document.createElement("script");
            script.src = "/telemetryScript.js?v=" + Date.now();
            script.onload = () => {
              imuScriptLoaded = true;
              console.log("✅ IMU telemetry script loaded");
              handleIMUMessage(h, r, p, mx, my, mz, temp);  // now safe to call
            };
            document.body.appendChild(script);
          } else {
            handleIMUMessage(h, r, p, mx, my, mz, temp);
          }
        }
        return;
      }


      if (key === "Light") {
        ledOn = (value == "1");
        const btn = document.getElementById("ledToggleBtn");
        if (ledOn) {
          btn.innerText = "💡 LED: ON";
          btn.style.backgroundColor = "#ffd700";
          btn.style.color = "black";
        } else {
          btn.innerText = "💡 LED: OFF";
          btn.style.backgroundColor = "#444"; // more visible on dark theme
          btn.style.color = "white";
        }

      }

      if (key === "GPIOCONF") {
        const pairs = value.split(";");
        pairs.forEach(p => {
          const [k, v] = p.split(":");
          if (k === "Left") document.getElementById("gpioLeft").value = v;
          if (k === "Right") document.getElementById("gpioRight").value = v;
          if (k === "Servo") document.getElementById("gpioServo").value = v;
        });
      }

      if (key === "FPS") {
        document.getElementById('fpsOverlay').innerText = "FPS: " + value;
        lastFPSUpdate = Date.now();  // ✅ use this for camera activity tracking
      }
      if (key === "AUX") {
        auxSlider.value = parseInt(value);
        updateSliderValue("AUX");
      }

      if (key === "Bucket") {
        bucketSlider.value = parseInt(value);
        updateSliderValue("Bucket");
      }


      if (key === "BATT") {
        let batteryPercent = parseInt(parts[1]);
        latestBatteryPercent = batteryPercent;  // ✅ Store globally
        let voltage = parseFloat(parts[2]);
        let wifiQuality = parseInt(parts[3]);

        let batteryText = document.getElementById('batteryText');
        let wifiText = document.getElementById('wifiText');
        let chargeIcon = document.getElementById('chargeIcon');

        // Update battery
        batteryText.innerText = "Batt: " + batteryPercent + "% (" + voltage.toFixed(2) + "V)";
        batteryText.className = "";
        if (batteryPercent > 70) batteryText.classList.add('batt-green');
        else if (batteryPercent > 40) batteryText.classList.add('batt-orange');
        else if (batteryPercent > 20) batteryText.classList.add('batt-red');
        else batteryText.classList.add('batt-critical');

        // Update Wi-Fi
        wifiText.innerText = "WiFi: " + wifiQuality + "%";
        wifiText.className = "";
        if (wifiQuality > 70) wifiText.classList.add('wifi-green');
        else if (wifiQuality > 40) wifiText.classList.add('wifi-orange');
        else wifiText.classList.add('wifi-red');

        // Charger logic is handled in CHARGE
      }

      if (key === "CHARGE") {
        const chargeIcon = document.getElementById("chargeIcon");

        if (value === "YES") {
          chargeIcon.style.display = "inline";
          chargeIcon.innerText = "⚡";

          let voltage = parseFloat(document.getElementById("batteryText").innerText.match(/\(([\d.]+)V\)/)[1]);

          if (voltage >= 8.4) {
            chargeIcon.style.animation = "none";
            chargeIcon.style.color = "lime";
          } else {
            chargeIcon.style.animation = "fadeCharge 1.5s infinite";
            let percent = Math.min(100, Math.max(0, parseInt(document.getElementById("batteryText").innerText.match(/Batt: (\d+)%/)[1])));
            let red = Math.round(255 - percent * 2.55);
            let green = Math.round(percent * 2.55);
            chargeIcon.style.color = `rgb(${red}, ${green}, 0)`;
          }

        } else if (value === "FAULT") {
          chargeIcon.style.display = "inline";
          chargeIcon.innerText = "⚡🚫";
          chargeIcon.style.animation = "flashRed 1s infinite";
          chargeIcon.style.color = "red";
        } else {
          chargeIcon.style.display = "none";
        }
      }




      if (key == "STATS") {
        let uptimeSecs = parseInt(parts[1]);
        let chipTemp = parseFloat(parts[2]);
        let uptimeMins = Math.floor(uptimeSecs / 60);
        let stats = document.getElementById("statsOverlay");

        stats.innerText = "Uptime: " + uptimeMins + " min, Temp: " + chipTemp + "C";
        stats.className = "overlay-topright"; // reset base style

        if (chipTemp >= 70) {
          stats.classList.add("temp-critical");
        } else if (chipTemp >= 55) {
          stats.classList.add("temp-warning");
        }
      }

      const normalizedKey = key.toUpperCase();

      if (normalizedKey === "TURN_LEFT") {
        const el = document.getElementById("leftIndicator");

        if (value === "1") {
          if (!emergencyOn) {
            el.classList.add("blinking", "visible");
          }
        } else {
          el.classList.remove("blinking");
          el.classList.remove("visible");
        }
      }


      if (normalizedKey === "TURN_RIGHT") {
        const el = document.getElementById("rightIndicator");

        if (value === "1") {
          if (!emergencyOn) {
            el.classList.add("blinking", "visible");
          }
        } else {
          el.classList.remove("blinking");
          el.classList.remove("visible");
        }
      }




      if (key === "Beacon") {
        beaconActive = (value === "1");
        const btn = document.getElementById("beaconBtn");
        if (beaconActive) {
          btn.classList.add("blinking");
        } else {
          btn.classList.remove("blinking");
        }
      }

      if (normalizedKey === "EMERGENCY") {
        emergencyOn = (value === "1");

        const left = document.getElementById("leftIndicator");
        const right = document.getElementById("rightIndicator");

        if (emergencyOn) {
          left.classList.add("blinking", "visible");
          right.classList.add("blinking", "visible");
        } else {
          left.classList.remove("blinking", "visible");
          right.classList.remove("blinking", "visible");
        }

        const btn = document.getElementById("emergencyBtn");
        if (btn) {
          if (emergencyOn) {
            btn.classList.add("blinking");
            btn.classList.add("active");
            btn.innerText = "⚠️ Emergency ON";
          } else {
            btn.classList.remove("blinking");
            btn.classList.remove("active");
            btn.innerText = "⚠️ Emergency";
          }
        }
      }


    };
  }

  function sendButtonInput(key, value) {
    if (websocketCarInput && websocketCarInput.readyState === WebSocket.OPEN) {
      websocketCarInput.send(key + "," + value);
    }
  }

  function handleKeyDown(e) {
    const key = e.key.toLowerCase();
    if (keysDown[key]) return; // prevent re-processing held key
    keysDown[key] = true;

    const action = keymap[key];
    if (!action) return;

    switch (action) {
      case "forward":
        sendButtonInput("MoveCar", "2");      // FORWARD
        setJoystickKnob(0, 255);
        break;
      case "backward":
        sendButtonInput("MoveCar", "1");      // BACKWARD
        setJoystickKnob(0, -255);
        break;
      case "left":
        sendButtonInput("MoveCar", "3");
        setJoystickKnob(-255, 0);
        break;
      case "right":
        sendButtonInput("MoveCar", "4");
        setJoystickKnob(255, 0);
        break;
      case "stop":
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
    }
  }

  function handleKeyUp(e) {
    const key = e.key.toLowerCase();
    delete keysDown[key];

    const action = keymap[key];
    if (!action) return;

    // Stop movement on release
    if (["forward", "backward", "left", "right"].includes(action)) {
      sendButtonInput("MoveCar", "0");
      setJoystickKnob(0, 0);
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
		const toast = document.getElementById("toast");
		toast.innerText = message;
		// Pick color by type
		toast.style.backgroundColor =
			type === "error" ? "#e53935" :
			type === "success" ? "#4CAF50" :
			"#1976d2"; // info (blue)
		toast.style.visibility = "visible";
		toast.style.opacity = "1";

		setTimeout(() => {
			toast.style.opacity = "0";
			setTimeout(() => toast.style.visibility = "hidden", 500);
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
    next.style.display = 'block'; // <--- SHOW explicitly

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

    requestAnimationFrame(updateFrameShape);

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

	function toggleSettingsModal() {
	  const modal = document.getElementById('settingsModal');
	  const mainContent = document.getElementById('mainContent');
	  const isVisible = modal.classList.contains('active');

	  if (isVisible) {
		// Hide: fade out
		modal.classList.remove('active');
		setTimeout(() => {
		  modal.style.display = 'none';
		}, 250); // Match your CSS transition time
		mainContent.classList.remove('blur');
		if (typeof onunloadModal === "function") onunloadModal();
	  } else {
		// Show: fade in
		modal.style.display = 'block';
		requestAnimationFrame(() => { // ensures CSS transition works
		  modal.classList.add('active');
		});
		mainContent.classList.add('blur');

		// Load modalScript.js only ONCE
		if (!window.modalScriptLoaded) {
		  const script = document.createElement('script');
		  script.src = "/modalScript.js?v=" + Date.now();
		  script.id = "modalScript";
		  script.onload = () => {
			window.modalScriptLoaded = true;
			console.log("✅ Modal script loaded dynamically.");
			fetchCamSettings();
			showTab('camTab');
			requestAnimationFrame(updateFrameShape);
		  };
		  document.body.appendChild(script);
		} else {
		  fetchCamSettings();
		  showTab('camTab');
		  requestAnimationFrame(updateFrameShape);
		}
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
});

// --- DYNAMIC MEDIA PLAYER LOADER ---
// Call this on media button click: <div onclick="toggleMediaPlayer()">
window.toggleMediaPlayer = function() {
  // Only load once
  if (!window.mediaPlayerScriptLoaded) {
    // Remove any old failed scripts
    const oldScript = document.getElementById('mediaPlayerScript');
    if (oldScript) oldScript.remove();

    const s = document.createElement('script');
    s.src = '/mediaPlayer.js?v=' + Date.now();
    s.id = 'mediaPlayerScript';
    s.onload = function() {
      if (typeof window.toggleMediaPlayerReal === "function") {
        window.toggleMediaPlayerReal();
      } else {
        showToast("Media player failed to initialize.");
      }
    };
    s.onerror = function() {
      showToast("Failed to load mediaPlayer.js from SD card!");
    };
    document.body.appendChild(s);
    window.mediaPlayerScriptLoaded = true;
  } else {
    if (typeof window.toggleMediaPlayerReal === "function") {
      window.toggleMediaPlayerReal();
    } else {
      showToast("Media player script not ready!");
    }
  }
};

// Minimal toast implementation (if not already present)
window.showToast = window.showToast || function(msg, duration) {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    toast.style = 'visibility:hidden;min-width:250px;background:#333;color:#fff;text-align:center;border-radius:2px;padding:16px;position:fixed;z-index:9999;left:50%;bottom:30px;font-size:17px;opacity:0;transition:opacity 0.5s;';
    document.body.appendChild(toast);
  }
  toast.innerText = msg;
  toast.style.visibility = 'visible';
  toast.style.opacity = '1';
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => { toast.style.visibility = 'hidden'; }, 500);
  }, duration || 2200);
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

