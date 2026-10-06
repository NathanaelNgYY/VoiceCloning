import test from 'node:test';
import assert from 'node:assert/strict';
import { createStreamingResampler } from './micResampler.js';

const sine = (rate, hz, seconds) => Float32Array.from({ length: Math.round(rate * seconds) }, (_, i) => Math.sin((2 * Math.PI * hz * i) / rate));
const rms = (data) => Math.sqrt(data.reduce((sum, value) => sum + value * value, 0) / data.length);
const middle = (data) => data.subarray(Math.floor(data.length * 0.1), Math.floor(data.length * 0.9));

for (const inputRate of [48000, 44100]) {
  test(`resampler keeps speech-band tone and length at ${inputRate} Hz`, () => {
    const out = createStreamingResampler(inputRate, 24000)(sine(inputRate, 1000, 1));
    assert.ok(Math.abs(out.length - 24000) < 40, `length ${out.length}`);
    assert.ok(Math.abs(rms(middle(out)) - Math.SQRT1_2) < 0.02, `rms ${rms(middle(out))}`);
  });

  test(`resampler suppresses content above the 12 kHz output Nyquist at ${inputRate} Hz`, () => {
    // A 16 kHz tone would alias to 8 kHz with a naive average.
    const out = createStreamingResampler(inputRate, 24000)(sine(inputRate, 16000, 1));
    assert.ok(rms(middle(out)) < 0.05, `alias rms ${rms(middle(out))}`);
  });
}

test('resampler output is identical whether audio arrives whole or in uneven chunks', () => {
  const input = sine(44100, 440, 0.5);
  const whole = createStreamingResampler(44100, 24000)(input);
  const chunked = createStreamingResampler(44100, 24000);
  const parts = [];
  for (let offset = 0, size = 128; offset < input.length; offset += size, size = size === 128 ? 4096 : 128) {
    parts.push(...chunked(input.subarray(offset, offset + size)));
  }
  assert.equal(parts.length, whole.length);
  for (let i = 0; i < whole.length; i += 1) assert.ok(Math.abs(parts[i] - whole[i]) < 1e-6, `sample ${i}`);
});

test('resampler passes 24 kHz input through unchanged', () => {
  const input = sine(24000, 300, 0.1);
  assert.deepEqual(createStreamingResampler(24000, 24000)(input), input);
});
