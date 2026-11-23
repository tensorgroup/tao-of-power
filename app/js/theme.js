// Runs before first paint (plain script in <head>). Light is the default.
(function () {
  var KEY = 'tao.theme';
  var MODES = ['light', 'dark', 'auto'];
  var ICON = { light: '☀', dark: '☾', auto: '◐' };
  var LABEL = { light: 'Theme: light', dark: 'Theme: dark', auto: 'Theme: follows your phone' };
  function get() { try { var t = localStorage.getItem(KEY); return MODES.indexOf(t) >= 0 ? t : 'light'; } catch (e) { return 'light'; } }
  function isDark(t) { return t === 'dark' || (t === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches); }
  function apply(t) {
    document.documentElement.setAttribute('data-theme', t);
    var m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute('content', isDark(t) ? '#14120f' : '#f4efe4');
    var b = document.getElementById('theme-btn');
    if (b) { b.textContent = ICON[t]; b.setAttribute('aria-label', LABEL[t] + '. Tap to change.'); b.title = LABEL[t]; }
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
