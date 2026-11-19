import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readSearchQuery } from '../search.js';

test('search needs at least 2 characters', () => {
  assert.equal(readSearchQuery(undefined), null);
  assert.equal(readSearchQuery(''), null);
  assert.equal(readSearchQuery(' a '), null);
  assert.equal(readSearchQuery('db'), '%db%');
});

test('LIKE wildcards in the query are matched literally', () => {
  assert.equal(readSearchQuery('100%'), '%100\\%%');
  assert.equal(readSearchQuery('cs_301'), '%cs\\_301%');
  assert.equal(readSearchQuery('a\\b'), '%a\\\\b%');
});

test('long queries are cut and only strings are accepted', () => {
  assert.equal(readSearchQuery('x'.repeat(200))?.length, 82);
  assert.equal(readSearchQuery(['db', 'x']), null);
});
