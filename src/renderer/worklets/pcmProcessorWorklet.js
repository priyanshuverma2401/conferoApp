// Runs on the dedicated real-time audio thread (AudioWorkletGlobalScope), not the
// renderer's main thread. This is the fix for UI/mouse lag on Start: the previous
// ScriptProcessorNode ran its downsampling/conversion work on the main thread,
// competing with DOM/input handling. No DOM, no Node, no contextBridge access here
// by spec — only plain JS + Web Audio globals (`sampleRate`, `registerProcessor`).

// Ported verbatim from the old renderer-side downsampleBuffer/floatTo16BitPCM —
// pure math, no browser-API dependency, so it moves unchanged.
function downsampleBuffer(buffer, inputSampleRate, outputSampleRate) {
  if (outputSampleRate === inputSampleRate) return buffer;
  const ratio = inputSampleRate / outputSampleRate;
  const newLength = Math.round(buffer.length / ratio);
  const result = new Float32Array(newLength);
  let offsetResult = 0;
  let offsetBuffer = 0;
  while (offsetResult < result.length) {
    const nextOffsetBuffer = Math.round((offsetResult + 1) * ratio);
    let accum = 0;
    let count = 0;
    for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i++) {
      accum += buffer[i];
      count++;
    }
    result[offsetResult] = count > 0 ? accum / count : 0;
    offsetResult++;
    offsetBuffer = nextOffsetBuffer;
  }
  return result;
}

function floatTo16BitPCM(float32Array) {
  const out = new Int16Array(float32Array.length);
  for (let i = 0; i < float32Array.length; i++) {
    const s = Math.max(-1, Math.min(1, float32Array[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

class PcmDownsampleProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const opts = options.processorOptions || {};
    this.targetSampleRate = opts.targetSampleRate || 16000;
    // Same batch size as the old ScriptProcessorNode (4096 @ native rate, ~85ms at
    // 48kHz) so downsample quality is identical to what was already verified working.
    this.RAW_BATCH_SIZE = 4096;
    this.rawBuffer = new Float32Array(this.RAW_BATCH_SIZE);
    this.writeIndex = 0;
  }

  process(inputs) {
    const channelData = inputs[0] && inputs[0][0];
    if (!channelData || channelData.length === 0) return true;

    let readIndex = 0;
    while (readIndex < channelData.length) {
      const spaceLeft = this.RAW_BATCH_SIZE - this.writeIndex;
      const toCopy = Math.min(spaceLeft, channelData.length - readIndex);
      this.rawBuffer.set(channelData.subarray(readIndex, readIndex + toCopy), this.writeIndex);
      this.writeIndex += toCopy;
      readIndex += toCopy;

      if (this.writeIndex >= this.RAW_BATCH_SIZE) {
        this.flush();
      }
    }

    return true; // keep the processor alive
  }

  flush() {
    const downsampled = downsampleBuffer(this.rawBuffer, sampleRate, this.targetSampleRate);
    const int16 = floatTo16BitPCM(downsampled);

    let sumSquares = 0;
    for (let i = 0; i < int16.length; i++) sumSquares += int16[i] * int16[i];
    const rms = int16.length > 0 ? Math.sqrt(sumSquares / int16.length) : 0;

    this.port.postMessage(
      { type: 'frame', pcm: int16.buffer, sampleRate: this.targetSampleRate, rms },
      [int16.buffer]
    );

    this.writeIndex = 0;
  }
}

registerProcessor('pcm-downsample-processor', PcmDownsampleProcessor);
