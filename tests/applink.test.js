import { test } from 'node:test';
import assert from 'node:assert/strict';
import { platformOf, youtubeAppUrl } from '../app/js/applink.js';

const yt = 'https://www.youtube.com/results?search_query=Tao%20song';

test('platformOf detects iPhone, iPad desktop mode, Android, desktop', () => {
  assert.equal(platformOf({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X)' }), 'ios');
  assert.equal(platformOf({ userAgent: 'Mozilla/5.0 (Macintosh)', platform: 'MacIntel', maxTouchPoints: 5 }), 'ios');
  assert.equal(platformOf({ userAgent: 'Mozilla/5.0 (Linux; Android 16; Pixel)' }), 'android');
  assert.equal(platformOf({ userAgent: 'Mozilla/5.0 (Macintosh)', platform: 'MacIntel', maxTouchPoints: 0 }), 'other');
});

test('youtubeAppUrl builds the iOS scheme URL', () => {
  assert.equal(youtubeAppUrl(yt, 'ios'), 'youtube://www.youtube.com/results?search_query=Tao%20song');
});

test('youtubeAppUrl builds an Android intent with a browser fallback', () => {
  const u = youtubeAppUrl(yt, 'android');
  assert.ok(u.startsWith('intent://www.youtube.com/results?search_query=Tao%20song#Intent;scheme=https;package=com.google.android.youtube;'));
  assert.ok(u.includes(`S.browser_fallback_url=${encodeURIComponent(yt)};end`));
});

test('youtubeAppUrl leaves desktop and non-YouTube links alone', () => {
  assert.equal(youtubeAppUrl(yt, 'other'), null);
  assert.equal(youtubeAppUrl('https://en.wikipedia.org/wiki/Tao', 'ios'), null);
  assert.equal(youtubeAppUrl('not a url', 'ios'), null);
});
