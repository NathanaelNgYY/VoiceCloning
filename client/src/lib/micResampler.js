// Streaming windowed-sinc resampler for live mic capture. Converts any input
// rate to the 24 kHz OpenAI expects with a real anti-aliasing low-pass, and
// keeps filter state across chunks so block boundaries are seamless. The old
// box average aliased badly at 44.1 kHz (uneven 1-or-2 sample bins), which
// smeared consonants and hurt transcription.
//
// Self-contained on purpose: the mic AudioWorklet embeds this function's
// source text, so it must not reference anything outside its own body.
export function createStreamingResampler(inputRate, outputRate, taps = 32) {
  if (inputRate === outputRate) return (chunk) => Float32Array.from(chunk);
  const ratio = inputRate / outputRate;
  // Fraction of the input Nyquist to keep: just under the output Nyquist.
  const cutoff = Math.min(1, outputRate / inputRate) * 0.92;
  const half = taps / 2;
  let history = new Float32Array(0);
  let position = half;
  return function resample(chunk) {
    const buffer = new Float32Array(history.length + chunk.length);
    buffer.set(history);
    buffer.set(chunk, history.length);
    const out = new Float32Array(Math.max(0, Math.ceil((buffer.length - half - position) / ratio) + 1));
    let count = 0;
    while (position + half < buffer.length) {
      const center = Math.floor(position);
      const frac = position - center;
      let sum = 0;
      let norm = 0;
      for (let k = 1 - half; k <= half; k += 1) {
        const x = k - frac;
        const window = 0.5 * (1 + Math.cos((Math.PI * x) / half));
        const sinc = x === 0 ? cutoff : Math.sin(Math.PI * cutoff * x) / (Math.PI * x);
        const weight = sinc * window;
        sum += buffer[center + k] * weight;
        norm += weight;
      }
      out[count] = norm ? sum / norm : 0;
      count += 1;
      position += ratio;
    }
    const keepFrom = Math.max(0, Math.floor(position) - half);
    history = buffer.slice(keepFrom);
    position -= keepFrom;
    return out.slice(0, count);
  };
}
