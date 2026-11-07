import test from 'node:test';
import assert from 'node:assert/strict';
import { __testing } from '../index.js';

function fixture(t, { native = true, failClick = false } = {}) {
  const keys = ['document', '__TAURITAVERN__', '__TAURITAVERN_MAIN_READY__', 'location'];
  const before = keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  t.after(() => {
    for (const [key, descriptor] of before) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  delete globalThis.__TAURITAVERN__;
  delete globalThis.__TAURITAVERN_MAIN_READY__;
  if (native) globalThis.__TAURITAVERN__ = {};
  globalThis.location = new URL('http://127.0.0.1/');
  const downloads = [];
  let mounted = null;
  globalThis.document = {
    body: { appendChild(node) { mounted = node; } },
    createElement(tag) {
      assert.equal(tag, 'a');
      return {
        style: {},
        click() {
          assert.equal(mounted, this, 'the native document bridge must be able to see the link');
          if (failClick) throw new Error('native click failed');
          downloads.push({ href: this.href, download: this.download });
        },
        remove() { assert.equal(mounted, this); mounted = null; },
      };
    },
  };
  return { downloads, mounted: () => mounted };
}

function clickEvent() {
  return { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
}

test('TT audio save relays the same file to the native document bridge exactly once', t => {
  const state = fixture(t);
  const event = clickEvent();
  const anchor = { href: 'blob:audio-fixture', download: '镜译-整楼.wav' };
  assert.equal(__testing.relayTtsDownload(event, anchor), true);
  assert.equal(event.defaultPrevented, true, 'do not also start the WebView blob download');
  assert.deepEqual(state.downloads, [anchor]);
  assert.equal(state.mounted(), null);
  assert.equal(__testing.relayTtsDownload(event, anchor), false);
  assert.equal(state.downloads.length, 1);
});

test('audio relay respects the existing user patch and leaves browser and non-blob links alone', t => {
  const state = fixture(t, { native: false });
  const anchor = { href: 'blob:audio-fixture', download: 'audio.wav' };
  const browserEvent = clickEvent();
  assert.equal(__testing.relayTtsDownload(browserEvent, anchor), false);
  assert.equal(browserEvent.defaultPrevented, false);
  globalThis.__TAURITAVERN__ = {};
  const alreadyHandled = clickEvent();
  alreadyHandled.preventDefault();
  assert.equal(__testing.relayTtsDownload(alreadyHandled, anchor), false);
  const remoteEvent = clickEvent();
  assert.equal(__testing.relayTtsDownload(remoteEvent, { ...anchor, href: 'https://example.invalid/audio.wav' }), false);
  assert.equal(remoteEvent.defaultPrevented, false);
  assert.deepEqual(state.downloads, []);
});

test('a failed native audio relay removes its temporary link', t => {
  const state = fixture(t, { failClick: true });
  assert.throws(() => __testing.relayTtsDownload(clickEvent(), { href: 'blob:audio-fixture', download: 'audio.wav' }), /native click failed/);
  assert.equal(state.mounted(), null);
  assert.deepEqual(state.downloads, []);
});
