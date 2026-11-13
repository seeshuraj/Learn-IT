import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLimit, parseOffset, encodeCursor, decodeCursor, likePattern } from '../paging.js';

test('limits: default when missing or invalid, capped at the maximum', () => {
  assert.equal(parseLimit(undefined, 25, 100), 25);
  assert.equal(parseLimit('abc', 25, 100), 25);
  assert.equal(parseLimit('0', 25, 100), 25);
  assert.equal(parseLimit('40', 25, 100), 40);
  assert.equal(parseLimit('100000', 25, 100), 100);
  assert.equal(parseOffset('-5'), 0);
  assert.equal(parseOffset('60'), 60);
});

test('cursor round-trips and rejects tampering', () => {
  const c = { at: '2026-11-13T10:00:00.000Z', id: 42 };
  assert.deepEqual(decodeCursor(encodeCursor(c)), c);
  assert.equal(decodeCursor('not-a-cursor'), null);
  assert.equal(decodeCursor(Buffer.from('2026-11-13|0').toString('base64url')), null);
  assert.equal(decodeCursor(Buffer.from('yesterday|5').toString('base64url')), null);
  assert.equal(decodeCursor(undefined), null);
  assert.equal(decodeCursor('x'.repeat(500)), null);
});

test('search patterns escape LIKE wildcards and ignore blanks', () => {
  assert.equal(likePattern('  priya '), '%priya%');
  assert.equal(likePattern('50%_off\\'), '%50\\%\\_off\\\\%');
  assert.equal(likePattern('   '), null);
  assert.equal(likePattern(undefined), null);
  assert.equal(likePattern('a'.repeat(300))!.length, 102);
});
