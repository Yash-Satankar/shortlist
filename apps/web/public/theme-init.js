// Runs before first paint (external file: the CSP forbids inline scripts).
// Resolves the saved theme preference to data-theme on <html> so there is no flash.
(function () {
  var pref = 'system';
  try {
    pref = localStorage.getItem('jt-theme') || 'system';
  } catch (e) {}
  var dark = pref === 'dark' || (pref === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
})();
