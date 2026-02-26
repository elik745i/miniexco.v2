// --- OLED TAB LOGIC ---

function loadOledSettings() {
	fetch("/get_oled_settings")
	.then(r => r.json())
	.then(data => {
		setVal("oledLayout", data.layout || "default");
		setChecked("oledShowIP", data.showIP);
		setChecked("oledShowBattery", data.showBattery);
		setChecked("oledShowWiFi", data.showWiFi);
		document.getElementById("oledAnimationUpload").style.display = (data.layout === "animation") ? "block" : "none";
	});
}

function saveOledSettings() {
	const layout = document.getElementById("oledLayout").value;
	const payload = {
		layout,
		showIP: document.getElementById("oledShowIP").checked,
		showBattery: document.getElementById("oledShowBattery").checked,
		showWiFi: document.getElementById("oledShowWiFi").checked
	};

	fetch("/set_oled_settings", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(payload)
	}).then(r => {
		if (r.ok) {
			document.getElementById("oledSaveStatus").textContent = "✅ OLED settings saved!";
		} else {
			document.getElementById("oledSaveStatus").textContent = "❌ Failed to save.";
		}
	});
}

function uploadOledAnimation() {
	const fileInput = document.getElementById("oledAnimFile");
	const status = document.getElementById("oledAnimStatus");
	if (!fileInput.files.length) {
		status.textContent = "⚠️ No file selected.";
		return;
	}

	const formData = new FormData();
	formData.append("oledAnim", fileInput.files[0]);

	fetch("/upload_oled_anim", {
		method: "POST",
		body: formData
	}).then(r => {
		if (r.ok) {
			status.textContent = "✅ Animation uploaded!";
		} else {
			status.textContent = "❌ Upload failed.";
		}
	});
}

// --- ENTRY POINT FOR TAB ---
window.loadOledTab = function() {
	// Always (re)load settings
	loadOledSettings();

	// Layout dropdown: Show/hide animation upload field
	const layout = document.getElementById("oledLayout");
	if (layout) {
		layout.onchange = function(e) {
			document.getElementById("oledAnimationUpload").style.display = (layout.value === "animation") ? "block" : "none";
		};
	}

	// Save button
	const saveBtn = document.getElementById("oledSaveBtn");
	if (saveBtn) saveBtn.onclick = saveOledSettings;

	// Upload animation button
	const uploadBtn = document.getElementById("oledAnimUploadBtn");
	if (uploadBtn) uploadBtn.onclick = uploadOledAnimation;

	// (Optional: reset statuses/messages if you want)
	const status = document.getElementById("oledSaveStatus");
	if (status) status.textContent = "";

	const animStatus = document.getElementById("oledAnimStatus");
	if (animStatus) animStatus.textContent = "";
};
