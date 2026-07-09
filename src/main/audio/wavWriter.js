const fs = require('fs');

// Writes a complete mono 16-bit PCM WAV file from an Int16Array in one shot.
// Chunks are short (a few seconds), so buffering the whole thing in memory
// before writing is simpler than a streaming writer with header seek-back.
function writeWavFile(filePath, int16Samples, sampleRate) {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = int16Samples.length * 2;

  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16); // fmt chunk size
  buffer.writeUInt16LE(1, 20); // PCM format
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < int16Samples.length; i++) {
    buffer.writeInt16LE(int16Samples[i], 44 + i * 2);
  }

  return fs.promises.writeFile(filePath, buffer);
}

module.exports = { writeWavFile };
