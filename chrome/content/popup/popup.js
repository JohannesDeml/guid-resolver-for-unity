// Popup of GUID Resolver for Unity
// Depends on ../scripts/storage.js (GuidStorage)

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const numberFormat = new Intl.NumberFormat();

// "1 GUID", "8,823 GUIDs"
function count(n, word) {
  return numberFormat.format(n) + ' ' + word + (n === 1 ? '' : 's');
}

// Firefox closes the popup while its file picker is open, so picking files there needs the tab view
const isFirefox = chrome.runtime.getURL('').startsWith('moz-extension://');
// Set once known: true when this page is open as a tab (options page) rather than as the popup
let isTab = false;

function openInTab() {
  chrome.runtime.openOptionsPage();
  if (!isTab) {
    window.close();
  }
}

document.addEventListener('DOMContentLoaded', async function () {
  const currentTab = chrome.tabs.getCurrent ? await chrome.tabs.getCurrent() : null;
  isTab = !!currentTab;
  document.body.classList.toggle('is-tab', isTab);
  document.getElementById('firefoxHint').hidden = !isFirefox || isTab;

  document.getElementById('optionsButton').addEventListener('click', openInTab);
  document.getElementById('firefoxOpenTab').addEventListener('click', openInTab);
  document.getElementById('version').textContent = 'v' + chrome.runtime.getManifest().version;

  setupTabs();
  setupFileUpload();
  document.getElementById('rescanButton').addEventListener('click', rescanPage);

  updateFileList();
  loadPageStatus();
});

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

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
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
    if (isFirefox && !isTab) {
      openInTab();
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

  try {
    await GuidStorage.addFile(file.name, parsed);
  } catch (error) {
    row.remove();
    showImportError(`Couldn't import ${file.name}`, error.message || String(error));
    return;
  }

  await updateFileList();
  const added = count(Object.keys(parsed.mapping).length, 'GUID');
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
