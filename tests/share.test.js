import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shareTarget, installMode } from '../app/js/share.js';

test('shareTarget: home shares the bare site URL', () => {
  const t = shareTarget('https://tao.tensor.group/#/');
  assert.equal(t.url, 'https://tao.tensor.group/');
  assert.equal(t.path, '/');
  assert.match(t.title, /Tao of Power/);
});

test('shareTarget: a passage link drops the private draw id', () => {
  const t = shareTarget('https://tao.tensor.group/#/p/59?d=abc-123');
  assert.equal(t.url, 'https://tao.tensor.group/#/p/59');
  assert.equal(t.title, 'Tao Te Ching, passage 59');
  assert.equal(t.path, '/p/59');
});

test('shareTarget: other pages keep their route', () => {
  assert.equal(shareTarget('https://tao.tensor.group/#/about?s=ox').url, 'https://tao.tensor.group/#/about?s=ox');
  assert.equal(shareTarget('https://tao.tensor.group/#/browse').path, '/browse');
});

test('installMode picks the right help', () => {
  assert.equal(installMode({ standalone: true, canPrompt: true }), 'installed');
  assert.equal(installMode({ canPrompt: true, ua: 'iPhone' }), 'prompt');
  assert.equal(installMode({ ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' }), 'ios');
  assert.equal(installMode({ ua: 'Mozilla/5.0 (Macintosh)', platform: 'MacIntel', touch: 5 }), 'ios');
  assert.equal(installMode({ ua: 'Mozilla/5.0 (Linux; Android 15)' }), 'menu');
});
