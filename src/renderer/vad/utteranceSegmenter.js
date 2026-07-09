// Pause-based (VAD-style) utterance segmentation. Replaces fixed-time chunking,
// which was cutting sentences mid-word — this waits for an actual pause before
// treating speech as complete, and tolerates brief mid-sentence breaths instead
// of splitting on them.
//
// States: IDLE -> SPEAKING -> TRAILING_SILENCE -> (back to SPEAKING, or -> IDLE).
// Driven by energy (RMS) readings arriving on each frame from the audio worklet.
class UtteranceSegmenter {
  constructor({
    onFlush,
    silenceRmsThreshold,
    trailingSilenceMs,
    maxUtteranceMs,
    minUtteranceMs,
    preRollFrameCount = 3,
  }) {
    this.onFlush = onFlush;
    this.silenceRmsThreshold = silenceRmsThreshold;
    this.trailingSilenceMs = trailingSilenceMs;
    this.maxUtteranceMs = maxUtteranceMs;
    this.minUtteranceMs = minUtteranceMs;
    this.preRollFrameCount = preRollFrameCount;

    this.state = 'IDLE';
    this.buffer = [];
    this.ringBuffer = [];
    this.utteranceStartTime = null;
    this.silenceStartTime = null;
    this.sampleRate = null;
  }

  // frame: Int16Array of already-downsampled PCM samples for this render batch.
  onFrame(frame, rms, sampleRate) {
    this.sampleRate = sampleRate;
    const now = Date.now();
    const isSpeech = rms >= this.silenceRmsThreshold;

    if (this.state === 'IDLE') {
      if (isSpeech) {
        // Seed the new utterance with the pre-roll so the onset syllable isn't clipped.
        this.state = 'SPEAKING';
        this.utteranceStartTime = now;
        this.buffer = [...this.ringBuffer, frame];
        this.ringBuffer = [];
      } else {
        this.ringBuffer.push(frame);
        if (this.ringBuffer.length > this.preRollFrameCount) this.ringBuffer.shift();
      }
      return;
    }

    // SPEAKING or TRAILING_SILENCE: keep accumulating regardless (don't clip word endings).
    this.buffer.push(frame);

    if (isSpeech) {
      this.state = 'SPEAKING';
      this.silenceStartTime = null;
    } else if (this.state === 'SPEAKING') {
      this.state = 'TRAILING_SILENCE';
      this.silenceStartTime = now;
    } else if (now - this.silenceStartTime >= this.trailingSilenceMs) {
      this._flushAndReset(now, false);
      return;
    }

    if (now - this.utteranceStartTime >= this.maxUtteranceMs) {
      this._flushAndReset(now, true);
    }
  }

  _flushAndReset(now, forced) {
    const durationMs = now - this.utteranceStartTime;
    const toFlush = this.buffer;
    this.buffer = [];

    if (durationMs >= this.minUtteranceMs && toFlush.length > 0) {
      this.onFlush(toFlush, this.sampleRate);
    }

    if (forced) {
      // Continuous talker past the safety cap — keep capturing as a new
      // utterance immediately rather than dropping to IDLE, so no audio is
      // lost waiting to re-cross the energy threshold.
      this.state = 'SPEAKING';
      this.utteranceStartTime = now;
      this.silenceStartTime = null;
    } else {
      this.state = 'IDLE';
      this.utteranceStartTime = null;
      this.silenceStartTime = null;
      this.ringBuffer = [];
    }
  }

  // Call when capture stops, to flush whatever was in progress.
  flushRemaining() {
    if (this.buffer.length === 0) return;
    const now = Date.now();
    const durationMs = this.utteranceStartTime ? now - this.utteranceStartTime : 0;
    if (durationMs >= this.minUtteranceMs) {
      this.onFlush(this.buffer, this.sampleRate);
    }
    this.buffer = [];
  }
}

window.UtteranceSegmenter = UtteranceSegmenter;
