// Applies the light/dark choice from the popup's footer toggle before the page renders,
// so there is no flash of the other theme. Without a saved choice the system theme is used.
(function () {
  try {
    var theme = localStorage.getItem('ui.theme');
    if (theme === 'light' || theme === 'dark') {
      document.documentElement.dataset.theme = theme;
    }
  } catch (e) {
    // Storage not available: follow the system theme
  }
})();
