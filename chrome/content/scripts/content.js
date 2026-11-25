// If the domain contains any of these strings, the script will be run
const gitUrls = [
  "git",
  "bitbucket",
  "codeberg",
  "sourceforge",
  "gogs",
];

// Define the regex pattern for GUIDs
const guidRegex = /\b([a-f0-9]{32})\b/g;
const invalidGuid = "00000000000000000000000000000000";

// Will be set to true when the guid mapping is loaded
var guidLoaded = false;

// Will be updated with stored guid mapping, if set in local storage
var guidLookup = {};

// Files the merged mapping was built from, indexed by the "s" field of each entry
var guidSources = [];

// Result of the last scan, reported to the popup: { resolved, unresolved, noMapping }
var lastStats = null;

// callback (optional) receives the stats once the scan is done
function addGuidLabels(callback) {
  if(guidLoaded) {
    runGuidReplacerDelayed(callback);
    return;
  }

  chrome.storage.local.get('guidMapping', function (data) {
    if (!data || !data.guidMapping || !data.guidMapping.mapping) {
      console.log('No guid mapping stored, skipping guid labels');
      lastStats = { resolved: 0, unresolved: 0, noMapping: true };
      if (callback) callback(lastStats);
      return;
    }
    guidLookup = data.guidMapping.mapping;
    guidSources = data.guidMapping.sources || [];
    guidLoaded = true;
    runGuidReplacerDelayed(callback);
  });
}

// Drop the cached mapping when it changes (import or delete in the popup),
// so the next scan does not use stale data. Re-label pages that already show labels.
chrome.storage.onChanged.addListener(function (changes, areaName) {
  if (areaName !== 'local' || !changes.guidMapping) {
    return;
  }
  guidLoaded = false;
  guidLookup = {};
  guidSources = [];
  if (document.querySelector('span.guidResolverTag')) {
    addGuidLabels();
  }
});

function runGuidReplacerDelayed(callback) {
  // Call adding labels with a small delay to make sure everything is set up
  setTimeout(function() {
    runGuidReplacer();
    if (callback) callback(lastStats);
  }, 500);
}

function runGuidReplacer() {
  console.log("Running unity guid replacer");
  var matchCount = 0;
  var nodeCount = 0;
  var resolvedCount = 0;
  var unresolvedCount = 0;

  // Create a label element. The asset name is drawn by CSS (::after with attr()),
  // so it is never part of the page text: copying code does not copy the labels,
  // and asset names are never parsed as HTML.
  function createTag(guid) {
    var entry = guidLookup[guid];
    var tag = document.createElement('span');
    tag.className = 'guidResolverTag';
    tag.dataset.guid = guid;
    tag.tabIndex = 0;
    if (entry && entry.fileName) {
      tag.dataset.guidName = entry.fileName;
      resolvedCount++;
    } else {
      unresolvedCount++;
      tag.classList.add('guidResolverTag--missing');
      tag.dataset.guidName = 'unresolved';
      tag.title = 'No loaded mapping contains this GUID';
    }
    matchCount++;
    return tag;
  }

  var skipParents = { SCRIPT: true, STYLE: true, NOSCRIPT: true, TEXTAREA: true };

  // Collect all text nodes with possible GUID values (default)
  function traverseTextNodes(element) {
    var treeWalker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null, false);

    // Cache all nodes to be able to add nodes while traversing
    var textNodes = [];
    while (treeWalker.nextNode()) {
      var node = treeWalker.currentNode;

      // Skip nodes that are too short to contain a GUID
      if (!node.nodeValue || node.nodeValue.length < 32) {
        continue;
      }

      // Skip script, style and editable text
      if (!node.parentNode || skipParents[node.parentNode.nodeName]) {
        continue;
      }

      textNodes.push(node);
    }

    textNodes.forEach(function(node) {
      processTextNode(node);
    });
  }

  // Insert a label after each GUID in a text node by splitting the node.
  // Works from the last match backwards, so earlier offsets stay valid.
  function processTextNode(node) {
    var text = node.nodeValue;
    var matches = [];
    var match;
    guidRegex.lastIndex = 0;
    while ((match = guidRegex.exec(text)) !== null) {
      if (match[0] !== invalidGuid) {
        matches.push({ guid: match[0], end: match.index + match[0].length });
      }
    }
    for (var i = matches.length - 1; i >= 0; i--) {
      var rest = node.splitText(matches[i].end);
      rest.parentNode.insertBefore(createTag(matches[i].guid), rest);
    }
    nodeCount++;
  }


  // collect all special github elements with data-code-text attribute
  function traverseDataCodeTextElements(element) {
    var treeWalker = document.createTreeWalker(element, NodeFilter.SHOW_ELEMENT, {
      acceptNode: function(node) {
        if (node.hasAttribute('data-code-text') && node.getAttribute('data-code-text').length >= 32) {
          return NodeFilter.FILTER_ACCEPT;
        }
        return NodeFilter.FILTER_SKIP;
      }
    }, false);

    // Cache all elements to be able to add elements while traversing
    var dataCodeTextElements = [];
    while (treeWalker.nextNode()) {
      var element = treeWalker.currentNode;
      dataCodeTextElements.push(element);
    }

    dataCodeTextElements.forEach(function(element) {
      processElementWithCodeTextAttribute(element);
    });
  }

  // Function to process an element with data-code-text attribute
  // Tag elements need to be added in between the attributes to give them a special style
  function processElementWithCodeTextAttribute(element) {
    var originalContent = element.getAttribute('data-code-text');
    var matches = originalContent.match(guidRegex);
    var currentIndex = 0;
    if (matches) {
      for (var i = 0; i < matches.length; i++) {
        var match = matches[i];
        if (match === invalidGuid) {
          continue;
        }

        var index = originalContent.indexOf(match, currentIndex);
        var upToMatch = originalContent.substring(currentIndex, index + match.length);
        var afterMatch = originalContent.substring(index + match.length);
        currentIndex = index + match.length;

        var upToMatchElement = element.cloneNode(true);
        upToMatchElement.setAttribute('data-code-text', upToMatch);
        element.parentNode.insertBefore(upToMatchElement, element);
        upToMatchElement.parentNode.insertBefore(createTag(match), upToMatchElement.nextSibling);
        element.setAttribute('data-code-text', afterMatch);
      }
    }
  }


  // measure time
  var startTime = performance.now();

  // Remove all old labels and merge the text nodes they split
  var elements = document.querySelectorAll('span.guidResolverTag');
  var parents = [];
  for(var i = 0; i < elements.length; i++){
    var parent = elements[i].parentNode;
    parent.removeChild(elements[i]);
    if (parents.indexOf(parent) === -1) {
      parents.push(parent);
    }
  }
  parents.forEach(function(parent) {
    parent.normalize();
  });

  // Traverse all potential nodes in the document body
  traverseTextNodes(document.body);
  if (window.location.hostname === "github.com") {
    // Additionally traverse all special github elements with data-code-text attribute
    traverseDataCodeTextElements(document.body);
  }

  lastStats = { resolved: resolvedCount, unresolved: unresolvedCount, noMapping: false };
  guidLabelsOnPage = resolvedCount + unresolvedCount > 0;
  console.log("Found " + matchCount + " matches" + " in " + nodeCount + " nodes (duration: " + (performance.now() - startTime) + " ms)");
}

// Add listener to run the script when the url is updated
// Messages from the popup and background script
// addGuidLabels: (re-)scan the page, answer with the label counts once done
// getGuidStats: answer with the counts of the last scan (null if the page was never scanned)
chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
  if (request.message === "addGuidLabels") {
    addGuidLabels(function(stats) {
      sendResponse({ message: "Labels added", stats: stats });
    });
    // keep the message channel open for the async response
    return true;
  }
  if (request.message === "getGuidStats") {
    sendResponse({ stats: lastStats });
  }
});

// ---------------------------------------------------------------------------
// Hover card: details and copy buttons for a label, shown on hover or keyboard focus.
// One card element is created on first use and reused for every label.

var guidCard = null;
var guidCardTag = null;
var hoveredGuidTag = null;
var guidPointerFrame = 0;
// True while the page shows labels; pointer tracking only runs then
var guidLabelsOnPage = false;
var guidCardShowTimer = null;
var guidCardHideTimer = null;

function guidCardButton(text, value) {
  var button = document.createElement('button');
  button.type = 'button';
  button.className = 'guidResolverCard__button';
  button.textContent = text;
  button.addEventListener('click', function () {
    navigator.clipboard.writeText(value).then(function () {
      button.textContent = 'Copied';
      setTimeout(function () { button.textContent = text; }, 1200);
    }).catch(function () {});
  });
  return button;
}

function guidCardLine(className, text) {
  var line = document.createElement('span');
  line.className = className;
  line.textContent = text;
  return line;
}

function showGuidCard(tag) {
  var guid = tag.dataset.guid;
  var entry = guidLookup[guid];
  var source = entry && typeof entry.s === 'number' ? guidSources[entry.s] : null;

  if (!guidCard) {
    guidCard = document.createElement('div');
    guidCard.className = 'guidResolverCard';
    guidCard.setAttribute('role', 'tooltip');
    guidCard.addEventListener('mouseenter', function () { clearTimeout(guidCardHideTimer); });
    guidCard.addEventListener('mouseleave', scheduleHideGuidCard);
    document.body.appendChild(guidCard);
  }

  var actions = document.createElement('span');
  actions.className = 'guidResolverCard__actions';
  if (entry && entry.fileName) {
    actions.appendChild(guidCardButton('Copy name', entry.fileName));
  }
  actions.appendChild(guidCardButton('Copy GUID', guid));

  var sourceText = 'Not in any loaded mapping';
  if (source) {
    sourceText = 'From ' + (source.projectName || source.fileName)
      + (source.projectVersion ? ' v' + source.projectVersion : '')
      + ' · ' + source.fileName;
  } else if (entry) {
    sourceText = 'From your loaded mappings';
  }

  guidCard.replaceChildren(
    guidCardLine('guidResolverCard__name', entry && entry.fileName ? entry.fileName : 'Unresolved GUID'),
    guidCardLine('guidResolverCard__guid', guid),
    guidCardLine('guidResolverCard__source', sourceText),
    actions
  );

  // Place under the label, kept inside the viewport horizontally
  guidCard.style.display = 'flex';
  var rect = tag.getBoundingClientRect();
  var width = guidCard.offsetWidth;
  var left = Math.min(Math.max(8, rect.left), document.documentElement.clientWidth - width - 8);
  guidCard.style.left = (left + window.scrollX) + 'px';
  guidCard.style.top = (rect.bottom + window.scrollY + 6) + 'px';
  guidCardTag = tag;
}

function hideGuidCard() {
  clearTimeout(guidCardShowTimer);
  if (guidCard) {
    guidCard.style.display = 'none';
  }
  guidCardTag = null;
  hoveredGuidTag = null;
}

function scheduleHideGuidCard() {
  clearTimeout(guidCardShowTimer);
  clearTimeout(guidCardHideTimer);
  guidCardHideTimer = setTimeout(hideGuidCard, 200);
}

function closestGuidTag(target) {
  return target && target.closest ? target.closest('span.guidResolverTag') : null;
}

// Finding the label under the pointer. Code views such as GitHub's lay a
// transparent textarea over the code for selection and may turn off pointer
// events on the code lines, so labels often get no mouse events and no
// hit-test results. Cheap checks run on every pointer move; comparing the
// pointer with every label's box only runs once the pointer rests, since the
// card opens after a delay anyway.

function pointInGuidTag(tag, x, y) {
  var rects = tag.getClientRects();
  for (var k = 0; k < rects.length; k++) {
    var r = rects[k];
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
      return true;
    }
  }
  return false;
}

// Target and hit-test stack only
function guidTagAtPointFast(target, x, y) {
  var tag = closestGuidTag(target);
  if (tag) return tag;
  var stack = document.elementsFromPoint(x, y);
  for (var i = 0; i < stack.length && i < 8; i++) {
    tag = closestGuidTag(stack[i]);
    if (tag) return tag;
  }
  return null;
}

// Including the boxes of all labels (cost grows with the number of labels)
function guidTagAtPoint(target, x, y) {
  var tag = guidTagAtPointFast(target, x, y);
  if (tag) return tag;
  var tags = document.getElementsByClassName('guidResolverTag');
  for (var j = 0; j < tags.length; j++) {
    if (pointInGuidTag(tags[j], x, y)) {
      return tags[j];
    }
  }
  return null;
}

var guidRestTimer = null;
var GUID_REST_DELAY = 80;

function setHoveredGuidTag(tag, showDelay) {
  if (tag && tag === guidCardTag) {
    clearTimeout(guidCardHideTimer);
    hoveredGuidTag = tag;
    return;
  }
  if (tag === hoveredGuidTag) return;
  hoveredGuidTag = tag;
  if (tag) {
    clearTimeout(guidCardShowTimer);
    guidCardShowTimer = setTimeout(function () { showGuidCard(tag); }, showDelay);
  } else if (guidCardTag) {
    scheduleHideGuidCard();
  } else {
    clearTimeout(guidCardShowTimer);
  }
}

function trackGuidPointer(target, x, y) {
  clearTimeout(guidRestTimer);
  if (guidCard && guidCard.contains(target)) {
    clearTimeout(guidCardHideTimer);
    return;
  }
  var tag = guidTagAtPointFast(target, x, y);
  if (!tag && hoveredGuidTag && pointInGuidTag(hoveredGuidTag, x, y)) {
    tag = hoveredGuidTag;
  }
  if (tag) {
    setHoveredGuidTag(tag, 300);
    return;
  }
  setHoveredGuidTag(null, 0);
  // Pointer resting: do the full search once
  guidRestTimer = setTimeout(function () {
    var restingTag = guidTagAtPoint(target, x, y);
    if (restingTag) {
      setHoveredGuidTag(restingTag, 300 - GUID_REST_DELAY);
    }
  }, GUID_REST_DELAY);
}

// Listen on window in the capture phase, so pages that stop mouse events
// on their own elements cannot hide them from us
window.addEventListener('mousemove', function (e) {
  if (!guidLabelsOnPage || guidPointerFrame) return;
  var target = e.target;
  var x = e.clientX;
  var y = e.clientY;
  // At most one lookup per frame
  guidPointerFrame = requestAnimationFrame(function () {
    guidPointerFrame = 0;
    trackGuidPointer(target, x, y);
  });
}, { capture: true, passive: true });

// Leaving the window
document.addEventListener('mouseout', function (e) {
  if (e.relatedTarget) return;
  clearTimeout(guidRestTimer);
  if (guidCardTag) {
    scheduleHideGuidCard();
  }
});

// A click on a label opens its card right away. The click itself is left to the
// page, so selecting code and placing the cursor keep working.
window.addEventListener('click', function (e) {
  if (!guidLabelsOnPage) return;
  var tag = guidTagAtPoint(e.target, e.clientX, e.clientY);
  if (tag) {
    clearTimeout(guidCardShowTimer);
    clearTimeout(guidCardHideTimer);
    hoveredGuidTag = tag;
    showGuidCard(tag);
  }
}, true);

document.addEventListener('focusin', function (e) {
  var tag = closestGuidTag(e.target);
  if (tag) {
    clearTimeout(guidCardHideTimer);
    showGuidCard(tag);
  } else if (guidCard && !guidCard.contains(e.target)) {
    hideGuidCard();
  }
});

document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape' && guidCardTag) {
    var tag = guidCardTag;
    hideGuidCard();
    if (document.activeElement && guidCard.contains(document.activeElement)) {
      tag.focus();
    }
  }
});

function initIfMatchingDomain()
{
  var url = window.location.href;
  if (!gitUrls.some(urlPart => url.includes(urlPart))) {
    // No git indicator in the url, don't run the script automatically
    return;
  }

  // Add listener to run the script when the page is loaded
  addEventListener("load", (event) => {
    addGuidLabels();
  });
}

initIfMatchingDomain();