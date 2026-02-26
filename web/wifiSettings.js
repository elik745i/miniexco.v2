// --- WiFi TAB LOGIC (consolidated) ---

// Global selection for preferred SSID rendered in Saved Networks
let selectedPrioritySSID = null;

// In-flight guard for scanning
let _scanInFlight = false;

// ---------- Small UI helpers ----------

function animateBtn(btn) {
  if (!btn) return;
  btn.classList.remove('btn-press'); // reset if still present
  void btn.offsetWidth;              // reflow to restart animation
  btn.classList.add('btn-press');
  setTimeout(() => btn.classList.remove('btn-press'), 180);
}

// ---------- Wi-Fi Tab bootstrapping ----------

window.loadWifiTab = function() {
  // Initial refresh of saved networks
  if (typeof loadSavedNetworks === "function") loadSavedNetworks();
  initApPasswordUi();
  initStaPasswordUi();

  // Safe (idempotent) bindings whenever tab opens
  bindWifiConnectForm();
  bindWifiScanBtn();
  bindPrioritySaveButton();
};

// ---------- Scan visible networks (left column) ----------

function scanNetworks() {
  if (_scanInFlight) return;      // prevent stacking
  _scanInFlight = true;

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

      if (!Array.isArray(data) || data.length === 0) {
        let retryText = document.createElement('div');
        retryText.id = 'scanningText';
        retryText.innerText = "No networks found, retrying...";
        ssidSelect.parentNode.insertBefore(retryText, ssidSelect);

        _scanInFlight = false;
        setTimeout(scanNetworks, 3000); // retry after 3 seconds
        return;
      }

      // Optional: strongest first
      try { data.sort((a, b) => (b.rssi ?? -999) - (a.rssi ?? -999)); } catch (_) {}

      data.forEach(function(network) {
        let option = document.createElement('option');
        option.value = network.ssid;
        option.innerText = network.ssid + (typeof network.rssi === 'number' ? ` (${network.rssi}dBm)` : '');
        ssidSelect.appendChild(option);
      });

      // Auto-select strongest
      if (data[0] && data[0].ssid) ssidSelect.value = data[0].ssid;

      ssidSelect.style.display = 'block';
      _scanInFlight = false;
    })
    .catch(error => {
      console.error("Error fetching Wi-Fi list:", error);
      let existingText = document.getElementById('scanningText');
      if (existingText) existingText.innerText = "Error scanning Wi-Fi, retrying...";
      _scanInFlight = false;
      setTimeout(scanNetworks, 3000);
    });
}

// ---------- Saved Networks (right column) ----------

function loadSavedNetworks() {
  fetch('/list_saved_wifi')
    .then(response => response.json())
    .then(data => {
      const container = document.getElementById('savedNetworksContainer');
      container.innerHTML = '';

      // reset selection each render; will set below if backend marks preferred
      selectedPrioritySSID = null;

      // Optional: pin preferred at top
      try { data.sort((a, b) => (b.preferred ? 1 : 0) - (a.preferred ? 1 : 0)); } catch (_) {}

      // Header row (name + priority)
      const hdr = document.createElement('div');
      hdr.className = 'wifi-row';
      hdr.style.fontWeight = 'bold';
      hdr.innerHTML = `
        <span style="min-width:160px; display:inline-block;">SSID</span>
        <span title="Prioritize — try this first on boot" style="opacity:0.9;">Prioritize</span>`;
      container.appendChild(hdr);

      data.forEach(net => {
        const row = document.createElement('div');
        row.className = 'wifi-row';
        row.style.alignItems = 'center';

        // SSID name (bold)
        const name = document.createElement('span');
        name.textContent = net.ssid;
        name.style.fontWeight = 'bold';
        name.style.minWidth = '160px';
        name.style.display = 'inline-block';
        row.appendChild(name);

        // Priority checkbox (single-select behavior)
        const prioWrap = document.createElement('label');
        prioWrap.title = 'Prioritize — try this first on boot';
        prioWrap.className = 'priorityCell';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.className = 'wifi-priority';
        cb.dataset.ssid = net.ssid;
        cb.checked = !!net.preferred;         // <- backend marks preferred
        if (cb.checked) selectedPrioritySSID = net.ssid;
        prioWrap.appendChild(cb);
        row.appendChild(prioWrap);

        // Pencil/Edit icon
        const editBtn = document.createElement('button');
        editBtn.title = "Edit Wi-Fi settings";
        editBtn.style.marginLeft = '8px';
        editBtn.innerHTML = `
          <svg width="18" height="18" fill="currentColor" viewBox="0 0 20 20">
            <path d="M17.414 2.586a2 2 0 010 2.828l-10 10a2 2 0 01-.707.414l-4 1a1 1 0 01-1.265-1.265l1-4a2 2 0 01.414-.707l10-10a2 2 0 012.828 0zm-10 12.828L15 5.828l-2.828-2.828-10 10V15h2.172z"/>
          </svg>`;
        editBtn.onclick = () => showWifiEditModal(net);
        row.appendChild(editBtn);

        container.appendChild(row);

        // Enforce single selection
        cb.addEventListener('change', () => {
          if (cb.checked) {
            document.querySelectorAll('.wifi-priority').forEach(x => {
              if (x !== cb) x.checked = false;
            });
            selectedPrioritySSID = cb.dataset.ssid;
          } else {
            selectedPrioritySSID = null;
          }
        });
      });
    })
    .catch(err => {
      console.error('Failed to load saved networks:', err);
      document.getElementById('savedNetworksContainer').innerText =
        'Error loading saved networks.';
    });
}

// ---------- Edit Modal for a saved network ----------

function showWifiEditModal(net) {
  let modal = document.getElementById('wifiEditModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'wifiEditModal';
    modal.className = 'modal';
    modal.innerHTML = `
      <div class="modal-content">
        <button class="modal-close-btn" id="wifiEditCloseBtn" title="Close">×</button>
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
          <button id="wifiEditDelete" class="danger">🗑 Delete</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  }

  // Populate current network data
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

  // Centralized close (also cleans up ESC listener)
  const escHandler = (ev) => {
    if (ev.key === 'Escape' || ev.key === 'Esc') {
      closeModal();
    }
  };
  const closeModal = () => {
    modal.style.display = 'none';
    document.removeEventListener('keydown', escHandler);
  };

  // Wire close buttons & click-away
  const closeBtn = document.getElementById('wifiEditCloseBtn');
  if (closeBtn) closeBtn.onclick = closeModal;
  document.getElementById('wifiEditCancel').onclick = closeModal;
  modal.onclick = (e) => { if (e.target === modal) closeModal(); };
  document.addEventListener('keydown', escHandler);

  // Try Connect Now
  tryBtn.onclick = () => {
    animateBtn(tryBtn);
    fetch(`/wifi_try_connect?ssid=${encodeURIComponent(net.ssid)}`, { method: 'POST' })
      .then(r => r.text())
      .then(txt => {
        const ok = txt && txt.toLowerCase().includes('connected');
        showToast(ok ? `🔄 Connecting to ${net.ssid}...` : `⚠️ ${txt}`, !ok);
      })
      .catch(err => {
        console.error(err);
        showToast(`❌ Error trying to connect to “${net.ssid}”`, true);
      });
  };

  // Save changes
  document.getElementById('wifiEditSave').onclick = () => {
    animateBtn(document.getElementById('wifiEditSave'));

    const newPass = passField.value;
    const newRetry = Math.min(10, Math.max(1, parseInt(retryField.value) || 3));
    const autoRe = autoReconnect.checked;

    // Save password (POST form-encoded, not in URL)
    updateSavedPassword(net.ssid, newPass);

    // Save retry count (kept same endpoint/signature)
    updateRetryCount(net.ssid, newRetry);

    // Save autoReconnect
    const postData = `ssid=${encodeURIComponent(net.ssid)}&enabled=${autoRe ? 1 : 0}`;
    fetch(`/wifi_set_autoreconnect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: postData
    })
      .then(response => {
        if (!response.ok) throw new Error(`Server responded with ${response.status}`);
        closeModal();
        setTimeout(loadSavedNetworks, 400);
      })
      .catch(err => {
        console.error("AutoReconnect update failed:", err);
        showToast("❌ Failed to update auto-reconnect", true);
      });
  };

  // DELETE saved network from Preferences
  document.getElementById('wifiEditDelete').onclick = async () => {
    const ssid = net.ssid;
    if (!confirm(`Remove saved Wi-Fi “${ssid}”?`)) return;
    try {
      const body = new URLSearchParams({ ssid });
      const res = await fetch('/delete_saved_wifi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      showToast(`🗑 Removed “${ssid}”`);
      closeModal();
      setTimeout(loadSavedNetworks, 300);
    } catch (e) {
      console.error(e);
      showToast(`❌ Failed to remove “${ssid}”`, true);
    }
  };

  // Show modal
  modal.style.display = 'flex';
}

// ---------- Backend updates ----------

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

// Safer: do not leak passwords in URL
function updateSavedPassword(ssid, newPass) {
  fetch(`/update_wifi_password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ssid, password: newPass })
  })
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

// ---------- STA/AP password eyes & AP save ----------

function initStaPasswordUi() {
  const passInput = document.getElementById('password');   // STA password field
  const eye       = document.getElementById('staPassShow');
  if (!passInput || !eye) return;

  eye.onclick = function () {
    if (passInput.type === 'password') {
      passInput.type = 'text';
      eye.textContent = '🙈';
    } else {
      passInput.type = 'password';
      eye.textContent = '👁️';
    }
  };
}

function initApPasswordUi() {
  const passInput = document.getElementById('apPass');
  const eye       = document.getElementById('apPassShow');
  const saveBtn   = document.getElementById('apPassSave');
  const statusEl  = document.getElementById('apPassStatus');
  if (!passInput || !eye || !saveBtn || !statusEl) return;

  // Eye toggle
  eye.onclick = function(){
    if (passInput.type === 'password') { passInput.type = 'text'; eye.textContent = '🙈'; }
    else { passInput.type = 'password'; eye.textContent = '👁️'; }
  };

  // Save handler
  saveBtn.onclick = async function(){
    animateBtn(saveBtn); // click animation

    const ap_pass = passInput.value; // empty => open AP
    statusEl.style.color = '#aac';
    statusEl.textContent = 'Saving...';

    try {
      const body = new URLSearchParams({ ap_pass });
      const r = await fetch('/set_ap_password', { method: 'POST', body });
      const j = await r.json().catch(()=>({}));
      if (r.ok && j.ok) {
        statusEl.style.color = 'lightgreen';
        statusEl.textContent = ap_pass.length
          ? 'Saved (applies next time AP starts).'
          : 'Saved. AP will be OPEN next time it starts.';
        showToast('💾 AP password saved');
      } else {
        statusEl.style.color = '#f77';
        statusEl.textContent = (j && j.err === 'len')
          ? 'Password must be 8–63 chars (or empty for open AP).'
          : 'Save failed.';
        showToast('❌ Failed to save AP password', true);
      }
    } catch (e) {
      statusEl.style.color = '#f77';
      statusEl.textContent = 'Network error.';
      showToast('❌ Network error saving AP password', true);
    }
  };

  // Prefill meta (we don’t return the actual password for security)
  fetch('/get_ap_password')
    .then(r => r.json())
    .then(j => {
      if (!j) return;
      if (j.open) {
        statusEl.style.color = '#ffc107';
        statusEl.textContent = 'Current setting: OPEN AP (no password).';
      } else {
        statusEl.style.color = '#aac';
        statusEl.textContent = 'Current setting: WPA2 password set (hidden).';
      }
    })
    .catch(()=>{ /* ignore */ });
}

// ---------- Idempotent bindings for buttons/forms ----------

function bindWifiConnectForm() {
  const form = document.getElementById('wifiConnectForm');
  const btn  = document.getElementById('wifiConnectBtn');
  if (!form || !btn || form.dataset.bound === "1") return;

  form.dataset.bound = "1";
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    animateBtn(btn);

    const ssid = document.getElementById('ssidList')?.value || '';
    const pass = document.getElementById('password')?.value || '';
    if (!ssid) {
      showToast('⚠️ Pick a Wi-Fi first', true);
      return;
    }
    showToast(`🔌 Connecting to “${ssid}”...`);

    try {
      const body = new URLSearchParams({ ssid, password: pass });
      const res  = await fetch('/savewifi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body
      });
      if (res.ok) {
        showToast(`✅ Sent connect request to “${ssid}”`);
        // Optional: refresh Saved Networks shortly after
        setTimeout(() => { if (typeof loadSavedNetworks==='function') loadSavedNetworks(); }, 600);
      } else {
        showToast(`❌ Connect failed (HTTP ${res.status})`, true);
      }
    } catch (err) {
      console.error(err);
      showToast('❌ Network error while connecting', true);
    }
  });
}

function bindWifiScanBtn() {
  const btn = document.getElementById('wifiScanBtn');
  if (!btn || btn.dataset.bound === "1") return;

  btn.dataset.bound = "1";
  btn.addEventListener('click', () => {
    animateBtn(btn);
    showToast('📡 Scanning for networks...');
  });
}

function bindPrioritySaveButton() {
  const btn = document.getElementById('wifiPrioritySave');
  if (!btn || btn.dataset.bound === "1") return;

  btn.dataset.bound = "1";
  btn.addEventListener('click', async () => {
    animateBtn(btn);

    if (!selectedPrioritySSID) {
      showToast('⚠️ Select a network to prioritize first', true);
      return;
    }
    try {
      const body = new URLSearchParams({ ssid: selectedPrioritySSID });
      const res  = await fetch('/wifi_set_priority', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body
      });
      const j = await res.json().catch(()=>({}));
      if (res.ok && j.ok) {
        showToast(`⭐ Priority set to “${selectedPrioritySSID}”. Reconnecting...`);
        setTimeout(loadSavedNetworks, 600); // refresh preferred ticks
      } else {
        showToast('❌ Failed to save priority', true);
      }
    } catch (e) {
      console.error(e);
      showToast('❌ Network error saving priority', true);
    }
  });
}
