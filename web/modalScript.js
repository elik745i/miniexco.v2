//--- modalScript.js --//

(function () {
  if (window.__modalScriptInit__) {
    console.log("↩️ modalScript already initialized; skipping.");
    return;
  }
  window.__modalScriptInit__ = true;


	// --- Script load flags ---
	let controlScriptLoaded = false;
	let sdScriptLoaded = false;
	let mqttScriptLoaded = false;
	let mediaScriptLoaded = false;
	let oledScriptLoaded = false;
	let otaScriptLoaded = false;
	let telemetryScriptLoaded = false;
	let wifiSettingsScriptLoaded = false;
	let cameraScriptLoaded = false;
	let robotConfigScriptLoaded = false;

	// --- MEDIA TAB LOGIC ---
	window.MEDIA_PATHS = {
		photo: '/media/capture/photo',
		video: '/media/capture/video',
		audio: '/media/wav'
	};

	// --- Modal unload helper ---
	function onunloadModal() {
		console.log("🧹 Cleaning up modal...");
		// Optionally clear DOM edits if needed (e.g., clear network containers)
		const container = document.getElementById('savedNetworksContainer');
		if (container) container.innerHTML = '<p>Loading saved networks...</p>';
	}

	// --- UI helpers ---
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

	// --- Dynamic tab loader & script loader ---
	window.showTab = function (tabId, button) {
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
			selectedTab.style.display = "flex";
			selectedTab.style.flexDirection = "column";
			selectedTab.style.minHeight = "0";
			selectedTab.classList.add("active");
		}

		// Highlight the triggering button OR find the matching one
		if (button) {
			button.classList.add("active");
		} else {
			// Fallback: find the button whose onclick references this tabId
			const guessBtn =
				document.querySelector(`.tabButton[data-tab="${tabId}"]`) ||
				Array.from(document.querySelectorAll(".tabButton"))
					.find(b => (b.getAttribute("onclick") || "").includes(`'${tabId}'`));
			if (guessBtn) guessBtn.classList.add("active");
		}

		// Remember last selected tab for next open
		try { localStorage.setItem("settingsLastTab", tabId); } catch (e) {}

		// ---- Script load by tab (defensive: only call if function exists) ----
		if (tabId === "keysTab") {
			if (typeof loadControlScript === "function") {
				loadControlScript(() => {
					if (typeof loadKeyMappings === "function") loadKeyMappings();
					if (typeof loadJoyMappings === "function") loadJoyMappings();
					if (typeof initGamepadSwitch === "function") initGamepadSwitch();
				});
			}
		}

		if (tabId === "wifiTab") {
			if (typeof loadWifiSettingsScript === "function") {
				loadWifiSettingsScript(() => {
					if (typeof loadWifiTab === "function") {
					loadWifiTab();
					 } else {
						 // Fallback if the function name ever changes
						 if (typeof initApPasswordUi === "function") initApPasswordUi();
						 if (typeof loadSavedNetworks === "function") loadSavedNetworks();
					 }					
				});
			}
		}

		if (tabId === "camTab") {
			if (typeof loadCameraScript === "function") {
				loadCameraScript(() => {
					if (typeof fetchCamSettings === "function") fetchCamSettings();
				});
			}
		}

		if (tabId === "mqttTab") {
			if (typeof loadMqttScript === "function") {
				loadMqttScript(() => {
					// fix: check the function you actually call
					if (typeof loadMqttTab === "function") loadMqttTab();
				});
			}
		}

		if (tabId === "telemetryTab") {
			if (typeof loadTelemetryScript === "function") {
				loadTelemetryScript(() => {
					if (typeof loadTelemetryTab === "function") loadTelemetryTab();
				});
			}
		}

		if (tabId === "robotTab") {
			if (typeof loadRobotConfigScript === "function") {
				loadRobotConfigScript(() => {
					if (typeof initRobotConfigTab === "function") initRobotConfigTab();
				});
			}
		}

		if (tabId === "sdTab") {
			if (typeof loadSdScript === "function") {
				loadSdScript(() => {
					if (typeof loadSdFileListWithPolling === "function") loadSdFileListWithPolling(true);
					else if (typeof loadSdFileList === "function") loadSdFileList(true);
					if (typeof attachRebootBtnHandler === "function") attachRebootBtnHandler();
					if (typeof updateSdCapacityBar === "function") updateSdCapacityBar();
				});
			}
		}

		if (tabId === "oledTab") {
			if (typeof loadOledScript === "function") {
				loadOledScript(() => {
					if (typeof loadOledTab === "function") loadOledTab();
				});
			}
		}

		if (tabId === "otaTab") {
			if (typeof loadOtaScript === "function") {
				loadOtaScript(() => {
					if (typeof loadOtaTab === "function") loadOtaTab();
				});
			}
		}

		if (tabId === "mediaTab") {
			if (typeof loadMediaScript === "function") {
				loadMediaScript(() => {
					if (typeof loadMediaTab === "function") loadMediaTab();
				});
			}
		}
		if (tabId === "viewTab") {
			if (typeof window.initViewWidgetPalette === "function") {
				window.initViewWidgetPalette();
			}
		}
	};

	// Top sub-tabs: keyboard / joystick
	window.showControlSubTab = function (which, btn) {
		document.querySelectorAll('.subTabBtn').forEach(b => b.classList.remove('active'));
		if (btn) btn.classList.add('active');

		document.getElementById('kbSection').classList.toggle('active', which === 'kb');
		document.getElementById('joySection').classList.toggle('active', which === 'joy');

		// ✅ When switching to joystick, repopulate & validate
		if (which === 'joy' && typeof window.initJoystickSubtab === 'function') {
			window.initJoystickSubtab();
		}
	};

	// Keyboard inner panes: movement / claw / lights
	window.showKeyboardPane = function (pane, btn) {
		document.querySelectorAll('.subSubBtn').forEach(b => b.classList.remove('active'));
		if (btn) btn.classList.add('active');

		['kbMovePane','kbClawPane','kbLightsPane'].forEach(id =>
			document.getElementById(id)?.classList.remove('active')
		);
		const map = { move: 'kbMovePane', claw: 'kbClawPane', lights: 'kbLightsPane' };
		document.getElementById(map[pane])?.classList.add('active');
	};

	// --- Script loader functions ---
	function loadControlScript(callback) {
		if (controlScriptLoaded) { if (typeof callback === "function") callback(); return; }
		const script = document.createElement("script");
		script.src = "/controlScript.js?v=" + Date.now();
		script.onload = () => { controlScriptLoaded = true; if (typeof callback === "function") callback(); };
		document.body.appendChild(script);
	}
	function loadOledScript(callback) {
		if (oledScriptLoaded) { if (callback) callback(); return; }
		const script = document.createElement("script");
		script.src = "/oledScript.js?v=" + Date.now();
		script.onload = () => { oledScriptLoaded = true; if (callback) callback(); };
		document.body.appendChild(script);
	}
	function loadSdScript(callback) {
		if (sdScriptLoaded) { if (callback) callback(); return; }
		const script = document.createElement("script");
		script.src = "/sdFileManager.js?v=" + Date.now();
		script.onload = () => { sdScriptLoaded = true; if (callback) callback(); };
		document.body.appendChild(script);
	}
	function loadMqttScript(callback) {
		if (mqttScriptLoaded) { if (callback) callback(); return; }
		const script = document.createElement("script");
		script.src = "/mqttScript.js?v=" + Date.now();
		script.onload = () => { mqttScriptLoaded = true; if (callback) callback(); };
		document.body.appendChild(script);
	}
	function loadOtaScript(callback) {
		if (otaScriptLoaded) { if (callback) callback(); return; }
		const script = document.createElement("script");
		script.src = "/otaScript.js?v=" + Date.now();
		script.onload = () => { otaScriptLoaded = true; if (callback) callback(); };
		document.body.appendChild(script);
	}
	function loadWifiSettingsScript(callback) {
		if (wifiSettingsScriptLoaded) { if (callback) callback(); return; }
		const script = document.createElement("script");
		script.src = "/wifiSettings.js?v=" + Date.now();
		script.onload = () => { wifiSettingsScriptLoaded = true; if (callback) callback(); };
		document.body.appendChild(script);
	}
	function loadTelemetryScript(callback) {
		if (telemetryScriptLoaded) { if (callback) callback(); return; }
		const script = document.createElement("script");
		script.src = "/telemetryScript.js?v=" + Date.now();
		script.onload = () => { telemetryScriptLoaded = true; if (callback) callback(); };
		document.body.appendChild(script);
	}
	function loadCameraScript(callback) {
		if (cameraScriptLoaded) { if (callback) callback(); return; }
		const script = document.createElement("script");
		script.src = "/cameraSettings.js?v=" + Date.now();
		script.onload = () => { cameraScriptLoaded = true; if (callback) callback(); };
		document.body.appendChild(script);
	}
	function loadRobotConfigScript(callback) {
		if (robotConfigScriptLoaded) { if (callback) callback(); return; }
		const script = document.createElement("script");
		script.src = "/robotConfig.js?v=" + Date.now();
		script.onload = () => { robotConfigScriptLoaded = true; if (callback) callback(); };
		document.body.appendChild(script);
	}
	function loadMediaScript(callback) {
		if (mediaScriptLoaded) { if (callback) callback(); return; }
		const script = document.createElement("script");
		script.src = "/mediaScript.js?v=" + Date.now();
		script.onload = () => { mediaScriptLoaded = true; if (callback) callback(); };
		document.body.appendChild(script);
	}

	// --- Firmware version helper (if needed) ---
	function updateFirmwareVersion() {
		fetch("/version")
			.then(r => r.json())
			.then(data => {
				document.getElementById("fwVersionNum").innerText = data.current || "unknown";
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

	// --- Modal drag/move and restore ---
	(function() {
		const modal = document.getElementById('settingsModal');
		const moveBar = document.getElementById('settingsModalMoveBar');
			const passInput = document.getElementById('mqttPass');
			const showBtn = document.getElementById('mqttPassShow');  
		let dragData = null;

			// --- Password show/hide logic for MQTT tab ---
			if (passInput && showBtn) {
					showBtn.onclick = function() {
							if (passInput.type === "password") {
									passInput.type = "text";
									showBtn.textContent = "🙈";
							} else {
									passInput.type = "password";
									showBtn.textContent = "👁️";
							}
					};
			}

		// DRAG: Only the move bar
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
					startTop: modal.offsetTop
				};
				document.body.style.userSelect = "none";
				window.onmousemove = function(ev) {
					if (!dragData) return;
					const dx = ev.clientX - dragData.startX;
					const dy = ev.clientY - dragData.startY;
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

		// SAVE / RESTORE position/size
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
			const width = 740, height = 680; // Your fixed modal size
			if (geo && modal) {
				const g = JSON.parse(geo);
				const left = Math.max(0, Math.min(g.left || 40, window.innerWidth - width));
				const top  = Math.max(0, Math.min(g.top  || 40, window.innerHeight - height));
				modal.style.left = left + "px";
				modal.style.top  = top  + "px";
				modal.style.width  = width + "px";
				modal.style.height = height + "px";
				modal.style.transform = "";
				modal.style.position = "fixed";
			} else if (modal) {
				modal.style.left = "50%";
				modal.style.top = "50%";
				modal.style.transform = "translate(-50%, -50%)";
				modal.style.position = "fixed";
				modal.style.width = width + "px";
				modal.style.height = height + "px";
			}
		}

		window.restoreModalGeometry = restoreModalGeometry;
		setTimeout(restoreModalGeometry, 20);
	})();

	// --- Modal close/ESC/overlay click handlers ---
	document.getElementById('modalCloseBtn').onclick = toggleSettingsModal;

	window.addEventListener('keydown', function(e) {
		const modal = document.getElementById('settingsModal');
		if (modal && modal.style.display !== "none" && (e.key === "Escape" || e.key === "Esc")) {
			toggleSettingsModal();
		}
	});

	document.getElementById('settingsModal').onclick = function(e) {
		if (e.target === this) toggleSettingsModal();
	};


  // Make helper functions visible to cameraSettings.js, etc.
  window.setVal = setVal;
  window.setChecked = setChecked;
  window.setRadio = setRadio;
})(); // end guard
