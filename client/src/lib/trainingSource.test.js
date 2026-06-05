import test from 'node:test';
import assert from 'node:assert/strict';

import {
  describeTrainingSelection,
  getTrainingLibraryOverflowHint,
  getTrainingLibraryScrollAreaClass,
  resolveTrainingSource,
} from './trainingSource.js';

test('resolveTrainingSource prefers shared library when library ids are selected', () => {
  assert.equal(resolveTrainingSource({
    directFiles: [{ name: 'voice.wav' }],
    selectedLibraryIds: ['lib-1'],
  }), 'library');
});

test('resolveTrainingSource falls back to direct when only direct files exist', () => {
  assert.equal(resolveTrainingSource({
    directFiles: [{ name: 'voice.wav' }],
    selectedLibraryIds: [],
  }), 'direct');
});

test('resolveTrainingSource returns none when no files are queued', () => {
  assert.equal(resolveTrainingSource({
    directFiles: [],
    selectedLibraryIds: [],
  }), 'none');
});

test('describeTrainingSelection reports shared clip counts for library mode', () => {
  assert.equal(describeTrainingSelection({
    directFiles: [{ name: 'voice.wav' }],
    selectedLibraryIds: ['lib-1', 'lib-2'],
  }), '2 shared clips selected');
});

test('describeTrainingSelection reports direct clip counts when direct files are queued', () => {
  assert.equal(describeTrainingSelection({
    directFiles: [{ name: 'voice.wav' }],
    selectedLibraryIds: [],
  }), '1 direct clip queued');
});

test('describeTrainingSelection reports the empty state when nothing is selected', () => {
  assert.equal(describeTrainingSelection({
    directFiles: [],
    selectedLibraryIds: [],
  }), 'No clips');
});

test('getTrainingLibraryOverflowHint stays empty when the list fits without scrolling', () => {
  assert.equal(getTrainingLibraryOverflowHint(2), '');
});

test('getTrainingLibraryOverflowHint prompts the user to scroll when many shared files exist', () => {
  assert.equal(getTrainingLibraryOverflowHint(5), 'Scroll to browse all 5 shared files.');
});

test('getTrainingLibraryScrollAreaClass keeps small lists naturally sized', () => {
  assert.equal(getTrainingLibraryScrollAreaClass(2), 'max-h-[280px]');
});

test('getTrainingLibraryScrollAreaClass switches overflowing lists to a fixed scroll height', () => {
  assert.equal(getTrainingLibraryScrollAreaClass(5), 'h-[280px]');
});
