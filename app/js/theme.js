// Runs before first paint (plain script in <head>). Light is the default.
(function () {
  var KEY = 'tao.theme';
  var MODES = ['light', 'dark', 'auto'];
  // Line icons in the ink colour (a text ☀ renders as a yellow emoji on phones).
  var NS = 'http://www.w3.org/2000/svg';
  var SHAPES = {
    light: [['circle', { cx: 12, cy: 12, r: 4.2 }], ['path', { d: 'M12 2.5v2.6M12 18.9v2.6M2.5 12h2.6M18.9 12h2.6M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8' }]],
    dark: [['path', { d: 'M19.5 14.6A8 8 0 0 1 9.4 4.5a8 8 0 1 0 10.1 10.1z' }]],
    auto: [['circle', { cx: 12, cy: 12, r: 8 }], ['path', { d: 'M12 4a8 8 0 0 1 0 16z', fill: 'currentColor' }]],
  };
  function icon(t) {
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('width', '20'); svg.setAttribute('height', '20'); svg.setAttribute('aria-hidden', 'true');
    SHAPES[t].forEach(function (s) {
      var el = document.createElementNS(NS, s[0]);
      el.setAttribute('fill', 'none'); el.setAttribute('stroke', 'currentColor'); el.setAttribute('stroke-width', '1.8'); el.setAttribute('stroke-linecap', 'round');
      for (var k in s[1]) el.setAttribute(k, s[1][k]);
      svg.appendChild(el);
    });
    return svg;
  }
  var LABEL = { light: 'Theme: light', dark: 'Theme: dark', auto: 'Theme: follows your phone' };
  function get() { try { var t = localStorage.getItem(KEY); return MODES.indexOf(t) >= 0 ? t : 'light'; } catch (e) { return 'light'; } }
  function isDark(t) { return t === 'dark' || (t === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches); }
  function apply(t) {
    document.documentElement.setAttribute('data-theme', t);
    var m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute('content', isDark(t) ? '#14120f' : '#f4efe4');
    var b = document.getElementById('theme-btn');
    if (b) { b.replaceChildren(icon(t)); b.setAttribute('aria-label', LABEL[t] + '. Tap to change.'); b.title = LABEL[t]; }
  }
  apply(get());
  document.addEventListener('DOMContentLoaded', function () {
    apply(get());
    document.getElementById('theme-btn').addEventListener('click', function () {
      var next = MODES[(MODES.indexOf(get()) + 1) % MODES.length];
      try { localStorage.setItem(KEY, next); } catch (e) {}
      apply(next);
    });
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () { apply(get()); });
})();
