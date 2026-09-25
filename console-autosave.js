// ---------------------------------------------------------------------------------------------
// Save-on-change (DESIGN.md §15.4): once a page adopts this, its fields save themselves as they
// change instead of waiting for the page's own save button — text/textarea/number fields on
// blur/change, everything else (checkbox/select/radio) on change, matching what the control
// center's existing delegated listeners (root.addEventListener('change', ...)) already fire for
// each field kind. A value that fails its own validator is never written: the settings last saved
// stay untouched and the field keeps what was typed.
//
// This file holds the pure decision (`resolveAutosaveWrite`, exercised in
// test/console-autosave.test.mjs without a browser) and the one DOM-facing piece DESIGN.md actually
// specifies — the 「改了就存 ✓」 header indicator that replaces a page's save button. A page adopts
// this from its existing delegated change/blur handler in index.js, the same place its old
// per-field save calls already live:
//
//   const result = resolveAutosaveWrite(runtime.settings, event.target.value, {
//     validate: raw => ...,                       // { ok: true, value } | { ok: false, message }
//     commit: (settings, value) => ({ ...settings, someField: value }),   // pure, unsaved
//   });
//   if (!result.ok) { toast('error', result.message); return; }          // last saved value stands
//   saveSettings(result.settings);
//
// What happens on an invalid value beyond that — a per-field inline message next to the input — is
// left to whoever wires a page over: DESIGN.md does not yet define that treatment (only the header
// indicator below), so nothing here invents one. Today every other validation error in this
// extension surfaces through toast('error', ...); a page adopting this mechanism can keep doing
// that until DESIGN.md says otherwise.
// ---------------------------------------------------------------------------------------------

/**
 * The pure half of save-on-change: given the settings last saved, a field's raw new value, and that
 * field's own validator and commit function, decides whether there is anything to save.
 *
 * `validate(raw)` returns `{ ok: true, value }` for a usable value or `{ ok: false, message }` for
 * one that is not; `commit(settings, value)` is itself pure and returns the next settings,
 * unsaved — the caller still calls its own `saveSettings`.
 */
export function resolveAutosaveWrite(settings, raw, { validate, commit }) {
  if (typeof validate !== 'function') throw new Error('resolveAutosaveWrite 需要一个 validate 函数。');
  if (typeof commit !== 'function') throw new Error('resolveAutosaveWrite 需要一个 commit 函数。');
  const result = validate(raw);
  if (!result || result.ok !== true) {
    return { ok: false, message: (result && typeof result.message === 'string' && result.message) || '这个值不对，没有保存。' };
  }
  return { ok: true, settings: commit(settings, result.value) };
}

/**
 * The 「改了就存 ✓」 label DESIGN §15.4 puts at a page header's right side once that page's save
 * button is gone (11px, `--jy-ok`; see the matching `.jy-autosave-indicator` rule in style.css).
 * Idempotent — a page header that already has one is left as it is — so a page can call this once
 * it switches a page's markup over to save-on-change without tracking whether it already ran.
 */
export function ensureAutosaveIndicator(pageHeading, ownerDocument = typeof document === 'undefined' ? null : document) {
  if (!pageHeading) return null;
  const existing = pageHeading.querySelector('[data-jy-autosave-indicator]');
  if (existing) return existing;
  const doc = ownerDocument || pageHeading.ownerDocument;
  if (!doc) return null;
  const node = doc.createElement('span');
  node.dataset.jyAutosaveIndicator = '';
  node.className = 'jy-autosave-indicator';
  node.textContent = '改了就存 ✓';
  pageHeading.appendChild(node);
  return node;
}
