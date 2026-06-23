function readAscii(view, offset, length) {
  let value = '';
  for (let i = 0; i < length; i += 1) {
    value += String.fromCharCode(view.getUint8(offset + i));
  }
  return value;
}

function writeAscii(view, offset, value) {
  for (let i = 0; i < value.length; i += 1) {
    view.setUint8(offset + i, value.charCodeAt(i));
  }
}

function parseWav(arrayBuffer) {
  const view = new DataView(arrayBuffer);
  if (arrayBuffer.byteLength < 44 || readAscii(view, 0, 4) !== 'RIFF' || readAscii(view, 8, 4) !== 'WAVE') {
    throw new Error('Expected a RIFF/WAVE audio buffer');
  }

  let offset = 12;
  let fmt = null;
  let data = null;
  while (offset + 8 <= arrayBuffer.byteLength) {
    const id = readAscii(view, offset, 4);
    const size = view.getUint32(offset + 4, true);
    const start = offset + 8;
    const end = start + size;
    if (end > arrayBuffer.byteLength) break;
    if (id === 'fmt ') fmt = arrayBuffer.slice(start, end);
    if (id === 'data') data = arrayBuffer.slice(start, end);
    offset = end + (size % 2);
  }

  if (!fmt || !data) throw new Error('WAV file is missing fmt or data chunk');
  const fmtView = new DataView(fmt);
  return {
    audioFormat: fmtView.getUint16(0, true),
    numChannels: fmtView.getUint16(2, true),
    sampleRate: fmtView.getUint32(4, true),
    byteRate: fmtView.getUint32(8, true),
    blockAlign: fmtView.getUint16(12, true),
    bitsPerSample: fmtView.getUint16(14, true),
    fmt,
    data,
  };
}

function createSilence(durationMs, wav) {
  const frames = Math.max(0, Math.round((durationMs / 1000) * wav.sampleRate));
  return new Uint8Array(frames * wav.blockAlign);
}

function sameFormat(a, b) {
  return a.audioFormat === b.audioFormat &&
    a.numChannels === b.numChannels &&
    a.sampleRate === b.sampleRate &&
    a.blockAlign === b.blockAlign &&
    a.bitsPerSample === b.bitsPerSample;
}

function buildWav(fmt, dataParts) {
  const dataLength = dataParts.reduce((sum, part) => sum + part.byteLength, 0);
  const totalLength = 12 + 8 + fmt.byteLength + 8 + dataLength;
  const output = new ArrayBuffer(totalLength);
  const view = new DataView(output);
  let offset = 0;

  writeAscii(view, offset, 'RIFF'); offset += 4;
  view.setUint32(offset, totalLength - 8, true); offset += 4;
  writeAscii(view, offset, 'WAVE'); offset += 4;
  writeAscii(view, offset, 'fmt '); offset += 4;
  view.setUint32(offset, fmt.byteLength, true); offset += 4;
  new Uint8Array(output, offset, fmt.byteLength).set(new Uint8Array(fmt)); offset += fmt.byteLength;
  writeAscii(view, offset, 'data'); offset += 4;
  view.setUint32(offset, dataLength, true); offset += 4;

  const outputBytes = new Uint8Array(output);
  for (const part of dataParts) {
    outputBytes.set(new Uint8Array(part), offset);
    offset += part.byteLength;
  }

  return output;
}

export async function concatWavBlobs(blobs, { pauseMs = 120 } = {}) {
  if (!Array.isArray(blobs) || blobs.length === 0) {
    throw new Error('No WAV blobs to concatenate');
  }
  if (blobs.length === 1) return blobs[0];

  const parsed = await Promise.all(blobs.map(async (blob) => parseWav(await blob.arrayBuffer())));
  const first = parsed[0];
  for (const wav of parsed.slice(1)) {
    if (!sameFormat(first, wav)) {
      throw new Error('Cannot concatenate WAV clips with mismatched audio formats');
    }
  }

  const dataParts = [];
  parsed.forEach((wav, index) => {
    dataParts.push(wav.data);
    if (index < parsed.length - 1 && pauseMs > 0) {
      dataParts.push(createSilence(pauseMs, first).buffer);
    }
  });

  return new Blob([buildWav(first.fmt, dataParts)], { type: 'audio/wav' });
}
