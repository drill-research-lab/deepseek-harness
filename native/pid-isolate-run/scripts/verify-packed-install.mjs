#!/usr/bin/env node
/**
 * Verify release tarballs in a throwaway plain-Node consumer: complete
 * package coverage, concrete dependency versions, executable platform
 * payload, byte identity with the workspace build, entry resolution, and
 * the documented fail-closed state before an operator installs file
 * capabilities. npm tarballs cannot preserve Linux security.capability
 * xattrs, so deployment applies them after installation.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { entryDirs, packageDirs, platformDirs, readJson, root } from './repo.mjs';

const args = process.argv.slice(2);
const currentPlatformOnly = args.includes('--current-platform-only');
const tarballDir = path.resolve(args.find(argument => !argument.startsWith('--')) || path.join(root, 'dist', 'npm'));
const entryPackageName = '@deepseek-ai/node-addon-pid-isolate-run';

function tarballName(manifest) {
  return `${manifest.name.slice(1).replace('/', '-')}-${manifest.version}.tgz`;
}

function tarballPath(manifest) {
  const file = path.join(tarballDir, tarballName(manifest));
  if (!fs.existsSync(file)) throw new Error(`missing packed tarball: ${file}`);
  return file;
}

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: options.cwd || root,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function capture(command, commandArgs) {
  const result = spawnSync(command, commandArgs, { cwd: root, encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.stderr.write(result.stderr);
    process.exit(result.status ?? 1);
  }
  return result.stdout;
}

function packedManifest(manifest) {
  return JSON.parse(capture('tar', ['-xOf', tarballPath(manifest), 'package/package.json']));
}

function verifyManifest(manifest) {
  for (const script of ['preinstall', 'install', 'postinstall', 'prepare']) {
    if (manifest.scripts?.[script]) throw new Error(`${manifest.name}: unexpected ${script} lifecycle script`);
  }
  for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
    for (const [name, version] of Object.entries(manifest[field] ?? {})) {
      if (version.includes('workspace:')) throw new Error(`${manifest.name}: unresolved ${field} ${name}@${version}`);
    }
  }
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

const manifests = packageDirs().map(dir => ({ dir, manifest: readJson(path.join(root, dir, 'package.json')) }));
const entry = manifests.find(item => item.manifest.name === entryPackageName);
if (!entry) throw new Error(`missing ${entryPackageName}`);
const hostPlatform = `${process.platform}-${process.arch}`;
const platform = manifests.find(item => platformDirs().includes(item.dir) && item.manifest.name === `${entryPackageName}-${hostPlatform}`);
const expected = currentPlatformOnly
  ? manifests.filter(item => entryDirs().includes(item.dir) || item.dir === platform?.dir)
  : manifests;
for (const item of expected) {
  tarballPath(item.manifest);
  verifyManifest(packedManifest(item.manifest));
}

const optionalNames = Object.keys(packedManifest(entry.manifest).optionalDependencies ?? {}).sort();
const platformNames = manifests.filter(item => platformDirs().includes(item.dir)).map(item => item.manifest.name).sort();
if (optionalNames.join('\n') !== platformNames.join('\n')) throw new Error('entry optionalDependencies do not match platform packages');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'npir-packed-install-'));
fs.writeFileSync(path.join(tempRoot, 'package.json'), `${JSON.stringify({ name: 'npir-packed-check', private: true, type: 'module' }, null, 2)}\n`);

function install(item) {
  const extract = fs.mkdtempSync(path.join(tempRoot, 'extract-'));
  run('tar', ['-xzf', tarballPath(item.manifest), '-C', extract]);
  const destination = path.join(tempRoot, 'node_modules', ...item.manifest.name.split('/'));
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.renameSync(path.join(extract, 'package'), destination);
  fs.rmSync(extract, { recursive: true, force: true });
  return destination;
}

install(entry);
if (platform) {
  const installed = install(platform);
  const prebuilds = readJson(path.join(root, platform.dir, 'prebuilds.json'));
  for (const binary of prebuilds.binaries) {
    const source = path.join(root, platform.dir, binary.path);
    const packed = path.join(installed, binary.path);
    if (sha256(source) !== sha256(packed)) throw new Error(`${binary.path}: packed bytes differ from workspace build`);
    fs.accessSync(packed, fs.constants.X_OK);
  }
} else if (process.platform === 'linux') {
  throw new Error(`Linux host has no platform package for ${hostPlatform}`);
}

const driver = path.join(tempRoot, 'driver.mjs');
fs.writeFileSync(driver, `
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { launcherPath, probe } from '@deepseek-ai/node-addon-pid-isolate-run';

const resolved = launcherPath();
assert.ok(path.isAbsolute(resolved));
if (process.platform === 'linux') {
  assert.ok(fs.existsSync(resolved));
  fs.accessSync(resolved, fs.constants.X_OK);
  assert.equal(probe(resolved), false, 'packed binary must fail closed until deployment installs file capabilities');
  console.log('installed launcher resolves and fails closed before setcap');
} else {
  assert.equal(fs.existsSync(resolved), false);
  assert.equal(probe(resolved), false);
  console.log('unsupported platform fallback verified');
}
`);
run(process.execPath, [driver], { cwd: tempRoot });

console.log('Packed install verification passed.');
