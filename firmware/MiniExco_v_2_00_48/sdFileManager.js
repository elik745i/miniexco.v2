// === SD Card File Manager v2 ===

const sdFilePageSize = 20;  // 30-100 is typical, depending on ESP heap
let sdFilePageLoaded = 0;   // Number of pages loaded
let sdFileLoading = false;  // Lock to prevent double fetch
let sdFileAllLoaded = false;
let sdFileCurrentDir = "";
let sdFileAllFiles = [];    // All files fetched so far

let sdPathStack = [""];
let sdMultiSelect = false;
let sdSelectedRows = new Set();
let sdSelectedFile = null;
let sdFileCache = [];

let sdPollingActive = false;
let sdPollingPath = null;

let sdIndexingInProgress = false;

const ICONS = {
  folder: "📁",
  recycle: "🗑️",
  js: "📜",
  html: "📝",
  txt: "📄",
  default: "📄"
};


function loadSdFileListWithPolling(reset = false) {
    if (sdIndexingInProgress) {
        console.log("[loadSdFileListWithPolling] Blocked: indexing in progress.");
        return;
    }	
  const list = document.getElementById("sdFileList");
  let tries = 30;
  // Always reset as in loadSdFileList
  if (reset || sdFileCurrentDir !== sdCurrentPath()) {
    sdFilePageLoaded = 0;
    sdFileAllLoaded = false;
    sdFileAllFiles = [];
    sdFileCurrentDir = sdCurrentPath();
    if (list) list.innerHTML = `<div style="padding:6px;">Loading file list...</div>`;
  }
  function tryFetch() {
    const path = sdAbsoluteCurrentPath();
    const showSystem = window.sdShowSystemFiles ? 1 : 0;
    fetch(`/list_sd_files?path=${encodeURIComponent(path)}&showSystem=${showSystem}&start=0&count=${sdFilePageSize}`)
      .then(r => r.json())
      .then(files => {
		if (Array.isArray(files) && files.length === 1 && files[0] === "__EMPTY__") {
	      files = [];
		}		  
		if (Array.isArray(files)) {
		  sdFileAllFiles = files;
		  sdFilePageLoaded = 1;
		  sdFileAllLoaded = files.length < sdFilePageSize;
		  renderSdFileTable();
		  // DO NOT RETRY if we got an array, even if empty
		} else if (--tries > 0) {
		  setTimeout(tryFetch, 1000);
		} else {
		  if (list) list.innerHTML = `<div style="color:#f66;">❌ Indexing timed out</div>`;
		}
      })
      .catch(() => {
        if (--tries > 0) setTimeout(tryFetch, 1000);
        else if (list) list.innerHTML = `<div style="color:#f66;">❌ File list unavailable</div>`;
      });
  }
  tryFetch();
}

function fileIcon(type, name) {
  if (type === "folder") {
    if (name === "recycle") return ICONS.recycle;
    return ICONS.folder;
  }
  if (type) return ICONS[type] || ICONS.default;
  if (name.endsWith(".js")) return ICONS.js;
  if (name.endsWith(".html")) return ICONS.html;
  if (name.endsWith(".txt")) return ICONS.txt;
  return ICONS.default;
}

function humanSize(sz) {
  if (sz === undefined || sz === null) return "—";
  if (sz < 1024) return sz + " B";
  if (sz < 1024 * 1024) return (sz/1024).toFixed(1) + " KB";
  if (sz < 1024 * 1024 * 1024) return (sz/1024/1024).toFixed(1) + " MB";
  return (sz/1024/1024/1024).toFixed(1) + " GB";
}

function sdCurrentPath() {
  return sdPathStack.length > 0 ? sdPathStack[sdPathStack.length - 1] : "";
}

function sdFullPath(name) {
  // Always returns absolute path, even if sdCurrentPath() returns ""
  const cur = sdCurrentPath();
  console.log("[sdFullPath] Current path:", cur, "Filename:", name);
  let path = (cur && cur !== "/") ? cur + "/" + name : "/" + name;
  path = path.replace(/\/+/g, "/");
  console.log("[sdFullPath] Result:", path);
  return path;
}

function sdAbsoluteCurrentPath() {
    // Joins the path stack into a root-based path
    let p = "/" + sdPathStack.filter(x => x).join("/");
    p = p.replace(/\/+/g, "/"); // normalize
    return p;
}

function sdGoTo(path) {
  // Navigates to a given path and updates the stack
  if (path === "..") {
    if (sdPathStack.length > 1) sdPathStack.pop();
  } else {
    sdPathStack.push(path);
  }
  loadSdFileListWithPolling(true);
}

function sdLeaveToRoot() {
  sdPathStack = [""];
  loadSdFileListWithPolling(true);
}

function toggleSdMultiSelect(force) {
  sdMultiSelect = force !== undefined ? force : !sdMultiSelect;
  sdSelectedRows.clear();
  loadSdFileListWithPolling(true);
}

function loadSdFileList(reset = false) {
    if (sdIndexingInProgress) {
        console.log("[loadSdFileList] Blocked: indexing in progress.");
        return;
    }	
  const list = document.getElementById("sdFileList");
  if (reset || sdFileCurrentDir !== sdCurrentPath()) {
    sdFilePageLoaded = 0;
    sdFileAllLoaded = false;
    sdFileAllFiles = [];
    sdFileCurrentDir = sdCurrentPath();
    list.innerHTML = `<div style="padding:6px;">Loading file list...</div>`;
  }
  if (sdFileLoading || sdFileAllLoaded) return;
  sdFileLoading = true;
  const path = sdAbsoluteCurrentPath();
  const showSystem = window.sdShowSystemFiles ? 1 : 0;
  fetch(`/list_sd_files?path=${encodeURIComponent(path)}&showSystem=${showSystem}&start=${sdFilePageLoaded*sdFilePageSize}&count=${sdFilePageSize}`)
    .then(r => r.json())
    .then(files => {
      // --- Robust empty-folder check ---
      if (
        Array.isArray(files) &&
        (files.length === 0 || (files.length === 1 && files[0] === "__EMPTY__"))
      ) {
        sdFileAllLoaded = true;
        sdFileAllFiles = [];
        renderSdFileTable();
        return;
      }
      if (files.length < sdFilePageSize) sdFileAllLoaded = true;
      sdFileAllFiles = sdFileAllFiles.concat(files);
      sdFilePageLoaded++;
      renderSdFileTable();

      // 👇 Attach (or re-attach) the scroll handler after every render
      const sdFileListDiv = document.getElementById('sdFileList');
      if (sdFileListDiv) {
        sdFileListDiv.onscroll = function() {
          // 50px from bottom triggers next page
          if (sdFileListDiv.scrollTop + sdFileListDiv.clientHeight >= sdFileListDiv.scrollHeight - 50) {
            if (!sdFileAllLoaded && !sdFileLoading) {
              loadSdFileList();
            }
          }
        };
      }
    })
    .catch(err => {
      list.innerHTML = `<div style="color:#f66;">❌ Error loading SD card files</div>`;
      sdFileAllLoaded = true;
    })
    .finally(() => { sdFileLoading = false; });
}





function sdDownloadFile(name) {
  const url = `/download_sd?path=${encodeURIComponent(sdFullPath(name))}`;
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function sdBatchDownload() {
  sdSelectedRows.forEach(name => {
    sdDownloadFile(name);
  });
}

function showIndexingProgress(path, percent, count, total, indeterminate) {
    sdIndexingInProgress = true;
    // Disable toolbar
    let toolbar = document.getElementById('sd-toolbar');
    if (toolbar) toolbar.style.pointerEvents = 'none', toolbar.style.opacity = 0.3;

    let modal = document.getElementById("sdReindexProgress");
    if (!modal) {
        modal = document.createElement("div");
        modal.id = "sdReindexProgress";
        modal.innerHTML = `
            <div id="sdReindexText"></div>
            <div id="sdReindexBarContainer">
                <div id="sdReindexBar"></div>
                <div id="sdReindexSpinner">
                    <span class="sd-spinner">
                        <svg viewBox="0 0 32 32">
                            <circle cx="16" cy="16" r="12" stroke="#6cf" stroke-width="4" fill="none" stroke-linecap="round" stroke-dasharray="60" stroke-dashoffset="30"></circle>
                        </svg>
                    </span>
                </div>
            </div>
            <div id="sdReindexPercent" style="font-size:16px;"></div>
        `;
        document.body.appendChild(modal);
    }
    const textDiv = document.getElementById("sdReindexText");
    const bar = document.getElementById("sdReindexBar");
    const spinner = document.getElementById("sdReindexSpinner");
    const percentDiv = document.getElementById("sdReindexPercent");

    if (indeterminate) {
        textDiv.textContent = "Indexing in process. Please wait...";
        bar.style.display = "none";
        spinner.style.display = "block";
        percentDiv.textContent = "";
    } else {
        textDiv.textContent = `Indexing folder: ${path}`;
		bar.style.display = "block";
		bar.style.background = "#3af";
		spinner.style.display = "none";
		bar.style.width = `${percent}%`;
		percentDiv.textContent = (total ? `${count} / ${total} files` : `${count} files`);
    }
    modal.style.display = "block";
}





function hideIndexingProgress() {
	sdIndexingInProgress = false;
    let bar = document.getElementById('sd-toolbar');
    if (bar) bar.style.pointerEvents = '', bar.style.opacity = 1;
	
    const modal = document.getElementById("sdReindexProgress");
    if (modal) modal.style.display = "none";
}

function pollReindexStatus(path) {
    let lastCount = -1;
    let stuckCount = 0;
    function poll() {
		fetch("/sd_reindex_status")
			.then(r => r.json())
			.then(info => {
				if (!info || info.path !== path) return;
				if (info.pending) {
					// Show spinner during file counting
					let indeterminate = (info.counting === true) || (!info.total || info.total === 0);
					let percent = (info.total > 0) ? Math.floor(info.count * 100 / info.total) : 0;
					showIndexingProgress(path, percent, info.count, info.total, indeterminate);
					setTimeout(poll, 1000);
				} else {
					hideIndexingProgress();
					loadSdFileListWithPolling(true); // auto-refresh file list
				}
			})

            .catch(e => {
                hideIndexingProgress();
                showToast("❌ Error polling reindex status: " + e, true);
            });
    }
    poll();
}


function refreshSdIndex() {
    const path = sdAbsoluteCurrentPath();
    console.log("[refreshSdIndex] path:", path);
    fetch(`/sd_reindex?path=${encodeURIComponent(path)}`, { method: 'POST' })
        .then(r => {
            if (!r.ok) throw new Error("Failed to refresh index");
            return r.text();
        })
        .then(msg => {
			if (msg && /ok|success|done|refreshed|✅|indexing started/i.test(msg)) {
				showToast(msg, "info", 1200);
				pollReindexStatus(path); // new progress poller!
				// Prevent legacy polling while indexing
				sdPollingActive = false;
			} else {
                showToast("❌ Failed to refresh index: " + (msg || "(empty)"), "error");
            }
        })
        .catch((e) => {
            showToast("❌ Failed to refresh index: " + e, true);
        });
}

function pollFileList(path) {
    let retries = 30;
    function tryFetch() {
        console.log("Polling", path, "sdPollingActive:", sdPollingActive, "sdPollingPath:", sdPollingPath);
        if (!sdPollingActive || sdPollingPath !== path) return;
        // ...
    }
    setTimeout(tryFetch, 1000);
}


// Add a polling function!
function pollFileList(path) {
    let retries = 30;
	if (!path.startsWith("/")) path = "/" + path.replace(/^\/+/, "");
    function tryFetch() {
		console.log("Polling", path, "sdPollingActive:", sdPollingActive, "sdPollingPath:", sdPollingPath);
        if (!sdPollingActive || sdPollingPath !== path) return;
        fetch(`/list_sd_files?path=${encodeURIComponent(path)}`)
            .then(r => r.json())
            .then(list => {
                if (!sdPollingActive || sdPollingPath !== path) return;

                // --- New logic ---
                if (Array.isArray(list) && list.length > 0) {
                    // Success: got the files
                    hideToast();
                    renderFiles(list);
                    sdPollingActive = false;
                    sdPollingPath = null;
                } else if (list && typeof list === 'object' && list.status === "reindexing") {
                    // Still indexing, poll again soon
                    setTimeout(tryFetch, 1000);
                } else if (--retries > 0) {
                    setTimeout(tryFetch, 1000);
                } else {
                    showToast("❌ Indexing timed out", true);
                    sdPollingActive = false;
                    sdPollingPath = null;
                }
            })
            .catch(() => {
                if (!sdPollingActive || sdPollingPath !== path) return;
                if (--retries > 0) setTimeout(tryFetch, 1000);
                else {
                    showToast("❌ File list unavailable", true);
                    sdPollingActive = false;
                    sdPollingPath = null;
                }
            });
    }
    setTimeout(tryFetch, 1000);
}


function renderSdFileTable() {
  const list = document.getElementById("sdFileList");
  list.innerHTML = "";

  // --- Toolbar row ---
  const bar = document.createElement("div");
  bar.style.display = "flex";
  bar.style.justifyContent = "space-between";
  bar.style.alignItems = "center";
  bar.style.marginBottom = "8px";
  bar.style.gap = "12px";

  // --- Left: Back + action icons ---
  const leftBar = document.createElement("div");
  leftBar.style.display = "flex";
  leftBar.style.gap = "8px";

  if (sdPathStack.length > 1) {
    const backBtn = document.createElement("button");
    backBtn.className = "sd-toolbar-btn sd-btn-blue";
    backBtn.title = "Back";
    backBtn.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6" stroke="currentColor" stroke-width="2" fill="none"/></svg>`;
    backBtn.onclick = () => { sdGoTo(".."); };
    leftBar.appendChild(backBtn);
  }

  if (!sdInRecycle()) {
    // New File
    const newFileBtn = document.createElement("button");
    newFileBtn.className = "sd-toolbar-btn sd-btn-green";
    newFileBtn.title = "New File";
    newFileBtn.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24"><path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z"/><path d="M12 17v-6"/><path d="M9 14h6"/></svg>`;
    newFileBtn.onclick = () => sdPromptNew('file');
    leftBar.appendChild(newFileBtn);

    // New Folder
    const newFolderBtn = document.createElement("button");
    newFolderBtn.className = "sd-toolbar-btn sd-btn-yellow";
    newFolderBtn.title = "New Folder";
    newFolderBtn.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24"><path d="M4 4h5l2 2h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/><path d="M12 10v6"/><path d="M9 13h6"/></svg>`;
    newFolderBtn.onclick = () => sdPromptNew('folder');
    leftBar.appendChild(newFolderBtn);

    // Upload
    const uploadBtn = document.createElement("button");
    uploadBtn.className = "sd-toolbar-btn sd-btn-purple";
    uploadBtn.title = "Upload";
    uploadBtn.id = "uploadSdFileBtn";
    uploadBtn.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24"><path d="M12 19V6m0 0l-5 5m5-5l5 5" stroke="currentColor" stroke-width="2" fill="none"/><rect x="5" y="19" width="14" height="2" rx="1"/></svg>`;
    leftBar.appendChild(uploadBtn);

    // Hidden input for upload
    const uploadInput = document.createElement("input");
    uploadInput.type = "file";
    uploadInput.id = "uploadSdFileInput";
    uploadInput.style.display = "none";
    leftBar.appendChild(uploadInput);
  }
  bar.appendChild(leftBar);

  // --- Right: Show/Hide System Files + Select/Cancel + Batch Delete/Download ---
  const rightBar = document.createElement("div");
  rightBar.style.display = "flex";
  rightBar.style.gap = "8px";


	// --- Refresh index button ---	
	const refreshBtn = document.createElement("button");
	refreshBtn.className = "sd-toolbar-btn sd-btn-blue";
	refreshBtn.title = "Refresh (force .index file)";
	refreshBtn.innerHTML = `
	<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
	  <path d="M21 2v6h-6"/>
	  <path d="M3 12a9 9 0 0 1 15-7.7L21 8"/>
	  <path d="M21 12a9 9 0 1 1-9-9"/>
	</svg>
	`;
	refreshBtn.onclick = () => {
		refreshSdIndex();
	};
	rightBar.appendChild(refreshBtn);

	
  // Show/Hide System Files button
  const sysBtn = document.createElement("button");
  sysBtn.className = "sd-toolbar-btn";
  sysBtn.style.background = "#ddefff";
  sysBtn.style.color = "#222";
  sysBtn.title = "Show/Hide System Files";
  
	// Choose icon based on state
	sysBtn.innerHTML = window.sdShowSystemFiles
	  // Eye with slash: system files are shown, click to hide
	  ? `<svg width="22" height="22" viewBox="0 0 24 24">
		   <path d="M1 12s4-7 11-7c2.7 0 5 .5 7 1.5M23 12s-4 7-11 7c-2.7 0-5-.5-7-1.5M17.94 17.94L6.06 6.06" stroke="currentColor" stroke-width="2" fill="none"/>
		   <circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="2" fill="none"/>
		 </svg>`
	  // Eye: system files are hidden, click to show
	  : `<svg width="22" height="22" viewBox="0 0 24 24">
		   <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" stroke="currentColor" stroke-width="2" fill="none"/>
		   <circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="2" fill="none"/>
		 </svg>`;
	sysBtn.onclick = () => {
	  window.sdShowSystemFiles = !window.sdShowSystemFiles;
	  loadSdFileListWithPolling(true);
	};
  rightBar.appendChild(sysBtn);

  // Select/Cancel
  const selBtn = document.createElement("button");
  selBtn.className = "sd-toolbar-btn sd-btn-blue";
  selBtn.title = sdMultiSelect ? "Cancel Selection" : "Multi-Select";
  selBtn.innerHTML = sdMultiSelect
    ? `<svg width="24" height="24" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke="currentColor" fill="none" stroke-width="2"/><path d="M8 8l8 8M16 8l-8 8" stroke="currentColor" stroke-width="2"/></svg>`
    : `<svg width="24" height="24" viewBox="0 0 24 24"><rect x="5" y="5" width="14" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M7 12l3 3 7-7" stroke="currentColor" stroke-width="2" fill="none"/></svg>`;
  selBtn.onclick = () => {
    sdMultiSelect = !sdMultiSelect;
    if (!sdMultiSelect) sdSelectedRows.clear();
    else if (sdSelectedFile) sdSelectedRows.add(sdSelectedFile);
    renderSdFileTable();
  };
  rightBar.appendChild(selBtn);

  // Batch Delete/Download
  if (sdMultiSelect && sdSelectedRows.size > 0) {
    // Download selected
    const downloadBtn = document.createElement("button");
    downloadBtn.className = "sd-toolbar-btn sd-btn-green";
    downloadBtn.title = "Download Selected";
    downloadBtn.innerHTML = "⬇️";
    downloadBtn.onclick = sdBatchDownload;
    rightBar.appendChild(downloadBtn);

    // Delete selected
    const delBtn = document.createElement("button");
    delBtn.className = "sd-toolbar-btn sd-btn-red";
    delBtn.title = sdInRecycle() ? "Permanently Delete Selected" : "Delete Selected";
    delBtn.innerHTML = "🗑️";
    delBtn.onclick = sdInRecycle() ? sdBatchPermanentDelete : sdBatchDelete;
    rightBar.appendChild(delBtn);
  }
  bar.appendChild(rightBar);

  // --- Sticky toolbar ---
  const toolbar = document.getElementById("sd-toolbar");
  if (toolbar) {
    toolbar.innerHTML = "";
    toolbar.appendChild(bar);
  }

  // --- PATH BREADCRUMB display below the toolbar ---
  const pathBar = document.getElementById("sd-pathbar");
  if (pathBar) {
    const cardName = "SD Card";
    let parts = sdPathStack.slice(1); // skip root ""
    let pathStr = cardName;
    if (parts.length > 0) {
      pathStr += "/" + parts.join("/");
    } else {
      pathStr += "/";
    }
    pathBar.textContent = pathStr;
  }

  // --- Table header ---
  const table = document.createElement("div");
  table.className = "sdFileTable";
  table.style.display = "grid";
  const colCount = sdMultiSelect ? 5 : 4;
  table.style.gridTemplateColumns = sdMultiSelect
    ? "32px 36px 1fr minmax(80px,auto) 120px 140px"
    : "36px 1fr minmax(80px,auto) 120px 140px";
  table.style.fontWeight = "bold";
  table.innerHTML =
      (sdMultiSelect
        ? `<div>
              <input type="checkbox" id="sdMasterSelect"
                     ${sdSelectedRows.size === sdFileCache.filter(f=>f.name!=="recycle").length ? "checked" : ""}>
           </div>`
        : "") +
      "<div></div><div>File</div><div>Size</div><div>Date</div><div>…</div>";

  list.appendChild(table);

  // Master select logic
  if (sdMultiSelect) {
    setTimeout(() => {
      const master = document.getElementById("sdMasterSelect");
      if (master) {
        master.onclick = function () {
          const allFiles = sdFileCache.filter(f => f.name !== "recycle");
          if (master.checked) {
            allFiles.forEach(f => sdSelectedRows.add(f.name));
          } else {
            allFiles.forEach(f => sdSelectedRows.delete(f.name));
          }
          renderSdFileTable();
        };
      }
    }, 50);
  }

  // --- Table content ---
  const files = [...sdFileAllFiles];
  files.sort((a, b) => ((!!b.isFolder) - (!!a.isFolder)) || a.name.localeCompare(b.name));
  sdFileCache = files;
  files.forEach((file, i) => {
    const cells = [];

    // Checkbox for multi-select
    if (sdMultiSelect) {
      const cbDiv = document.createElement("div");
      if (file.name !== "recycle") {
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = sdSelectedRows.has(file.name);
        cb.onclick = (e) => {
          if (cb.checked) sdSelectedRows.add(file.name);
          else sdSelectedRows.delete(file.name);
          renderSdFileTable();
          e.stopPropagation();
        };
        cbDiv.appendChild(cb);
      }
      cells.push(cbDiv);
    }

    // Icon
    const iconDiv = document.createElement("div");
    iconDiv.style.textAlign = "center";
    iconDiv.textContent = fileIcon(file.type, file.name);
    cells.push(iconDiv);

    // Name
    const nameDiv = document.createElement("div");
    nameDiv.textContent = file.name;
    nameDiv.style.cursor = file.isFolder ? "pointer" : "default";
    cells.push(nameDiv);

    // Size
    const sizeDiv = document.createElement("div");
    sizeDiv.textContent = file.isFolder ? "—" : humanSize(file.size);
    cells.push(sizeDiv);

	// Date cell
	const dateDiv = document.createElement("div");
	console.log(file.name, file.date);
	if (file.date) {
	  let ts = Number(file.date);
	  if (ts > 1e12) {
		// Already in ms (e.g. 1753085436000)
	  } else if (ts > 1e9) {
		// In seconds (e.g. 1753085436)
		ts *= 1000;
	  }
	  const d = new Date(ts);
	  dateDiv.textContent = d.toLocaleString();
	} else {
	  dateDiv.textContent = "—";
	}

	cells.push(dateDiv);

    // Actions
    const actDiv = document.createElement("div");
    actDiv.style.display = "flex";
    const isSelected = sdMultiSelect
      ? sdSelectedRows.has(file.name)
      : sdSelectedFile === file.name;
    if (isSelected && file.name !== "recycle") {
      if (sdInRecycle()) {
        // Recover button
        const recoverBtn = document.createElement("button");
        recoverBtn.title = "Recover";
        recoverBtn.innerHTML = "♻️";
        recoverBtn.style.marginRight = "5px";
        recoverBtn.onclick = (e) => { sdRecover(file.name); e.stopPropagation(); };
        actDiv.appendChild(recoverBtn);

        // Permanently delete button
        const delBtn = document.createElement("button");
        delBtn.title = "Delete Permanently";
        delBtn.innerHTML = "🗑️";
        delBtn.onclick = (e) => { sdPermanentDelete(file.name); e.stopPropagation(); };
        actDiv.appendChild(delBtn);
      } else {
        // Download button for single file
        if (!file.isFolder) {
          const dlBtn = document.createElement("button");
          dlBtn.title = "Download";
          dlBtn.innerHTML = "⬇️";
          dlBtn.onclick = (e) => { sdDownloadFile(file.name); e.stopPropagation(); };
          actDiv.appendChild(dlBtn);
        }

        const delBtn = document.createElement("button");
        delBtn.title = "Delete";
        delBtn.innerHTML = "🗑️";
        delBtn.onclick = (e) => { sdDelete(file.name); e.stopPropagation(); };
        actDiv.appendChild(delBtn);

        if (!file.isFolder) {
          const repBtn = document.createElement("button");
          repBtn.title = "Replace";
          repBtn.innerHTML = `<svg width="20" height="20" viewBox="0 0 20 20"><path d="M6 7v6a2 2 0 0 0 2 2h4" stroke="currentColor" stroke-width="2" fill="none"/><path d="M14 15v-2a2 2 0 0 0-2-2H8"/><path d="M14 11l2 2-2 2"/></svg>`;
          repBtn.onclick = (e) => {
            const fileInput = document.getElementById("replaceFileInput");
            fileInput.onchange = () => {
              if (fileInput.files.length > 0) {
                sdReplace(file.name, fileInput.files[0]);
              }
            };
            fileInput.click();
            e.stopPropagation();
          };
          actDiv.appendChild(repBtn);
        }
      }
    }
    cells.push(actDiv);

    // Row highlight
    if (isSelected) {
      cells.forEach(cell => cell.classList.add("selected"));
    }

    // Row click handler
    cells.forEach(cell => {
      cell.onclick = (e) => {
        if (
          e.target.tagName === "BUTTON" ||
          e.target.type === "checkbox"
        ) return;
        if (file.name === "recycle") {
          sdGoTo("recycle");
        } else if (file.isFolder) {
          sdGoTo(file.name);
        } else if (!sdMultiSelect) {
          if (sdSelectedFile !== file.name) {
            sdSelectedFile = file.name;
            renderSdFileTable();
          }
        }
        e.stopPropagation();
      };
    });

    // Append all cells
    cells.forEach(cell => table.appendChild(cell));
  });

	if (files.length === 0 && window.sdFileAllLoaded) {
	  const emptyMsg = document.createElement("div");
	  emptyMsg.style = "color:gray;padding:1em;text-align:center;";
	  emptyMsg.innerText = "No files found";
	  list.appendChild(emptyMsg);
	}

  // --- Loading spinner for infinite scroll ---
  if (window.sdFileLoading && !window.sdFileAllLoaded) {
    const spinner = document.createElement("div");
    spinner.style.textAlign = "center";
    spinner.style.color = "#6cf";
    spinner.style.padding = "8px";
    spinner.innerText = "Loading more files…";
    list.appendChild(spinner);
  }

  attachSdUploadHandler();
  updateSdCapacityBar();
}



function sdInRecycle() {
  return sdCurrentPath() === "recycle";
}

// --- Actions (to be implemented on backend) ---
function sdDelete(name) {
  fetch(`/delete_sd?path=${encodeURIComponent(sdFullPath(name))}`, { method: "POST" })
    .then(r => loadSdFileListWithPolling(true));
}
function sdBatchDelete() {
  const files = Array.from(sdSelectedRows);
  Promise.all(files.map(name => fetch(`/delete_sd?path=${encodeURIComponent(sdFullPath(name))}`, { method: "POST" })))
    .then(() => { sdSelectedRows.clear(); loadSdFileListWithPolling(true); });
}
function sdPermanentDelete(name) {
  if (!confirm("Permanently delete this file? This cannot be undone.")) return;
  fetch(`/permadelete_sd?path=${encodeURIComponent(sdFullPath(name))}`, { method: "POST" })
    .then(r => loadSdFileListWithPolling(true));
}
function sdBatchPermanentDelete() {
  if (!confirm("Permanently delete selected files? This cannot be undone.")) return;
  const files = Array.from(sdSelectedRows);
  Promise.all(files.map(name => fetch(`/permadelete_sd?path=${encodeURIComponent(sdFullPath(name))}`, { method: "POST" })))
    .then(() => { sdSelectedRows.clear(); loadSdFileListWithPolling(true); });
}

function sdReplace(name, file) {
  const fullPath = sdFullPath(name);
  const formData = new FormData();
  formData.append("file", file);
  formData.append("path", fullPath);

  // Use XHR like upload, with ?path=... in URL
  const xhr = new XMLHttpRequest();
  xhr.open("POST", "/upload_sd?path=" + encodeURIComponent(fullPath));

  xhr.onload = function() {
    if (xhr.status >= 200 && xhr.status < 300) {
      showToast(`✅ Replaced ${fullPath}`);
      loadSdFileListWithPolling(true);
    } else {
      showToast("❌ Replace failed", true);
    }
  };
  xhr.onerror = function() {
    showToast("❌ Replace failed", true);
  };
  xhr.send(formData);
}


function sdPromptNew(type) {
  let name = prompt(`Enter ${type === "folder" ? "folder" : "file"} name:`);
  if (!name) return;
  fetch(`/create_${type}?path=${encodeURIComponent(sdFullPath(name))}`, { method: "POST" })
    .then(r => loadSdFileListWithPolling(true));
}


function showSdFileActions(filename, parentDiv) {
  // Clear existing buttons
  const old = parentDiv.querySelector(".sdFileActions");
  if (old) old.remove();

  const actions = document.createElement("span");
  actions.className = "sdFileActions";

  const delBtn = document.createElement("button");
  delBtn.textContent = "🗑 Delete";
  delBtn.onclick = () => deleteSdFile(filename);
  actions.appendChild(delBtn);

  const repBtn = document.createElement("button");
  repBtn.textContent = "🔁 Replace";
  repBtn.style.marginLeft = "10px";
  repBtn.onclick = () => {
    const fileInput = document.getElementById("replaceFileInput");
    fileInput.onchange = () => {
      if (fileInput.files.length > 0) {
        replaceSdFile(filename, fileInput.files[0]);
      }
    };
    fileInput.click();
  };
  actions.appendChild(repBtn);

  actions.style.marginLeft = "10px";
  parentDiv.appendChild(actions);
}

function deleteSdFile(path) {
  fetch(`/delete_sd?path=${encodeURIComponent(path)}`, { method: "POST" })
    .then(r => {
      if (r.ok) {
        showToast(`🗑 Moved ${path} to recycle`);
        loadSdFileListWithPolling(true);
      } else {
        showToast(`❌ Failed to delete ${path}`, true);
      }
    })
    .catch(err => {
      console.error("Delete failed:", err);
      showToast("❌ Error deleting file", true);
    });
}

function replaceSdFile(name, file) {
  const fullPath = sdFullPath(name);
  const formData = new FormData();
  formData.append("file", file);
  formData.append("path", fullPath);

  fetch("/upload_sd", {
    method: "POST",
    body: formData,
  })
    .then(r => {
      if (r.ok) {
        showToast(`✅ Replaced ${fullPath}`);
        loadSdFileListWithPolling(true);
      } else {
        showToast("❌ Replace failed", true);
      }
    })
    .catch(err => {
      console.error("Replace error:", err);
      showToast("❌ Replace failed", true);
    });
}


function attachSdUploadHandler() {
  const btn = document.getElementById("uploadSdFileBtn");
  const fileInput = document.getElementById("uploadSdFileInput");
  if (!btn || !fileInput) return;
  btn.onclick = () => fileInput.click();
  fileInput.onchange = () => {
    if (fileInput.files.length > 0) {
      const file = fileInput.files[0];
      // --- USE sdFullPath TO CALCULATE TARGET PATH ---
      const path = sdFullPath(file.name);

      const formData = new FormData();
      formData.append("file", file);
      formData.append("path", path);

      // --- Progress UI ---
      let progContainer = document.getElementById("sdDynamicUploadProgress");
      if (progContainer) progContainer.remove();
      progContainer = document.createElement("div");
      progContainer.id = "sdDynamicUploadProgress";
      progContainer.style.cssText = `
        position: fixed; left: 50%; top: 30px; transform: translateX(-50%);
        background: #222; color: #eee; border-radius: 8px;
        box-shadow: 0 2px 12px #0008; z-index:9999; padding: 18px 28px 18px 28px;
        display: flex; flex-direction: column; align-items: center; min-width:240px; font-size:15px;`;

      // Progress bar
      const barBG = document.createElement("div");
      barBG.style.cssText = "background:#333;width:220px;height:14px;border-radius:6px;overflow:hidden;margin-bottom:10px;";
      const bar = document.createElement("div");
      bar.style.cssText = "background:#4CAF50;width:0;height:100%;transition:width 0.2s;";
      barBG.appendChild(bar);

      // Text status
      const status = document.createElement("div");
      status.style.marginBottom = "4px";
      status.textContent = "Uploading…";

      // Speed status
      const speed = document.createElement("div");
      speed.style.fontSize = "13px";
      speed.style.color = "#99f";

      // ETA status
      const eta = document.createElement("div");
      eta.style.fontSize = "13px";
      eta.style.color = "#9f9";

      // Cancel button
      const cancelBtn = document.createElement("button");
      cancelBtn.textContent = "Cancel";
      cancelBtn.style.cssText = `
        margin-top:10px;background:#c44;color:white;border:none;border-radius:5px;
        padding:4px 16px;cursor:pointer;font-size:14px;transition:background 0.2s;`;
      cancelBtn.onmouseover = () => cancelBtn.style.background = "#a22";
      cancelBtn.onmouseleave = () => cancelBtn.style.background = "#c44";

      progContainer.appendChild(status);
      progContainer.appendChild(barBG);
      progContainer.appendChild(speed);
      progContainer.appendChild(eta);
      progContainer.appendChild(cancelBtn);
      document.body.appendChild(progContainer);

      // --- Upload logic (XHR for progress) ---
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/upload_sd?path=" + encodeURIComponent(path));

      let lastTime = Date.now();
      let lastLoaded = 0;
      let speedVal = 0;
      let canceled = false;
      xhr.upload.onprogress = function(e) {
        if (e.lengthComputable) {
          const percent = Math.round(e.loaded * 100 / e.total);
          bar.style.width = percent + "%";
          status.textContent = `Uploading: ${percent}% (${formatBytes(e.loaded)} / ${formatBytes(e.total)})`;

          // Calculate speed
          const now = Date.now();
          const deltaBytes = e.loaded - lastLoaded;
          const deltaTime = (now - lastTime) / 1000;
          if (deltaTime > 0.1) {
            speedVal = deltaBytes / deltaTime;
            speed.textContent = "Speed: " + formatBytes(speedVal) + "/s";
            lastLoaded = e.loaded;
            lastTime = now;
          }

          // Estimate time remaining
          if (speedVal > 0) {
            const remainingBytes = e.total - e.loaded;
            const secs = remainingBytes / speedVal;
            eta.textContent = "Time left: " + formatTime(secs);
          } else {
            eta.textContent = "";
          }
        }
      };

      xhr.onload = function() {
        if (canceled) return;
        bar.style.width = "100%";
        status.textContent = "Upload Complete!";
        speed.textContent = "";
        eta.textContent = "";
        setTimeout(() => {
          if (progContainer) progContainer.remove();
        }, 800);
        if (xhr.status >= 200 && xhr.status < 300) {
          showToast("✅ File uploaded!");
          loadSdFileListWithPolling(true);
        } else {
          showToast("❌ Upload failed", true);
        }
        fileInput.value = "";
      };
      xhr.onerror = function() {
        if (canceled) return;
        status.textContent = "Upload Failed!";
        speed.textContent = "";
        eta.textContent = "";
        bar.style.background = "#f33";
        setTimeout(() => {
          if (progContainer) progContainer.remove();
        }, 1400);
        showToast("❌ Upload failed", true);
        fileInput.value = "";
      };

      // Cancel logic
      cancelBtn.onclick = () => {
        canceled = true;
        xhr.abort();
        status.textContent = "Upload canceled";
        speed.textContent = "";
        eta.textContent = "";
        bar.style.background = "#888";
        cancelBtn.disabled = true;
        setTimeout(() => {
          if (progContainer) progContainer.remove();
        }, 900);
        // Send BOTH path and permanent in POST body!
        fetch("/delete_sd", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: "path=" + encodeURIComponent(path) + "&permanent=1"
        }).then(() => {
          showToast("❌ Upload canceled", true);
          loadSdFileListWithPolling(true);
        });
        fileInput.value = "";
      };

      xhr.send(formData);
    }
  };
}


  function formatBytes(bytes) {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  }
  function formatTime(secs) {
    secs = Math.round(secs);
    if (secs < 1) return "less than 1s";
    if (secs < 60) return `${secs}s`;
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    if (m < 60) return `${m}m ${s}s`;
    const h = Math.floor(m / 60);
    const mm = m % 60;
    return `${h}h ${mm}m`;
  }


function updateSdCapacityBar() {
  console.log("updateSdCapacityBar called");

  fetch('/sd_info')
    .then(r => {
      console.log("Got response for /sd_info:", r);
      return r.json();
    })
    .then(info => {
      console.log("Parsed /sd_info JSON:", info);
      const used = info.used, total = info.total, free = info.free;
      const percent = total ? Math.round(used * 100 / total) : 0;

      const bar = document.getElementById('sd-bar-used');
      const label = document.getElementById('sd-bar-label');
      console.log("DOM elements:", {bar, label});

      if (bar) bar.style.width = percent + '%';
      else console.warn("sd-bar-used not found in DOM");

      if (label) label.innerText = `${formatBytes(used)} used, ${formatBytes(free)} free of ${formatBytes(total)}`;
      else console.warn("sd-bar-label not found in DOM");

      console.log(`SD Capacity: used=${used}, total=${total}, free=${free}, percent=${percent}%`);
    })
    .catch(e => {
      console.error("Error updating SD capacity bar:", e);
    });
}

function sendReboot() {
  fetch("/reboot", { method: "POST" }).then(() => {
    showToast("🔄 Rebooting...");
    setTimeout(() => location.reload(), 5000);
  });
}


function attachRebootBtnHandler() {
  const btn = document.getElementById("rebootBtn");
  if (btn) {
    // Remove any old handlers to prevent duplicates
    btn.replaceWith(btn.cloneNode(true)); // Remove all old listeners
    const newBtn = document.getElementById("rebootBtn");
    newBtn.addEventListener("click", sendReboot);
  }
}

window.loadSdFileList = loadSdFileList;
window.updateSdCapacityBar = updateSdCapacityBar;
window.sendReboot = sendReboot;
window.sdShowSystemFiles = false;