// --- Hardcoded fallbacks (used/merged when selecting that country) ---
const FALLBACK_STATIONS = {
  AZ: [
    { name: "106 FM (Azad Azərbaycan)", url: "https://audiostr.atv.az/106fm" },
    { name: "Yurd FM",                  url: "https://icecast.livetv.az/yurdfm" },
    { name: "Anti Radio (Baku)",        url: "https://stream.antiradio.net/listen/anti_radio/mp3" },
    { name: "Radio TMB 100.5",          url: "https://s39.myradiostream.com:5458/listen.mp3" },
    { name: "Radio Antenn",             url: "https://icecast.livetv.az/antennfm" },
  ],
};

const ALLOW_RADIO_BROWSER = (window.mediaPlayerAllowRemote !== false);

// Utilities
function mergeStations(a, b){
  const norm = u => (u||"").trim().toLowerCase();
  const map = new Map();
  (a||[]).forEach(s => s?.url && map.set(norm(s.url), s));
  (b||[]).forEach(s => s?.url && !map.has(norm(s.url)) && map.set(norm(s.url), s));
  return Array.from(map.values()).sort((x,y)=>x.name.localeCompare(y.name));
}
function populateSelect(sel, items, valueKey="url", textKey="name"){
  if (!sel) return;
  sel.innerHTML = "";
  (items||[]).forEach(it=>{
    const o=document.createElement("option");
    o.value = it[valueKey]; o.textContent = it[textKey];
    sel.appendChild(o);
  });
}
function isBrowserPlayable(url){
  if (location.protocol === "https:") return url.startsWith("https://");
  return true;
}

async function fetchCountriesRB(){
  (window.__mpFetchLog || (window.__mpFetchLog = [])).push({ fn: "fetchCountriesRB", ts: Date.now() });
  if (!ALLOW_RADIO_BROWSER) {
    const list = Object.keys(FALLBACK_STATIONS).map(code => ({ code, name: code }));
    if (list.length) return list;
    throw new Error("Radio Browser disabled");
  }
  try{
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), 8000);
    const res = await fetch("/rb/countries?t=" + Date.now(), { cache: "no-store", signal: ctl.signal });
    clearTimeout(to);
    if (!res.ok) throw new Error("countries upstream " + res.status);
    const all = await res.json();
    if (Array.isArray(all)) {
      return all
        .map(c => {
          const name = c?.name || c?.country || c?.code;
          const code = (c?.iso_3166_1 || c?.code || "").toString().trim().toUpperCase();
          if (!code || !name) return null;
          return { code, name };
        })
        .filter(Boolean)
        .sort((a,b)=>a.name.localeCompare(b.name));
    }
  }catch(e){
    console.warn("[RadioBrowser] countries fetch failed", e);
  }
  // fall back to keys we have locally
  const fallbackCodes = Object.keys(FALLBACK_STATIONS);
  if (fallbackCodes.length) {
    return fallbackCodes.map(code => ({
      code,
      name: code
    })).sort((a,b)=>a.name.localeCompare(b.name));
  }
  throw new Error("Radio Browser countries unavailable");
}

async function fetchStationsByCountry(code, limit=100){
  const cc = (code || "").toString().trim().toUpperCase();
  (window.__mpFetchLog || (window.__mpFetchLog = [])).push({ fn: "fetchStationsByCountry", ts: Date.now(), code: cc });
  const lim = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 200);
  if (!ALLOW_RADIO_BROWSER) {
    return mergeStations(FALLBACK_STATIONS[cc]||[], []);
  }
  try{
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), 8000);
    const res = await fetch(`/rb/stations?country=${encodeURIComponent(cc)}&limit=${lim}&t=${Date.now()}`, {
      cache: "no-store",
      signal: ctl.signal
    });
    clearTimeout(to);
    if (!res.ok) throw new Error("stations upstream " + res.status);
    const js = await res.json();
    if (Array.isArray(js)) {
      return js
        .slice(0, lim)
        .map(s=>({ name: s?.name || s?.tags || "Unnamed", url: s?.url_resolved || s?.url }))
        .filter(s=>s.url);
    }
  }catch(e){
    console.warn("[RadioBrowser] stations fetch failed for", cc, e);
  }
  return mergeStations(FALLBACK_STATIONS[cc]||[], []); // fail soft, we still have fallbacks
}

// ===== Radio: global helpers =====
function setLiveTitle(name) {
  const titleDiv = document.getElementById('progressSongTitle');
  const wrap = document.getElementById('progressSongTitleWrap');
  if (!titleDiv || !wrap) return;
  window.currentMediaIndex = -1; // clear file highlight
  const live = `🔴 LIVE · ${name}`;
  // repeat once for marquee
  const spacer = '&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;';
  titleDiv.innerHTML = live + spacer + live + spacer;

  setTimeout(() => {
    const wrapWidth = wrap.offsetWidth;
    const textWidth = titleDiv.scrollWidth / 2; // one cycle width
    if (textWidth > wrapWidth) {
      const total = textWidth + 32;
      titleDiv.style.setProperty('--scroll-total', `-${total}px`);
      const speed = Math.max(8, (textWidth / 90) * 8);
      titleDiv.style.animation = `marquee-loop ${speed}s linear infinite`;
    } else {
      titleDiv.style.animation = 'none';
      titleDiv.textContent = live;
    }
  }, 30);
}

function playRadioInBrowser(url, name) {
  // stop device if it’s playing
  if (window.mediaPlaybackMode !== "browser" &&
      window.wsCarInput && window.wsCarInput.readyState === 1) {
    window.wsCarInput.send("MEDIA_STOP");
  }
  window.mediaPlaybackMode = "browser";

  const audio = document.getElementById('mediaPlayerAudio');
  const video = document.getElementById('mediaPlayerVideo');
  if (video) { video.pause(); video.style.display = 'none'; }
  if (!audio) return;

  audio.style.display = '';
  const volSlider = document.getElementById('mediaVolume');
  if (volSlider) audio.volume = parseFloat(volSlider.value || "1");

  audio.src = url;               // direct stream URL
  audio.play().catch(() => { showToast("Couldn’t start radio in browser."); });
  setLiveTitle(name);
  if (typeof renderMediaFileList === "function") renderMediaFileList(); // clear highlight
}

function playRadioOnDevice(url, name) {
  // stop browser player
  const audio = document.getElementById('mediaPlayerAudio');
  const video = document.getElementById('mediaPlayerVideo');
  if (audio) { audio.pause(); audio.currentTime = 0; }
  if (video) { video.pause(); video.currentTime = 0; }

  window.mediaPlaybackMode = "device";
  fetch('/play_radio?url=' + encodeURIComponent(url), { cache: "no-store" })
    .then(async (r) => {
      let data = {};
      try { data = await r.json(); } catch (_) { data = {}; }
      if (!r.ok || !data.ok) {
        const msg = (data && (data.error || data.message)) ? (data.error || data.message) : (`HTTP ${r.status}`);
        throw new Error(msg);
      }
      showToast("Asked ESP32 to play: " + name);
    })
    .catch((e) => {
      showToast("Failed to start device radio: " + (e?.message || e), "error");
    });
  if (typeof window.mediaPlayerSetDevicePlayState === "function") {
    window.mediaPlayerSetDevicePlayState(name, true);
  }
  setLiveTitle(name);
}


// Optional: avoid mixed-content error for browser playback when page is HTTPS
function isBrowserPlayable(url) {
  if (location.protocol === "https:") return url.startsWith("https://");
  return true;
}


if (typeof window.mediaFiles === "undefined") window.mediaFiles = [];
if (typeof window.currentMediaIndex === "undefined") window.currentMediaIndex = -1;
if (typeof window.currentDeviceMediaIndex === "undefined") window.currentDeviceMediaIndex = -1;
if (typeof window.fileListPageSize === "undefined") window.fileListPageSize = 20;
if (typeof window.totalMediaFiles === "undefined") window.totalMediaFiles = 0;
if (typeof window.loadingFiles === "undefined") window.loadingFiles = false;
if (typeof window.mediaListEndReached === "undefined") window.mediaListEndReached = false;
if (typeof window.loopEnabled === "undefined") {
  window.loopEnabled = localStorage.getItem("mpLoopEnabled") === "1";
}
if (typeof window.shuffleEnabled === "undefined") {
  window.shuffleEnabled = localStorage.getItem("mpShuffleEnabled") === "1";
}
if (typeof window.shuffleHistory === "undefined") window.shuffleHistory = [];
if (typeof window.shuffleHistoryPointer === "undefined") window.shuffleHistoryPointer = -1;
if (typeof window.currentDeviceTrackName === "undefined") window.currentDeviceTrackName = "";

function isShuffleOn() { return window.shuffleEnabled === true; }
function isLoopOn() { return window.loopEnabled === true; }
function persistMediaModes() {
  localStorage.setItem("mpLoopEnabled", isLoopOn() ? "1" : "0");
  localStorage.setItem("mpShuffleEnabled", isShuffleOn() ? "1" : "0");
}



function fmt(s) {
  if (isNaN(s)) return '--:--';
  let m = Math.floor(s / 60), ss = Math.floor(s % 60);
  return `${m}:${ss < 10 ? '0' : ''}${ss}`;
}

let mediaProgressTrack = null;
let mediaProgressFill = null;
let mediaProgressThumb = null;
let mediaProgressTime = null;

function ensureMediaProgressElements() {
  const needsRefresh = (el) => !el || !el.isConnected;
  if (needsRefresh(mediaProgressTrack)) mediaProgressTrack = document.getElementById('progressTrack');
  if (needsRefresh(mediaProgressFill)) mediaProgressFill = document.getElementById('progressFill');
  if (needsRefresh(mediaProgressThumb)) mediaProgressThumb = document.getElementById('progressThumb');
  if (needsRefresh(mediaProgressTime)) mediaProgressTime = document.getElementById('progressTime');
}

function updateProgressBar(force) {
  force = (typeof force === 'boolean') ? force : false;
  ensureMediaProgressElements();

  const player = getPlayer();
  if (!player || !mediaProgressFill || !mediaProgressThumb || !mediaProgressTime) return;

  let percent = 0;
  if (player.duration) percent = (player.currentTime / player.duration) * 100;

  mediaProgressFill.style.width = percent + '%';
  mediaProgressThumb.style.left = percent + '%';
  mediaProgressTime.textContent = `${fmt(player.currentTime)} / ${fmt(player.duration)}`;

  try {
    const timeRect = mediaProgressTime.getBoundingClientRect();
    const thumbRect = mediaProgressThumb.getBoundingClientRect();
    if (thumbRect.left < timeRect.right &&
        thumbRect.right > timeRect.left &&
        thumbRect.top < timeRect.bottom &&
        thumbRect.bottom > timeRect.top) {
      mediaProgressTime.classList.add('covered');
    } else {
      mediaProgressTime.classList.remove('covered');
    }
  } catch (_) {
    // Ignore layout exceptions while elements are detaching.
  }

  if (!force && typeof updateSongTitleMarquee === "function") {
    updateSongTitleMarquee();
  }
}

  
window.mediaPlaybackMode = "browser"; // Keep track of which mode is active: "browser" or "device"
window.mediaDeviceTransportState = window.mediaDeviceTransportState || "stopped";

function getTransportButtons() {
  return {
    play: document.getElementById('mediaPlayBtn'),
    pause: document.getElementById('mediaPauseBtn'),
    stop: document.getElementById('mediaStopBtn')
  };
}

function resolveBrowserTransportState() {
  const player = getPlayer();
  if (!player) return "stopped";

  const hasSource = !!player.src;
  const hasProgress = Number(player.currentTime || 0) > 0;

  if (!hasSource && !hasProgress) return "stopped";
  if (!player.paused && !player.ended) return "playing";
  if (player.paused && hasProgress && !player.ended) return "paused";
  return "stopped";
}

function resolveTransportState() {
  if (window.mediaPlaybackMode === "device") {
    return window.mediaDeviceTransportState || "stopped";
  }
  if (window.mediaPlaybackMode === "both") {
    const browserState = resolveBrowserTransportState();
    if (browserState === "playing") return "playing";
    return window.mediaDeviceTransportState || browserState || "stopped";
  }
  return resolveBrowserTransportState();
}

function updateTransportButtons() {
  const btns = getTransportButtons();
  if (!btns.play || !btns.pause || !btns.stop) return;

  const state = resolveTransportState();
  btns.play.classList.toggle('transport-latched', state === "playing");
  btns.pause.classList.toggle('transport-latched', state === "paused");
  btns.stop.classList.toggle('transport-latched', state === "stopped");
}

window.mediaPlayerSetDeviceTransportState = function(state) {
  if (state !== "playing" && state !== "paused" && state !== "stopped") return;
  window.mediaDeviceTransportState = state;
  updateTransportButtons();
};

window.mediaPlayerUpdateDeviceProgress = function(filename, elapsed, duration) {
  // Only update if device mode active
  if (window.mediaPlaybackMode !== "device" && window.mediaPlaybackMode !== "both") return;
 
  if (filename) {
    window.currentDeviceTrackName = filename;
    const target = filename.split('/').pop();
    const idx = mediaFiles.findIndex(f => {
      let name = (typeof f === "object" && f.name) ? f.name : f;
      return name === filename || name.split('/').pop() === target;
    });
    if (idx !== -1) {
      window.currentDeviceMediaIndex = idx;
    }
  }

  // Update progress bar:
  const progressFill = document.getElementById('progressFill');
  const progressThumb = document.getElementById('progressThumb');
  const progressTime = document.getElementById('progressTime');
  if (!progressFill || !progressThumb || !progressTime) return;

  const percent = duration > 0 ? (elapsed / duration) * 100 : 0;
  progressFill.style.width = percent + '%';
  progressThumb.style.left = percent + '%';
  progressTime.textContent = fmt(elapsed) + " / " + fmt(duration);

  updateProgressBar(true);
  requestAnimationFrame(() => updateSongTitleMarquee());
};

window.mediaPlayerUpdateProgressBar = function(force) {
  updateProgressBar(force);
};

window.mediaPlayerSetDevicePlayState = function(filename, isPlaying) {
  window.mediaPlaybackMode = isPlaying ? "device" : "browser";
  window.mediaDeviceTransportState = isPlaying ? "playing" : "stopped";
  
  if (isPlaying && filename) {
    window.currentDeviceTrackName = filename;
    // Normalize both to just the filename part for robust comparison
    const target = filename.split('/').pop();
    const idx = mediaFiles.findIndex(f => {
      let name = (typeof f === "object" && f.name) ? f.name : f;
      // Compare either full path or just file name
      return name === filename || name.split('/').pop() === target;
    });
    if (idx !== -1) {
      window.currentDeviceMediaIndex = idx;
    } else {
      window.currentDeviceMediaIndex = -1;
    }
  } else {
    window.currentDeviceMediaIndex = -1;
    window.currentDeviceTrackName = "";
  }
  
  renderMediaFileList();
  updateTransportButtons();
  requestAnimationFrame(() => updateSongTitleMarquee());
};



function fetchFirstMediaFiles() {
  hideMediaIndexingProgress();
  mediaFiles = [];
  window.currentMediaIndex = -1;
  totalMediaFiles = 0;
  mediaListEndReached = false;
  renderMediaFileList(true); // Clear existing list
  fetchNextMediaFiles();
  updateSongTitleMarquee();
}

function fetchNextMediaFiles() {
  if (loadingFiles || mediaListEndReached) return Promise.resolve(0);
  loadingFiles = true;
  const start = mediaFiles.length;
  const ctl = new AbortController();
  const timeoutId = setTimeout(() => ctl.abort(), 15000);
  return fetch(`/list_media_files?start=${start}&count=${fileListPageSize}`, { cache: "no-store", signal: ctl.signal })
    .then(r => r.json())
	.then(data => {
		//console.log("Fetched data.files:", data.files);
	  if (data && data.status === "reindexing") {
		showMediaIndexingProgress(data.path || "/media", 0, 0, 0, true);
		pollMediaReindexStatus(data.path || "/media");
		mediaListEndReached = false;
		return;
	  }
	  if (Array.isArray(data.files)) {
		const before = mediaFiles.length;
		mediaFiles = mediaFiles.concat(data.files);
		const added = mediaFiles.length - before;
		const reportedTotal = Number(data.total);
		if (Number.isFinite(reportedTotal) && reportedTotal >= 0) {
			totalMediaFiles = reportedTotal;
		} else if (totalMediaFiles < mediaFiles.length) {
			totalMediaFiles = mediaFiles.length;
		}
		// End list when backend says no more, or on empty/short page, or no newly appended rows.
		if (typeof data.hasMore === "boolean") {
			mediaListEndReached = !data.hasMore || (added <= 0);
		} else {
			mediaListEndReached = (data.files.length < fileListPageSize) || (added <= 0);
		}
		renderMediaFileList(); // Just add, do NOT clear!
		return added;
	  }
	  return 0;
	})
	.catch(err => {
		console.warn("[media] list_media_files failed:", err);
		showToast("Media list request timed out. Pull to retry.", "error");
		return 0;
	})
	.finally(() => {
		clearTimeout(timeoutId);
		loadingFiles = false;
		renderMediaFileList();
	});
}


window.toggleMediaPlayerReal = function() {
  // Always remove any old modal instances before injecting a new one.
  document.querySelectorAll('#mediaPlayerModal').forEach(m => m.remove());

  // Now, always load fresh from server:
  fetch('/mediaPlayer.html?v=' + Date.now())
    .then(r => r.text())
    .then(html => {
      document.body.insertAdjacentHTML('beforeend', html);
      window.mediaPlayerLoaded = true;  // Optional: this variable is now redundant if you always reload
      initMediaPlayer();
      showMediaPlayer();
    });
};



function showMediaPlayer() {
  const playerModal = document.getElementById('mediaPlayerModal');
  if (!playerModal) return showToast("Media player modal not found!");
  playerModal.style.display = 'block';
  //fetchFirstMediaFiles();     // instead of fetchMediaFiles()
}


function hideMediaPlayer() {
  hideMediaIndexingProgress();
  if (typeof window.releaseDeviceMediaResources === "function") {
    window.releaseDeviceMediaResources();
  }
  const playerModal = document.getElementById('mediaPlayerModal');
  if (playerModal) playerModal.style.display = 'none';
}

function initMediaPlayer() {
	document.getElementById('mediaPlayBtn').onclick = function() {
	  if (window.mediaPlaybackMode === "device") {
		if (window.wsCarInput && window.wsCarInput.readyState === 1) {
		  window.wsCarInput.send("MEDIA_RESUME");
      window.mediaPlayerSetDeviceTransportState("playing");
		}
		return;
	  }
	  playCurrentMedia();
    updateTransportButtons();
	};

	document.getElementById('mediaPauseBtn').onclick = function() {
	  if (window.mediaPlaybackMode === "device") {
		if (window.wsCarInput && window.wsCarInput.readyState === 1) {
		  window.wsCarInput.send("MEDIA_PAUSE");
      window.mediaPlayerSetDeviceTransportState("paused");
		}
		return;
	  }
	  getPlayer().pause();
    updateTransportButtons();
	};

	document.getElementById('mediaStopBtn').onclick = function() {
	  if (window.mediaPlaybackMode === "device") {
		if (window.wsCarInput && window.wsCarInput.readyState === 1) {
		  window.wsCarInput.send("MEDIA_STOP");
      window.mediaPlayerSetDeviceTransportState("stopped");
		}
		return;
	  }
	  getPlayer().pause();
	  getPlayer().currentTime = 0;
    updateTransportButtons();
	};

	document.getElementById('mediaPrevBtn').onclick = function() {
      const deviceModeActive = (window.mediaPlaybackMode === "device" &&
                                window.currentDeviceMediaIndex >= 0 &&
                                window.currentMediaIndex < 0);
	  if (deviceModeActive) {
		if (window.wsCarInput && window.wsCarInput.readyState === 1) {
		  window.wsCarInput.send("MEDIA_PREV");
          return;
		}
	  }
	  // --- Existing browser shuffle/prev logic ---
      if (mediaFiles.length === 0 && !mediaListEndReached) {
        fetchNextMediaFiles().then((added) => { if (added > 0) selectMedia(0, true); });
        return;
      }
	  if (isShuffleOn()) {
		if (window.shuffleHistoryPointer > 0) {
		  window.shuffleHistoryPointer -= 1;
		  selectMedia(window.shuffleHistory[window.shuffleHistoryPointer], "prev");
		}
	  } else {
		if (window.currentMediaIndex < 0 && mediaFiles.length > 0) {
		  selectMedia(0, true);
		} else if (window.currentMediaIndex > 0) {
		  selectMedia(window.currentMediaIndex - 1, true);
		}
	  }
	};


	document.getElementById('mediaNextBtn').onclick = function() {
	  //console.log("NEXT clicked, mode=", window.mediaPlaybackMode);
      const deviceModeActive = (window.mediaPlaybackMode === "device" &&
                                window.currentDeviceMediaIndex >= 0 &&
                                window.currentMediaIndex < 0);
	  if (deviceModeActive) {
		if (window.wsCarInput && window.wsCarInput.readyState === 1) {
		  window.wsCarInput.send("MEDIA_NEXT");
          return;
		}
	  }
	  // --- Existing browser shuffle/next logic ---
      if (mediaFiles.length === 0 && !mediaListEndReached) {
        fetchNextMediaFiles().then((added) => { if (added > 0) selectMedia(0, true); });
        return;
      }
      syncCurrentIndexFromPlayer();
      if (window.currentMediaIndex >= mediaFiles.length) {
        window.currentMediaIndex = mediaFiles.length - 1;
      }
	  if (isShuffleOn()) {
		if (window.shuffleHistoryPointer < window.shuffleHistory.length - 1) {
		  window.shuffleHistoryPointer += 1;
		  selectMedia(window.shuffleHistory[window.shuffleHistoryPointer], "next");
		} else {
		  let available = mediaFiles.map((_, i) => i).filter(i => i !== window.currentMediaIndex);
		  if (available.length === 0) return;
		  let next = available[Math.floor(Math.random() * available.length)];
		  selectMedia(next, true);
		}
	  } else {
		if (window.currentMediaIndex < 0 && mediaFiles.length > 0) {
		  selectMedia(0, true);
		  return;
		}
		if (window.currentMediaIndex < mediaFiles.length - 1) {
		  selectMedia(window.currentMediaIndex + 1, true);
		  return;
		}
		if (!mediaListEndReached) {
		  fetchNextMediaFiles().then((added) => {
			if (added > 0 && window.currentMediaIndex < mediaFiles.length - 1) {
			  selectMedia(window.currentMediaIndex + 1, true);
			}
		  });
		}
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
      loopBtn.classList.toggle('active', isLoopOn());
	  loopBtn.onclick = function() {
		window.loopEnabled = !isLoopOn();
        persistMediaModes();
		loopBtn.classList.toggle('active', isLoopOn());
		// If loop is on, turn shuffle off for clarity
		if (isLoopOn() && isShuffleOn()) {
		  window.shuffleEnabled = false;
		  if (shuffleBtn) shuffleBtn.classList.remove('active');
          window.shuffleHistory = [];
          window.shuffleHistoryPointer = -1;
		}
		if (window.mediaPlaybackMode === "device" && window.wsCarInput && window.wsCarInput.readyState === 1) {
		  window.wsCarInput.send(isLoopOn() ? "MEDIA_LOOP_ON" : "MEDIA_LOOP_OFF");
		}
	  };
	}

	const shuffleBtn = document.getElementById('mediaShuffleBtn');
	if (shuffleBtn) {
      shuffleBtn.classList.toggle('active', isShuffleOn());
	  shuffleBtn.onclick = function() {
		window.shuffleEnabled = !isShuffleOn();
        persistMediaModes();
		shuffleBtn.classList.toggle('active', isShuffleOn());
		// If shuffle is on, turn loop off for clarity
		if (isShuffleOn() && isLoopOn()) {
		  window.loopEnabled = false;
		  if (loopBtn) loopBtn.classList.remove('active');
        }
        if (!isShuffleOn()) {
          window.shuffleHistory = [];
          window.shuffleHistoryPointer = -1;
		}
		if (window.mediaPlaybackMode === "device" && window.wsCarInput && window.wsCarInput.readyState === 1) {
		  window.wsCarInput.send(isShuffleOn() ? "MEDIA_SHUFFLE_ON" : "MEDIA_SHUFFLE_OFF");
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
      // Refresh and reset file list every time panel opens to keep scroll/paging state consistent.
      if (panel.classList.contains('open')) {
        fetchFirstMediaFiles();
      }

    };
  }

	// --- Radio dropdown + buttons ---
	const countrySel = document.getElementById('radioCountrySelect');
	const stationSel = document.getElementById('radioSelect');
	const btnWeb     = document.getElementById('radioBrowserBtn');
	const btnDev     = document.getElementById('radioDeviceBtn');

	// Defaults (force Azerbaijan on initial load)
	const DEFAULT_CC = "AZ";
	localStorage.setItem("radioCountry", DEFAULT_CC);

	// Load countries (cache first for instant UI)
	(function loadCountries(){
		let cached = [];
		try {
			const c = JSON.parse(localStorage.getItem("radioCountries")||"[]");
			if (Array.isArray(c)) cached = c;
		} catch(e){}
		if (cached.length){
			populateSelect(countrySel, cached, "code", "name");
			countrySel.value = DEFAULT_CC;
		}
		// Fetch fresh
		fetchCountriesRB().then(list=>{
			localStorage.setItem("radioCountries", JSON.stringify(list));
			populateSelect(countrySel, list, "code", "name");
			countrySel.value = DEFAULT_CC;
			loadStationsFor(DEFAULT_CC, true);
		}).catch(()=>{
			// if RB fails and we had no cached countries, show just AZ
			if (!cached.length){
				const onlyAZ = [{code:"AZ", name:"Azerbaijan"}];
				populateSelect(countrySel, onlyAZ, "code", "name");
				countrySel.value = "AZ";
				loadStationsFor("AZ", true);
			}
		});
	})();

	// Load stations for a country, merge fallbacks, cache
	async function loadStationsFor(code, force=false){
		localStorage.setItem("radioCountry", code);
		// 1) cached stations first
		let cached = [];
		try {
			const ck = JSON.parse(localStorage.getItem("radioStations:"+code)||"[]");
			if (Array.isArray(ck)) cached = ck;
		} catch(e){}
		let merged = mergeStations(FALLBACK_STATIONS[code]||[], cached);
		if (merged.length || force) populateSelect(stationSel, merged);

		// 2) fetch fresh from RB and repopulate
		const remote = await fetchStationsByCountry(code);
		merged = mergeStations(FALLBACK_STATIONS[code]||[], remote);
		populateSelect(stationSel, merged);
		localStorage.setItem("radioStations:"+code, JSON.stringify(remote)); // store raw remote only
	}

	// Change country -> reload stations
	if (countrySel){
		countrySel.addEventListener('change', ()=>{
			const cc = countrySel.value || "AZ";
			loadStationsFor(cc, true);
		});
	}

	// Buttons reuse your existing functions
	if (btnWeb){
		btnWeb.onclick = ()=>{
			const url  = stationSel?.value;
			const name = stationSel?.selectedOptions?.[0]?.textContent || "Radio";
			if (!url) return;
			if (!isBrowserPlayable(url)) {
				showToast("This station is HTTP-only. Use 'Play on device'.");
				return;
			}
			playRadioInBrowser(url, name);
		};
	}
	if (btnDev){
		btnDev.onclick = ()=>{
			const url  = stationSel?.value;
			const name = stationSel?.selectedOptions?.[0]?.textContent || "Radio";
			if (!url) return;
			playRadioOnDevice(url, name);
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
  if (panel) {
    if (panel.__mpScrollHandler) {
      panel.removeEventListener('scroll', panel.__mpScrollHandler);
    }
    panel.__mpScrollHandler = function() {
      if (panel.scrollTop + panel.clientHeight >= panel.scrollHeight - 50) {
        if (!loadingFiles && !mediaListEndReached) {
          fetchNextMediaFiles();
        }
      }
    };
    panel.addEventListener('scroll', panel.__mpScrollHandler, { passive: true });
  }

  // --- Custom progress bar logic below ---
  const audio = document.getElementById('mediaPlayerAudio');
  const video = document.getElementById('mediaPlayerVideo');
  const progressTrack = mediaProgressTrack = document.getElementById('progressTrack');
  const progressFill = mediaProgressFill = document.getElementById('progressFill');
  const progressThumb = mediaProgressThumb = document.getElementById('progressThumb');
  const progressTime = mediaProgressTime = document.getElementById('progressTime');
  // --- Drag/seek support ---
  let isDragging = false;
  let wasPlaying = false;

  function seekToEvent(e) {
    const player = getPlayer();
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
    const player = getPlayer();
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
    if (wasPlaying) getPlayer().play();
    document.body.style.userSelect = "";
  });

  // Touch events
  progressTrack.addEventListener('touchstart', function(e) {
    isDragging = true;
    wasPlaying = !getPlayer().paused;
    getPlayer().pause();
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
    if (wasPlaying) getPlayer().play();
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
	  if (isLoopOn()) {
		getPlayer().currentTime = 0;
		getPlayer().play();
	  } else if (isShuffleOn()) {
		// If in history, go forward
		if (window.shuffleHistoryPointer < window.shuffleHistory.length - 1) {
		  window.shuffleHistoryPointer += 1;
		  selectMedia(window.shuffleHistory[window.shuffleHistoryPointer], "next");
		} else {
		  // Pick a new one
		  let available = mediaFiles.map((_, i) => i !== window.currentMediaIndex ? i : null).filter(i => i !== null);
		  if (available.length === 0) return;
		  let next = available[Math.floor(Math.random() * available.length)];
		  selectMedia(next, true);
		}
	  } else {
		// Next track if available
		let nextIndex = window.currentMediaIndex + 1;
		const knownTotal = (Number.isFinite(Number(totalMediaFiles)) && Number(totalMediaFiles) > 0)
			? Number(totalMediaFiles)
			: mediaFiles.length;
		if (nextIndex >= knownTotal) nextIndex = 0;
		if (nextIndex < knownTotal) {
		  if (nextIndex >= mediaFiles.length) {
			fetchNextMediaFiles();
		  } else {
			selectMedia(nextIndex, true);
		  }
		}
	  }
	}


  // --- Key bit: update highlight & play button animation on actual play/pause events
  audio.addEventListener('play', () => { renderMediaFileList(); updateTransportButtons(); });
  audio.addEventListener('pause', () => { renderMediaFileList(); updateTransportButtons(); });
  audio.addEventListener('ended', () => { updateTransportButtons(); });
  video.addEventListener('play', () => { renderMediaFileList(); updateTransportButtons(); });
  video.addEventListener('pause', () => { renderMediaFileList(); updateTransportButtons(); });
  video.addEventListener('ended', () => { updateTransportButtons(); });

  // Optionally: update when switching tracks
  updateProgressBar();
  updateTransportButtons();
}


function getPlayer() {
  const audio = document.getElementById('mediaPlayerAudio');
  const video = document.getElementById('mediaPlayerVideo');

  // If neither exists (modal not open), return null safely
  if (!audio && !video) return null;

  // If only one exists, return it
  if (audio && !video) return audio;
  if (!audio && video) return video;

  // Both exist -> choose visible one
  return (audio.style.display !== 'none') ? audio : video;
}

function normalizeMediaPath(src) {
  if (!src) return "";
  try {
    const u = new URL(src, window.location.href);
    return decodeURIComponent(u.pathname || "");
  } catch (_) {
    return decodeURIComponent(src || "");
  }
}

function syncCurrentIndexFromPlayer() {
  if (!Array.isArray(mediaFiles) || mediaFiles.length === 0) return;
  if (window.currentMediaIndex >= 0 && window.currentMediaIndex < mediaFiles.length) return;

  const player = getPlayer();
  if (!player || !player.src) return;
  const path = normalizeMediaPath(player.src);
  const fileOnly = path.split('/').pop();
  const idx = mediaFiles.findIndex(f => {
    const name = (typeof f === "object" && f.name) ? f.name : f;
    return name === path || name.split('/').pop() === fileOnly;
  });
  if (idx >= 0) window.currentMediaIndex = idx;
}

function centerActiveMediaInList() {
  const panel = document.getElementById('mediaFileListPanel');
  if (!panel) return;
  const active = panel.querySelector('.media-file-item.active');
  if (!active) return;
  const offset = active.offsetTop - (panel.clientHeight / 2) + (active.offsetHeight / 2);
  panel.scrollTop = Math.max(0, offset);
}



// Main render function: append only new files, unless clear=true

function renderMediaFileList(clear = false) {
  const panel = document.getElementById('mediaFileListPanel');
  const list = document.getElementById('mediaFileList');
  if (!list) return;

  list.innerHTML = '';

  let foundAny = false;
  let displayedCount = 0;
  let activeElement = null;
  for (let idx = 0; idx < mediaFiles.length; idx++) {
    const fileObj = mediaFiles[idx];
    const file = typeof fileObj === "string" ? fileObj : fileObj.name;
    const ext = file.split('.').pop().toLowerCase();
    const isAudio = ['mp3', 'wav', 'ogg'].includes(ext);
    const isVideo = ['mp4', 'webm', 'mov'].includes(ext);

    if (!(isAudio || isVideo)) continue;
    foundAny = true;
    displayedCount++;

    const el = document.createElement('div');
    el.className = "media-file-item";
    el.dataset.mediaIndex = String(idx);

    // Browser play button
    const playBtn = document.createElement('button');
    playBtn.textContent = isAudio ? '▶️' : '🎬';
    playBtn.title = "Play in browser";
    playBtn.className = "play-anim";
    if (idx === window.currentMediaIndex && getPlayer() && !getPlayer().paused) {
      playBtn.classList.add('playing');
    }
    playBtn.onclick = () => selectMedia(idx);

    // Device play button
    const devBtn = document.createElement('button');
    devBtn.textContent = '🔊';
    devBtn.title = "Play on ESP32";
    devBtn.className = "play-anim";
    if (idx === window.currentDeviceMediaIndex) {
      devBtn.classList.add('playing');
    }
    devBtn.onclick = () => {
      window.currentDeviceMediaIndex = idx;
      playOnDevice(file);
      renderMediaFileList(); // Update UI immediately
    };

    // File name
    const fileSpan = document.createElement('span');
    fileSpan.textContent = ' ' + file;
    fileSpan.style.cursor = "pointer";
    fileSpan.onclick = () => selectMedia(idx);

    el.appendChild(playBtn);
    el.appendChild(devBtn);
    el.appendChild(fileSpan);

    if (idx === window.currentMediaIndex || idx === window.currentDeviceMediaIndex) {
      el.classList.add('active');
      activeElement = el;
    }
    list.appendChild(el);
  }

  if (!foundAny) {
    list.innerHTML = '<div style="color:gray;padding:1em;text-align:center;">No audio/video files found</div>';
  }

  // Update summary
  const summary = document.getElementById('mediaFileListSummary');
  if (summary) {
    const total = Number(totalMediaFiles);
    if (Number.isFinite(total) && total > 0) {
      summary.textContent = `Showing ${displayedCount} of ${total}`;
    } else {
      summary.textContent = mediaListEndReached
        ? `Showing ${displayedCount} files`
        : `Showing ${displayedCount}+ files`;
    }
  }

  // Spinner logic
  const spinnerId = 'mediaFileListSpinner';
  let oldSpinner = document.getElementById(spinnerId);
  if (loadingFiles && !mediaListEndReached) {
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

  if (panel && activeElement) centerActiveMediaInList();
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

  // Stop browser playback
  const audio = document.getElementById('mediaPlayerAudio');
  const video = document.getElementById('mediaPlayerVideo');
  if (audio) { audio.pause(); audio.currentTime = 0; }
  if (video) { video.pause(); video.currentTime = 0; }

  const useWebSocket = window.wsCarInput && window.wsCarInput.readyState === 1;
  window.mediaPlaybackMode = "device";
  window.mediaDeviceTransportState = "playing";

  // NO MORE: fetch('/disable_mic')

  if (useWebSocket) {
    window.wsCarInput.send("MEDIA_PLAY," + file);
    showToast("Requested ESP32 to play: " + file);
  } else {
    fetch('/play_on_device?file=' + encodeURIComponent(file))
      .then(r => r.text())
      .then(txt => showToast(txt));
  }

  if (window.mediaPlayerSetDevicePlayState)
    window.mediaPlayerSetDevicePlayState(file, true);
  updateTransportButtons();
}







function selectMedia(idx, fromUser = false) {
  if (!Number.isInteger(idx) || idx < 0 || idx >= mediaFiles.length) return;

  // Handle shuffle history management
  if (isShuffleOn() && fromUser !== "prev" && fromUser !== "next") {
    // If we're not at the end of history, cut off future (like browser nav)
    if (window.shuffleHistoryPointer < window.shuffleHistory.length - 1) {
      window.shuffleHistory = window.shuffleHistory.slice(0, window.shuffleHistoryPointer + 1);
    }
    window.shuffleHistory.push(idx);
    window.shuffleHistoryPointer = window.shuffleHistory.length - 1;
  } else if (!isShuffleOn()) {
    window.shuffleHistory = [];
    window.shuffleHistoryPointer = -1;
  }

  window.currentMediaIndex = idx;
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
  } else if (['mp4','webm','mov'].includes(ext)) {
    video.src = file.startsWith('/media/') ? encodeURI(file) : '/media/' + encodeURI(file);
    video.style.display = '';
    video.play();
    // For video, you may want to set playback mode as "browser" too:
    window.mediaPlaybackMode = "browser";
  }

  renderMediaFileList();
  updateTransportButtons();
  centerActiveMediaInList();
  requestAnimationFrame(() => updateSongTitleMarquee());
}



function playCurrentMedia() {
  if (window.currentMediaIndex === -1 && mediaFiles.length > 0) {
    selectMedia(0);
  } else {
    getPlayer().play();
    updateTransportButtons();
  }
}

function updateSongTitleMarquee() {
  const titleDiv = document.getElementById('progressSongTitle');
  const wrap = document.getElementById('progressSongTitleWrap');
  if (!titleDiv || !wrap) return;
  let displayName = "";
  if (window.currentMediaIndex >= 0 && window.currentMediaIndex < mediaFiles.length) {
    let fileObj = mediaFiles[window.currentMediaIndex] || '';
    let file = fileObj && typeof fileObj === "object" ? fileObj.name : fileObj;
    if (file) displayName = file.split('/').pop();
  } else if (window.currentDeviceTrackName) {
    displayName = window.currentDeviceTrackName.split('/').pop();
  }

  if (!displayName) {
    titleDiv.innerHTML = '';
    titleDiv.style.animation = 'none';
    return;
  }
  let name = displayName;

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


