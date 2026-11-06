import { randomUUID } from 'node:crypto';
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rmdir, unlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPOSITORY = /^https:\/\/github\.com\/iabil-604\/MirrorTranslate(?:\.git)?\/?$/i;

async function exists(path) {
  try { return await lstat(path); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function readJson(path) {
  return JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, ''));
}

export function enableFishPlugin(source, yaml) {
  const document = yaml.parseDocument(source);
  if (document.errors.length || !yaml.isMap(document.contents)) throw new Error('无法读取 config.yaml 的设置。');
  const entry = document.get('enableServerPlugins', true);
  if (entry?.value === true) return { source, dataRoot: document.get('dataRoot') };
  if (entry) {
    if (!yaml.isScalar(entry) || typeof entry.value !== 'boolean' || !entry.range) {
      throw new Error('请将 config.yaml 中的 enableServerPlugins 设为 true。');
    }
    const [start, end] = entry.range;
    return { source: source.slice(0, start) + 'true' + source.slice(end), dataRoot: document.get('dataRoot') };
  }
  if (document.contents.flow) throw new Error('请在 config.yaml 中添加 enableServerPlugins: true。');
  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  const documentEnd = /^(?:\.\.\.)(?=[ \t]*(?:#|\r?$))/m.exec(source)?.index ?? source.length;
  const before = source.slice(0, documentEnd);
  const separator = before.endsWith('\n') ? '' : eol;
  return {
    source: before + separator + 'enableServerPlugins: true' + eol + source.slice(documentEnd),
    dataRoot: document.get('dataRoot'),
  };
}

async function installedExtension(roots) {
  const matches = [];
  for (const root of roots) {
    if (!await exists(root)) continue;
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const directory = join(root, entry.name);
      const manifest = await readJson(join(directory, 'manifest.json')).catch(() => null);
      if (REPOSITORY.test(manifest?.homePage ?? '')) matches.push(directory);
    }
  }
  if (matches.length > 1) throw new Error('找到多份镜译，请只保留要更新的那一份后重试。');
  return matches[0];
}

async function stage(source, target, backupId) {
  const parent = dirname(target);
  await mkdir(parent, { recursive: true });
  const staging = await mkdtemp(join(parent, '.mirrortranslate-stage-'));
  const stagedTree = join(staging, 'files');
  const backup = join(dirname(parent), '.mirrortranslate-backups', backupId, basename(target));
  const current = await exists(target);
  if (current && !current.isDirectory()) throw new Error('安装位置被其他文件占用。');
  await cp(source, stagedTree, { recursive: true, errorOnExist: true, force: false });
  let backedUp = false;
  let installed = false;
  return {
    async install() {
      if (current) {
        await mkdir(dirname(backup), { recursive: true });
        await rename(target, backup);
        backedUp = true;
      }
      await rename(stagedTree, target);
      installed = true;
    },
    async undo() {
      if (installed) await rename(target, stagedTree);
      if (backedUp) await rename(backup, target);
    },
    async finish() { await rmdir(staging).catch(() => {}); },
  };
}

export async function installMirrorTranslate(tavernPath, bundlePath, { yaml, configPath, dataRoot } = {}) {
  const tavern = await realpath(tavernPath);
  const bundle = await realpath(bundlePath);
  const packagePath = join(tavern, 'package.json');
  const host = await readJson(packagePath).catch(() => null);
  if (host?.name !== 'sillytavern' || !await exists(join(tavern, 'server.js'))) throw new Error('请选择含 server.js 的 SillyTavern 目录。');
  const settings = resolve(tavern, configPath ?? 'config.yaml');
  const original = await readFile(settings, 'utf8').catch(error => {
    if (error.code === 'ENOENT') throw new Error('找不到酒馆的 config.yaml，请先启动一次酒馆。');
    throw error;
  });
  const yamlModule = yaml ?? createRequire(packagePath)('yaml');
  const updated = enableFishPlugin(original, yamlModule);
  const profiles = resolve(tavern, dataRoot ?? updated.dataRoot ?? 'data');
  const client = join(bundle, 'MirrorTranslate');
  const server = join(bundle, 'server-plugin');
  const manifest = await readJson(join(client, 'manifest.json'));
  if (!REPOSITORY.test(manifest.homePage ?? '') || !await exists(join(server, 'runtime', 'node.exe'))) {
    throw new Error('安装包不完整，请重新解压。');
  }
  const lock = join(tavern, '.mirrortranslate-install-lock');
  await mkdir(lock).catch(error => {
    if (error.code === 'EEXIST') throw new Error('这份酒馆已有安装任务。');
    throw error;
  });
  const backupId = randomUUID();
  let configStage;
  try {
    const globalExtensions = join(tavern, 'public', 'scripts', 'extensions', 'third-party');
    const users = await exists(profiles) ? await readdir(profiles, { withFileTypes: true }) : [];
    const userExtensions = users.filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
      .map(entry => join(profiles, entry.name, 'extensions'));
    const prior = await installedExtension([globalExtensions, ...userExtensions]);
    const extensionTarget = prior ?? join(globalExtensions, 'MirrorTranslate');
    if (!prior && await exists(extensionTarget)) throw new Error('MirrorTranslate 目录已存在，请检查目录里的 manifest.json。');
    const pluginTarget = join(tavern, 'plugins', 'mirrortranslate-fish');
    if (await exists(pluginTarget)) {
      const marker = await readFile(join(pluginTarget, 'index.mjs'), 'utf8').catch(() => '');
      if (!marker.includes("id: 'mirrortranslate-fish'")) throw new Error('Fish 服务端插件的安装目录被占用。');
    }
    const trees = await Promise.all([stage(client, extensionTarget, backupId), stage(server, pluginTarget, backupId)]);
    if (updated.source !== original) {
      if (await readFile(settings, 'utf8') !== original) throw new Error('酒馆配置刚被修改，请重新运行安装。');
      const backup = join(tavern, '.mirrortranslate-backups', backupId);
      await mkdir(backup, { recursive: true });
      await writeFile(join(backup, 'config.yaml'), original, { flag: 'wx' });
      configStage = join(dirname(settings), `.mirrortranslate-${backupId}.yaml`);
      await writeFile(configStage, updated.source, { flag: 'wx' });
    }
    try {
      for (const tree of trees) await tree.install();
      if (configStage) await rename(configStage, settings);
    } catch (error) {
      for (const tree of trees.toReversed()) await tree.undo();
      throw error;
    }
    await Promise.all(trees.map(tree => tree.finish()));
    return { extensionTarget, pluginTarget };
  } finally {
    if (configStage) await unlink(configStage).catch(() => {});
    await rmdir(lock).catch(() => {});
  }
}

async function main() {
  let [target, configPath, dataRoot] = process.argv.slice(2);
  if (!target) {
    const prompt = createInterface({ input: process.stdin, output: process.stdout });
    try { target = await prompt.question('请粘贴已关闭的 SillyTavern 安装目录，然后回车。\n'); }
    finally { prompt.close(); }
  }
  target = target.trim().replace(/^"(.*)"$/, '$1');
  if (!target) throw new Error('请选择 SillyTavern 安装目录。');
  const bundle = fileURLToPath(new URL('./', import.meta.url));
  await installMirrorTranslate(target, bundle, { configPath, dataRoot });
  console.log('镜译已安装。重启酒馆，打开镜译 → Fish 管理。');
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
