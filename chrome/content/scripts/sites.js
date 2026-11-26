// Pages whose URL contains one of these strings get labels automatically.
// Shared by the content script and the background script (badge and toolbar icon).
var guidResolverUrlParts = [
  "git",
  "bitbucket",
  "codeberg",
  "sourceforge",
  "gogs",
];

function isGuidResolverUrl(url) {
  if (!url || !/^(https?|file):/.test(url)) {
    return false;
  }
  return guidResolverUrlParts.some(function (part) { return url.indexOf(part) !== -1; });
}
