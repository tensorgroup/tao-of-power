// Open YouTube links in the YouTube app on phones.
// Brave and other iOS browsers often keep https://www.youtube.com links in the
// browser, so iOS gets the youtube:// scheme. Android gets an intent URL with
// a browser fallback. Desktop keeps the plain https link.

/** 'ios' | 'android' | 'other' from a navigator-like object. */
export function platformOf(nav = globalThis.navigator || {}) {
  const ua = String(nav.userAgent || '');
  if (/iPad|iPhone|iPod/.test(ua) || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1)) return 'ios';
  if (/Android/.test(ua)) return 'android';
  return 'other';
}

/** The app URL for a YouTube https URL, or null when the plain link is best. */
export function youtubeAppUrl(href, platform) {
  let u;
  try { u = new URL(href); } catch { return null; }
  if (!/(^|\.)youtube\.com$/.test(u.hostname)) return null;
  const rest = `${u.hostname}${u.pathname}${u.search}`;
  if (platform === 'ios') return `youtube://${rest}`;
  if (platform === 'android') {
    return `intent://${rest}#Intent;scheme=https;package=com.google.android.youtube;S.browser_fallback_url=${encodeURIComponent(href)};end`;
  }
  return null;
}

/** Click handler: try the app; on iOS fall back to the web page if the app does not open. */
export function openInYouTubeApp(e, href) {
  const platform = platformOf();
  const app = youtubeAppUrl(href, platform);
  if (!app) return;
  e.preventDefault();
  if (platform === 'android') { location.href = app; return; }
  let timer = 0;
  const cancel = () => { clearTimeout(timer); document.removeEventListener('visibilitychange', cancel); window.removeEventListener('pagehide', cancel); };
  document.addEventListener('visibilitychange', cancel);
  window.addEventListener('pagehide', cancel);
  timer = setTimeout(() => {
    cancel();
    if (document.visibilityState !== 'visible') return;
    if (!window.open(href, '_blank', 'noopener')) location.href = href;
  }, 1500);
  location.href = app;
}
