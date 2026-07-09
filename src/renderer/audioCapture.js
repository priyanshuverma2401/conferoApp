// Renderer-side audio capture: getUserMedia/getDisplayMedia only exist in a
// browser context, so this logic can't live in the Node-side main process.
// Captures system audio (loopback) and mic as two separate labeled streams,
// downsamples both to 16kHz mono PCM16 via an AudioWorklet, and forwards
// pause-delimited utterances to main over IPC for WAV-file writing.

const TARGET_SAMPLE_RATE = 16000;

const captureState = {
  system: null,
  mic: null,
};

function concatInt16(chunks) {
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const out = new Int16Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

async function startPipeline(source, mediaStream, vadConfig) {
  const audioCtx = new AudioContext();
  await audioCtx.audioWorklet.addModule('worklets/pcmProcessorWorklet.js');

  const sourceNode = audioCtx.createMediaStreamSource(mediaStream);
  const workletNode = new AudioWorkletNode(audioCtx, 'pcm-downsample-processor', {
    processorOptions: { targetSampleRate: TARGET_SAMPLE_RATE },
  });

  // The worklet only fires reliably while connected through to a destination —
  // route through a silent gain so we don't create audio feedback by playing
  // captured system audio back out through the speakers.
  const silentGain = audioCtx.createGain();
  silentGain.gain.value = 0;

  const segmenter = new window.UtteranceSegmenter({
    ...vadConfig,
    onFlush: (frames, sampleRate) => {
      const merged = concatInt16(frames);
      window.stealthAPI.sendPcmChunk(source, merged.buffer, sampleRate);
    },
  });

  workletNode.port.onmessage = (event) => {
    if (event.data.type !== 'frame') return;
    segmenter.onFrame(new Int16Array(event.data.pcm), event.data.rms, event.data.sampleRate);
  };

  sourceNode.connect(workletNode);
  workletNode.connect(silentGain);
  silentGain.connect(audioCtx.destination);

  return { audioCtx, sourceNode, workletNode, mediaStream, segmenter };
}

function stopPipeline(state) {
  if (!state) return;
  state.segmenter.flushRemaining();
  state.workletNode.port.onmessage = null;
  state.workletNode.disconnect();
  state.sourceNode.disconnect();
  state.mediaStream.getTracks().forEach((t) => t.stop());
  state.audioCtx.close();
}

async function startSystemAudioCapture(vadConfig) {
  await window.stealthAPI.enableLoopbackAudio();
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
  await window.stealthAPI.disableLoopbackAudio();

  stream.getVideoTracks().forEach((track) => {
    track.stop();
    stream.removeTrack(track);
  });

  captureState.system = await startPipeline('system', stream, vadConfig);
}

async function startMicCapture(vadConfig) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  captureState.mic = await startPipeline('mic', stream, vadConfig);
}

async function startAudioCapture() {
  const cfg = await window.stealthAPI.getConfig();
  const vadConfig = {
    silenceRmsThreshold: cfg.silenceRmsThreshold,
    trailingSilenceMs: cfg.trailingSilenceMs,
    maxUtteranceMs: cfg.maxUtteranceMs,
    minUtteranceMs: cfg.minUtteranceMs,
  };
  await startSystemAudioCapture(vadConfig);
  await startMicCapture(vadConfig);
}

function stopAudioCapture() {
  stopPipeline(captureState.system);
  stopPipeline(captureState.mic);
  captureState.system = null;
  captureState.mic = null;
}

window.audioCapture = { startAudioCapture, stopAudioCapture };
