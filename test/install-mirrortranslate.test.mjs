import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { installMirrorTranslate } from '../scripts/install-mirrortranslate.mjs';

test('the source installer installs the extension and Fish together using the host Node layout', async t => {
  const temp = await realpath(tmpdir());
  const host = await realpath(await mkdtemp(join(temp, 'mirrortranslate-install-')));
  assert.equal(dirname(host), temp);
  t.after(() => rm(host, { recursive: true, force: true }));
  await mkdir(join(host, 'data'));
  await writeFile(join(host, 'package.json'), '{"name":"sillytavern"}');
  await writeFile(join(host, 'server.js'), '');
  await writeFile(join(host, 'config.yaml'), 'enableServerPlugins: true\n');
  const yaml = {
    parseDocument: () => ({ errors: [], get: key => key === 'enableServerPlugins' ? { value: true } : undefined }),
    isMap: () => true,
  };

  const source = fileURLToPath(new URL('../', import.meta.url));
  const { extensionTarget, pluginTarget } = await installMirrorTranslate(host, source, { yaml });
  assert.equal(pluginTarget, join(host, 'plugins', 'mirrortranslate-fish'));
  assert.equal(await readFile(join(extensionTarget, 'manifest.json'), 'utf8'), await readFile(join(source, 'manifest.json'), 'utf8'));
  assert.match(await readFile(join(pluginTarget, 'index.mjs'), 'utf8'), /id: 'mirrortranslate-fish'/);
  await access(join(pluginTarget, 'child.mjs'));
  for (const name of ['.git', 'test', 'server-plugin']) {
    await assert.rejects(access(join(extensionTarget, name)), { code: 'ENOENT' });
  }
  await assert.rejects(access(join(pluginTarget, 'runtime', 'node.exe')), { code: 'ENOENT' });
});
