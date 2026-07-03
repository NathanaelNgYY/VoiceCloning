import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCorsOrigin } from './corsOrigin.js';

test('wildcard and empty values allow any origin', () => {
  assert.equal(parseCorsOrigin('*'), '*');
  assert.equal(parseCorsOrigin(''), '*');
  assert.equal(parseCorsOrigin(undefined), '*');
});

test('a single origin stays a string', () => {
  assert.equal(parseCorsOrigin('https://a.example.com'), 'https://a.example.com');
});

test('a comma-separated list becomes a trimmed array', () => {
  assert.deepEqual(
    parseCorsOrigin('https://a.example.com, https://b.example.com'),
    ['https://a.example.com', 'https://b.example.com'],
  );
});

test('blank entries are dropped', () => {
  assert.deepEqual(
    parseCorsOrigin('https://a.example.com,,'),
    'https://a.example.com',
  );
});
