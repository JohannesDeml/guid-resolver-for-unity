// Shared access to the stored GUID mapping files.
// Used by the popup (script tag), the Chrome service worker (importScripts)
// and the Firefox background page (background.scripts).
//
// Storage layout (chrome.storage.local):
//   guidFiles:   { [fileId]: { fileName, creationDate, uploadDate, projectName, projectVersion, mapping } }
//   guidMapping: { mapping: { [guid]: { fileName, s } }, sources: [{ id, fileName, creationDate, projectName, projectVersion }] }
// guidMapping is the merged lookup the content script uses. Newer files win;
// "s" is the index into "sources" of the file an entry came from.
var GuidStorage = (function () {
  function fileTime(file) {
    var time = new Date(file.creationDate || file.uploadDate || 0).getTime();
    return isNaN(time) ? 0 : time;
  }

  // All stored files as [{ id, ...file }], newest first
  async function getFiles() {
    var data = await chrome.storage.local.get('guidFiles');
    var files = data.guidFiles || {};
    return Object.keys(files)
      .map(function (id) { return Object.assign({ id: id }, files[id]); })
      .sort(function (a, b) { return fileTime(b) - fileTime(a); });
  }

  async function getFile(id) {
    var data = await chrome.storage.local.get('guidFiles');
    var files = data.guidFiles || {};
    return files[id] ? Object.assign({ id: id }, files[id]) : null;
  }

  // Number of unique GUIDs in the merged lookup
  async function getMergedCount() {
    var data = await chrome.storage.local.get('guidMapping');
    var mapping = data.guidMapping && data.guidMapping.mapping;
    return mapping ? Object.keys(mapping).length : 0;
  }

  // Store a parsed mapping file (must contain "mapping") and rebuild the merged lookup.
  // Returns the id the file is stored under.
  async function addFile(fileName, parsed) {
    if (!parsed || typeof parsed.mapping !== 'object' || parsed.mapping === null) {
      throw new Error('The file has no "mapping" field at the root.');
    }
    var id = fileName + ' - ' + parsed.creationDate;
    var data = await chrome.storage.local.get('guidFiles');
    var files = data.guidFiles || {};
    files[id] = {
      fileName: fileName,
      creationDate: parsed.creationDate,
      uploadDate: new Date().toISOString(),
      projectName: parsed.projectName,
      projectVersion: parsed.projectVersion,
      mapping: parsed.mapping
    };
    await chrome.storage.local.set({ guidFiles: files });
    await rebuildMerged();
    return id;
  }

  async function removeFile(id) {
    var data = await chrome.storage.local.get('guidFiles');
    var files = data.guidFiles || {};
    delete files[id];
    await chrome.storage.local.set({ guidFiles: files });
    await rebuildMerged();
  }

  // Merge all files into one lookup. Files are applied oldest first,
  // so entries of newer files overwrite older ones.
  async function rebuildMerged() {
    var files = await getFiles();
    var mapping = {};
    var sources = [];
    for (var i = files.length - 1; i >= 0; i--) {
      var file = files[i];
      var index = sources.length;
      sources.push({
        id: file.id,
        fileName: file.fileName,
        creationDate: file.creationDate,
        projectName: file.projectName,
        projectVersion: file.projectVersion
      });
      var entries = file.mapping || {};
      for (var guid in entries) {
        var entry = entries[guid];
        mapping[guid] = { fileName: entry && entry.fileName, s: index };
      }
    }
    await chrome.storage.local.set({ guidMapping: { mapping: mapping, sources: sources } });
  }

  // JSON text of a stored file, in the format the Unity package exports
  function toJson(file) {
    return JSON.stringify({
      creationDate: file.creationDate,
      projectName: file.projectName,
      projectVersion: file.projectVersion,
      mapping: file.mapping
    }, null, 2);
  }

  return {
    getFiles: getFiles,
    getFile: getFile,
    getMergedCount: getMergedCount,
    addFile: addFile,
    removeFile: removeFile,
    rebuildMerged: rebuildMerged,
    toJson: toJson
  };
})();
