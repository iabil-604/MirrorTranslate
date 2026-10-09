// Sound played while it is still arriving (边收边放).
//
// A provider asked for raw 16-bit PCM sends a sentence in pieces, faster than it is spoken. Each piece is
// turned into a Web Audio buffer and started exactly where the one before it ends, so the first words are
// heard while the rest are still being made, and the next sentence follows without a gap. Pausing
// freezes the whole timeline (the context is suspended); stopping drops everything scheduled.
//
// One player serves the page; `takes` are the sentences, fed in the order they are to be heard.

export const LIVE_SAMPLE_RATE = 24000;

// Pieces shorter than this are held back and joined to the next, so a trickle of tiny chunks does not
// become a trickle of tiny buffers; the end of a take flushes whatever is left.
const MIN_BUFFER_SEC = 0.05;
// How far ahead of now a buffer is started when nothing is playing: enough for the audio thread to take it.
const LEAD_SEC = 0.04;

/**
 * 16-bit little-endian samples as floats. `carry` is the odd byte a previous piece ended on; what this
 * piece leaves over comes back as the new carry.
 */
export function pcmSamples(bytes, carry = null) {
  let data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes ?? 0);
  if (carry?.length) {
    const joined = new Uint8Array(carry.length + data.length);
    joined.set(carry);
    joined.set(data, carry.length);
    data = joined;
  }
  const whole = data.length - (data.length % 2);
  const view = new DataView(data.buffer, data.byteOffset, whole);
  const samples = new Float32Array(whole / 2);
  for (let index = 0; index < samples.length; index += 1) samples[index] = view.getInt16(index * 2, true) / 32768;
  return { samples, carry: whole < data.length ? data.slice(whole) : null };
}

/** Where the samples begin in bytes that may open with a WAV header; 0 for raw PCM. */
export function pcmDataOffset(bytes) {
  const text = at => String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
  if (!(bytes?.length >= 12) || text(0) !== 'RIFF' || text(8) !== 'WAVE') return 0;
  for (let at = 12; at + 8 <= Math.min(bytes.length, 512); at += 1) {
    if (text(at) === 'data') return at + 8;
  }
  return 0;
}

/** The sample rate a WAV header in front of the samples names; 0 when there is none to read. */
export function wavSampleRate(bytes) {
  const text = at => String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
  if (!(bytes?.length >= 28) || text(0) !== 'RIFF' || text(8) !== 'WAVE') return 0;
  for (let at = 12; at + 16 <= Math.min(bytes.length, 512); at += 1) {
    if (text(at) !== 'fmt ') continue;
    const rate = new DataView(bytes.buffer, bytes.byteOffset + at + 12, 4).getUint32(0, true);
    return rate >= 3000 && rate <= 384000 ? rate : 0;
  }
  return 0;
}

/**
 * A WAV stream (GPT-SoVITS's streaming_mode: its header, then raw 16-bit PCM) made into what one take
 * plays. The header goes on only for the first sentence of a take (`first`), which reads the sample rate
 * off it; a later sentence's header is dropped, or it would be heard as a click. Samples are scaled by
 * `gain`, and nothing is handed on until `holdSec` of sound has come or the stream has ended, so a model
 * that starts slowly does not stutter. `push` the stream's bytes as they come, `end` when it is over.
 */
export function createWavStreamFeed({ first = true, gain = 1, holdSec = 0, onBytes }) {
  let head = new Uint8Array(0);
  let started = false;
  let rate = LIVE_SAMPLE_RATE;
  let carry = null;
  let held = [];
  let heldBytes = 0;
  let released = !(holdSec > 0);
  const scale = Number.isFinite(gain) && gain > 0 ? gain : 1;
  const hand = bytes => { if (bytes.length) onBytes(bytes); };
  const release = () => {
    released = true;
    for (const bytes of held) hand(bytes);
    held = [];
    heldBytes = 0;
  };
  const samples = data => {
    let bytes = data;
    if (carry?.length) {
      const joined = new Uint8Array(carry.length + bytes.length);
      joined.set(carry);
      joined.set(bytes, carry.length);
      bytes = joined;
    }
    const whole = bytes.length - (bytes.length % 2);
    carry = whole < bytes.length ? bytes.slice(whole) : null;
    if (!whole) return;
    const out = bytes.slice(0, whole);
    if (scale !== 1) {
      const view = new DataView(out.buffer, out.byteOffset, out.length);
      for (let at = 0; at < out.length; at += 2) view.setInt16(at, Math.max(-32768, Math.min(32767, Math.round(view.getInt16(at, true) * scale))), true);
    }
    if (released) {
      hand(out);
      return;
    }
    held.push(out);
    heldBytes += out.length;
    if (heldBytes >= holdSec * rate * 2) release();
  };
  return {
    push(bytes) {
      let data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes ?? 0);
      if (!started) {
        const joined = new Uint8Array(head.length + data.length);
        joined.set(head);
        joined.set(data, head.length);
        head = joined;
        const offset = pcmDataOffset(head);
        // A header split across pieces is waited for; bytes that never turn into one are raw PCM.
        if (!offset && head.length < 512 && (head.length < 4 || String.fromCharCode(...head.subarray(0, 4)) === 'RIFF')) return;
        started = true;
        if (offset) {
          rate = wavSampleRate(head) || rate;
          if (first) hand(head.slice(0, offset));
        }
        data = head.subarray(offset);
        head = null;
      }
      samples(data);
    },
    end() {
      if (!started && head?.length) {
        started = true;
        // A stream that ended inside its header has no sound; anything else is raw PCM after all.
        if (head.length < 4 || String.fromCharCode(...head.subarray(0, 4)) !== 'RIFF') samples(head);
        head = null;
      }
      release();
    },
    get sampleRate() { return rate; },
  };
}

/**
 * The player. `createContext` makes the AudioContext the first time sound is needed (a page may not
 * have one before a tap); `sampleRate` is what the provider sends.
 */
export function createPcmPlayer({ createContext, sampleRate = LIVE_SAMPLE_RATE } = {}) {
  let context = null;
  let nextTime = 0;
  let held = false;
  const sources = new Set();
  const listeners = new Set();
  const drainWaiters = [];
  const liveTakes = new Set();
  const minSamples = Math.round(sampleRate * MIN_BUFFER_SEC);

  const tell = () => {
    const change = { busy: sources.size > 0, state: context?.state ?? 'none' };
    for (const listener of listeners) {
      try { listener(change); } catch { /* a listener's own bug is not ours */ }
    }
  };
  const ctx = () => {
    if (!context) {
      context = createContext();
      // A tap that lets the page sound, a pause, an iOS interruption: whoever listens hears it.
      context.addEventListener?.('statechange', tell);
      // Paused before there was anything to pause: the first sound waits too.
      if (held) Promise.resolve(context.suspend?.()).catch(() => {});
    }
    return context;
  };
  const settleDrained = () => {
    if (sources.size) return;
    while (drainWaiters.length) drainWaiters.shift()();
  };
  const schedule = (samples, take, rate = sampleRate) => {
    const audio = ctx();
    const buffer = audio.createBuffer(1, samples.length, rate);
    if (typeof buffer.copyToChannel === 'function') buffer.copyToChannel(samples, 0);
    else buffer.getChannelData(0).set(samples);
    const source = audio.createBufferSource();
    source.buffer = buffer;
    source.connect(audio.destination);
    const at = Math.max(nextTime, audio.currentTime + LEAD_SEC);
    source.start(at);
    nextTime = at + samples.length / rate;
    const wasIdle = sources.size === 0;
    sources.add(source);
    take.pending += 1;
    source.onended = () => {
      if (!sources.delete(source)) return;
      take.pending -= 1;
      take.check();
      if (!sources.size) tell();
      settleDrained();
    };
    if (wasIdle) tell();
    return at - audio.currentTime;
  };

  const player = {
    get sampleRate() { return sampleRate; },
    /** Whether anything is scheduled and not yet heard. */
    get busy() { return sources.size > 0; },
    /** 'running', 'suspended', 'interrupted' (iOS), 'closed', or 'none' before any sound. */
    get state() { return context?.state ?? 'none'; },
    /** Paused by the reader (as opposed to a page that has not been allowed sound yet). */
    get held() { return held; },

    /**
     * One sentence's sound, in the order sentences are to be heard. Bytes that open with a WAV header are
     * played at the rate it names (GPT-SoVITS sends 32 kHz); raw PCM at the player's own.
     */
    take() {
      let carry = null;
      let skipped = false;
      let rate = sampleRate;
      let least = minSamples;
      let waiting = new Float32Array(0);
      let ended = false;
      let settle = null;
      const done = new Promise(resolve => { settle = resolve; });
      const take = {
        pending: 0,
        samples: 0,
        done,
        check() {
          if (ended && take.pending === 0) {
            liveTakes.delete(take);
            settle(take.samples ? 'ended' : 'empty');
          }
        },
        stop() {
          liveTakes.delete(take);
          settle('stopped');
        },
      };
      liveTakes.add(take);
      const flush = () => {
        if (!waiting.length) return null;
        const lead = schedule(waiting, take, rate);
        take.samples += waiting.length;
        waiting = new Float32Array(0);
        return lead;
      };
      return Object.freeze({
        done,
        /** Raw bytes as they came; returns how many seconds from now they start, or null if held back. */
        push(bytes) {
          if (ended) return null;
          let data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes ?? 0);
          if (!skipped) {
            skipped = true;
            const offset = pcmDataOffset(data);
            if (offset) {
              rate = wavSampleRate(data) || sampleRate;
              least = Math.round(rate * MIN_BUFFER_SEC);
            }
            data = data.subarray(offset);
          }
          const read = pcmSamples(data, carry);
          carry = read.carry;
          if (!read.samples.length) return null;
          const joined = new Float32Array(waiting.length + read.samples.length);
          joined.set(waiting);
          joined.set(read.samples, waiting.length);
          waiting = joined;
          return waiting.length >= least ? flush() : null;
        },
        /** Nothing more comes for this sentence; `done` settles once it has been heard. */
        end() {
          if (ended) return null;
          const lead = flush();
          ended = true;
          take.check();
          return lead;
        },
        get samples() { return take.samples; },
      });
    },

    /** Resolves once everything scheduled has been heard (or dropped). */
    drained() {
      if (!sources.size) return Promise.resolve();
      return new Promise(resolve => drainWaiters.push(resolve));
    },

    /**
     * Sound allowed: resumes a context the page started suspended. Resolves with whether it runs within
     * `waitMs`; a page that needs a tap first answers false. Held (paused) sound is left paused.
     */
    async ensureRunning(waitMs = 500) {
      const audio = ctx();
      if (held || audio.state === 'running') return audio.state === 'running';
      const resumed = Promise.resolve(audio.resume?.()).catch(() => {});
      await Promise.race([resumed, new Promise(resolve => globalThis.setTimeout(resolve, waitMs))]);
      return audio.state === 'running';
    },

    /** A tap anywhere: a context waiting for one starts. Never undoes the reader's own pause. */
    unlock() {
      if (held) return;
      const audio = ctx();
      if (audio.state !== 'running') Promise.resolve(audio.resume?.()).catch(() => {});
    },

    /** Pause: the timeline stops where it is. */
    hold() {
      held = true;
      if (context && context.state === 'running') Promise.resolve(context.suspend?.()).catch(() => {});
    },

    /** Carry on from where it stopped. */
    release() {
      held = false;
      if (context && context.state !== 'running') return Promise.resolve(context.resume?.()).catch(() => {});
      return Promise.resolve();
    },

    /** Everything scheduled is dropped; the next take starts from now. */
    stop() {
      for (const source of [...sources]) {
        sources.delete(source);
        source.onended = null;
        try { source.stop(); } catch { /* already over */ }
        try { source.disconnect(); } catch { /* never connected */ }
      }
      for (const take of [...liveTakes]) take.stop();
      nextTime = 0;
      held = false;
      if (context && context.state !== 'running' && context.state !== 'closed') Promise.resolve(context.resume?.()).catch(() => {});
      tell();
      settleDrained();
    },

    /** Everything dropped and the context let go, for a page that is shutting the reading down. */
    close() {
      player.stop();
      const closing = context;
      context = null;
      if (closing && closing.state !== 'closed') Promise.resolve(closing.close?.()).catch(() => {});
    },

    /**
     * Hears { busy, state } whenever either changes: busy while something is scheduled and not yet heard,
     * state as the context's. Returns an unsubscribe.
     */
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return player;
}
