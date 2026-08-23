/**
 * tap-worklet.js — hand the microphone to the main thread, gap-free.
 *
 * This file exists for one reason: `AnalyserNode` answers "what does the
 * spectrum look like right now", and asking it from `requestAnimationFrame`
 * means the answer is spaced by the compositor's whim. Measured on real
 * recordings, that alone moved the strike count by 9–19% on identical audio.
 *
 * A worklet is handed *every* render quantum on the audio thread, in order,
 * with nothing skipped. All this processor does is gather those quanta into
 * blocks of the size the detector wants and post them across. The analysis
 * stays on the main thread, where it can be read, tested and changed without
 * a build step; what moves here is only the part that has to be reliable.
 *
 * The port carries audio one way and nothing comes back. Detection is not
 * done here on purpose: posting a small block 100 times a second is cheap,
 * and an audio thread that misses its deadline produces glitches in every
 * other sound on the device.
 */

class StrikeTap extends AudioWorkletProcessor {
  constructor(options) {
    super();
    // The detector's hop, in samples. Anything sensible works — the detector
    // reframes what it gets — but matching the hop keeps the post rate down
    // to one message per analysis window.
    const block = options?.processorOptions?.block ?? 128;
    this.block = Math.max(128, block | 0);
    this.buf = new Float32Array(this.block);
    this.fill = 0;
  }

  process(inputs) {
    const ch = inputs[0]?.[0];
    // No input yet, or the track ended. Staying alive costs nothing and
    // means the node keeps working if the stream comes back.
    if (!ch) return true;

    for (let i = 0; i < ch.length; i++) {
      this.buf[this.fill++] = ch[i];
      if (this.fill === this.block) {
        // Transferred, not copied: the main thread takes ownership of the
        // buffer and this side allocates a fresh one.
        this.port.postMessage(this.buf.buffer, [this.buf.buffer]);
        this.buf = new Float32Array(this.block);
        this.fill = 0;
      }
    }
    return true;
  }
}

registerProcessor('strike-tap', StrikeTap);
