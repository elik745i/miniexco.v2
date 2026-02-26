let controlScriptLoaded = false;
let sdScriptLoaded = false;


  function onunloadModal() {
    console.log("🧹 Cleaning up modal...");

    // Remove resize listener (re-adds itself every time modal loads)
    window.removeEventListener('resize', modalResizeHandler);

    // Optionally clear DOM edits if needed (e.g., clear network containers)
    const container = document.getElementById('savedNetworksContainer');
    if (container) container.innerHTML = '<p>Loading saved networks...</p>';
  }

  // Save a named reference to remove easily
  function modalResizeHandler() {
    const modal = document.getElementById('settingsModal');
    if (modal && modal.offsetParent !== null) {
      updateFrameShape();
    }
  }


  function scanNetworks() {
      let ssidSelect = document.getElementById('ssidList');

      // Always clear existing scanning text and dropdown
      let existingText = document.getElementById('scanningText');
      if (existingText) existingText.remove();

      ssidSelect.style.display = 'none';
      ssidSelect.innerHTML = '';  // clear old entries

      let scanningText = document.createElement('div');
      scanningText.id = 'scanningText';
      scanningText.innerText = "Scanning for Networks...";
      ssidSelect.parentNode.insertBefore(scanningText, ssidSelect);

      fetch('/listwifi')
        .then(response => response.json())
        .then(data => {
          let existingText = document.getElementById('scanningText');
          if (existingText) existingText.remove();

          if (data.length === 0) {
            let retryText = document.createElement('div');
            retryText.id = 'scanningText';
            retryText.innerText = "No networks found, retrying...";
            ssidSelect.parentNode.insertBefore(retryText, ssidSelect);

            setTimeout(scanNetworks, 3000); // retry after 3 seconds
            return;
          }

          data.forEach(function(network) {
            let option = document.createElement('option');
            option.value = network.ssid;
            option.innerText = network.ssid + " (" + network.rssi + "dBm)";
            ssidSelect.appendChild(option);
          });

          ssidSelect.style.display = 'block';
        })
        .catch(error => {
          console.error("Error fetching Wi-Fi list:", error);
          let existingText = document.getElementById('scanningText');
          if (existingText) existingText.innerText = "Error scanning Wi-Fi, retrying...";
          setTimeout(scanNetworks, 3000);
        });
  }

	function loadSavedNetworks() {
	  fetch('/list_saved_wifi')
		.then(response => response.json())
		.then(data => {
		  const container = document.getElementById('savedNetworksContainer');
		  container.innerHTML = '';
		  data.forEach(net => {
			const div = document.createElement('div');
			div.className = 'wifi-row';

			// SSID name
			const nameSpan = document.createElement('span');
			nameSpan.innerText = net.ssid;
			nameSpan.style.fontWeight = 'bold';
			div.appendChild(nameSpan);

			// Pencil/Edit icon button
			const editBtn = document.createElement('button');
			editBtn.title = "Edit Wi-Fi settings";
			editBtn.style.marginLeft = '8px';
			editBtn.innerHTML = `
			  <svg width="18" height="18" fill="currentColor" viewBox="0 0 20 20">
				<path d="M17.414 2.586a2 2 0 010 2.828l-10 10a2 2 0 01-.707.414l-4 1a1 1 0 01-1.265-1.265l1-4a2 2 0 01.414-.707l10-10a2 2 0 012.828 0zm-10 12.828L15 5.828l-2.828-2.828-10 10V15h2.172z"/>
			  </svg>`;
			editBtn.onclick = () => showWifiEditModal(net);
			div.appendChild(editBtn);

			container.appendChild(div);
		  });
		})
		.catch(err => {
		  console.error('Failed to load saved networks:', err);
		  document.getElementById('savedNetworksContainer').innerText = 'Error loading saved networks.';
		});
	}

	function showWifiEditModal(net) {
		
	  let modal = document.getElementById('wifiEditModal');
	  if (!modal) {
		modal = document.createElement('div');
		modal.id = 'wifiEditModal';
		modal.className = 'modal';
		modal.innerHTML = `
		  <div class="modal-content">
			<h3>Edit Wi-Fi: <span id="wifiEditSSID"></span></h3>
			<label>Password:</label><br>
			<input type="password" id="wifiEditPassword" style="width:100%;margin-bottom:10px;">
			<span id="wifiEditShow" style="cursor:pointer;margin-left:4px;">👁️</span>
			<br><br>
			<label>Retry Count:</label><br>
			<input type="number" min="1" max="10" id="wifiEditRetry" style="width:60px;margin-bottom:14px;"><br>
			<label>
			  <input type="checkbox" id="wifiEditAutoReconnect" style="margin-right:6px;vertical-align:middle;">
			  Auto-reconnect
			</label>
			<br>
			<button id="wifiEditTryConnect" style="margin:12px 0 18px 0;float:right;">🔄 Try Connect Now</button>
			<div style="clear:both"></div>
			<div style="text-align:right;">
			  <button id="wifiEditSave" style="margin-right:8px;">💾 Save</button>
			  <button id="wifiEditCancel">✖ Cancel</button>
			</div>
		  </div>
		`;
		document.body.appendChild(modal);

		// Dismiss by clicking outside
		modal.onclick = (e) => {
		  if (e.target === modal) modal.style.display = 'none';
		};
	  }

	  // Update content for this network
	  document.getElementById('wifiEditSSID').textContent = net.ssid;
	  const passField = document.getElementById('wifiEditPassword');
	  const retryField = document.getElementById('wifiEditRetry');
	  const autoReconnect = document.getElementById('wifiEditAutoReconnect');
	  const tryBtn = document.getElementById('wifiEditTryConnect');

	  passField.value = net.password || '';
	  retryField.value = net.retry || 3;
	  autoReconnect.checked = net.autoReconnect !== false;

	  // Show/hide password
	  document.getElementById('wifiEditShow').onclick = () => {
		passField.type = passField.type === 'password' ? 'text' : 'password';
	  };

	  // Try Connect Now
	  tryBtn.onclick = () => {
		fetch(`/wifi_try_connect?ssid=${encodeURIComponent(net.ssid)}`, { method: 'POST' })
		  .then(r => r.text())
		  .then(txt => {
			showToast(txt.startsWith("Connected") ? `🔄 Connecting to ${net.ssid}...` : `⚠️ ${txt}`, !txt.startsWith("Connected"));
		  });
	  };

	  // Save changes
		document.getElementById('wifiEditSave').onclick = () => {
		  const newPass = passField.value;
		  const newRetry = Math.min(10, Math.max(1, parseInt(retryField.value) || 3));
		  const autoRe = autoReconnect.checked;

		  // Save password and retry count
		  updateSavedPassword(net.ssid, newPass);
		  updateRetryCount(net.ssid, newRetry);

		  // Send autoReconnect using proper POST body
		  const postData = `ssid=${encodeURIComponent(net.ssid)}&enabled=${autoRe ? 1 : 0}`;
		  fetch(`/wifi_set_autoreconnect`, {
			method: 'POST',
			headers: {
			  'Content-Type': 'application/x-www-form-urlencoded'
			},
			body: postData
		  })
		  .then(response => {
			if (!response.ok) {
			  throw new Error(`Server responded with ${response.status}`);
			}
			modal.style.display = 'none';
			setTimeout(loadSavedNetworks, 400);
		  })
		  .catch(err => {
			console.error("AutoReconnect update failed:", err);
			showToast("❌ Failed to update auto-reconnect", true);
		  });
		};


	  // Cancel button
	  document.getElementById('wifiEditCancel').onclick = () => {
		modal.style.display = 'none';
	  };

	  // Show modal
	  modal.style.display = 'flex';
	}




  function updateRetryCount(ssid, retries) {
    fetch(`/update_retry_count?ssid=${encodeURIComponent(ssid)}&count=${retries}`)
      .then(response => {
        if (response.ok) {
          showToast(`🔁 Retry count set to ${retries} for ${ssid}`);
        } else {
          showToast(`⚠️ Failed to set retry count for ${ssid}`, true);
        }
      })
      .catch(err => {
        console.error('Update retry count error:', err);
        showToast(`❌ Error updating retry count for ${ssid}`, true);
      });
  }

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
		ae_level: parseInt(getVal("camAELevel"))
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

  // ---- Helpers ----
  function setVal(id, v, def=0) {
	const el = document.getElementById(id);
	if (el) { el.value = v ?? def; if (el.type === "range" || el.type === "number") updateSliderValue(id); }
  }
  function setChecked(id, v, def=0) {
	const el = document.getElementById(id);
	if (el) el.checked = ((v ?? def) == 1);
  }
  function setRadio(name, v, def=0) {
	const radio = document.querySelector(`input[name="${name}"][value="${v ?? def}"]`);
	if (radio) radio.checked = true;
  }


  function connectToSavedNetwork(ssid) {
      fetch(`/connect_saved_wifi?ssid=${encodeURIComponent(ssid)}`)
        .then(response => {
          if (response.ok) {
            showToast(`✅ Connecting to ${ssid}`);
          } else {
            showToast(`⚠️ Failed to connect to ${ssid}`, true);
          }
        })
        .catch(err => {
          console.error('Connect error:', err);
          showToast(`❌ Connection error for ${ssid}`, true);
        });
  }

  function updateSavedPassword(ssid, newPass) {
      fetch(`/update_wifi_password?ssid=${encodeURIComponent(ssid)}&password=${encodeURIComponent(newPass)}`)
        .then(response => {
          if (response.ok) {
            showToast(`✅ Password updated for ${ssid}`);
          } else {
            showToast(`⚠️ Failed to update password for ${ssid}`, true);
          }
        })
        .catch(err => {
          console.error('Update password error:', err);
          showToast(`❌ Error updating password for ${ssid}`, true);
        });
  }

	window.openCamSettings = function() {
	  fetchCamSettings();
	}

  function saveRobotConfig() {
    const left = document.getElementById("gpioLeft").value;
    const right = document.getElementById("gpioRight").value;
    const servo = document.getElementById("gpioServo").value;

    const payload = `GPIO,Left,${left};Right,${right};Servo,${servo}`;
    if (websocketCarInput && websocketCarInput.readyState === WebSocket.OPEN) {
      websocketCarInput.send(payload);
      showToast("✅ GPIO config sent");
    } else {
      showToast("❌ WebSocket not connected", true);
    }
  }

  window.updateFrameShape = function() {
    const modal = document.getElementById('settingsModal');
    const frame = document.getElementById('modalFrameShape');
    const activeBtn = document.querySelector('.tabButton.active');
    if (!modal || !frame || !activeBtn) return;

    const modalRect = modal.getBoundingClientRect();
    const btnRect = activeBtn.getBoundingClientRect();

    const offset = -10;      // 🔸 offset from left, right, bottom
    const topOffset = -50;   // 🔸 separate top offset
    const cut = 12;
    const notchHeight = 14;
    const notchPad = 6;

    const left = btnRect.left - modalRect.left - offset;
    const right = btnRect.right - modalRect.left - offset;

    const clip = `polygon(
      ${offset}px ${topOffset + cut}px,
      ${offset + cut}px ${topOffset}px,
      ${left - notchPad}px ${topOffset}px,
      ${left}px ${topOffset + notchHeight}px,
      ${right}px ${topOffset + notchHeight}px,
      ${right + notchPad}px ${topOffset}px,
      calc(100% - ${offset + cut}px) ${topOffset}px,
      calc(100% - ${offset}px) ${topOffset + cut}px,
      calc(100% - ${offset}px) calc(100% - ${cut}px),
      calc(100% - ${offset + cut}px) calc(100% - ${offset}px),
      ${offset + cut}px calc(100% - ${offset}px),
      ${offset}px calc(100% - ${offset + cut}px)
    )`;

    frame.style.clipPath = clip;
  }

  window.addEventListener('resize', () => {
    const modal = document.getElementById('settingsModal');
    if (modal && modal.offsetParent !== null) {
      updateFrameShape();
    }

  });

  window.uploadFirmware = function () {
    const fileInput = document.getElementById("otaFile");
    const status = document.getElementById("otaStatus");
    const progress = document.getElementById("otaProgress");
    const file = fileInput.files[0];

    if (!file) {
      status.innerText = "Please select a file.";
      return;
    }

    // ⚠️ Battery warning if below 50%
    if (latestBatteryPercent < 50) {
      const proceed = confirm(
        `⚠️ Battery is at ${latestBatteryPercent}%.\nIt's recommended to have at least 50% to prevent failure during update.\nContinue anyway?`
      );
      if (!proceed) {
        status.innerText = "❌ Upload cancelled due to low battery.";
        return;
      }
    }

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/ota/upload", true);

    xhr.upload.onprogress = function (e) {
      if (e.lengthComputable) {
        progress.style.display = "block";
        progress.value = (e.loaded / e.total) * 100;
      }
    };

    xhr.onreadystatechange = function () {
      if (xhr.readyState === 4) {
        if (xhr.status === 200) {
          status.innerText = "✅ Upload successful. Rebooting...";
          setTimeout(() => location.reload(), 5000);
        } else if (xhr.status === 0) {
          status.innerText = "✅ Firmware uploaded. Waiting for reboot...";
          setTimeout(() => location.reload(), 6000);
        } else {
          status.innerText = "❌ Upload failed.";
        }
      }
    };

    const formData = new FormData();
    formData.append("update", file);
    xhr.send(formData);
  };


  window.onFirmwareFileSelected = function () {
    const fileInput = document.getElementById("otaFile");
    const file = fileInput.files[0];
    const status = document.getElementById("otaStatus");
    const versionBox = document.getElementById("versionCompare");
    const selected = document.getElementById("selectedVersion");
    const current = document.getElementById("currentVersion");
    const uploadBtn = document.getElementById("uploadBtn");

    if (!file) {
      versionBox.style.display = "none";
      uploadBtn.style.display = "none";
      return;
    }

    const reader = new FileReader();
    reader.onload = function (e) {
      const bin = new Uint8Array(e.target.result);
      const text = new TextDecoder().decode(bin);

      // Find all version strings in the text
      const allMatches = [...text.matchAll(/v\d+\.\d+\.\d{1,2}(?: ?[A-Za-z]+)?/gi)];

      console.log("All version matches found:", allMatches.map(m => m[0]));

      // Use the last match (usually your firmware version)
      let match = null;
      if (allMatches.length > 0) {
        match = [null, allMatches[allMatches.length - 1][0]]; // last match
      } else {
        match = null;
      }

      selected.innerText = match ? match[1] : "❓ Unknown";

      fetch("/version")
        .then(res => res.json())
        .then(data => {
          current.innerText = data.current;
          versionBox.style.display = "block";
          uploadBtn.style.display = "inline-block";
          status.innerText = "";
        })
        .catch(() => {
          current.innerText = "❌ Failed";
          status.innerText = "❌ Could not fetch current firmware version.";
        });
    };

    reader.onerror = () => {
      versionBox.style.display = "none";
      uploadBtn.style.display = "none";
      status.innerText = "❌ Failed to read selected firmware file.";
    };

    // Only read the first 4096 bytes — enough for string table
    reader.readAsArrayBuffer(file.slice(0, 32768));
  };

  function compareVersions(a, b) {
    // Remove v/V prefix, trim, and ignore suffix like " Beta" or "Beta"
    a = a.replace(/^v/i, '').split(/[^\d.]+/)[0].split('.').map(Number);
    b = b.replace(/^v/i, '').split(/[^\d.]+/)[0].split('.').map(Number);

    while (a.length < 3) a.push(0);
    while (b.length < 3) b.push(0);

    for (let i = 0; i < 3; ++i) {
      if (a[i] > b[i]) return 1;
      if (a[i] < b[i]) return -1;
    }
    return 0;
  }

  function checkForUpdates(showAlert = false) {
    Promise.all([
      fetch('/version').then(r => r.json()),
      fetch('https://api.github.com/repos/elik745i/miniexco.v1/releases/latest').then(r => r.json())
    ])
    .then(([local, github]) => {
      const current = local.current.replace(/^v/, '');
      const latest = github.tag_name.replace(/^v/, '');
      const binUrl = github.assets.find(a => a.name.endsWith(".bin"))?.browser_download_url;

      if (compareVersions(latest, current) > 0 && binUrl) {
        if (confirm(`🆕 New firmware v${latest} available (current: v${current})\nDo you want to update now?`)) {
          // ✅ Check battery before OTA
          if (latestBatteryPercent < 50) {
            alert(`❌ Battery too low (${latestBatteryPercent}%). Please charge above 50% to update.`);
            return;
          }
          startOTA(binUrl);
        }
      } else if (showAlert) {
        alert(`✅ Already on latest version (v${current})`);
      }
    })
    .catch(err => {
      console.error("Update check failed:", err);
      if (showAlert) alert("❌ Failed to check for updates.");
    });
  }



  function startOTA(url) {
    fetch(url)
      .then(r => {
        if (!r.ok) throw new Error("Download failed");
        return r.blob();
      })
      .then(blob => {
        const formData = new FormData();
        formData.append("update", blob, "firmware.bin");

        const xhr = new XMLHttpRequest();
        xhr.open("POST", "/ota/upload", true); // Use working endpoint

        xhr.upload.onprogress = function(e) {
          if (e.lengthComputable) {
            const percent = (e.loaded / e.total) * 100;
            console.log(`Uploading: ${percent.toFixed(1)}%`);
          }
        };

        xhr.onload = function() {
          if (xhr.status === 200) {
            alert("✅ Firmware updated. Rebooting...");
          } else {
            alert("❌ Update failed: " + xhr.statusText);
          }
        };

        xhr.send(formData);
      })
      .catch(err => {
        console.error("OTA failed:", err);
        alert("❌ OTA update failed: " + err.message);
      });
  }


  function loadControlScript(callback) {
    if (controlScriptLoaded) {
      if (typeof callback === "function") callback();
      return;
    }

    const script = document.createElement("script");
    script.src = "/controlScript.js?v=" + Date.now();
    script.onload = () => {
      controlScriptLoaded = true;
      console.log("✅ Control script loaded dynamically.");
      if (typeof callback === "function") callback();
    };
    document.body.appendChild(script);
  }

  //Telemetry tab----------------------------------------------------------------

  function updateCalibrationStatus(sys, gyro, accel, mag) {
    document.getElementById("sysCal").textContent = sys;
    document.getElementById("gyroCal").textContent = gyro;
    document.getElementById("accelCal").textContent = accel;
    document.getElementById("magCal").textContent = mag;
  }

  function triggerCalibration() {
    fetch("/calibrate_imu", { method: "POST" })
      .then(res => res.text())
      .then(msg => {
        document.getElementById("calibStatus").textContent = msg;
      });
  }

  function loadCalibrationData() {
    fetch("/get_calibration")
      .then(res => res.json())
      .then(data => {
        updateCalibrationStatus(data.sys, data.gyro, data.accel, data.mag);
        document.getElementById("calibBtn").textContent = data.stored ? "Recalibrate" : "Calibrate";
      });
  }

  window.showTab = function(tabId, button) {
    const tabs = document.querySelectorAll(".tabContent");
    const buttons = document.querySelectorAll(".tabButton");

    // Hide all tabs and remove active class
    tabs.forEach(tab => {
      tab.style.display = "none";
      tab.classList.remove("active");
    });
    buttons.forEach(btn => btn.classList.remove("active"));

    // Show selected tab and apply active class
    const selectedTab = document.getElementById(tabId);
    if (selectedTab) {
      selectedTab.style.display = "block";
      selectedTab.classList.add("active");
    }
    if (button) button.classList.add("active");

    // Special case for Controls tab to load key mappings
    if (tabId === "keysTab") {
      loadControlScript(() => {
        if (typeof loadKeyMappings === "function") loadKeyMappings();
      });
    }

    if (tabId === "wifiTab") {
      if (typeof loadSavedNetworks === "function") loadSavedNetworks();
    }

    if (tabId === "telemetryTab") {
      if (websocketCarInput && websocketCarInput.readyState === WebSocket.OPEN) {
        websocketCarInput.send("IMU,REQUEST_CALIB");
      }
    }

	if (tabId === "robotTab") {
		initRobotConfigTab();
	  }

	if (tabId === "sdTab") {
	  loadSdScript(() => {
		loadSdFileList(true);
		attachRebootBtnHandler();
		updateSdCapacityBar();
	  });
	}

	if (tabId === "otaTab") {
	  if (typeof updateFirmwareVersion === "function") updateFirmwareVersion();
	}
	
    if (typeof updateFrameShape === "function") updateFrameShape();
  };


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

  
	// In modalScript.js:
	function handleModalWebSocketMessage(key, value) {
	  if (key === "DarkMode") {
		const darkToggle = document.getElementById('darkToggle');
		if (darkToggle) darkToggle.checked = (value == "1");
		toggleDarkMode(value == "1");
	  }
	  if (key === "HoldBucket") {
		const el = document.getElementById('holdBucketSwitch');
		if (el) el.checked = (value == "1");
	  }
	  if (key === "HoldAux") {
		const el = document.getElementById('holdAuxSwitch');
		if (el) el.checked = (value == "1");
	  }
	  if (key === "Switch") {
		const el = document.getElementById('powerSwitch');
		if (el) el.checked = (value == "1");
	  }
	  // ...add more modal-relevant handlers if needed
	}


function initRobotConfigTab() {
  // Dark Mode
  const darkToggle = document.getElementById("darkToggle");
  if (darkToggle) {
    // Sync checkbox on open
    darkToggle.checked = (localStorage.getItem("darkMode") === "1");
    // Add handler
    darkToggle.onchange = function() {
      toggleDarkMode(this.checked);
    };
  }

  // Horizontal Screen
  const powerSwitch = document.getElementById("powerSwitch");
  if (powerSwitch) {
    // Initial sync: get value from server/localStorage/whatever (optional)
    // For demo, skip
    powerSwitch.onchange = function() {
      sendButtonInput("Switch", this.checked ? 1 : 0);
    };
  }

  // Hold Bucket
  const holdBucketSwitch = document.getElementById("holdBucketSwitch");
  if (holdBucketSwitch) {
    holdBucketSwitch.onchange = function() {
      sendButtonInput("HoldBucket", this.checked ? 1 : 0);
    };
  }

  // Hold Aux
  const holdAuxSwitch = document.getElementById("holdAuxSwitch");
  if (holdAuxSwitch) {
    holdAuxSwitch.onchange = function() {
      sendButtonInput("HoldAux", this.checked ? 1 : 0);
    };
  }
}
	function syncDarkToggleCheckbox() {
	  const darkToggle = document.getElementById("darkToggle");
	  if (darkToggle) {
		darkToggle.checked = (localStorage.getItem("darkMode") === "1");
	  }
	}

function updateFirmwareVersion() {
  fetch("/version")
    .then(r => r.json())
    .then(data => {
      document.getElementById("fwVersionNum").innerText = data.current || "unknown";
      // Optionally update other version displays, e.g. in versionCompare
      if(document.getElementById("currentVersion")) {
        document.getElementById("currentVersion").innerText = data.current || "-";
      }
    })
    .catch(() => {
      document.getElementById("fwVersionNum").innerText = "unknown";
      if(document.getElementById("currentVersion")) {
        document.getElementById("currentVersion").innerText = "-";
      }
    });
}

function reloadCameraStream() {
  const stream = document.getElementById("cameraStream");
  if (stream) {
    // Reload with cache-buster so browser doesn't re-use old MJPEG connection
    stream.src = "http://" + location.hostname + ":81/stream?t=" + Date.now();
  }
}

// Register it on script load
window.addEventListener('resize', modalResizeHandler);

function loadSdScript(callback) {
  if (sdScriptLoaded) {
    if (typeof callback === "function") callback();
    return;
  }
  const script = document.createElement("script");
  script.src = "/sdFileManager.js?v=" + Date.now();
  script.onload = () => {
    sdScriptLoaded = true;
    console.log("✅ SD File Manager script loaded dynamically.");
    if (typeof callback === "function") callback();
  };
  document.body.appendChild(script);
}

(function() {
  const modal = document.getElementById('settingsModal');
  const moveBar = document.getElementById('settingsModalMoveBar');
  let dragData = null;

  // --- DRAG: Only the move bar ---
  if (moveBar) {
    moveBar.style.cursor = "move";
	moveBar.onmousedown = function(e) {
	  if (modal.style.transform && modal.style.transform.includes('translate')) {
		const rect = modal.getBoundingClientRect();
		modal.style.left = rect.left + "px";
		modal.style.top = rect.top + "px";
		modal.style.transform = "";
		modal.style.position = "fixed";
	  }
	  dragData = {
		startX: e.clientX,
		startY: e.clientY,
		startLeft: modal.offsetLeft,
		startTop: modal.offsetTop,
		startW: modal.offsetWidth,
		startH: modal.offsetHeight
	  };
	  document.body.style.userSelect = "none";
	  window.onmousemove = function(ev) {
		if (!dragData) return;
		const dx = ev.clientX - dragData.startX;
		const dy = ev.clientY - dragData.startY;
		// ---- NO CLAMPING ----
		modal.style.left = (dragData.startLeft + dx) + "px";
		modal.style.top  = (dragData.startTop  + dy) + "px";
	  };
	  window.onmouseup = function() {
		if (!dragData) return;
		saveModalGeometry();
		dragData = null;
		window.onmousemove = null;
		window.onmouseup = null;
		document.body.style.userSelect = "";
	  };
	};


  }

  // --- RESIZE ---
  let resizeData = null;
	modal.querySelectorAll('.modal-resize-handle').forEach(handle => {
	  handle.onmousedown = function(e) {
		e.preventDefault();
		modal.style.transform = ""; // Remove centering on resize
		const dir = Array.from(handle.classList).find(cls => cls.startsWith('modal-resize-')).replace('modal-resize-', '');
		resizeData = {
		  dir,
		  startX: e.clientX,
		  startY: e.clientY,
		  startLeft: modal.offsetLeft,
		  startTop: modal.offsetTop,
		  startW: modal.offsetWidth,
		  startH: modal.offsetHeight
		};
		document.body.style.userSelect = "none";
		window.onmousemove = function(ev) {
		  if (!resizeData) return;
		  let {dir, startX, startY, startLeft, startTop, startW, startH} = resizeData;
		  let dx = ev.clientX - startX, dy = ev.clientY - startY;
		  let minW = 480, minH = 660;
		  let maxW = window.innerWidth * 0.94, maxH = window.innerHeight * 0.90;
		  let newLeft = startLeft, newTop = startTop, newW = startW, newH = startH;

		  // ---- CORNER HANDLES ----
		  if (dir === "se") { // Bottom-Right: width/height grow only
			newW = Math.min(maxW, Math.max(minW, startW + dx));
			newH = Math.min(maxH, Math.max(minH, startH + dy));
			// left/top remain
		  } else if (dir === "sw") { // Bottom-Left: left increases, width shrinks, height grows
			newW = Math.min(maxW, Math.max(minW, startW - dx));
			newLeft = startLeft + dx;
			if (newW <= minW) newLeft = startLeft + (startW - minW);
			newH = Math.min(maxH, Math.max(minH, startH + dy));
			// top remains
		  } else if (dir === "ne") { // Top-Right: width grows, top increases, height shrinks
			newW = Math.min(maxW, Math.max(minW, startW + dx));
			newH = Math.min(maxH, Math.max(minH, startH - dy));
			newTop = startTop + dy;
			if (newH <= minH) newTop = startTop + (startH - minH);
			// left remains
		  } else if (dir === "nw") { // Top-Left: left/top increase, width/height shrink
			newW = Math.min(maxW, Math.max(minW, startW - dx));
			newLeft = startLeft + dx;
			if (newW <= minW) newLeft = startLeft + (startW - minW);
			newH = Math.min(maxH, Math.max(minH, startH - dy));
			newTop = startTop + dy;
			if (newH <= minH) newTop = startTop + (startH - minH);
		  }
		  // ---- EDGE HANDLES (optional, no change) ----
		  else {
			if (dir === "n") {
			  newH = Math.min(maxH, Math.max(minH, startH - dy));
			  newTop = startTop + dy;
			  if (newH <= minH) newTop = startTop + (startH - minH);
			} else if (dir === "s") {
			  newH = Math.min(maxH, Math.max(minH, startH + dy));
			}
			if (dir === "e") {
			  newW = Math.min(maxW, Math.max(minW, startW + dx));
			} else if (dir === "w") {
			  newW = Math.min(maxW, Math.max(minW, startW - dx));
			  newLeft = startLeft + dx;
			  if (newW <= minW) newLeft = startLeft + (startW - minW);
			}
		  }
		  modal.style.width = newW + "px";
		  modal.style.height = newH + "px";
		  modal.style.left = newLeft + "px";
		  modal.style.top = newTop + "px";
		};

		window.onmouseup = function() {
		  if (!resizeData) return;
		  saveModalGeometry();
		  resizeData = null;
		  window.onmousemove = null;
		  window.onmouseup = null;
		  document.body.style.userSelect = "";
		};
	  };
	});


  // --- SAVE / RESTORE ---
  function saveModalGeometry() {
    const geo = {
      left: modal.offsetLeft,
      top: modal.offsetTop,
      width: modal.offsetWidth,
      height: modal.offsetHeight
    };
    sessionStorage.setItem("settingsModal-geom", JSON.stringify(geo));
  }

	function restoreModalGeometry() {
	  const modal = document.getElementById('settingsModal');
	  const geo = sessionStorage.getItem("settingsModal-geom");
	  const minW = 480, minH = 660;
	  const maxW = window.innerWidth  * 0.94;
	  const maxH = window.innerHeight * 0.90;

	  if (geo && modal) {
		const g = JSON.parse(geo);
		const width  = Math.max(minW, Math.min(g.width  || 740, maxW));
		const height = Math.max(minH, Math.min(g.height || 500, maxH));
		// Clamp position so modal never goes out of view (fully visible)
		const maxLeft = window.innerWidth  - width;
		const maxTop  = window.innerHeight - height;
		const left = Math.max(0, Math.min(g.left || 40, maxLeft));
		const top  = Math.max(0, Math.min(g.top  || 40, maxTop));

		modal.style.left = left + "px";
		modal.style.top  = top  + "px";
		modal.style.width  = width  + "px";
		modal.style.height = height + "px";
		modal.style.transform = ""; // Remove centering!
		modal.style.position = "fixed";
	  } else if (modal) {
		// Default: use CSS centering only!
		modal.style.left = "50%";
		modal.style.top = "50%";
		modal.style.transform = "translate(-50%, -50%)";
		modal.style.position = "fixed";
		modal.style.width = "";   // Let CSS/min/max handle sizing
		modal.style.height = "";
	  }
	}


  window.restoreModalGeometry = restoreModalGeometry;

  // Restore on page load
  setTimeout(restoreModalGeometry, 20);
})();


