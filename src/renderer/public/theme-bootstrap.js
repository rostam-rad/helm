// Sets data-theme on <html> before the React bundle loads, so there's no
// flash of wrong theme on launch. Lives in a separate file (not inline)
// so the renderer's CSP can keep `script-src 'self'` strict — inline
// scripts would force `'unsafe-inline'`, defeating the point of CSP.
//
// MUST be loaded synchronously (no defer, no module) and BEFORE the main
// React entry, otherwise React mounts against an unset theme attribute.
(function () {
  try {
    var stored = localStorage.getItem('helm.theme');
    var mode = stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system';
    var dark = mode === 'dark' || (mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  } catch (_) {
    document.documentElement.setAttribute('data-theme', 'light');
  }
})();
