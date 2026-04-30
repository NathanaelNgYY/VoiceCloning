import test from 'node:test';
import assert from 'node:assert/strict';
import { preprocessText } from './longTextInference.js';

// Years
test('preprocessText: year 2021 -> twenty twenty-one', () => {
  assert.equal(preprocessText('released in 2021'), 'released in twenty twenty-one');
});
test('preprocessText: year 2000 -> two thousand', () => {
  assert.equal(preprocessText('the year 2000'), 'the year two thousand');
});
test('preprocessText: year 1999 -> nineteen ninety-nine', () => {
  assert.equal(preprocessText('back in 1999'), 'back in nineteen ninety-nine');
});
test('preprocessText: year 2001 -> two thousand and one', () => {
  assert.equal(preprocessText('since 2001'), 'since two thousand and one');
});
test('preprocessText: year 2010 -> twenty ten', () => {
  assert.equal(preprocessText('from 2010'), 'from twenty ten');
});
test('preprocessText: year 1776 -> seventeen seventy-six', () => {
  assert.equal(preprocessText('in 1776'), 'in seventeen seventy-six');
});

// Ordinals
test('preprocessText: 1st -> first', () => {
  assert.equal(preprocessText('the 1st place'), 'the first place');
});
test('preprocessText: 2nd -> second', () => {
  assert.equal(preprocessText('2nd and 3rd'), 'second and third');
});
test('preprocessText: 21st -> twenty-first', () => {
  assert.equal(preprocessText('the 21st century'), 'the twenty-first century');
});
test('preprocessText: 30th -> thirtieth', () => {
  assert.equal(preprocessText('the 30th anniversary'), 'the thirtieth anniversary');
});
test('preprocessText: 101st -> one hundred and first', () => {
  assert.equal(preprocessText('the 101st Airborne'), 'the one hundred and first Airborne');
});
test('preprocessText: 100th -> one hundredth', () => {
  assert.equal(preprocessText('the 100th time'), 'the one hundredth time');
});

// Currency
test('preprocessText: $50 -> fifty dollars', () => {
  assert.equal(preprocessText('costs $50'), 'costs fifty dollars');
});
test('preprocessText: $1 -> one dollar', () => {
  assert.equal(preprocessText('just $1'), 'just one dollar');
});
test('preprocessText: $3.50 -> three dollars and fifty cents', () => {
  assert.equal(preprocessText('fee is $3.50'), 'fee is three dollars and fifty cents');
});

// Decimals
test('preprocessText: 3.14 -> three point one four', () => {
  assert.equal(preprocessText('pi is 3.14'), 'pi is three point one four');
});
test('preprocessText: 0.5 -> zero point five', () => {
  assert.equal(preprocessText('chance of 0.5'), 'chance of zero point five');
});

// Cardinals
test('preprocessText: small cardinals', () => {
  assert.equal(preprocessText('I have 3 cats and 42 dogs'), 'I have three cats and forty-two dogs');
});
test('preprocessText: hundreds', () => {
  assert.equal(preprocessText('over 100 people'), 'over one hundred people');
});
test('preprocessText: comma-separated thousands', () => {
  assert.equal(preprocessText('about 1,500 users'), 'about fifteen hundred users');
});
