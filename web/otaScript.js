// OTA tab logic.
(function () {
  const OTA_REPO_OWNER = "elik745i";
  const OTA_REPO_NAME = "miniexco.v2";
  const OTA_RELEASE_API = `https://api.github.com/repos/${OTA_REPO_OWNER}/${OTA_REPO_NAME}/releases/latest`;

  function otaStatusEl() {
    return document.getElementById("otaStatus");
  }

  function otaProgressEl() {
    return document.getElementById("otaProgress");
  }

  function setStatus(text) {
    const status = otaStatusEl();
    if (status) status.textContent = text;
  }

  function setProgress(value, visible) {
    const progress = otaProgressEl();
    if (!progress) return;
    progress.value = value;
    progress.style.display = visible ? "block" : "none";
  }

  function currentBatteryPercent() {
    if (typeof window.latestBatteryPercent !== "number") return 100;
    return window.latestBatteryPercent;
  }

  function ensureBatteryForOta(interactive) {
    const pct = currentBatteryPercent();
    if (pct >= 50) return true;
    if (!interactive) return false;
    return confirm(
      `Battery is ${pct}%. Recommended minimum is 50% for OTA.\nContinue anyway?`
    );
  }

  function normalizeVersion(v) {
    const s = String(v || "").replace(/^v/i, "");
    return s.split(/[^\d.]+/)[0];
  }

  function compareVersions(a, b) {
    const aa = normalizeVersion(a).split(".").map((n) => parseInt(n || "0", 10));
    const bb = normalizeVersion(b).split(".").map((n) => parseInt(n || "0", 10));
    while (aa.length < 3) aa.push(0);
    while (bb.length < 3) bb.push(0);
    for (let i = 0; i < 3; i += 1) {
      if (aa[i] > bb[i]) return 1;
      if (aa[i] < bb[i]) return -1;
    }
    return 0;
  }

  function chooseFirmwareAsset(release) {
    const assets = Array.isArray(release?.assets) ? release.assets : [];
    const preferred = assets.find((a) => /\.ino\.bin$/i.test(a.name || ""));
    if (preferred?.browser_download_url) return preferred.browser_download_url;
    const generic = assets.find((a) => {
      const n = String(a.name || "").toLowerCase();
      return n.endsWith(".bin") && !n.includes("bootloader") && !n.includes("partitions");
    });
    return generic?.browser_download_url || null;
  }

  async function fetchLocalVersion() {
    const r = await fetch("/version", { cache: "no-store" });
    if (!r.ok) throw new Error(`Local version request failed (${r.status})`);
    return r.json();
  }

  async function fetchLatestRelease() {
    const r = await fetch(OTA_RELEASE_API, {
      headers: { Accept: "application/vnd.github+json" },
      cache: "no-store",
    });
    if (!r.ok) throw new Error(`GitHub latest release request failed (${r.status})`);
    return r.json();
  }

  function uploadBlobToDevice(blob, filename) {
    return new Promise((resolve, reject) => {
      const formData = new FormData();
      formData.append("update", blob, filename || "firmware.bin");

      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/ota/upload", true);

      xhr.upload.onprogress = (e) => {
        if (!e.lengthComputable) return;
        setProgress((e.loaded / e.total) * 100, true);
      };

      xhr.onload = () => {
        if (xhr.status === 200 || xhr.status === 0) {
          resolve();
        } else {
          reject(new Error(`Upload failed (${xhr.status})`));
        }
      };
      xhr.onerror = () => reject(new Error("Upload failed (network error)"));
      xhr.send(formData);
    });
  }

  async function startOtaFromUrl(url) {
    setStatus("Downloading latest firmware...");
    setProgress(0, true);
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) throw new Error(`Firmware download failed (${r.status})`);
    const blob = await r.blob();
    setStatus("Uploading firmware to device...");
    await uploadBlobToDevice(blob, "firmware.bin");
    setStatus("Firmware uploaded. Device rebooting...");
    setTimeout(() => location.reload(), 6000);
  }

  window.uploadFirmware = async function uploadFirmware() {
    const fileInput = document.getElementById("otaFile");
    const file = fileInput?.files?.[0];
    if (!file) {
      setStatus("Please select a firmware file.");
      return;
    }
    if (!ensureBatteryForOta(true)) {
      setStatus("Upload canceled due to low battery.");
      return;
    }
    try {
      setStatus("Uploading firmware...");
      setProgress(0, true);
      await uploadBlobToDevice(file, file.name || "firmware.bin");
      setStatus("Upload successful. Device rebooting...");
      setTimeout(() => location.reload(), 6000);
    } catch (err) {
      setStatus(`Upload failed: ${err.message}`);
    }
  };

  window.onFirmwareFileSelected = function onFirmwareFileSelected() {
    const fileInput = document.getElementById("otaFile");
    const file = fileInput?.files?.[0];
    const versionBox = document.getElementById("versionCompare");
    const selected = document.getElementById("selectedVersion");
    const current = document.getElementById("currentVersion");
    const uploadBtn = document.getElementById("uploadBtn");

    if (!file) {
      if (versionBox) versionBox.style.display = "none";
      if (uploadBtn) uploadBtn.style.display = "none";
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const bin = new Uint8Array(e.target.result);
      const text = new TextDecoder().decode(bin);
      const allMatches = [...text.matchAll(/v\d+\.\d+\.\d{1,2}(?: ?[A-Za-z]+)?/gi)];
      const selectedVersion = allMatches.length ? allMatches[allMatches.length - 1][0] : "? Unknown";
      if (selected) selected.textContent = selectedVersion;

      fetchLocalVersion()
        .then((data) => {
          if (current) current.textContent = data.current || "?";
          if (versionBox) versionBox.style.display = "block";
          if (uploadBtn) uploadBtn.style.display = "inline-block";
          setStatus("");
        })
        .catch(() => {
          if (current) current.textContent = "Failed";
          setStatus("Could not fetch current firmware version.");
        });
    };

    reader.onerror = () => {
      if (versionBox) versionBox.style.display = "none";
      if (uploadBtn) uploadBtn.style.display = "none";
      setStatus("Failed to read selected firmware file.");
    };
    reader.readAsArrayBuffer(file.slice(0, 32768));
  };

  window.checkForUpdates = async function checkForUpdates(showAlert = false) {
    try {
      setStatus("Checking latest release on GitHub...");
      const [local, github] = await Promise.all([fetchLocalVersion(), fetchLatestRelease()]);
      const current = local.current || "0.0.0";
      const latest = github.tag_name || "0.0.0";
      const binUrl = chooseFirmwareAsset(github);
      if (!binUrl) throw new Error("No OTA firmware asset found in latest release.");

      if (compareVersions(latest, current) > 0) {
        const proceed = confirm(
          `New firmware ${latest} is available (current: ${current}).\nUpdate now?`
        );
        if (!proceed) {
          setStatus("Update canceled.");
          return;
        }
        if (!ensureBatteryForOta(true)) {
          setStatus(`Battery too low (${currentBatteryPercent()}%).`);
          return;
        }
        await startOtaFromUrl(binUrl);
      } else {
        setStatus(`Already on latest version (${current}).`);
        if (showAlert) alert(`Already on latest version (${current}).`);
      }
    } catch (err) {
      console.error("Update check failed:", err);
      setStatus(`Update check failed: ${err.message}`);
      if (showAlert) alert(`Failed to check for updates: ${err.message}`);
    }
  };

  window.loadOtaTab = function loadOtaTab() {
    setStatus("");
    setProgress(0, false);

    fetchLocalVersion()
      .then((data) => {
        const fwNum = document.getElementById("fwVersionNum");
        const current = document.getElementById("currentVersion");
        if (fwNum) fwNum.textContent = data.current || "?";
        if (current) current.textContent = data.current || "?";
      })
      .catch(() => {
        const fwNum = document.getElementById("fwVersionNum");
        const current = document.getElementById("currentVersion");
        if (fwNum) fwNum.textContent = "Failed";
        if (current) current.textContent = "Failed";
      });

    const versionBox = document.getElementById("versionCompare");
    const uploadBtn = document.getElementById("uploadBtn");
    const selectedVersion = document.getElementById("selectedVersion");
    if (versionBox) versionBox.style.display = "block";
    if (uploadBtn) uploadBtn.style.display = "none";
    if (selectedVersion) selectedVersion.textContent = "-";

    const fileInput = document.getElementById("otaFile");
    if (fileInput) fileInput.onchange = window.onFirmwareFileSelected;
    if (uploadBtn) uploadBtn.onclick = window.uploadFirmware;
  };
})();
