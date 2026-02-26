// --- MEDIA TAB LOGIC ---

window.loadMediaTab = function() {
	const PATHS = window.MEDIA_PATHS || { photo:'/media/capture/photo', video:'/media/capture/video', audio:'/media/wav' };
  attachMediaRadioHandlers(); // always ensure correct handlers
  let type = document.querySelector('input[name="mediaType"]:checked')?.value || "photo";
  fetch(`/list_sd_files?path=${encodeURIComponent(PATHS[type])}`)
    .then(r => r.json())
    .then(list => renderMediaFileList(list, type));
};


function renderMediaFileList(list, type) {
  const fileList = document.getElementById("settingsMediaFileList");
  fileList.innerHTML = "";
  if (!Array.isArray(list) || list.length === 0 || (list.length === 1 && list[0] === "__EMPTY__")) {
    fileList.innerHTML = "<div style='color:#888;padding:12px;text-align:center;'>No files found</div>";
    return;
  }
  list.sort((a, b) => b.date - a.date); // newest first if possible
  list.forEach(file => {
    const row = document.createElement("div");
    row.className = "media-row";
    row.style = "padding:7px 8px; display:flex; align-items:center; cursor:pointer; border-bottom:1px solid #222;";
    row.innerHTML = `
      <span style="flex:1;">${file.name}</span>
      <button class="media-download-btn" style="margin-left:8px;">⬇️</button>
    `;
    row.onclick = (e) => {
      if (e.target.classList.contains("media-download-btn")) {
        downloadMediaFile(file, type);
        e.stopPropagation();
        return;
      }
      previewMediaFile(file, type);
    };
    fileList.appendChild(row);
  });
}

function downloadMediaFile(file, type) {
  let path = MEDIA_PATHS[type] + "/" + file.name;
  const a = document.createElement("a");
  a.href = `/download_sd?path=${encodeURIComponent(path)}`;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function previewMediaFile(file, type) {
  let path = MEDIA_PATHS[type] + "/" + file.name;
  const preview = document.getElementById("mediaPreview");
  preview.innerHTML = "";
  if (type === "photo") {
    const img = document.createElement("img");
    img.src = `/download_sd?path=${encodeURIComponent(path)}&t=${Date.now()}`;
    img.style = "max-width:95%;max-height:300px;border-radius:10px;box-shadow:0 0 14px #48f8;";
    preview.appendChild(img);
  } else if (type === "video") {
    if (file.name.endsWith(".mp4") || file.name.endsWith(".webm") || file.name.endsWith(".ogg")) {
      const video = document.createElement("video");
      video.src = `/download_sd?path=${encodeURIComponent(path)}&t=${Date.now()}`;
      video.controls = true;
      video.autoplay = true;
      video.style = "max-width:95%;max-height:300px;border-radius:10px;box-shadow:0 0 14px #48f8;";
      preview.appendChild(video);
    } else if (file.name.endsWith(".avi") || file.name.endsWith(".mjpeg")) {
      // MJPEG/AVI: play in-browser!
      playMjpegFile(path, preview, 10); // Default 10 FPS, tweak as needed
    } else {
      preview.textContent = "Unsupported video format.";
    }
  } else if (type === "audio") {
    if (file.name.endsWith(".wav") || file.name.endsWith(".mp3") || file.name.endsWith(".ogg")) {
      const audio = document.createElement("audio");
      audio.src = `/download_sd?path=${encodeURIComponent(path)}&t=${Date.now()}`;
      audio.controls = true;
      audio.style = "width:90%;";
      preview.appendChild(audio);
    } else {
      preview.textContent = "Unsupported audio format.";
    }
  }
}


// Listen for mediaType radio change
function attachMediaRadioHandlers() {
  const radios = document.querySelectorAll('input[name="mediaType"]');
  radios.forEach(radio => {
    radio.onchange = window.loadMediaTab;
  });
}

// MJPEG playback for Media Tab

function showCircularProgress(parent, percent, text = "") {
  // Remove existing progress bar if any
  let prog = parent.querySelector(".circle-progress");
  if (!prog) {
    prog = document.createElement("div");
    prog.className = "circle-progress";
    prog.style = `
      display:flex;flex-direction:column;align-items:center;justify-content:center;
      width:120px;height:120px;margin:28px auto 18px auto;position:relative;
    `;
    prog.innerHTML = `
      <svg width="120" height="120" style="position:absolute;top:0;left:0;">
        <circle cx="60" cy="60" r="54" stroke="#222" stroke-width="13" fill="none"/>
        <circle class="progress-bar" cx="60" cy="60" r="54"
          stroke="#00B6FF" stroke-width="10" fill="none"
          stroke-dasharray="339.292"
          stroke-dashoffset="339.292"
          stroke-linecap="round"
          style="transition:stroke-dashoffset 0.2s"/>
      </svg>
      <div class="progress-text" style="font-size:1.6em;font-weight:bold;color:#fff;z-index:1;position:relative;margin-top:18px;">0%</div>
      <div style="color:#8af;font-size:0.98em;margin-top:4px;">${text}</div>
    `;
    parent.appendChild(prog);
  }
  const circle = prog.querySelector(".progress-bar");
  const dash = 339.292;
  circle.setAttribute("stroke-dashoffset", (dash * (1 - percent/100)).toFixed(1));
  prog.querySelector(".progress-text").textContent = `${percent|0}%`;
}


async function playMjpegFile(path, previewDiv, fps = 10) {
  previewDiv.innerHTML = `
    <div class="mjpeg-player-wrapper">
      <div class="mjpeg-loading-overlay">
        <canvas class="mjpeg-loading-frame"></canvas>
        <div class="mjpeg-progress-circle">
          <svg class="mjpeg-progress-svg">
            <circle class="mjpeg-progress-bg" cx="40" cy="40" r="33"/>
            <circle class="mjpeg-progress-fg" cx="40" cy="40" r="33"
              stroke-dasharray="207" stroke-dashoffset="207"/>
          </svg>
          <span class="mjpeg-progress-text">0%</span>
        </div>
      </div>
      <div class="mjpeg-player-bar">
        <button class="mjpeg-playpause-btn">⏸️</button>
        <input type="range" class="mjpeg-seek-bar" value="0" min="0" step="1">
        <button class="mjpeg-enlarge-btn" title="Fullscreen">⛶</button>
        <button class="mjpeg-mute-btn">🔊</button>
        <input type="range" class="mjpeg-volume" min="0" max="100" value="100">
      </div>
    </div>
  `;

  // --- Download with Progress ---
  const loadingOverlay = previewDiv.querySelector('.mjpeg-loading-overlay');
  const progressFg = previewDiv.querySelector('.mjpeg-progress-fg');
  const progressText = previewDiv.querySelector('.mjpeg-progress-text');
  const loadingFrame = previewDiv.querySelector('.mjpeg-loading-frame');
  loadingFrame.getContext('2d').clearRect(0, 0, loadingFrame.width, loadingFrame.height);

  let received = 0, total = 1;
  const response = await fetch(`/download_sd?path=${encodeURIComponent(path)}`);
  if (!response.ok) {
    loadingOverlay.innerHTML = "<div style='color:#f66;text-align:center;width:100%;'>Failed to load video</div>";
    return;
  }
  total = +response.headers.get('Content-Length') || 1;
  const reader = response.body.getReader();
  let chunks = [], len = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      len += value.length;
      received += value.length;
      let pct = Math.round(received * 100 / total);
      progressText.textContent = pct + "%";
      progressFg.setAttribute('stroke-dashoffset', 207 - 207 * pct / 100);
    }
  }
  const data = new Uint8Array(len);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.length;
  }
  // --- Parse JPEG frames ---
  let frames = [];
  let i = 0;
  while (i < data.length - 1) {
    if (data[i] === 0xFF && data[i + 1] === 0xD8) {
      let start = i;
      i += 2;
      while (i < data.length - 1) {
        if (data[i] === 0xFF && data[i + 1] === 0xD9) {
          let end = i + 2;
          frames.push(data.slice(start, end));
          i = end;
          break;
        }
        i++;
      }
    } else {
      i++;
    }
  }
  if (frames.length === 0) {
    loadingOverlay.innerHTML = "<div style='color:#f66'>No frames found in MJPEG</div>";
    return;
  }

  // --- Setup Player in Modal ---
  const playerBar = previewDiv.querySelector('.mjpeg-player-bar');
  const playPauseBtn = playerBar.querySelector('.mjpeg-playpause-btn');
  const seekBar = playerBar.querySelector('.mjpeg-seek-bar');
  const enlargeBtn = playerBar.querySelector('.mjpeg-enlarge-btn');
  const muteBtn = playerBar.querySelector('.mjpeg-mute-btn');
  const volumeInput = playerBar.querySelector('.mjpeg-volume');
  let playing = true, curFrame = 0, timer = null, muted = false, volume = 1;

  // Canvas for video
  const canvas = document.createElement("canvas");
  canvas.style = "width:100%;max-width:100%;max-height:360px;background:#111;border-radius:14px;box-shadow:0 0 14px #48f8;";
  loadingOverlay.parentNode.replaceChild(canvas, loadingOverlay);
  let ctx = canvas.getContext("2d");

  // Controls
  playerBar.style.display = "flex";
  seekBar.max = frames.length - 1;

  function showFrame(idx, autoPlay) {
    let blob = new Blob([frames[idx]], { type: "image/jpeg" });
    let url = URL.createObjectURL(blob);
    let img = new window.Image();
    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);
      if (document.body.contains(fullscreenOverlay) && fullscreenOverlay.classList.contains('active')) {
        fsCanvas.width = img.width;
        fsCanvas.height = img.height;
        fsCtx.drawImage(img, 0, 0);
      }
      URL.revokeObjectURL(url);
    };
    img.src = url;
    seekBar.value = idx;
    curFrame = idx;
    if (timer) clearTimeout(timer);
    if (playing && autoPlay) {
      timer = setTimeout(() => {
        let next = curFrame + 1;
        if (next >= frames.length) next = 0;
        showFrame(next, true);
      }, 1000 / fps);
    }
  }
  showFrame(0, true);

  playPauseBtn.onclick = () => {
    playing = !playing;
    playPauseBtn.textContent = playing ? "⏸️" : "▶️";
    if (playing) showFrame(curFrame, true);
    else if (timer) clearTimeout(timer);
  };
  seekBar.oninput = e => {
    if (timer) clearTimeout(timer);
    showFrame(+seekBar.value, playing);
  };
  muteBtn.onclick = () => {
    muted = !muted;
    muteBtn.textContent = muted ? "🔇" : "🔊";
  };
  volumeInput.oninput = () => {
    volume = volumeInput.value / 100;
  };

  // --- Fullscreen Overlay logic ---
  let fullscreenOverlay = null, fsCanvas = null, fsCtx = null;
  enlargeBtn.onclick = () => {
    // 1. Pause playback and snapshot the frame/canvas
    playing = false; playPauseBtn.textContent = "▶️";
    if (timer) clearTimeout(timer);

    // 2. Create overlay dynamically if not exists
    if (!fullscreenOverlay) {
      fullscreenOverlay = document.createElement('div');
      fullscreenOverlay.className = 'mjpeg-fullscreen-overlay active';
      fullscreenOverlay.innerHTML = `
        <div class="mjpeg-fs-header">
          <button class="fs-min-btn" title="Minimize">&#8676;</button>
          <button class="fs-close-btn" title="Close">✖</button>
        </div>
        <canvas class="mjpeg-fullscreen-canvas"></canvas>
        <div class="mjpeg-fs-controls">
          <button class="fs-playpause-btn">▶️</button>
          <input type="range" class="fs-seek-bar" value="0" min="0" step="1">
          <button class="fs-mute-btn">🔊</button>
          <input type="range" class="fs-volume" min="0" max="100" value="100">
        </div>
      `;
      document.body.appendChild(fullscreenOverlay);

      // --- Animations ---
      fullscreenOverlay.style.opacity = 0;
      setTimeout(() => fullscreenOverlay.style.opacity = 1, 20);

      // --- Fullscreen Controls ---
      fsCanvas = fullscreenOverlay.querySelector('.mjpeg-fullscreen-canvas');
      fsCtx = fsCanvas.getContext('2d');
      const fsPlayBtn = fullscreenOverlay.querySelector('.fs-playpause-btn');
      const fsSeekBar = fullscreenOverlay.querySelector('.fs-seek-bar');
      const fsMuteBtn = fullscreenOverlay.querySelector('.fs-mute-btn');
      const fsVolume = fullscreenOverlay.querySelector('.fs-volume');
      fsSeekBar.max = frames.length - 1;

				function syncFsFrame(idx) {
					let blob = new Blob([frames[idx]], { type: "image/jpeg" });
					let url = URL.createObjectURL(blob);
					let img = new window.Image();
					img.onload = () => {
						// Get available area (matching .mjpeg-fullscreen-canvas CSS)
						const maxW = window.innerWidth * 0.96;
						const maxH = window.innerHeight * 0.84;
						let w = img.width, h = img.height;
						let scale = Math.min(maxW / w, maxH / h, 1); // Don't upscale!
						fsCanvas.width = w * scale;
						fsCanvas.height = h * scale;
						fsCtx.clearRect(0, 0, fsCanvas.width, fsCanvas.height);
						fsCtx.drawImage(img, 0, 0, fsCanvas.width, fsCanvas.height);
						URL.revokeObjectURL(url);
					};
					img.src = url;
					fsSeekBar.value = idx;
				}

      // Play/Pause
      let fsPlaying = false, fsTimer = null, fsCurFrame = curFrame;
      fsPlayBtn.onclick = () => {
        fsPlaying = !fsPlaying;
        fsPlayBtn.textContent = fsPlaying ? "⏸️" : "▶️";
        if (fsPlaying) playFsFrame(fsCurFrame, true);
        else if (fsTimer) clearTimeout(fsTimer);
      };
      fsSeekBar.oninput = e => {
        if (fsTimer) clearTimeout(fsTimer);
        fsCurFrame = +fsSeekBar.value;
        syncFsFrame(fsCurFrame);
      };
      fsMuteBtn.onclick = () => {
        muted = !muted;
        fsMuteBtn.textContent = muted ? "🔇" : "🔊";
      };
      fsVolume.oninput = () => {
        volume = fsVolume.value / 100;
      };

      function playFsFrame(idx, autoPlay) {
        syncFsFrame(idx);
        fsCurFrame = idx;
        if (fsTimer) clearTimeout(fsTimer);
        if (fsPlaying && autoPlay) {
          fsTimer = setTimeout(() => {
            let next = fsCurFrame + 1;
            if (next >= frames.length) next = 0;
            playFsFrame(next, true);
          }, 1000 / fps);
        }
      }
      // Minimize or Close
      fullscreenOverlay.querySelector('.fs-min-btn').onclick = () => {
        fullscreenOverlay.classList.remove('active');
        setTimeout(() => fullscreenOverlay.remove(), 200);
      };
      fullscreenOverlay.querySelector('.fs-close-btn').onclick = () => {
        fullscreenOverlay.classList.remove('active');
        setTimeout(() => fullscreenOverlay.remove(), 200);
      };

      // Start at current frame, paused
      syncFsFrame(curFrame);
    }
  };

  // Ensure .active triggers fade-in
}
