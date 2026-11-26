// Popup of GUID Resolver for Unity
// Depends on ../scripts/storage.js (GuidStorage)

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const numberFormat = new Intl.NumberFormat();

// "1 GUID", "8,823 GUIDs"; plural defaults to word + "s"
function count(n, word, plural) {
  return numberFormat.format(n) + ' ' + (n === 1 ? word : (plural || word + 's'));
}

// Firefox closes the popup while its file picker is open, so picking files there needs the separate window
const isFirefox = chrome.runtime.getURL('').startsWith('moz-extension://');
const POPUP_WIDTH = 360;
const POPUP_HEIGHT = 560;
// How this page is shown: 'popup' (toolbar popup), 'window' (popped out) or 'tab' (options page)
let viewMode = 'popup';

// Pop the popup out into its own small window at the popup's position,
// or focus that window if it is already open
async function openPopoutWindow() {
  const url = location.origin + location.pathname + '?view=window';
  const windows = await chrome.windows.getAll({ populate: true, windowTypes: ['popup'] });
  const existing = windows.find(w => (w.tabs || []).some(t => t.url && t.url.startsWith(url)));
  if (existing) {
    await chrome.windows.update(existing.id, { focused: true });
  } else {
    const current = await chrome.windows.getCurrent();
    let left = window.screenX;
    let top = window.screenY;
    // Chrome reports the popup's own screen position. Firefox does not (it gives the
    // browser window's), so there, and whenever the position looks like the browser
    // window's corner, use the top right of the browser window below the toolbar,
    // where the extension button usually is (as Bitwarden does).
    const atWindowCorner = Math.abs(left - current.left) < 4 && Math.abs(top - current.top) < 4;
    if (viewMode !== 'popup' || isFirefox || atWindowCorner || (!left && !top)) {
      left = current.left + current.width - POPUP_WIDTH - 15;
      top = current.top + 90;
    }
    left = Math.round(left);
    top = Math.round(top);
    await chrome.windows.create({
      url: `${url}&x=${left}&y=${top}`,
      type: 'popup',
      width: POPUP_WIDTH,
      height: POPUP_HEIGHT,
      left: left,
      top: top,
      focused: true
    });
  }
  if (viewMode === 'popup') {
    window.close();
  }
}

// The size given to windows.create includes the window frame. Once the page knows the
// frame size, resize the window so its content is exactly the popup's size, and move it
// so the content sits where the popup was.
async function fitPopoutWindow() {
  const params = new URLSearchParams(location.search);
  const frameWidth = Math.max(0, window.outerWidth - window.innerWidth);
  const frameHeight = Math.max(0, window.outerHeight - window.innerHeight);
  const current = await chrome.windows.getCurrent();
  const update = { width: POPUP_WIDTH + frameWidth, height: POPUP_HEIGHT + frameHeight };
  if (params.has('x') && params.has('y')) {
    const side = Math.round(frameWidth / 2);
    update.left = Number(params.get('x')) - side;
    update.top = Math.max(0, Number(params.get('y')) - (frameHeight - side));
    // Only place it once; a reload keeps wherever the user moved it
    history.replaceState(null, '', location.pathname + '?view=window');
  }
  if (update.width !== current.width || update.height !== current.height || 'left' in update) {
    await chrome.windows.update(current.id, update);
  }
}

document.addEventListener('DOMContentLoaded', async function () {
  if (new URLSearchParams(location.search).get('view') === 'window') {
    viewMode = 'window';
  } else if (chrome.tabs.getCurrent && await chrome.tabs.getCurrent()) {
    viewMode = 'tab';
  }
  document.body.classList.toggle('is-tab', viewMode === 'tab');
  document.body.classList.toggle('is-window', viewMode === 'window');
  document.getElementById('firefoxHint').hidden = !isFirefox || viewMode !== 'popup';
  if (viewMode === 'window') {
    fitPopoutWindow();
    followActiveTab();
  }

  document.getElementById('optionsButton').addEventListener('click', openPopoutWindow);
  document.getElementById('firefoxPopout').addEventListener('click', openPopoutWindow);
  document.getElementById('version').textContent = 'v' + chrome.runtime.getManifest().version;
  setupThemeToggle();

  setupTabs();
  setupFileUpload();
  document.getElementById('rescanButton').addEventListener('click', rescanPage);

  updateFileList();
  loadPageStatus();
});

// Light/dark toggle in the footer. theme.js applies the saved choice on load;
// without one, the system theme is used.
function setupThemeToggle() {
  const root = document.documentElement;
  const button = document.getElementById('themeToggle');
  const systemDark = window.matchMedia('(prefers-color-scheme: dark)');
  const currentTheme = () => root.dataset.theme || (systemDark.matches ? 'dark' : 'light');

  function render() {
    const dark = currentTheme() === 'dark';
    const label = dark ? 'Switch to light mode' : 'Switch to dark mode';
    button.setAttribute('aria-label', label);
    button.title = label;
    // SVG elements have no hidden property, so set the attribute
    button.querySelector('.theme-toggle__moon').toggleAttribute('hidden', dark);
    button.querySelector('.theme-toggle__sun').toggleAttribute('hidden', !dark);
  }

  button.addEventListener('click', () => {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    root.dataset.theme = next;
    try {
      localStorage.setItem('ui.theme', next);
    } catch (e) {
      // Not saved; the choice lasts until the popup closes
    }
    render();
  });
  systemDark.addEventListener('change', render);
  // Keep the popup and a popped-out window in sync
  window.addEventListener('storage', (e) => {
    if (e.key === 'ui.theme' && (e.newValue === 'light' || e.newValue === 'dark')) {
      root.dataset.theme = e.newValue;
      render();
    }
  });
  render();
}

// Mappings / Lookup tabs. The last opened tab is restored on the next open.
function setupTabs() {
  const tabs = Array.from(document.querySelectorAll('[role="tab"]'));

  function select(tab, options) {
    tabs.forEach(t => {
      const selected = t === tab;
      t.setAttribute('aria-selected', String(selected));
      t.tabIndex = selected ? 0 : -1;
      document.getElementById(t.getAttribute('aria-controls')).hidden = !selected || !document.getElementById('firstRun').hidden;
    });
    if (options.focusTab) {
      tab.focus();
    }
    if (options.remember) {
      chrome.storage.local.set({ 'ui.lastTab': tab.id });
    }
    if (tab.id === 'tab-lookup') {
      updateLookupScope();
      if (!options.focusTab) {
        document.getElementById('lookupInput').focus();
      }
    }
  }

  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => select(tab, { remember: true }));
    tab.addEventListener('keydown', (e) => {
      let next = null;
      if (e.key === 'ArrowRight') next = tabs[(index + 1) % tabs.length];
      if (e.key === 'ArrowLeft') next = tabs[(index - 1 + tabs.length) % tabs.length];
      if (e.key === 'Home') next = tabs[0];
      if (e.key === 'End') next = tabs[tabs.length - 1];
      if (next) {
        e.preventDefault();
        select(next, { remember: true, focusTab: true });
      }
    });
  });

  chrome.storage.local.get('ui.lastTab').then(data => {
    const last = tabs.find(t => t.id === data['ui.lastTab']);
    if (last) {
      select(last, { remember: false });
    }
  });
}

function updateLookupScope() {
  Promise.all([GuidStorage.getFiles(), GuidStorage.getMergedCount()]).then(([files, total]) => {
    const scope = document.getElementById('lookupScope');
    scope.textContent = files.length
      ? `Searches ${count(files.length, 'mapping')} · ${count(total, 'GUID')}.`
      : 'Add a mapping file first.';
  });
}

// ---------------------------------------------------------------------------
// Page status and re-scan

// The tab the status card is about. A popped-out window is a window of its own,
// so there it is the active tab of the browser window used last.
async function getActiveTab() {
  if (viewMode === 'window') {
    try {
      const browserWindow = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
      const [tab] = await chrome.tabs.query({ active: true, windowId: browserWindow.id });
      return tab;
    } catch (e) {
      return null;
    }
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

// A popped-out window stays open while the user browses, so follow tab changes
function followActiveTab() {
  chrome.tabs.onActivated.addListener(() => loadPageStatus());
  chrome.windows.onFocusChanged.addListener(() => loadPageStatus());
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status === 'complete') {
      // The content script scans 500 ms after load
      setTimeout(loadPageStatus, 800);
    }
  });
}

function hostOf(tab) {
  try {
    return new URL(tab.url).hostname || tab.url;
  } catch (e) {
    return '';
  }
}

function setPageStatus(title, detail) {
  document.getElementById('pageStatusTitle').textContent = title;
  document.getElementById('pageStatusDetail').textContent = detail || '';
}

function showStats(stats, host) {
  if (!stats) {
    setPageStatus('Not scanned yet', host);
  } else if (stats.noMapping) {
    setPageStatus('No mapping loaded', 'Add a mapping file below');
  } else {
    setPageStatus(`${count(stats.resolved, 'GUID')} found`, `${host} · ${numberFormat.format(stats.unresolved)} unresolved`);
  }
}

async function loadPageStatus() {
  const tab = await getActiveTab();
  if (!tab) {
    setPageStatus('No page open');
    return;
  }
  try {
    const response = await chrome.tabs.sendMessage(tab.id, { message: 'getGuidStats' });
    showStats(response && response.stats, hostOf(tab));
  } catch (e) {
    // No content script in this tab (opened before install, or a restricted page)
    setPageStatus('Labels aren\'t active on this page', hostOf(tab));
  }
}

// Inject the content script into a tab that was opened before the extension was installed
async function injectContentScript(tabId) {
  const contentScript = chrome.runtime.getManifest().content_scripts[0];
  if (contentScript.css) {
    await chrome.scripting.insertCSS({ target: { tabId: tabId }, files: contentScript.css });
  }
  await chrome.scripting.executeScript({ target: { tabId: tabId }, files: contentScript.js });
}

async function rescanPage() {
  const button = document.getElementById('rescanButton');
  const label = document.getElementById('rescanLabel');
  const tab = await getActiveTab();
  if (!tab) return false;

  button.disabled = true;
  button.classList.add('is-busy');
  label.textContent = 'Scanning';
  setPageStatus('Scanning page…', hostOf(tab));
  try {
    let response;
    try {
      response = await chrome.tabs.sendMessage(tab.id, { message: 'addGuidLabels' });
    } catch (e) {
      await injectContentScript(tab.id);
      response = await chrome.tabs.sendMessage(tab.id, { message: 'addGuidLabels' });
    }
    showStats(response && response.stats, hostOf(tab));
    return true;
  } catch (e) {
    setPageStatus('Labels can\'t run on this page', hostOf(tab));
    return false;
  } finally {
    button.disabled = false;
    button.classList.remove('is-busy');
    label.textContent = 'Re-scan';
  }
}

// ---------------------------------------------------------------------------
// Mapping files

function setupFileUpload() {
  const dropZone = document.getElementById('addMapping');
  const fileInput = document.getElementById('jsonFile');
  const overlay = document.getElementById('dragOverlay');
  let dragDepth = 0;

  const browse = () => {
    if (isFirefox && viewMode === 'popup') {
      openPopoutWindow();
    } else {
      fileInput.click();
    }
  };
  dropZone.addEventListener('click', browse);
  document.getElementById('firstRunAdd').addEventListener('click', browse);
  document.getElementById('importErrorRetry').addEventListener('click', browse);
  document.getElementById('importErrorDismiss').addEventListener('click', hideImportError);
  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      handleFileUpload(e.target.files[0]);
      fileInput.value = '';
    }
  });

  // The whole popup is the drop target. dragenter/dragleave fire for every
  // child element, so a depth counter keeps the overlay from flickering.
  const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files');
  document.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth++;
    overlay.hidden = false;
  });
  document.addEventListener('dragover', (e) => {
    if (hasFiles(e)) e.preventDefault();
  });
  document.addEventListener('dragleave', (e) => {
    if (!hasFiles(e)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) overlay.hidden = true;
  });
  document.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0;
    overlay.hidden = true;
    if (e.dataTransfer.files.length > 0) {
      handleFileUpload(e.dataTransfer.files[0]);
    }
  });
}

function showImportError(title, text) {
  document.getElementById('importErrorTitle').textContent = title;
  document.getElementById('importErrorText').textContent = text;
  document.getElementById('importError').hidden = false;
  if (!document.getElementById('tabsBar').hidden) {
    document.getElementById('tab-mappings').click();
  }
}

function hideImportError() {
  document.getElementById('importError').hidden = true;
}

let toastTimer = null;
function showToast(text) {
  const toast = document.getElementById('toast');
  document.getElementById('toastText').textContent = text;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 3500);
}

// Temporary row at the top of the list while a file is read and stored
function showImportingRow(file) {
  const row = document.createElement('div');
  row.className = 'file-row file-row--importing';
  row.setAttribute('role', 'listitem');
  row.innerHTML = '<div class="file-row__head"><span class="file-row__name"></span><span class="file-row__meta">Parsing…</span></div>'
    + '<div class="progress"><div class="progress__bar"></div></div>'
    + '<span class="file-row__meta"></span>';
  row.querySelector('.file-row__name').textContent = file.name;
  row.lastElementChild.textContent = (file.size / (1024 * 1024)).toFixed(1) + ' MB · rows appear when done';
  document.getElementById('fileList').prepend(row);
  return row;
}

const IMPORT_HINT = 'Use the file from Assets › Generate Full GUID Mapping.';

async function handleFileUpload(file) {
  hideImportError();
  if (!file.name.toLowerCase().endsWith('.json')) {
    showImportError(`Couldn't import ${file.name}`, 'Mapping files are .json files. ' + IMPORT_HINT);
    return;
  }

  const row = showImportingRow(file);
  let parsed;
  try {
    parsed = JSON.parse(await file.text());
  } catch (error) {
    row.remove();
    showImportError(`Couldn't import ${file.name}`, 'The file is not valid JSON. ' + IMPORT_HINT);
    return;
  }
  if (!parsed || typeof parsed.mapping !== 'object' || parsed.mapping === null) {
    row.remove();
    showImportError(`Couldn't import ${file.name}`, 'No "mapping" field at the root. ' + IMPORT_HINT);
    return;
  }

  let result;
  try {
    result = await GuidStorage.addFile(file.name, parsed);
  } catch (error) {
    row.remove();
    showImportError(`Couldn't import ${file.name}`, (error.message || String(error)) + ' ' + IMPORT_HINT);
    return;
  }

  await updateFileList();
  let added = count(result.count, 'GUID');
  if (result.skipped > 0) {
    added += ` (${count(result.skipped, 'invalid entry', 'invalid entries')} skipped)`;
  }
  const scanned = await rescanPage();
  showToast(scanned ? `Added ${added}. Labels updated on this tab.` : `Added ${added}.`);
}

function createIconButton(label, svgPath, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'icon-button icon-button--small';
  button.setAttribute('aria-label', label);
  button.title = label;
  button.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + svgPath + '</svg>';
  button.addEventListener('click', onClick);
  return button;
}

const ICON_DOWNLOAD = '<path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/><path d="M7 11l5 5l5-5"/><path d="M12 4l0 12"/>';
const ICON_TRASH = '<path d="M4 7l16 0"/><path d="M10 11l0 6"/><path d="M14 11l0 6"/><path d="M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12"/><path d="M9 7v-3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3"/>';

function formatDate(value) {
  const date = new Date(value);
  return isNaN(date.getTime()) ? (value || 'unknown date') : dateFormat.format(date);
}

function createFileRow(file) {
  const name = file.projectName || file.fileName;
  const entryCount = Object.keys(file.mapping || {}).length;

  const row = document.createElement('div');
  row.className = 'file-row';
  row.setAttribute('role', 'listitem');
  row.title = file.fileName;

  const text = document.createElement('div');
  text.className = 'file-row__text';

  const nameLine = document.createElement('span');
  nameLine.className = 'file-row__name';
  nameLine.textContent = name + ' ';
  if (file.projectVersion) {
    const version = document.createElement('span');
    version.className = 'file-row__version';
    version.textContent = 'v' + file.projectVersion;
    nameLine.appendChild(version);
  }

  const meta = document.createElement('span');
  meta.className = 'file-row__meta';
  meta.textContent = `${count(entryCount, 'GUID')} · ${formatDate(file.creationDate)}`;

  text.append(nameLine, meta);
  row.append(
    text,
    createIconButton('Download ' + file.fileName, ICON_DOWNLOAD, () => downloadFileData(file.id)),
    createIconButton('Remove ' + name, ICON_TRASH, (e) => {
      e.currentTarget.disabled = true;
      row.classList.add('is-removing');
      deleteFile(file.id);
    })
  );
  return row;
}

async function updateFileList() {
  const fileList = document.getElementById('fileList');
  const totalEntries = document.getElementById('totalEntries');
  const [files, total] = await Promise.all([GuidStorage.getFiles(), GuidStorage.getMergedCount()]);

  fileList.replaceChildren(...files.map(createFileRow));
  totalEntries.textContent = files.length ? count(total, 'GUID') : 'none loaded';
  setFirstRun(files.length === 0);
}

// Without any mapping, the tabs are hidden and the setup steps are shown instead
function setFirstRun(firstRun) {
  const wasFirstRun = !document.getElementById('firstRun').hidden;
  document.getElementById('firstRun').hidden = !firstRun;
  document.getElementById('tabsBar').hidden = firstRun;
  document.querySelectorAll('[role="tab"]').forEach(tab => {
    const panel = document.getElementById(tab.getAttribute('aria-controls'));
    panel.hidden = firstRun || tab.getAttribute('aria-selected') !== 'true';
  });
  // Show the new file after the first import
  if (wasFirstRun && !firstRun) {
    document.getElementById('tab-mappings').click();
  }
}

async function deleteFile(fileId) {
  await GuidStorage.removeFile(fileId);
  updateFileList();
}

async function downloadFileData(fileId) {
  const file = await GuidStorage.getFile(fileId);
  if (!file) return;

  const blob = new Blob([GuidStorage.toJson(file)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.fileName;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 0);
}
