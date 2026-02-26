// --- MQTT TAB LOGIC ---
let mqttStatusInterval = null;

window.loadMqttSettings = function() {
  fetch('/get_mqtt')
    .then(r => r.json())
    .then(cfg => {
      document.getElementById("mqttEnable").checked = !!cfg.enable;
      document.getElementById("mqttHost").value = cfg.host || "";
      document.getElementById("mqttPort").value = cfg.port || 1883;
      document.getElementById("mqttUser").value = cfg.user || "";
      document.getElementById("mqttPass").value = cfg.pass || "";
      document.getElementById("mqttTopicPrefix").value = cfg.topic_prefix || "";
      appendMqttTerminalLog("MQTT config loaded.");
      // Start or stop polling depending on enable
      handleMqttEnableChange();
    })
    .catch(() => {
      appendMqttTerminalLog("❌ Error loading MQTT config");
    });
};

window.saveMqttSettings = function() {
  const settings = {
    enable: document.getElementById("mqttEnable").checked ? 1 : 0,
    host: document.getElementById("mqttHost").value,
    port: parseInt(document.getElementById("mqttPort").value) || 1883,
    user: document.getElementById("mqttUser").value,
    pass: document.getElementById("mqttPass").value,
    topic_prefix: document.getElementById("mqttTopicPrefix").value
  };
  fetch("/set_mqtt", {
    method: "POST",
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify(settings)
  })
  .then(r => r.ok ? r.text() : Promise.reject("Save failed"))
  .then(msg => {
    appendMqttTerminalLog("✅ MQTT settings saved!");
  })
  .catch(e => {
    appendMqttTerminalLog("❌ Error saving MQTT settings");
  });
};

window.testMqttConnection = function() {
  const btn = document.getElementById("mqttTestBtn");
  if (!btn) return;
  const defaultText = "🔄 Test Connection";
  btn.textContent = "🔄 Testing...";
  fetch("/mqtt_test", {method:"POST"})
    .then(r => r.text())
    .then(msg => {
      btn.textContent = msg;
      appendMqttTerminalLog(msg);
      setTimeout(() => { btn.textContent = defaultText; }, 2000);
    })
    .catch(e => {
      btn.textContent = "❌ Error";
      appendMqttTerminalLog("❌ Test error");
      setTimeout(() => { btn.textContent = defaultText; }, 2000);
    });
};

function appendMqttTerminalLog(line) {
  const term = document.getElementById("mqttTerminal");
  if (!term) return;
  const now = new Date();
  const time = now.toLocaleTimeString().replace(/:\d+$/, ""); // "12:32"
  const clean = line.replace(/[\r\n]+/g, " ");
  term.textContent += `[${time}] ${clean}\n`;
  term.scrollTop = term.scrollHeight;
}

function handleMqttEnableChange() {
  const enabled = document.getElementById("mqttEnable").checked;
  if (enabled) {
    if (typeof updateMqttStatus === "function") updateMqttStatus();
    if (mqttStatusInterval) clearInterval(mqttStatusInterval);
    mqttStatusInterval = setInterval(() => {
      if (typeof updateMqttStatus === "function") updateMqttStatus();
    }, 3000);
  } else {
    if (mqttStatusInterval) {
      clearInterval(mqttStatusInterval);
      mqttStatusInterval = null;
    }
    // Optionally, clear the status indicator here
    const dot = document.getElementById('mqttStatusDot');
    const text = document.getElementById('mqttStatusText');
    if (dot && text) {
      dot.textContent = "⚪";
      text.innerHTML = "MQTT disabled";
      text.style.color = "#888";
    }
  }
}

window.loadMqttTab = function() {
  // Load settings and handle polling
  window.loadMqttSettings();

  // Save button
  const saveBtn = document.getElementById("mqttSaveBtn");
  if (saveBtn) saveBtn.onclick = window.saveMqttSettings;

  // Test button
  const testBtn = document.getElementById("mqttTestBtn");
  if (testBtn) testBtn.onclick = window.testMqttConnection;

  // Show/hide password
  const passShow = document.getElementById("mqttPassShow");
  if (passShow) {
    passShow.onclick = function() {
      const pass = document.getElementById("mqttPass");
      pass.type = (pass.type === "password") ? "text" : "password";
    };
  }

  // Enable/disable MQTT checkbox handler
  const enableCheckbox = document.getElementById("mqttEnable");
  if (enableCheckbox) {
    enableCheckbox.onchange = handleMqttEnableChange;
  }

	// Publish Discovery button
	const publishBtn = document.getElementById("mqttPublishDiscoveryBtn");
	if (publishBtn) publishBtn.onclick = function() {
		publishBtn.disabled = true;
		publishBtn.textContent = "Publishing...";
		fetch("/mqtt_discovery", { method: "POST" })
			.then(r => r.text())
			.then(msg => {
				appendMqttTerminalLog(msg);
				publishBtn.textContent = "📢 Publish Discovery";
				publishBtn.disabled = false;
			})
			.catch(err => {
				appendMqttTerminalLog("❌ " + err);
				publishBtn.textContent = "📢 Publish Discovery";
				publishBtn.disabled = false;
			});
	};
	
};

window.unloadMqttTab = function() {
  if (mqttStatusInterval) {
    clearInterval(mqttStatusInterval);
    mqttStatusInterval = null;
  }
};

function updateMqttStatus() {
  fetch('/mqtt_status')
    .then(r => r.json())
    .then(data => {
      const dot = document.getElementById('mqttStatusDot');
      const text = document.getElementById('mqttStatusText');
      if (dot && text) {
        if (data.connected) {
          dot.textContent = "🟢";
          text.innerHTML = "Connected";
          text.style.color = "var(--okgreen,green)";
        } else {
          dot.textContent = "🔴";
          text.innerHTML = "Disconnected" + (data.last_error ? "<br><small style='color:#a55'>" + data.last_error + "</small>" : "");
          text.style.color = "var(--errred,red)";
        }
      }
    })
    .catch(() => {
      const dot = document.getElementById('mqttStatusDot');
      const text = document.getElementById('mqttStatusText');
      if (dot && text) {
        dot.textContent = "⚪";
        text.innerHTML = "Status Unknown";
        text.style.color = "#999";
      }
    });
}