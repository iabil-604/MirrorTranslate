import test from 'node:test';
import assert from 'node:assert/strict';

import { createPcmPlayer, pcmDataOffset, pcmSamples } from '../pcm-player.js';
import { fishLivePayload } from '../tts.js';

// A stand-in for an AudioContext: a clock the test moves by hand, sources that end when it passes them.
function fakeContext({ state = 'running' } = {}) {
  const started = [];
  const listeners = new Set();
  const context = {
    state,
    currentTime: 0,
    destination: {},
    createBuffer: (channels, length, rate) => {
      const data = new Float32Array(length);
      return { length, sampleRate: rate, duration: length / rate, getChannelData: () => data, copyToChannel: samples => data.set(samples) };
    },
    createBufferSource: () => {
      const source = { buffer: null, onended: null, stopped: false, connect() {}, disconnect() {}, start(at) { source.at = at; started.push(source); }, stop() { source.stopped = true; } };
      return source;
    },
    addEventListener: (type, listener) => { if (type === 'statechange') listeners.add(listener); },
    resume: async () => { context.state = 'running'; for (const listener of listeners) listener(); },
    suspend: async () => { context.state = 'suspended'; for (const listener of listeners) listener(); },
    // Moves the clock; every source whose sound is over by then ends, in order.
    advance(seconds) {
      context.currentTime += seconds;
      for (const source of started.filter(item => !item.over && !item.stopped && item.at + item.buffer.duration <= context.currentTime + 1e-9)) {
        source.over = true;
        source.onended?.();
      }
    },
    started,
  };
  return context;
}

const pcm = (...values) => {
  const bytes = new Uint8Array(values.length * 2);
  const view = new DataView(bytes.buffer);
  values.forEach((value, index) => view.setInt16(index * 2, value, true));
  return bytes;
};
const silence = samples => new Uint8Array(samples * 2);

test('16-bit samples become floats, and an odd byte waits for the next piece', () => {
  const whole = pcm(0, 16384, -32768, 32767);
  const first = pcmSamples(whole.subarray(0, 3));
  assert.deepEqual([...first.samples], [0]);
  assert.equal(first.carry.length, 1, 'half a sample is carried');
  const second = pcmSamples(whole.subarray(3), first.carry);
  assert.deepEqual([...second.samples], [0.5, -1, 32767 / 32768]);
  assert.equal(second.carry, null);
});

test('a WAV header in front of the samples is stepped over; raw PCM starts at once', () => {
  const header = new Uint8Array(44);
  header.set([...'RIFF'].map(c => c.charCodeAt(0)), 0);
  header.set([...'WAVE'].map(c => c.charCodeAt(0)), 8);
  header.set([...'data'].map(c => c.charCodeAt(0)), 36);
  assert.equal(pcmDataOffset(header), 44);
  assert.equal(pcmDataOffset(pcm(1, 2, 3, 4, 5, 6)), 0);
});

test('chunks are played end to end, and the next sentence starts where the last one ends', async () => {
  const context = fakeContext();
  const player = createPcmPlayer({ createContext: () => context, sampleRate: 1000 });
  const first = player.take();
  assert.equal(first.push(silence(20)), null, 'too little to be worth a buffer yet');
  const lead = first.push(silence(40));
  assert.ok(lead > 0 && lead < 0.1, 'the first sound starts almost at once');
  first.push(silence(100));
  first.end();
  const second = player.take();
  second.push(silence(100));
  second.end();
  const [a, b, c] = context.started;
  assert.equal(a.buffer.length, 60, 'held-back samples are joined to the next piece');
  assert.equal(b.at, a.at + 0.06, 'no gap inside a sentence');
  assert.equal(c.at, b.at + 0.1, 'no gap between sentences');
  assert.equal(player.busy, true);
  let drained = false;
  const waiting = player.drained().then(() => { drained = true; });
  context.advance(0.2);
  assert.equal(await first.done, 'ended');
  context.advance(0.2);
  await waiting;
  assert.equal(drained, true);
  assert.equal(await second.done, 'ended');
  assert.equal(player.busy, false);
});

test('a player that fell behind starts the next chunk from now, not in the past', () => {
  const context = fakeContext();
  const player = createPcmPlayer({ createContext: () => context, sampleRate: 1000 });
  const take = player.take();
  take.push(silence(100));
  context.advance(1);
  take.push(silence(100));
  assert.ok(context.started[1].at >= context.currentTime, 'late audio is not scheduled into the past');
});

test('stop drops everything scheduled; pause and resume move the whole timeline', async () => {
  const context = fakeContext();
  const player = createPcmPlayer({ createContext: () => context, sampleRate: 1000 });
  const changes = [];
  player.onChange(change => changes.push(change));
  const take = player.take();
  take.push(silence(100));
  player.hold();
  await Promise.resolve();
  assert.equal(context.state, 'suspended');
  assert.equal(player.held, true);
  player.unlock();
  assert.equal(context.state, 'suspended', 'a stray tap never undoes the reader\'s own pause');
  await player.release();
  assert.equal(context.state, 'running');
  player.stop();
  assert.equal(context.started[0].stopped, true);
  assert.equal(await take.done, 'stopped');
  assert.equal(player.busy, false);
  assert.deepEqual(changes.map(change => change.busy), [true, true, true, false], 'busy, then the pause and resume, then stopped');
});

test('a pause asked for before the first sound holds that sound too', async () => {
  const context = fakeContext();
  const player = createPcmPlayer({ createContext: () => context, sampleRate: 1000 });
  player.hold();
  player.take().push(silence(100));
  await Promise.resolve();
  assert.equal(context.state, 'suspended');
  assert.equal(await player.ensureRunning(10), false, 'and asking for sound does not undo the pause');
});

test('a page that has not been tapped yet says so, and a tap lets it sound', async () => {
  const context = fakeContext({ state: 'suspended' });
  context.resume = async () => {}; // a browser that wants a tap first: resume does nothing yet
  const player = createPcmPlayer({ createContext: () => context, sampleRate: 1000 });
  assert.equal(await player.ensureRunning(20), false);
  context.resume = async () => { context.state = 'running'; };
  player.unlock();
  await Promise.resolve();
  assert.equal(player.state, 'running');
});

test('a Fish body asked for as it is made: raw PCM at the rate asked for, and a latency that streams', () => {
  const body = { text: '喂？', format: 'mp3', mp3_bitrate: 128, latency: 'normal', reference_id: 'v1' };
  assert.deepEqual(fishLivePayload(body, 24000), { text: '喂？', format: 'pcm', sample_rate: 24000, latency: 'balanced', reference_id: 'v1' });
  assert.equal(fishLivePayload({ ...body, latency: 'low' }).latency, 'low', 'a faster choice of the reader\'s is kept');
  assert.equal(body.format, 'mp3', 'the body handed in is left as it was');
});
