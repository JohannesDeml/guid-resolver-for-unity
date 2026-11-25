// Lookup tab: shows which asset a GUID belongs to and which mapping file it comes from.
// Depends on popup.js (count, numberFormat, formatDate) and ../scripts/storage.js (GuidStorage).

(function () {
  const GUID = /\b[0-9a-f]{32}\b/;
  const MIN_PREFIX = 3;
  const MAX_MATCHES = 20;

  // Mapping files are read once per popup open, newest first
  let filesPromise = null;
  function loadFiles() {
    if (!filesPromise) {
      filesPromise = GuidStorage.getFiles();
    }
    return filesPromise;
  }

  const el = (id) => document.getElementById(id);

  function showOnly(visible) {
    ['lookupEmpty', 'lookupResult', 'lookupMissing', 'lookupMatches', 'lookupHint'].forEach(id => {
      el(id).hidden = id !== visible;
    });
  }

  // Accepts a bare GUID, "guid: ..." or a whole YAML line containing one
  function normalize(value) {
    const text = value.trim().toLowerCase();
    const match = text.match(GUID);
    return match ? match[0] : text.replace(/^guid:\s*/, '');
  }

  function showResult(guid, files) {
    const sources = files.filter(file => file.mapping && file.mapping[guid]);
    if (sources.length === 0) {
      const total = new Set(files.flatMap(file => Object.keys(file.mapping || {}))).size;
      el('lookupMissingText').textContent =
        `Searched ${count(files.length, 'mapping')} · ${count(total, 'GUID')}. The asset may be newer than your latest export.`;
      showOnly('lookupMissing');
      return;
    }

    const top = sources[0];
    const name = top.mapping[guid].fileName;
    el('resultName').textContent = name;
    el('resultName').title = name;
    el('resultProject').textContent = top.projectName || top.fileName;
    el('resultVersion').textContent = top.projectVersion ? 'v' + top.projectVersion : '';
    el('resultFile').textContent = top.fileName;
    el('resultDate').textContent = formatDate(top.creationDate);

    // The same GUID in older files: same name, or overridden by the newer file
    const others = sources.slice(1).map(file => {
      const label = (file.projectName || file.fileName) + (file.projectVersion ? ' v' + file.projectVersion : '');
      const otherName = file.mapping[guid].fileName;
      return otherName === name
        ? `Also in ${label} with the same name.`
        : `${label} (older) maps it to ${otherName} — overridden.`;
    });
    el('resultAlso').textContent = others.join(' ');
    el('resultAlso').hidden = others.length === 0;
    showOnly('lookupResult');
  }

  // GUIDs starting with the prefix, newest file wins. Older files with the
  // same GUID are only counted. Stops collecting rows after MAX_MATCHES.
  function findPrefix(prefix, files) {
    const hits = new Map();
    let total = 0;
    for (const file of files) {
      for (const guid in file.mapping) {
        if (!guid.startsWith(prefix)) continue;
        const hit = hits.get(guid);
        if (hit) {
          hit.older++;
          continue;
        }
        total++;
        if (hits.size < MAX_MATCHES) {
          hits.set(guid, { name: file.mapping[guid].fileName, file: file, older: 0 });
        }
      }
    }
    return { hits: hits, total: total };
  }

  function createMatchRow(guid, hit, prefix) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'match';
    row.setAttribute('role', 'listitem');

    const guidLine = document.createElement('span');
    guidLine.className = 'match__guid';
    const typed = document.createElement('b');
    typed.textContent = guid.slice(0, prefix.length);
    guidLine.append(typed, guid.slice(prefix.length));

    const line = document.createElement('span');
    line.className = 'match__line';
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.textContent = hit.name;
    const source = document.createElement('span');
    source.className = 'match__source';
    source.textContent = (hit.file.projectName || hit.file.fileName) + (hit.older ? ` · +${hit.older} older` : '');
    line.append(chip, source);

    row.append(guidLine, line);
    row.addEventListener('click', () => {
      const input = el('lookupInput');
      input.value = guid;
      run();
      input.focus();
    });
    return row;
  }

  function showMatches(prefix, files) {
    const result = findPrefix(prefix, files);
    el('matchesCount').textContent = result.total
      ? `${count(result.total, 'GUID')} ${result.total === 1 ? 'starts' : 'start'} with ${prefix}`
      : `No GUIDs start with ${prefix}`;
    el('matchList').replaceChildren(...Array.from(result.hits, ([guid, hit]) => createMatchRow(guid, hit, prefix)));
    const more = result.total - result.hits.size;
    el('matchesMore').textContent = `…and ${numberFormat.format(more)} more. Keep typing to narrow it down.`;
    el('matchesMore').hidden = more <= 0;
    showOnly('lookupMatches');
  }

  function showHint(text) {
    el('lookupHint').textContent = text;
    showOnly('lookupHint');
  }

  async function run() {
    const input = el('lookupInput');
    const query = normalize(input.value);
    el('lookupClear').hidden = input.value.length === 0;

    if (query.length === 0) {
      showOnly('lookupEmpty');
      return;
    }
    if (/^[0-9a-f]{32}$/.test(query)) {
      showResult(query, await loadFiles());
      return;
    }
    if (!/^[0-9a-f]+$/.test(query)) {
      showHint('GUIDs only contain 0–9 and a–f.');
    } else if (query.length > 32) {
      showHint('Too long. A GUID has 32 characters.');
    } else if (query.length < MIN_PREFIX) {
      showHint(`Type at least ${MIN_PREFIX} characters to see matching GUIDs.`);
    } else {
      showMatches(query, await loadFiles());
    }
  }

  async function copyName(button) {
    try {
      await navigator.clipboard.writeText(el('resultName').textContent);
      button.title = 'Copied';
      button.setAttribute('aria-label', 'Copied');
      setTimeout(() => {
        button.title = 'Copy name';
        button.setAttribute('aria-label', 'Copy asset name');
      }, 1500);
    } catch (e) {
      // Clipboard not available, nothing to do
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    const input = el('lookupInput');
    input.addEventListener('input', run);
    // Start reading the mapping files as soon as the field is focused (the tab opens),
    // so large projects don't delay the first keystroke
    input.addEventListener('focus', loadFiles);
    el('lookupClear').addEventListener('click', () => {
      input.value = '';
      run();
      input.focus();
    });
    el('resultCopy').addEventListener('click', (e) => copyName(e.currentTarget));
  });

  // Imports and removals change the data to search
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.guidFiles) {
      filesPromise = null;
      run();
    }
  });
})();
