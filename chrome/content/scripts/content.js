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