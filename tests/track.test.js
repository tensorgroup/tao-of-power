import { test } from 'node:test';
import assert from 'node:assert/strict';
import { viewPath, UNKNOWN_ROUTE } from '../app/js/track.js';

// Three patterns in the shape of the router's routes in app.js.
const PATTERNS = [/^#?\/?$/, /^#\/p\/(\d{1,2})(?:\?d=([\w-]+))?$/, /^#\/search(?:\?q=([^&]*))?$/];

test('viewPath: a known route without its query; any other fragment is unknown', () => {
  assert.equal(viewPath('#/p/59?d=x', PATTERNS), '/p/59');
  assert.equal(viewPath('#/search?q=grief', PATTERNS), '/search');
  assert.equal(viewPath('#/search/private-words', PATTERNS), UNKNOWN_ROUTE);
  assert.equal(UNKNOWN_ROUTE, 'unknown');
  assert.equal(viewPath('', PATTERNS), '/');
});
