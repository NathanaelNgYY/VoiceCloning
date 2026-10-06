import { createStreamingResampler } from './micResampler.js';

export const MIC_TARGET_SAMPLE_RATE = 24000;

// Collects resampled audio into fixed-size frames so callers see a steady
// cadence regardless of the browser's render quantum or processor size.
export function createFrameCollector(frameSize, onFrame) {
  let frame = new Float32Array(frameSize);
  let fill = 0;
  return (samples) => {
    for (let i = 0; i < samples.length; i += 1) {
      frame[fill] = samples[i];
      fill += 1;
      if (fill === frameSize) {
        onFrame(frame);
        frame = new Float32Array(frameSize);
        fill = 0;
      }
    }
  };
}

// The worklet runs on the audio rendering thread, so React renders, base64
// encoding and clip decoding on the main thread can no longer drop mic audio
// (ScriptProcessor ran on the main thread and glitched under load).
function workletSource() {
  return `
const createStreamingResampler = ${createStreamingResampler.toString()};
const createFrameCollector = ${createFrameCollector.toString()};
class VcsMicCapture extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const { targetRate, frameSize } = options.processorOptions;
    this.resample = createStreamingResampler(sampleRate, targetRate);
    this.collect = createFrameCollector(frameSize, (frame) => this.port.postMessage(frame, [frame.buffer]));
  }
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel && channel.length) this.collect(this.resample(channel));
    return true;
  }
}
registerProcessor('vcs-mic-capture', VcsMicCapture);
`;
}

/**
 * Starts mic capture and calls onFrame(Float32Array) with `frameSize` samples
 * of 24 kHz mono audio each. Returns { audioContext, stop }.
 */
export async function startMicFrames(stream, { frameSize, onFrame, AudioContextCtor }) {
  const audioContext = new AudioContextCtor();
  // Created after an awaited getUserMedia, which can leave it suspended on
  // Safari/iOS; resuming here keeps capture from silently producing nothing.
  audioContext.resume?.().catch(() => {});
  const source = audioContext.createMediaStreamSource(stream);
  let node = null;
  let moduleUrl = '';

  if (audioContext.audioWorklet && typeof AudioWorkletNode !== 'undefined') {
    try {
      moduleUrl = URL.createObjectURL(new Blob([workletSource()], { type: 'application/javascript' }));
      await audioContext.audioWorklet.addModule(moduleUrl);
      node = new AudioWorkletNode(audioContext, 'vcs-mic-capture', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        processorOptions: { targetRate: MIC_TARGET_SAMPLE_RATE, frameSize },
      });
      node.port.onmessage = (event) => onFrame(event.data);
    } catch {
      node = null;
    }
  }

  if (!node) {
    const resample = createStreamingResampler(audioContext.sampleRate, MIC_TARGET_SAMPLE_RATE);
    const collect = createFrameCollector(frameSize, onFrame);
    node = audioContext.createScriptProcessor(2048, 1, 1);
    node.onaudioprocess = (event) => {
      event.outputBuffer.getChannelData(0).fill(0);
      collect(resample(event.inputBuffer.getChannelData(0)));
    };
  }

  source.connect(node);
  // Output is silent; the connection keeps the node pulled by the graph.
  node.connect(audioContext.destination);

  return {
    audioContext,
    stop() {
      if (node.port) node.port.onmessage = null;
      if ('onaudioprocess' in node) node.onaudioprocess = null;
      try { node.disconnect(); } catch { /* ignore */ }
      try { source.disconnect(); } catch { /* ignore */ }
      audioContext.close().catch(() => {});
      if (moduleUrl) URL.revokeObjectURL(moduleUrl);
    },
  };
}
