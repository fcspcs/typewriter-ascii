/**
 * wav.mjs — read a WAV file into a mono Float32Array.
 *
 * Exists so the listening lab can feed real recordings to the real
 * `StrikeDetector` in Node, where there is no Web Audio API to decode for
 * us. Only WAV is handled, deliberately: it is what every recorder can
 * produce, it is lossless, and decoding anything compressed would mean
 * shipping a codec. A phone that recorded m4a can be converted once with
 * ffmpeg (`ffmpeg -i in.m4a -ar 48000 out.wav`) and the conversion is not
 * this file's problem.
 *
 * Handles what recorders actually emit: PCM 16/24/32-bit integer, IEEE
 * float 32, mono or multi-channel (averaged down — the detector wants one
 * signal, and a phone's two microphones heard the same typewriter),
 * and the EXTENSIBLE header that Windows recorders like to write.
 */

import { readFileSync } from 'node:fs';

/**
 * @param {string} path
 * @returns {{ samples: Float32Array, sampleRate: number, seconds: number }}
 */
export function readWav(path) {
  const buf = readFileSync(path);
  if (buf.length < 12 || buf.toString('ascii', 0, 4) !== 'RIFF'
    || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error(`${path}: not a WAV file (is it m4a/mp3? convert with ffmpeg)`);
  }

  // Walk the chunks rather than assuming fmt starts at byte 12 — recorders
  // put LIST/INFO chunks wherever they like.
  let fmt = null;
  let data = null;
  for (let at = 12; at + 8 <= buf.length;) {
    const id = buf.toString('ascii', at, at + 4);
    const size = buf.readUInt32LE(at + 4);
    const body = at + 8;
    if (id === 'fmt ') fmt = { at: body, size };
    if (id === 'data') data = { at: body, size: Math.min(size, buf.length - body) };
    // Chunks are word-aligned; an odd size is padded with one byte.
    at = body + size + (size & 1);
  }
  if (!fmt || !data) throw new Error(`${path}: missing ${fmt ? 'data' : 'fmt'} chunk`);

  let format = buf.readUInt16LE(fmt.at);
  const channels = buf.readUInt16LE(fmt.at + 2);
  const sampleRate = buf.readUInt32LE(fmt.at + 4);
  const bits = buf.readUInt16LE(fmt.at + 14);
  if (format === 0xfffe) {
    // WAVE_FORMAT_EXTENSIBLE: the real format is the first two bytes of the
    // sub-format GUID, 24 bytes into the fmt chunk.
    format = buf.readUInt16LE(fmt.at + 24);
  }

  const bytesPer = bits / 8;
  const frames = Math.floor(data.size / (bytesPer * channels));
  const samples = new Float32Array(frames);

  const read = (() => {
    if (format === 3 && bits === 32) return (o) => buf.readFloatLE(o);
    if (format === 1 && bits === 16) return (o) => buf.readInt16LE(o) / 32768;
    if (format === 1 && bits === 32) return (o) => buf.readInt32LE(o) / 2147483648;
    if (format === 1 && bits === 24) {
      return (o) => {
        const v = buf[o] | (buf[o + 1] << 8) | (buf[o + 2] << 16);
        return (v > 0x7fffff ? v - 0x1000000 : v) / 8388608;
      };
    }
    if (format === 1 && bits === 8) return (o) => (buf[o] - 128) / 128;
    throw new Error(`${path}: unsupported format ${format} at ${bits} bit`);
  })();

  for (let i = 0; i < frames; i++) {
    const base = data.at + i * bytesPer * channels;
    let v = 0;
    for (let c = 0; c < channels; c++) v += read(base + c * bytesPer);
    samples[i] = v / channels;
  }

  return { samples, sampleRate, seconds: frames / sampleRate };
}
