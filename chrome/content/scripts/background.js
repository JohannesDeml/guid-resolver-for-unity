// Chrome loads this file as a service worker and needs the shared scripts imported;
// Firefox lists them before this file in background.scripts.
if (typeof importScripts === 'function' && typeof GuidStorage === 'undefined') {
  importScripts('storage.js', 'sites.js');
}

// Rebuild the merged lookup after installs and updates, so it always
// matches the format of the current version (newest file wins, with sources).
chrome.runtime.onInstalled.addListener(function () {
  GuidStorage.rebuildMerged().catch(function (error) {
    console.log('Could not rebuild guid mapping: ' + error.message);
  });
});

// Toolbar badge: the number of resolved GUIDs on a tab, reported by the
// content script after every scan. Empty when nothing was resolved.
var toolbarAction = chrome.action || chrome.browserAction;
toolbarAction.setBadgeBackgroundColor({ color: '#6A00DB' });
if (toolbarAction.setBadgeTextColor) {
  toolbarAction.setBadgeTextColor({ color: '#FFFFFF' });
}

function badgeText(resolved) {
  if (!resolved) return '';
  return resolved > 999 ? '999+' : String(resolved);
}

// Toolbar icon: greyed out on tabs where the extension does not label
// automatically (the URL does not match sites.js), the normal icon elsewhere.
// Grey versions only exist in the sizes the toolbar uses
var TOOLBAR_ICON_SIZES = ['16', '32'];

function iconPaths(inactive) {
  var icons = chrome.runtime.getManifest().icons;
  var paths = {};
  TOOLBAR_ICON_SIZES.forEach(function (size) {
    var path = inactive ? icons[size].replace('icon-', 'icon-inactive-') : icons[size];
    paths[size] = '/' + path;
  });
  return paths;
}

// The icons are drawn into ImageData once and set from that, instead of by file
// path: Firefox could lose a tab's path-based icon later on (blank toolbar button).
var iconImageCache = {};

function loadIconImageData(inactive) {
  var key = inactive ? 'inactive' : 'active';
  if (!iconImageCache[key]) {
    var paths = iconPaths(inactive);
    iconImageCache[key] = Promise.all(TOOLBAR_ICON_SIZES.map(function (size) {
      var pixels = Number(size);
      return fetch(chrome.runtime.getURL(paths[size].slice(1)))
        .then(function (response) { return response.blob(); })
        .then(function (blob) { return createImageBitmap(blob); })
        .then(function (bitmap) {
          var canvas = new OffscreenCanvas(pixels, pixels);
          var context = canvas.getContext('2d');
          context.drawImage(bitmap, 0, 0, pixels, pixels);
          return [size, context.getImageData(0, 0, pixels, pixels)];
        });
    })).then(function (entries) {
      var imageData = {};
      entries.forEach(function (entry) { imageData[entry[0]] = entry[1]; });
      return imageData;
    });
    // Try again next time if drawing failed
    iconImageCache[key].catch(function () { delete iconImageCache[key]; });
  }
  return iconImageCache[key];
}

function setTabIconActive(tabId, active) {
  loadIconImageData(!active).then(function (imageData) {
    return toolbarAction.setIcon({ tabId: tabId, imageData: imageData });
  }, function () {
    // Drawing not possible: fall back to the file paths
    return toolbarAction.setIcon({ tabId: tabId, path: iconPaths(!active) });
  }).catch(function () {}); // the tab was closed meanwhile
}

function updateTabIcon(tab) {
  if (tab && tab.id !== undefined) {
    setTabIconActive(tab.id, isGuidResolverUrl(tab.url || tab.pendingUrl));
  }
}

// Tabs that were open before the extension started
function updateAllTabIcons() {
  chrome.tabs.query({}, function (tabs) {
    (tabs || []).forEach(updateTabIcon);
  });
}
chrome.runtime.onInstalled.addListener(updateAllTabIcons);
chrome.runtime.onStartup.addListener(updateAllTabIcons);

chrome.runtime.onMessage.addListener(function (request, sender) {
  if (request && request.message === 'guidStats' && sender.tab && sender.tab.id !== undefined) {
    var stats = request.stats || {};
    toolbarAction.setBadgeText({ tabId: sender.tab.id, text: badgeText(stats.resolved) });
    // A manual re-scan can label pages that don't match: show the normal icon there
    if (stats.resolved || stats.unresolved) {
      setTabIconActive(sender.tab.id, true);
    }
  }
});

chrome.tabs.onUpdated.addListener(function (tabId, changeInfo, tab) {
  if (changeInfo.url) {
    // A new page: the old count no longer applies, the next scan reports a new one
    toolbarAction.setBadgeText({ tabId: tabId, text: '' });
    var url = changeInfo.url;
    setTabIconActive(tabId, isGuidResolverUrl(url));
    if (!isGuidResolverUrl(url)) {
      return;
    }
    console.log("URL changed to " + url + ", changeInfo.status: " + changeInfo.status);
    chrome.tabs.sendMessage(tabId, { message: "addGuidLabels" }, function(response) {
      // No content script yet while the page loads; it scans on load by itself
      void chrome.runtime.lastError;
    });
  }
});