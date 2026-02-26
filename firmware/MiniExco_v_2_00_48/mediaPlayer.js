// mediaPlayer.js
let mediaFiles = [];           // This will now hold ALL loaded files, append as we go.
let currentMediaIndex = -1;
let fileListPageSize = 20;
let totalMediaFiles = 0;       // from backend
let loadingFiles = false;      // prevent double-requests
let loopEnabled = false;
let shuffleEnabled = false;
let shuffleHistory = [];
let shuffleHistoryPointer = -1; // Points to current position in the shuffle history


function fmt(s) {
  if (isNaN(s)) return '--:--';
  let m = Math.floor(s / 60), ss = Math.floor(s % 60);
  return `${m}:${ss < 10 ? '0' : ''}${ss}`;
}

  
window.mediaPlaybackMode = "browser"; // Keep track of which mode is active: "browser" or "device"

window.mediaPlayerUpdateDeviceProgress = function(filename, elapsed, duration) {
  // Only update if device mode active
  if (window.mediaPlaybackMode !== "device" && window.mediaPlaybackMode !== "both") return;
  // Optionally: check if filename matches current device song
  // Update progress bar:
  const progressFill = document.getElementById('progressFill');
  const progressThumb = document.getElementById('progressThumb');
  const progressTime = document.getElementById('progressTime');
  if (!progressFill || !progressThumb || !progressTime) return;

  const percent = duration > 0 ? (elapsed / duration) * 100 : 0;
  progressFill.style.width = percent + '%';
  progressThumb.style.left = percent + '%';
  progressTime.textContent = fmt(elapsed) + " / " + fmt(duration);

  // Optionally: update highlight, set device song title, etc.
};

window.mediaPlayerSetDevicePlayState = function(filename, isPlaying) {
  // Highlight the correct 'play on device' button and update UI states
  window.mediaPlaybackMode = isPlaying ? "device" : "browser";
  renderMediaFileList();
  // Optionally: update play/pause animations on device controls
};

function fetchFirstMediaFiles() {
  hideMediaIndexingProgress();
  mediaFiles = [];
  totalMediaFiles = 0;
  renderMediaFileList(true); // Clear existing list
  fetchNextMediaFiles();
  updateSongTitleMarquee();
}

function fetchNextMediaFiles() {
  if (loadingFiles) return;
  loadingFiles = true;
  fetch(`/list_media_files?start=${mediaFiles.length}&count=${fileListPageSize}`)
    .then(r => r.json())
	.then(data => {
	  if (data && data.status === "reindexing") {
		showMediaIndexingProgress(data.path || "/media", 0, 0, 0, true);
		pollMediaReindexStatus(data.path || "/media");
		return;
	  }
	  if (Array.isArray(data.files)) {
		mediaFiles = mediaFiles.concat(data.files);
		totalMediaFiles = data.total;
		renderMediaFileList(); // Just add, do NOT clear!
	  }
	})

    .finally(() => loadingFiles = false);
}


window.toggleMediaPlayerReal = function() {
  let modal = document.getElementById('mediaPlayerModal');
  // If not loaded, load as before
  if (!window.mediaPlayerLoaded) {
    fetch('/mediaPlayer.html?v=' + Date.now())
      .then(r => r.text())
      .then(html => {
        document.body.insertAdjacentHTML('beforeend', html);
        window.mediaPlayerLoaded = true;
        initMediaPlayer();
        showMediaPlayer();
      });
  } else if (modal) {
    // Toggle show/hide
    if (modal.style.display === 'block') {
      modal.style.display = 'none';
    } else {
      showMediaPlayer();
    }
  }
};



function showMediaPlayer() {
  const playerModal = document.getElementById('mediaPlayerModal');
  if (!playerModal) return showToast("Media player modal not found!");
  playerModal.style.display = 'block';
  fetchFirstMediaFiles();     // instead of fetchMediaFiles()
}


function hideMediaPlayer() {
  hideMediaIndexingProgress();
  const playerModal = document.getElementById('mediaPlayerModal');
  if (playerModal) playerModal.style.display = 'none';
}

function initMediaPlayer() {
	document.getElementById('mediaPlayBtn').onclick = function() {
	  if (window.mediaPlaybackMode === "device") {
		if (window.wsCarInput && window.wsCarInput.readyState === 1) {
		  window.wsCarInput.send("MEDIA_RESUME");
		}
		return;
	  }
	  playCurrentMedia();
	};

	document.getElementById('mediaPauseBtn').onclick = function() {
	  if (window.mediaPlaybackMode === "device") {
		if (window.wsCarInput && window.wsCarInput.readyState === 1) {
		  window.wsCarInput.send("MEDIA_PAUSE");
		}
		return;
	  }
	  getPlayer().pause();
	};

	document.getElementById('mediaStopBtn').onclick = function() {
	  if (window.mediaPlaybackMode === "device") {
		if (window.wsCarInput && window.wsCarInput.readyState === 1) {
		  window.wsCarInput.send("MEDIA_STOP");
		}
		return;
	  }
	  getPlayer().pause();
	  getPlayer().currentTime = 0;
	};

	document.getElementById('mediaPrevBtn').onclick = function() {
	  if (window.mediaPlaybackMode === "device") {
		if (window.wsCarInput && window.wsCarInput.readyState === 1) {
		  window.wsCarInput.send("MEDIA_PREV");
		}
		return;
	  }
	  // --- Existing browser shuffle/prev logic ---
	  if (shuffleEnabled) {
		if (shuffleHistoryPointer > 0) {
		  selectMedia(shuffleHistory[shuffleHistoryPointer - 1], "prev");
		  shuffleHistoryPointer -= 2; // Will be re-incremented by selectMedia
		}
	  } else {
		if (currentMediaIndex > 0) selectMedia(currentMediaIndex - 1, true);
	  }
	};


	document.getElementById('mediaNextBtn').onclick = function() {
	  console.log("NEXT clicked, mode=", window.mediaPlaybackMode);
	  if (window.mediaPlaybackMode === "device") {
		if (window.wsCarInput && window.wsCarInput.readyState === 1) {
		  window.wsCarInput.send("MEDIA_NEXT");
		}
		return;
	  }
	  // --- Existing browser shuffle/next logic ---
	  if (shuffleEnabled) {
		if (shuffleHistoryPointer < shuffleHistory.length - 1) {
		  selectMedia(shuffleHistory[shuffleHistoryPointer + 1], "next");
		} else {
		  let available = mediaFiles.map((_, i) => i).filter(i => i !== currentMediaIndex);
		  if (available.length === 0) return;
		  let next = available[Math.floor(Math.random() * available.length)];
		  selectMedia(next, true);
		}
	  } else {
		if (currentMediaIndex < mediaFiles.length - 1) selectMedia(currentMediaIndex + 1, true);
	  }
	};



	document.getElementById('mediaVolume').oninput = function(e) {
	  const browserVolume = parseFloat(e.target.value);
	  // Convert [0..1] slider to [0..21] for ESP32
	  const deviceVolume = Math.round(browserVolume * 21);

	  if (!window.mediaPlaybackMode) window.mediaPlaybackMode = "browser";

	  // Control volume as per playback mode
	  if (window.mediaPlaybackMode === "browser") {
		getPlayer().volume = browserVolume;
	  } else if (window.mediaPlaybackMode === "device") {
		fetch('/set_volume?value=' + deviceVolume);
	  } else if (window.mediaPlaybackMode === "both") {
		getPlayer().volume = browserVolume;
		fetch('/set_volume?value=' + deviceVolume);
	  }
	};


    // Loop/Shuffle buttons
	const loopBtn = document.getElementById('mediaLoopBtn');
	if (loopBtn) {
	  loopBtn.onclick = function() {
		loopEnabled = !loopEnabled;
		loopBtn.classList.toggle('active', loopEnabled);
		// If loop is on, turn shuffle off for clarity
		if (loopEnabled && shuffleEnabled) {
		  shuffleEnabled = false;
		  shuffleBtn.classList.remove('active');
		}
		if (window.mediaPlaybackMode === "device" && window.wsCarInput && window.wsCarInput.readyState === 1) {
		  window.wsCarInput.send(loopEnabled ? "MEDIA_LOOP_ON" : "MEDIA_LOOP_OFF");
		}
	  };
	}

	const shuffleBtn = document.getElementById('mediaShuffleBtn');
	if (shuffleBtn) {
	  shuffleBtn.onclick = function() {
		shuffleEnabled = !shuffleEnabled;
		shuffleBtn.classList.toggle('active', shuffleEnabled);
		// If shuffle is on, turn loop off for clarity
		if (shuffleEnabled && loopEnabled) {
		  loopEnabled = false;
		  loopBtn.classList.remove('active');
		}
		if (window.mediaPlaybackMode === "device" && window.wsCarInput && window.wsCarInput.readyState === 1) {
		  window.wsCarInput.send(shuffleEnabled ? "MEDIA_SHUFFLE_ON" : "MEDIA_SHUFFLE_OFF");
		}
	  };
	}


  // Only attach if exists
  var filesBtn = document.getElementById('mediaFilesBtn');
  if (filesBtn) {
    filesBtn.onclick = function() {
      const panel = document.getElementById('mediaFileListPanel');
      if (!panel) return;
      panel.classList.toggle('open');
      // Refresh and reset file list every time panel opens
      if (panel.classList.contains('open')) {
        fetchFirstMediaFiles();
      }
    };
  }

  document.getElementById('mediaPlayerModal').onclick = function(e) {
    if (e.target === this) hideMediaPlayer();
  };

  document.addEventListener('keydown', function(e) {
    const modal = document.getElementById('mediaPlayerModal');
    if (!modal || modal.style.display !== 'block') return;
    if (e.key === 'Escape') hideMediaPlayer();
    if (e.key === ' ') {
      const player = getPlayer();
      if (player.paused) player.play();
      else player.pause();
      e.preventDefault();
    }
  }, false);

  // --- Infinite Scroll Handler for File List ---
  const panel = document.getElementById('mediaFileListPanel');
  panel.onscroll = function() {
    if (panel.scrollTop + panel.clientHeight >= panel.scrollHeight - 50) {
      if (!loadingFiles && mediaFiles.length < totalMediaFiles) {
        fetchNextMediaFiles();
      }
    }
  };

  // --- Custom progress bar logic below ---
  const audio = document.getElementById('mediaPlayerAudio');
  const video = document.getElementById('mediaPlayerVideo');
  const progressTrack = document.getElementById('progressTrack');
  const progressFill = document.getElementById('progressFill');
  const progressThumb = document.getElementById('progressThumb');
  const progressTime = document.getElementById('progressTime');

  function getActivePlayer() {
    return audio.style.display !== 'none' ? audio : video;
  }

  function updateProgressBar() {
    const player = getActivePlayer();
    if (!player || !progressFill || !progressThumb || !progressTime) return;
    let percent = 0;
    if (player.duration) percent = (player.currentTime / player.duration) * 100;
    progressFill.style.width = percent + '%';
    progressThumb.style.left = percent + '%';
    progressTime.textContent = `${fmt(player.currentTime)} / ${fmt(player.duration)}`;

    // --- Add thumb-over-text color logic (not needed if time is on right, but harmless):
    const timeRect = progressTime.getBoundingClientRect();
    const thumbRect = progressThumb.getBoundingClientRect();
    if (
      thumbRect.left < timeRect.right &&
      thumbRect.right > timeRect.left &&
      thumbRect.top < timeRect.bottom &&
      thumbRect.bottom > timeRect.top
    ) {
      progressTime.classList.add('covered');
    } else {
      progressTime.classList.remove('covered');
    }
  }
  
  updateSongTitleMarquee();
  // --- Drag/seek support ---
  let isDragging = false;
  let wasPlaying = false;

  function seekToEvent(e) {
    const player = getActivePlayer();
    if (!player.duration) return;
    const rect = progressTrack.getBoundingClientRect();
    let x;
    if (e.touches && e.touches.length) {
      x = e.touches[0].clientX - rect.left;
    } else if (e.changedTouches && e.changedTouches.length) {
      x = e.changedTouches[0].clientX - rect.left;
    } else {
      x = e.clientX - rect.left;
    }
    x = Math.max(0, Math.min(rect.width, x));
    const percent = x / rect.width;
    player.currentTime = percent * player.duration;
    updateProgressBar();
  }

  // Mouse events
  progressTrack.addEventListener('mousedown', function(e) {
    const player = getActivePlayer();
    if (!player.duration) return;
    isDragging = true;
    wasPlaying = !player.paused;
    player.pause();
    seekToEvent(e);
    document.body.style.userSelect = "none";
  });
  window.addEventListener('mousemove', function(e) {
    if (!isDragging) return;
    seekToEvent(e);
  });
  window.addEventListener('mouseup', function(e) {
    if (!isDragging) return;
    isDragging = false;
    seekToEvent(e);
    if (wasPlaying) getActivePlayer().play();
    document.body.style.userSelect = "";
  });

  // Touch events
  progressTrack.addEventListener('touchstart', function(e) {
    isDragging = true;
    wasPlaying = !getActivePlayer().paused;
    getActivePlayer().pause();
    seekToEvent(e);
    e.preventDefault();
  });
  window.addEventListener('touchmove', function(e) {
    if (!isDragging) return;
    seekToEvent(e);
    e.preventDefault();
  }, { passive: false });
  window.addEventListener('touchend', function(e) {
    if (!isDragging) return;
    isDragging = false;
    seekToEvent(e);
    if (wasPlaying) getActivePlayer().play();
    document.body.style.userSelect = "";
  });

  // --- Attach progress listeners to both audio and video
  ['timeupdate', 'durationchange', 'ended'].forEach(evt => {
    audio.addEventListener(evt, updateProgressBar);
    video.addEventListener(evt, updateProgressBar);
  });

  // --- Handle track end for loop/shuffle ---
  audio.addEventListener('ended', onTrackEnded);
  video.addEventListener('ended', onTrackEnded);

	function onTrackEnded() {
	  if (loopEnabled) {
		getPlayer().currentTime = 0;
		getPlayer().play();
	  } else if (shuffleEnabled) {
		// If in history, go forward
		if (shuffleHistoryPointer < shuffleHistory.length - 1) {
		  selectMedia(shuffleHistory[shuffleHistoryPointer + 1], "next");
		} else {
		  // Pick a new one
		  let available = mediaFiles.map((_, i) => i !== currentMediaIndex ? i : null).filter(i => i !== null);
		  if (available.length === 0) return;
		  let next = available[Math.floor(Math.random() * available.length)];
		  selectMedia(next, true);
		}
	  } else {
		// Next track if available
		let nextIndex = currentMediaIndex + 1;
		if (nextIndex >= totalMediaFiles) nextIndex = 0;
		if (nextIndex < totalMediaFiles) {
		  if (nextIndex >= mediaFiles.length) {
			fetch(`/list_media_files?start=${mediaFiles.length}&count=${fileListPageSize}`)
			  .then(r => r.json())
			  .then(data => {
				if (Array.isArray(data.files)) {
				  mediaFiles = mediaFiles.concat(data.files);
				  totalMediaFiles = data.total;
				  renderMediaFileList();
				  if (nextIndex < mediaFiles.length) {
					selectMedia(nextIndex, true);
				  }
				}
			  });
		  } else {
			selectMedia(nextIndex, true);
		  }
		}
	  }
	}


  // --- Key bit: update highlight & play button animation on actual play/pause events
  audio.addEventListener('play', renderMediaFileList);
  audio.addEventListener('pause', renderMediaFileList);
  video.addEventListener('play', renderMediaFileList);
  video.addEventListener('pause', renderMediaFileList);

  // Optionally: update when switching tracks
  updateProgressBar();
}


function getPlayer() {
  const audio = document.getElementById('mediaPlayerAudio');
  const video = document.getElementById('mediaPlayerVideo');
  return audio.style.display !== 'none' ? audio : video;
}



// Main render function: append only new files, unless clear=true
function renderMediaFileList(clear = false) {
  const list = document.getElementById('mediaFileList');
  if (clear) {
    list.innerHTML = '';
  } else {
    // Remove "No files found" message if present
    const firstChild = list.firstChild;
    if (firstChild && firstChild.textContent && firstChild.textContent.includes('No audio/video files found')) {
      list.removeChild(firstChild);
    }
  }

  // Remove already rendered count
  let renderedCount = list.children.length;
  for (let idx = renderedCount; idx < mediaFiles.length; idx++) {
    const fileObj = mediaFiles[idx];
    const file = typeof fileObj === "string" ? fileObj : fileObj.name;
    const ext = file.split('.').pop().toLowerCase();
    const isAudio = ['mp3', 'wav', 'ogg'].includes(ext);
    const isVideo = ['mp4', 'webm', 'mov'].includes(ext);
    if (!(isAudio || isVideo)) continue;

    const el = document.createElement('div');
    el.className = "media-file-item";

    const playBtn = document.createElement('button');
    playBtn.textContent = isAudio ? '▶️' : '🎬';
    playBtn.title = "Play in browser";
	playBtn.className = "play-anim";
	if (idx === currentMediaIndex && getPlayer() && !getPlayer().paused) {
	  playBtn.classList.add('playing');
	}
    playBtn.onclick = () => selectMedia(idx);

    const devBtn = document.createElement('button');
    devBtn.textContent = '🔊';
    devBtn.title = "Play on ESP32";
    devBtn.onclick = () => playOnDevice(file.name ? file.name : file);

    const fileSpan = document.createElement('span');
    fileSpan.textContent = ' ' + file;
    fileSpan.style.cursor = "pointer";
    fileSpan.onclick = () => selectMedia(idx);

    el.appendChild(playBtn);
    el.appendChild(devBtn);
    el.appendChild(fileSpan);

    if (idx === currentMediaIndex) el.classList.add('active');
    list.appendChild(el);
  }

  if (mediaFiles.length === 0) {
    list.innerHTML = '<div style="color:gray;padding:1em;text-align:center;">No audio/video files found</div>';
  }
  
  const summary = document.getElementById('mediaFileListSummary');
  if (summary) {
    summary.textContent = `Showing ${mediaFiles.length} of ${totalMediaFiles}`;
  }
  
	// Show spinner at bottom if loading more files
	const spinnerId = 'mediaFileListSpinner';
	let oldSpinner = document.getElementById(spinnerId);
	if (loadingFiles && mediaFiles.length < totalMediaFiles) {
	  if (!oldSpinner) {
		let spinner = document.createElement('div');
		spinner.id = spinnerId;
		spinner.style = "text-align:center;color:#6cf;padding:10px;";
		spinner.innerHTML = "Loading more files...";
		list.appendChild(spinner);
	  }
	} else if (oldSpinner) {
	  oldSpinner.remove();
	}
  
}


function playOnDevice(file) {
  // Instantly update UI: turn off mic if active
  if (window.micEnabled) {
    window.micEnabled = false;
    const micBtn = document.getElementById("micBtn");
    if (micBtn) micBtn.classList.remove("active", "listening");
    const micIcon = document.getElementById("micIcon");
    if (micIcon) micIcon.style.color = "";
  }

  // Always stop browser audio/video and set playback mode first!
  const audio = document.getElementById('mediaPlayerAudio');
  const video = document.getElementById('mediaPlayerVideo');
  if (audio) {
    audio.pause();
    audio.currentTime = 0;
  }
  if (video) {
    video.pause();
    video.currentTime = 0;
  }

  // Decide playback method ONCE at the start
  const useWebSocket = window.wsCarInput && window.wsCarInput.readyState === 1;

  window.mediaPlaybackMode = "device";
  console.log("playOnDevice: switching to device mode, useWebSocket=", useWebSocket);

  fetch('/disable_mic')
    .finally(() => {
      if (useWebSocket) {
        window.wsCarInput.send("MEDIA_PLAY," + file);
        showToast("Requested ESP32 to play: " + file);
      } else {
        fetch('/play_on_device?file=' + encodeURIComponent(file))
          .then(r => r.text())
          .then(txt => showToast(txt));
      }

      if (window.mediaPlayerSetDevicePlayState)
        window.mediaPlayerSetDevicePlayState(true, file);
    });
}






function selectMedia(idx, fromUser = false) {
  // Handle shuffle history management
  if (shuffleEnabled && fromUser !== "prev") {
    // If we're not at the end of history, cut off future (like browser nav)
    if (shuffleHistoryPointer < shuffleHistory.length - 1) {
      shuffleHistory = shuffleHistory.slice(0, shuffleHistoryPointer + 1);
    }
    shuffleHistory.push(idx);
    shuffleHistoryPointer = shuffleHistory.length - 1;
  } else if (!shuffleEnabled) {
    shuffleHistory = [];
    shuffleHistoryPointer = -1;
  }

  currentMediaIndex = idx;
  const fileObj = mediaFiles[idx];
  const file = typeof fileObj === "string" ? fileObj : fileObj.name;
  const ext = file.split('.').pop().toLowerCase();
  const audio = document.getElementById('mediaPlayerAudio');
  const video = document.getElementById('mediaPlayerVideo');

  audio.style.display = 'none';
  video.style.display = 'none';
  audio.pause(); video.pause();

  // ----- Playback handling -----
  if (['mp3','wav','ogg'].includes(ext)) {
    audio.src = file.startsWith('/media/') ? encodeURI(file) : '/media/' + encodeURI(file);
    audio.style.display = '';
    // Set volume from slider (range 0..1)
    const volSlider = document.getElementById('mediaVolume');
    if (volSlider) audio.volume = parseFloat(volSlider.value || "1");
	
	// If switching to browser playback, stop device playback first
	if (window.mediaPlaybackMode !== "browser" && window.wsCarInput && window.wsCarInput.readyState === 1) {
	  window.wsCarInput.send("MEDIA_STOP");
	}
	window.mediaPlaybackMode = "browser";
	
    audio.play();
    // Set playback mode: if device is also playing, mode = both
    if (window.mediaPlaybackMode === "device") {
      window.mediaPlaybackMode = "both";
    } else {
      window.mediaPlaybackMode = "browser";
    }
  } else if (['mp4','webm','mov'].includes(ext)) {
    video.src = '/media/' + encodeURIComponent(file);
    video.style.display = '';
    video.play();
    // For video, you may want to set playback mode as "browser" too:
    window.mediaPlaybackMode = "browser";
  }

  renderMediaFileList();

  // Scroll into view
  const list = document.getElementById('mediaFileList');
  const items = list.children;
  if (items[idx]) {
    const panel = document.getElementById('mediaFileListPanel');
    const el = items[idx];
    const offset = el.offsetTop - panel.clientHeight / 2 + el.offsetHeight / 2;
    panel.scrollTop = Math.max(0, offset);
  }
  updateSongTitleMarquee();
}



function playCurrentMedia() {
  if (currentMediaIndex === -1 && mediaFiles.length > 0) {
    selectMedia(0);
  } else {
    getPlayer().play();
  }
}

function updateSongTitleMarquee() {
  const titleDiv = document.getElementById('progressSongTitle');
  const wrap = document.getElementById('progressSongTitleWrap');
  if (!titleDiv || !wrap) return;
  let fileObj = mediaFiles[currentMediaIndex] || '';
  let file = fileObj && typeof fileObj === "object" ? fileObj.name : fileObj;
  if (!file) {
    titleDiv.innerHTML = '';
    titleDiv.style.animation = 'none';
    return;
  }
  let name = file.split('/').pop();

  // Add spaces between repeats for smooth loop (repeat once)
  let spacer = '&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;'; // 5 spaces
  titleDiv.innerHTML = name + spacer + name + spacer; // at least two cycles

  // Wait until DOM renders, then animate if overflow
  setTimeout(() => {
    const wrapWidth = wrap.offsetWidth;
    const textWidth = titleDiv.scrollWidth / 2; // Single name+gap width

    if (textWidth > wrapWidth) {
      // The total distance is textWidth + gap
      let total = textWidth + 32; // Add small fudge for smoother reset
      titleDiv.style.setProperty('--scroll-total', `-${total}px`);
      let speed = Math.max(8, (textWidth / 90) * 8); // 8s per 600px approx
      titleDiv.style.animation = `marquee-loop ${speed}s linear infinite`;
    } else {
      titleDiv.style.animation = 'none';
      titleDiv.innerHTML = name; // Remove repeat if no overflow
    }
  }, 50);
}

// Show/hide modal using SD File Manager logic if available
function showMediaIndexingProgress(path, percent, count, total, indeterminate) {
    if (window.showIndexingProgress) {
        // Reuse SD card modal (will show under SD tab too, that's fine!)
        showIndexingProgress(path, percent, count, total, indeterminate);
    } else {
        // Fallback: basic modal (never needed if SD logic loaded)
        let modal = document.getElementById("mediaIndexProgress");
        if (!modal) {
            modal = document.createElement("div");
            modal.id = "mediaIndexProgress";
            modal.style = "position:fixed;top:40%;left:50%;transform:translate(-50%,-50%);z-index:3001;background:#223;padding:22px 44px;border-radius:18px;color:#fff;font-size:1.2em;text-align:center;";
            modal.innerHTML = "<span id='mediaIndexText'></span><div id='mediaIndexBar' style='height:14px;background:#333;border-radius:7px;margin:12px 0;width:100%;overflow:hidden;'><div id='mediaIndexFill' style='background:#6cf;width:0;height:14px;border-radius:7px;transition:width .2s;'></div></div>";
            document.body.appendChild(modal);
        }
        let txt = indeterminate ? "Indexing media files..." : `Indexing folder: ${path}`;
        document.getElementById("mediaIndexText").textContent = txt;
        document.getElementById("mediaIndexBar").style.display = indeterminate ? "none" : "block";
        document.getElementById("mediaIndexFill").style.width = indeterminate ? "0" : (percent + "%");
        modal.style.display = "block";
    }
}

function hideMediaIndexingProgress() {
    if (window.hideIndexingProgress) {
        hideIndexingProgress();
    } else {
        let modal = document.getElementById("mediaIndexProgress");
        if (modal) modal.style.display = "none";
    }
}

function pollMediaReindexStatus(path) {
    function poll(currentPath) {
        fetch("/sd_reindex_status")
            .then(r => r.json())
            .then(info => {
                if (!info || !info.path) return;
                if (info.pending) {
                    let indeterminate = (info.counting === true) || (!info.total || info.total === 0);
                    let percent = (info.total > 0) ? Math.floor(info.count * 100 / info.total) : 0;
                    showMediaIndexingProgress(info.path, percent, info.count, info.total, indeterminate);
                    setTimeout(() => poll(info.path), 900); // Always update to latest
                } else {
                    hideMediaIndexingProgress();
                    fetchFirstMediaFiles(); // Reload after indexing
                }
            })
            .catch(e => {
                hideMediaIndexingProgress();
                showToast("❌ Error polling media index: " + e, true);
            });
    }
    poll(path);
}

