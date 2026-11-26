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
  // Unity GUIDs: 32 lowercase hex characters
  var GUID_KEY = /^[0-9a-f]{32}$/;
  var MAX_NAME_LENGTH = 512;
  var MAX_META_LENGTH = 200;

  function validName(name) {
    return typeof name === 'string' && name.length > 0 && name.length <= MAX_NAME_LENGTH;
  }

  // Optional text fields of a file (project name, version, date)
  function metaText(value) {
    return typeof value === 'string' ? value.slice(0, MAX_META_LENGTH) : undefined;
  }

  // Keep only entries with a GUID key and a file name; drop everything else
  // (other fields, wrong types, keys such as "__proto__").
  function sanitizeMapping(mapping) {
    var clean = {};
    var kept = 0;
    var skipped = 0;
    Object.keys(mapping).forEach(function (key) {
      var entry = mapping[key];
      var name = entry && typeof entry === 'object' ? entry.fileName : undefined;
      if (GUID_KEY.test(key) && validName(name)) {
        clean[key] = { fileName: name };
        kept++;
      } else {
        skipped++;
      }
    });
    return { mapping: clean, kept: kept, skipped: skipped };
  }

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

  // Store a parsed mapping file and rebuild the merged lookup. Invalid entries are
  // skipped. Returns { id, count, skipped }; throws if nothing valid is left.
  async function addFile(fileName, parsed) {
    if (!parsed || typeof parsed.mapping !== 'object' || parsed.mapping === null || Array.isArray(parsed.mapping)) {
      throw new Error('The file has no "mapping" field at the root.');
    }
    var result = sanitizeMapping(parsed.mapping);
    if (result.kept === 0) {
      throw new Error('The file contains no valid GUID entries.');
    }
    var creationDate = metaText(parsed.creationDate);
    var id = fileName + ' - ' + creationDate;
    var data = await chrome.storage.local.get('guidFiles');
    var files = data.guidFiles || {};
    files[id] = {
      fileName: fileName,
      creationDate: creationDate,
      uploadDate: new Date().toISOString(),
      projectName: metaText(parsed.projectName),
      projectVersion: metaText(parsed.projectVersion),
      mapping: result.mapping
    };
    await chrome.storage.local.set({ guidFiles: files });
    await rebuildMerged();
    return { id: id, count: result.kept, skipped: result.skipped };
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
      // Files stored by older versions were not validated on import
      var entries = file.mapping || {};
      Object.keys(entries).forEach(function (guid) {
        var entry = entries[guid];
        if (GUID_KEY.test(guid) && entry && validName(entry.fileName)) {
          mapping[guid] = { fileName: entry.fileName, s: index };
        }
      });
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
