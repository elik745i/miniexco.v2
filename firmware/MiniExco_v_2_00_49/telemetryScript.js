  //Telemetry pitch, tilt, roll from BNO055 over UDP
  //let headingDeg = 0, rollDeg = 0, pitchDeg = 0;
  //let headingCanvas, tiltCanvas;
  //let headingCtx, tiltCtx;
  //let pendingIMU = null;

  function drawHeadingSphere() {
    const ctx = headingCtx;
    const angle = headingDeg * Math.PI / 180;
    const x = 40 + Math.sin(angle) * 20;
    const y = 40 - Math.cos(angle) * 20;

    ctx.clearRect(0, 0, 80, 80);
    ctx.beginPath();
    ctx.arc(40, 40, 30, 0, 2 * Math.PI);
    ctx.fillStyle = "#222";
    ctx.fill();

    ctx.beginPath();
    ctx.arc(x, y, 5, 0, 2 * Math.PI);
    ctx.fillStyle = "red";
    ctx.fill();

    ctx.strokeStyle = "white";
    ctx.stroke();
  }

  function drawTiltSphere() {
    const ctx = tiltCtx;
    const rollRad = rollDeg * Math.PI / 180;
    const pitchRad = pitchDeg * Math.PI / 180;

    const x = 40 + Math.sin(rollRad) * 20;
    const y = 40 - Math.sin(pitchRad) * 20;

    ctx.clearRect(0, 0, 80, 80);
    ctx.beginPath();
    ctx.arc(40, 40, 30, 0, 2 * Math.PI);
    ctx.fillStyle = "#222";
    ctx.fill();

    ctx.beginPath();
    ctx.arc(x, y, 5, 0, 2 * Math.PI);
    ctx.fillStyle = "yellow";
    ctx.fill();

    ctx.strokeStyle = "white";
    ctx.stroke();
  }


	function handleIMUMessage(h, r, p, mx, my, mz, temp) {
	  if (!window.headingCtx || !window.tiltCtx) {
		window.headingCanvas = document.getElementById("compassCanvas");
		window.tiltCanvas = document.getElementById("tiltSphere");
		window.headingCtx = window.headingCanvas?.getContext("2d");
		window.tiltCtx = window.tiltCanvas?.getContext("2d");
	  }

	  if (!window.headingCtx || !window.tiltCtx) {
		window.pendingIMU = [h, r, p, mx, my, mz, temp];
		console.warn("IMU canvas not ready, data queued");
		return;
	  }

	  window.pendingIMU = null;

	  window.headingDeg = parseFloat(h);
	  window.rollDeg = parseFloat(r);
	  window.pitchDeg = parseFloat(p);

	  document.getElementById("headingText").textContent = `Heading: ${window.headingDeg.toFixed(1)}°`;
	  document.getElementById("rollText").textContent = `Roll: ${window.rollDeg.toFixed(1)}°`;
	  document.getElementById("pitchText").textContent = `Pitch: ${window.pitchDeg.toFixed(1)}°`;

	  document.getElementById("imuTemp").textContent = `Temp: ${parseFloat(temp).toFixed(1)}°C`;
	  document.getElementById("magText").textContent = `Mag: [${mx}, ${my}, ${mz}]`;

	  drawHeadingSphere();
	  drawTiltSphere();
	  drawCompassDial();
	  drawThermometer(temp);
	}


	// Retry drawing if canvases become available
	function tryProcessPendingIMU() {
	  if (pendingIMU && headingCtx && tiltCtx) {
		handleIMUMessage(...pendingIMU);
		pendingIMU = null;
	  }
	}

	// After modal/content inject, call this
	document.addEventListener("DOMContentLoaded", tryProcessPendingIMU);
	// Or after modal is shown

  function drawThermometer(tempC) {
    const canvas = document.getElementById("tempCanvas");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const minTemp = 0;
    const maxTemp = 60;
    const clamped = Math.max(minTemp, Math.min(maxTemp, tempC));
    const fillHeight = (clamped - minTemp) / (maxTemp - minTemp) * h;

    // Tube background
    ctx.fillStyle = "#222";
    ctx.fillRect(w / 4, 0, w / 2, h);

    // Fill
    ctx.fillStyle = "#f33";
    ctx.fillRect(w / 4, h - fillHeight, w / 2, fillHeight);

    // Border
    ctx.strokeStyle = "#888";
    ctx.strokeRect(w / 4, 0, w / 2, h);
  }

  function drawCompassDial() {
    const canvas = document.getElementById("compassCanvas");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const size = canvas.width;
    const center = size / 2;
    const radius = center - 4;

    ctx.clearRect(0, 0, size, size);

    ctx.beginPath();
    ctx.arc(center, center, radius, 0, 2 * Math.PI);
    ctx.fillStyle = "#111";
    ctx.fill();
    ctx.strokeStyle = "#888";
    ctx.lineWidth = 1;
    ctx.stroke();

    const directions = ["N", "E", "S", "W"];
    for (let i = 0; i < 4; i++) {
      const angle = (i * 90 - 90) * Math.PI / 180;
      const x = center + Math.cos(angle) * (radius - 10);
      const y = center + Math.sin(angle) * (radius - 10);
      ctx.fillStyle = i === 0 ? "#f33" : "#fff";
      ctx.font = "bold 10px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(directions[i], x, y);
    }

    const needleAngle = (headingDeg - 90) * Math.PI / 180;
    const needleLength = radius - 12;
    ctx.beginPath();
    ctx.moveTo(center, center);
    ctx.lineTo(center + Math.cos(needleAngle) * needleLength, center + Math.sin(needleAngle) * needleLength);
    ctx.strokeStyle = "#f00";
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(center, center, 2, 0, 2 * Math.PI);
    ctx.fillStyle = "#fff";
    ctx.fill();
  }