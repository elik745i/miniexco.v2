let keyMap = {};  // Dynamic key-to-action map

const allKeys = [
  " ", "w", "a", "s", "d", "u", "j", "i", "k", "l", "b", "e",
  "q", "z", "x", "c", "v", "n", "m",
  "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"
];

document.addEventListener("DOMContentLoaded", () => {
  loadKeyMappings();
  setupKeyInputValidation();
});

// 🧪 DEBUG: log every key pressed
document.addEventListener("keydown", e => console.log("Key pressed:", e.key));

document.addEventListener("keydown", function(e) {
  if (e.repeat) return;

  let key = e.key;
  if (key.length === 1) key = key.toLowerCase();  // Normalize only single chars

  // ✅ Move preventDefault AFTER normalization
  if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(key)) {
    e.preventDefault(); // properly stops page from scrolling
  }

  const action = keyMap[key];
  if (!action) return;

  switch (action) {
    case "forward":     ws.send("MoveCar,1"); break;
    case "backward":    ws.send("MoveCar,2"); break;
    case "left":        ws.send("MoveCar,3"); break;
    case "right":       ws.send("MoveCar,4"); break;
    case "stop":        ws.send("MoveCar,0"); break;
    case "armUp":       ws.send("MoveCar,5"); break;
    case "armDown":     ws.send("MoveCar,6"); break;   
    case "bucketUp":    ws.send("Bucket,180"); break;
    case "bucketDown":  ws.send("Bucket,0"); break;
    case "auxUp":       ws.send("AUX,180"); break;
    case "auxDown":     ws.send("AUX,0"); break;
    case "led":         ws.send("Light,1"); break;
    case "beacon":      ws.send("Beacon,1"); break;
    case "emergency":   ws.send("Emergency,1"); break;
  }
});



function populateKeyDropdowns() {
  const selects = document.querySelectorAll("#keyMappingInputs select");
  selects.forEach(select => {
    select.innerHTML = "";
    allKeys.forEach(key => {
      const option = document.createElement("option");
      option.value = key;
      option.textContent = key === " " ? "Space" : key;
      select.appendChild(option);
    });
  });
}

function loadKeyMappings() {
  populateKeyDropdowns();

  fetch("/get_keymap")
    .then(res => res.json())
    .then(map => {
      keyMap = {}; // <-- clear and rebuild live keyMap for use in keydown
      Object.entries(map).forEach(([action, key]) => {
        const select = document.querySelector(`select[data-action="${action}"]`);
        if (select) select.value = key;
        const normalizedKey = key.length === 1 ? key.toLowerCase() : key.toLowerCase();
        keyMap[normalizedKey] = action
      });
      console.log("Keymap loaded:", keyMap);
    });
}


function saveKeyMappings() {
  const selects = document.querySelectorAll("#keyMappingInputs select");
  const tempMap = {};
  let hasDuplicate = false;

  selects.forEach(select => {
    const key = select.value.trim();  // 🟢 Use raw casing (e.g., "ArrowUp" stays "ArrowUp")
    const action = select.dataset.action;
    const warn = select.nextElementSibling;
    warn.textContent = "";
    warn.style.color = "";

    if (!key) return;
    if (tempMap[key]) {
      warn.textContent = "⚠️ Duplicate";
      warn.style.color = "red";
      hasDuplicate = true;
    } else {
      tempMap[key] = action;
    }
  });

  if (hasDuplicate) {
    document.getElementById("keySaveStatus").textContent = "Fix duplicates first!";
    document.getElementById("keySaveStatus").style.color = "red";
    return;
  }

  // Convert: { key: action } → { action: key }
  const finalMap = {};
  Object.entries(tempMap).forEach(([key, action]) => {
    finalMap[action] = key;
  });

  fetch("/set_keymap", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(finalMap)
  })
  .then(res => res.text())
  .then(msg => {
    document.getElementById("keySaveStatus").textContent = "✔️ Saved!";
    document.getElementById("keySaveStatus").style.color = "lightgreen";
    loadKeyMappings(); // re-render selected options
  });
}


function setupKeyInputValidation() {
  const selects = document.querySelectorAll("#keyMappingInputs select");

  selects.forEach(select => {
    select.addEventListener("change", () => {
      const seen = {};
      selects.forEach(sel => {
        const key = sel.value.trim();  // ✅ Preserve casing for correct duplicate detection
        const warn = sel.nextElementSibling;
        warn.textContent = "";
        warn.style.color = "";

        if (key && seen[key]) {
          warn.textContent = "⚠️ Duplicate";
          warn.style.color = "red";
        } else {
          seen[key] = true;
        }
      });
    });
  });
}


function resetToDefaultKeymap() {
  const defaultMap = {
    forward: "w",
    backward: "s",
    left: "a",
    right: "d",
    stop: " ",
    armUp: "n",
    armDown: "m",    
    bucketUp: "u",
    bucketDown: "j",
    auxUp: "i",
    auxDown: "k",
    led: "l",
    beacon: "b",
    emergency: "e"
  };

  const selects = document.querySelectorAll("#keyMappingInputs select");
  selects.forEach(select => {
    const action = select.dataset.action;
    if (defaultMap[action] !== undefined) {
      select.value = defaultMap[action];
    }
  });

  document.getElementById("keySaveStatus").textContent = "Default keys loaded. Click Save to apply.";
  document.getElementById("keySaveStatus").style.color = "orange";
}
