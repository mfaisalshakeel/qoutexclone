/*
 * Resolves the saved theme before the app paints. This is a file rather than an
 * inline <script> because the production CSP is `script-src 'self'`: an inline
 * block is refused there, and the page would flash dark before hydration for
 * anyone who chose light. Keep it in sync with src/store/theme.ts.
 */
(function () {
  try {
    const saved = localStorage.getItem('qx.theme') || 'system';
    const light =
      saved === 'light' || (saved === 'system' && window.matchMedia('(prefers-color-scheme: light)').matches);
    document.documentElement.dataset.theme = light ? 'light' : 'dark';
    document.documentElement.classList.toggle('dark', !light);
    if (light) {
      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute('content', '#f4f6fb');
    }
  } catch {
    // blocked storage, or no matchMedia: the dark default still applies
    document.documentElement.dataset.theme = 'dark';
  }
})();
