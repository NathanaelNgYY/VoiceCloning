import assert from 'node:assert/strict';
import test from 'node:test';

import { buildFilteredTrainingManifest } from './trainingQuality.js';

function line(file, text) {
  return `/clips/${file}|speaker|EN|${text}`;
}

function quality(overrides = {}) {
  return { eligible: true, score: 80, duration_s: 4, rejection_reasons: [], ...overrides };
}

test('training quality gate removes acoustic failures, bad transcripts, and duplicate slices', () => {
  const lines = [
    line('a.wav', 'This is the strongest clean sentence.'),
    line('b.wav', 'This is the strongest clean sentence.'),
    line('c.wav', 'Another clean sentence remains in training.'),
    line('d.wav', 'A third useful sentence remains available.'),
    line('e.wav', 'A fourth useful sentence remains available.'),
    line('f.wav', 'A fifth useful sentence remains available.'),
    line('g.wav', 'noise'),
  ];
  const scoreEntries = {
    'a.wav': quality({ score: 92 }),
    'b.wav': quality({ score: 70 }),
    'c.wav': quality(),
    'd.wav': quality(),
    'e.wav': quality(),
    'f.wav': quality(),
    'g.wav': quality({ eligible: false, rejection_reasons: ['snr_below_10db'] }),
  };

  const result = buildFilteredTrainingManifest({
    manifestText: lines.join('\n'),
    scoreEntries,
    minClips: 5,
    minDurationSeconds: 20,
  });

  assert.match(result.manifestText, /a\.wav/u);
  assert.doesNotMatch(result.manifestText, /b\.wav/u);
  assert.doesNotMatch(result.manifestText, /g\.wav/u);
  assert.equal(result.report.keptClips, 5);
  assert.deepEqual(
    result.report.rejected.find((row) => row.filename === 'b.wav')?.reasons,
    ['duplicate_transcript'],
  );
});
test('training quality gate fails instead of silently training on too little clean speech', () => {
  assert.throws(
    () => buildFilteredTrainingManifest({
      manifestText: [line('a.wav', 'One clean sentence here.'), line('b.wav', 'Another one here.')].join('\n'),
      scoreEntries: { 'a.wav': quality(), 'b.wav': quality() },
    }),
    /kept only 2\/2 clips/u,
  );
});
