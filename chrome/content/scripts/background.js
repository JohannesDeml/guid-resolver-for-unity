// Chrome loads this file as a service worker and needs the storage module imported;
// Firefox lists storage.js before this file in background.scripts.
if (typeof importScripts === 'function' && typeof GuidStorage === 'undefined') {
  importScripts('storage.js');
}

// Rebuild the merged lookup after installs and updates, so it always
// matches the format of the current version (newest file wins, with sources).
chrome.runtime.onInstalled.addListener(function () {
  GuidStorage.rebuildMerged().catch(function (error) {
    console.log('Could not rebuild guid mapping: ' + error.message);
  });
});

chrome.tabs.onUpdated.addListener(function (tabId, changeInfo, tab) {
  if (changeInfo.url) {
    var url = changeInfo.url;
    if(url.indexOf("chrome:") != -1) {
      return;
    }
    if(url.indexOf("git") == -1 &&
      url.indexOf("bitbucket") == -1) {
      return;
    }
    console.log("URL changed to " + url + ", changeInfo.status: " + changeInfo.status);
    chrome.tabs.sendMessage(tabId, { message: "addGuidLabels" }, function(response) {});
  }
});