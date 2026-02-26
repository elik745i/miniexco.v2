  window.toggleDrawMode = function() {
    drawMode = !drawMode;
    const btn = document.getElementById("drawPathBtn");
    btn.style.backgroundColor = drawMode ? "#4CAF50" : "#444";
    btn.innerText = drawMode ? "✏️ Drawing..." : "✏️ Draw Path";
    canvas = document.getElementById("drawingCanvas");
    svgOverlay = document.getElementById("drawingOverlay");

    if (drawMode) {
      // ✅ Show IMU/Encoder warning
      const old = document.getElementById("imuWarning");
      if (old) old.remove();

      const warning = document.createElement("div");
      warning.id = "imuWarning";
      warning.innerText = "⚠️ This feature requires MPU9250 and Encoders. DEMO mode only!";
      document.body.appendChild(warning);

      // Auto-remove warning after 4 seconds
      setTimeout(() => warning.remove(), 4000);

      // ✅ Initialize canvas
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      canvas.style.pointerEvents = "auto";
      canvas.style.cursor = "crosshair";
      canvas.style.zIndex = "20";
      document.body.style.cursor = "crosshair";

      drawingPoints = [];
      currentPath = [];

      const cam = document.getElementById("cameraStream");
      const camRect = cam.getBoundingClientRect();
      const canvasRect = canvas.getBoundingClientRect();

      const anchorX = camRect.left + camRect.width / 2 - canvasRect.left;
      const anchorY = camRect.bottom - canvasRect.top;

      drawingPoints.push({ x: anchorX, y: anchorY });
      currentPath.push({ x: anchorX, y: anchorY });

      renderPath();          // draw START button immediately
      renderPath(false);     // force START rendering, even after wipe

      canvas.addEventListener("mousemove", handleMouseMove);
      canvas.addEventListener("mousedown", handleCanvasClick);
      canvas.addEventListener("contextmenu", stopDrawing);
      redrawCanvas();

    } else {
      cleanupDrawing(); // also disables pointerEvents
    }
  }

  function handleMouseMove(e) {
    if (!drawMode || drawingPoints.length === 0) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    redrawCanvas(x, y); // 👈 draw preview line to current mouse
  }

  function handleCanvasClick(e) {
    if (e.button === 0) { // Left click
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      drawingPoints.push({ x, y });
      redrawCanvas();           // Optional: keep canvas for debugging
      addPointToPath(x, y);     // ✅ REQUIRED to draw to SVG overlay
      console.log("Point added to SVG:", x, y);
    }
  }

  function redrawCanvas(cursorX = null, cursorY = null) {
    if (!ctx) ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (drawingPoints.length === 0) return;

    ctx.strokeStyle = "lime";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(drawingPoints[0].x, drawingPoints[0].y);

    for (let i = 1; i < drawingPoints.length; i++) {
      ctx.lineTo(drawingPoints[i].x, drawingPoints[i].y);
    }

    // live preview line to cursor
    if (cursorX !== null && cursorY !== null) {
      ctx.lineTo(cursorX, cursorY);
    }

    ctx.stroke();
  }

  function drawPlayButton(x, y) {
    ctx.fillStyle = "yellow";
    ctx.beginPath();
    ctx.moveTo(x + 10, y);
    ctx.lineTo(x, y - 10);
    ctx.lineTo(x, y + 10);
    ctx.closePath();
    ctx.fill();
  }

  function stopDrawing(e) {
    if (e) e.preventDefault();

    drawMode = false;

    canvas.removeEventListener("mousemove", handleMouseMove);
    canvas.removeEventListener("mousedown", handleCanvasClick);
    canvas.removeEventListener("contextmenu", stopDrawing);

    // ✅ Fix: stop blocking other UI
    canvas.style.pointerEvents = "none";
    canvas.style.cursor = "default";
    canvas.style.zIndex = "-1"; // ✅ Push canvas behind everything
    document.body.style.cursor = "default";

    // ✅ Fully clear canvas to remove overlay hitbox
    canvas.width = 0;
    canvas.height = 0;

    const btn = document.getElementById("drawPathBtn");
    btn.innerText = "✏️ Draw Path";
    btn.style.backgroundColor = "#444";

    renderPath(true); // ✅ show STOP button
  }

  function cleanupDrawing() {
    if (!canvas) return;
    canvas.removeEventListener("mousemove", handleMouseMove);
    canvas.removeEventListener("mousedown", handleCanvasClick);
    canvas.removeEventListener("contextmenu", stopDrawing);
    canvas.style.pointerEvents = "none";
    canvas.style.cursor = "default";
    document.body.style.cursor = "default";
  }

  window.addEventListener("resize", () => {
    const canvas = document.getElementById("drawingCanvas");
    if (canvas && drawMode) {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      redrawCanvas(); // <- redraw current path
    }
  });

  function clearDrawing() {
    if (!ctx || !canvas || !svgOverlay) return;

    // Clear path data
    drawingPoints = [];
    currentPath = [];

    // Clear visuals
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    svgOverlay.innerHTML = ""; // ✅ Remove drawn polyline/arrow/nodes

    // Clear buttons
    const pathButtons = document.getElementById("pathControlButtons");
    pathButtons.innerHTML = "";                // ✅ Remove START/STOP buttons
    document.getElementById("startButton")?.remove(); // ✅ extra safety
    document.getElementById("stopButton")?.remove();
    pathButtons.style.pointerEvents = "none";  // ✅ Prevent hitbox bug

    // Reset cursors
    canvas.style.cursor = "default";
    document.body.style.cursor = "default";

    console.log("🧹 Drawing cleared");
  }

  function addPointToPath(x, y) {
    currentPath.push({ x, y });
    renderPath();
  }

  function rotateNodeAt(x, y) {
    alert(`Rotate node clicked at (${x.toFixed(0)}, ${y.toFixed(0)})`);
    // Later: open angle input or rotate arrow preview
  }

  function handleStopClick() {
    showToast("🛑 Stop triggered");
    console.log("Stop button clicked");
    // Add actual command logic here
  }

  function renderPath(showStopOnly = false) {
    if (!svgOverlay) svgOverlay = document.getElementById("drawingOverlay");
    const btnContainer = document.getElementById("pathControlButtons");
    if (!svgOverlay || !btnContainer) return;

    // Clear only the SVG overlay (not buttons) while drawing
    svgOverlay.innerHTML = "";

    // Default start point (bottom center of overlay)
    const svgRect = svgOverlay.getBoundingClientRect();
    const offsetX = svgRect.width / 2;
    const offsetY = svgRect.height - 10;
    const startPoint = { x: offsetX, y: offsetY };

    // Ensure path starts from anchor point
    if (!currentPath || currentPath.length === 0) {
      currentPath = [startPoint];
    } else if (
      currentPath[0].x !== startPoint.x ||
      currentPath[0].y !== startPoint.y
    ) {
      currentPath.unshift(startPoint);
    }

    const points = currentPath.map((p) => `${p.x},${p.y}`).join(" ");

    if (currentPath.length > 1) {
      const polyline = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
      polyline.setAttribute("points", points);
      polyline.classList.add("drawn-path");
      svgOverlay.appendChild(polyline);
    }

    // START button: render only once, unless already exists
    if (!showStopOnly) {
      const existing = document.getElementById("startButton");
      if (existing) existing.remove();  // ensure no stale element
      const startBtn = document.createElement("button");

      startBtn.id = "startButton";
      startBtn.innerText = "Start";
      startBtn.style.pointerEvents = "auto";

// path to be sent to robot, old one was: startBtn.onclick = () => alert("START clicked");
      startBtn.onclick = () => {
        if (window.websocketCarInput && window.websocketCarInput.readyState === WebSocket.OPEN) {
          window.websocketCarInput.send("PATH," + JSON.stringify(currentPath));
          showToast("🚗 Path sent to robot!");
        } else {
          showToast("❌ Robot not connected!", true);
        }
      };
//---------------------------------------------------------------------------------------------

      btnContainer.appendChild(startBtn);
    }

    // STOP button: only render after right-click triggers stopDrawing
    if (showStopOnly && currentPath.length > 1 && !document.getElementById("stopButton")) {
      const last = currentPath[currentPath.length - 1];
      const stopBtn = document.createElement("button");
      stopBtn.id = "stopButton";
      stopBtn.innerText = "Stop";

      stopBtn.onclick = () => {
        websocketCarInput.send("PATH_STOP");
        showToast("🛑 Stop sent");
      };

      stopBtn.style.left = `${last.x}px`;
      stopBtn.style.top = `${last.y}px`;
      btnContainer.appendChild(stopBtn);
    }

    console.log("✅ Path rendered with", currentPath.length, "points");
  }
