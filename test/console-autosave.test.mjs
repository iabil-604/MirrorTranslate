import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveAutosaveWrite, ensureAutosaveIndicator } from '../console-autosave.js';

test('resolveAutosaveWrite saves the committed settings when validate accepts the raw value', () => {
  const settings = { name: 'old' };
  const result = resolveAutosaveWrite(settings, '  New Name  ', {
    validate: raw => (raw.trim() ? { ok: true, value: raw.trim() } : { ok: false, message: '不能留空。' }),
    commit: (current, value) => ({ ...current, name: value }),
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.settings, { name: 'New Name' });
  assert.deepEqual(settings, { name: 'old' }, 'the settings object handed in is never mutated');
});

test('resolveAutosaveWrite reports the validator\'s message and writes nothing for an invalid value', () => {
  const settings = { name: 'old' };
  const result = resolveAutosaveWrite(settings, '   ', {
    validate: raw => (raw.trim() ? { ok: true, value: raw.trim() } : { ok: false, message: '不能留空。' }),
    commit: (current, value) => ({ ...current, name: value }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.message, '不能留空。');
  assert.equal('settings' in result, false);
});

test('resolveAutosaveWrite falls back to a generic message when the validator gives none', () => {
  const result = resolveAutosaveWrite({}, 'x', {
    validate: () => ({ ok: false }),
    commit: current => current,
  });
  assert.equal(result.ok, false);
  assert.equal(typeof result.message, 'string');
  assert.ok(result.message.length > 0);
});

test('resolveAutosaveWrite requires both a validate and a commit function', () => {
  assert.throws(() => resolveAutosaveWrite({}, 'x', { commit: s => s }));
  assert.throws(() => resolveAutosaveWrite({}, 'x', { validate: () => ({ ok: true, value: 1 }) }));
});

test('ensureAutosaveIndicator creates the DESIGN §15.4 label once and is a no-op on a second call', () => {
  // A tiny DOM stand-in: exactly the surface ensureAutosaveIndicator touches, so this test needs no
  // browser or jsdom dependency.
  const heading = {
    ownerDocument: {
      createElement: tag => ({
        tagName: tag,
        dataset: {},
        className: '',
        textContent: '',
      }),
    },
    children: [],
    querySelector(selector) {
      return this.children.find(child => selector === '[data-jy-autosave-indicator]' && 'jyAutosaveIndicator' in child.dataset) || null;
    },
    appendChild(node) {
      this.children.push(node);
      return node;
    },
  };
  const first = ensureAutosaveIndicator(heading);
  assert.ok(first);
  assert.equal(first.className, 'jy-autosave-indicator');
  assert.equal(first.textContent, '改了就存 ✓');
  assert.equal(heading.children.length, 1);
  const second = ensureAutosaveIndicator(heading);
  assert.equal(second, first, 'a header that already has the indicator is left alone');
  assert.equal(heading.children.length, 1);
});

test('ensureAutosaveIndicator is a no-op for a missing header and does not throw', () => {
  assert.equal(ensureAutosaveIndicator(null), null);
});
