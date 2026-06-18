import test from 'node:test';
import assert from 'node:assert/strict';
import { concatWavBlobs } from './wavConcat.js';

function makePcm16Wav(samples, sampleRate = 8000) {
  const dataSize = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  let offset = 0;
  const writeString = (value) => {
    for (let i = 0; i < value.length; i += 1) {
      view.setUint8(offset + i, value.charCodeAt(i));
    }
    offset += value.length;
  };

  writeString('RIFF');
  view.setUint32(offset, 36 + dataSize, true); offset += 4;
  writeString('WAVE');
  writeString('fmt ');
  view.setUint32(offset, 16, true); offset += 4;
  view.setUint16(offset, 1, true); offset += 2;
  view.setUint16(offset, 1, true); offset += 2;
  view.setUint32(offset, sampleRate, true); offset += 4;
  view.setUint32(offset, sampleRate * 2, true); offset += 4;
  view.setUint16(offset, 2, true); offset += 2;
  view.setUint16(offset, 16, true); offset += 2;
  writeString('data');
  view.setUint32(offset, dataSize, true); offset += 4;
  for (const sample of samples) {
    view.setInt16(offset, sample, true);
    offset += 2;
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

test('concatWavBlobs joins matching WAV blobs and inserts silence', async () => {
  const first = makePcm16Wav([1000, 2000]);
  const second = makePcm16Wav([3000, 4000]);
  const joined = await concatWavBlobs([first, second], { pauseMs: 100 });
  const output = new Uint8Array(await joined.arrayBuffer());
  const view = new DataView(output.buffer);

  assert.equal(joined.type, 'audio/wav');
  assert.equal(String.fromCharCode(...output.slice(0, 4)), 'RIFF');
  assert.equal(String.fromCharCode(...output.slice(8, 12)), 'WAVE');
  assert.equal(view.getUint32(40, true), (2 + 800 + 2) * 2);
});
