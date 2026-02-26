// --- OTA TAB LOGIC ---

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

window.loadOtaTab = function() {
    // Reset status/progress fields
    const status = document.getElementById("otaStatus");
    if (status) status.textContent = "";

    const progress = document.getElementById("otaProgress");
    if (progress) {
        progress.value = 0;
        progress.style.display = "none";
    }

    // Always fetch and show current FW version in both places!
    fetch("/version")
        .then(res => res.json())
        .then(data => {
            // Main display
            const fwNum = document.getElementById("fwVersionNum");
            if (fwNum) fwNum.innerText = data.current || "❓";
            // OTA compare area
            const current = document.getElementById("currentVersion");
            if (current) current.innerText = data.current || "❓";
        })
        .catch(() => {
            const fwNum = document.getElementById("fwVersionNum");
            if (fwNum) fwNum.innerText = "❌";
            const current = document.getElementById("currentVersion");
            if (current) current.innerText = "❌ Failed";
        });

    // Hide uploadBtn, clear selectedVersion, show versionCompare box if present
    const versionBox = document.getElementById("versionCompare");
    if (versionBox) versionBox.style.display = "block";
    const uploadBtn = document.getElementById("uploadBtn");
    if (uploadBtn) uploadBtn.style.display = "none";
    const selectedVersion = document.getElementById("selectedVersion");
    if (selectedVersion) selectedVersion.innerText = "-";

    // Attach file input handler
    const fileInput = document.getElementById("otaFile");
    if (fileInput) fileInput.onchange = window.onFirmwareFileSelected;

    // Attach upload button handler
    if (uploadBtn) uploadBtn.onclick = window.uploadFirmware;

    // Optionally auto-fetch current version or check for update button
    const checkBtn = document.getElementById("checkUpdateBtn");
    if (checkBtn) checkBtn.onclick = () => checkForUpdates(true);
};
