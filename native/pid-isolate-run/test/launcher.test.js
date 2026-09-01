/**
 * Real-kernel tests for the namespace launcher. Privileged assertions require
 * the release and fault-injection binaries to carry
 * cap_sys_admin,cap_setpcap+ep; CI and local orchestration install those file
 * capabilities before running this file.
 */

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import {
  LAUNCHER_FAILURE_EXIT,
  launcherPath,
  probe,
} from '@deepseek-ai/node-addon-pid-isolate-run';

const FATAL_PREFIX = 'pid-isolate-run: ';
const CAP_SETPCAP = 8n;
const CAP_SYS_ADMIN = 21n;
const REQUIRED_MASK = (1n << CAP_SETPCAP) | (1n << CAP_SYS_ADMIN);
const requireIsolation = process.env.NPIR_REQUIRE_PID_ISOLATION === '1';

if (process.platform !== 'linux') {
  console.log(`launcher.test: SKIP — pid-isolate-run supports Linux only (host: ${process.platform})`);
  process.exit(0);
}

const launcher = launcherPath();
const capbsetReadFail = path.join(import.meta.dirname, '.bin', 'pid-isolate-run-capbset-read-fail');
const dropNoop = path.join(import.meta.dirname, '.bin', 'pid-isolate-run-drop-noop');
assert.ok(fs.existsSync(launcher), `launcher.test: missing ${launcher}; run pnpm build:native`);

const run = (binary, args, options = {}) => spawnSync(binary, args, { encoding: 'utf8', ...options });

for (const args of [
  [],
  ['--bogus'],
  ['--'],
  ['--probe', '--'],
  ['--bind', '/source'],
  ['--bind', 'relative', '/destination', '--', 'true'],
  ['--chdir', 'relative', '--', 'true'],
  ['--mask', 'relative', '--', 'true'],
]) {
  const result = run(launcher, args);
  assert.equal(result.status, LAUNCHER_FAILURE_EXIT);
  assert.ok(result.stderr.startsWith(FATAL_PREFIX));
  assert.match(result.stderr, /usage error/);
}

const usable = probe(launcher, { timeoutMs: 5_000 });
console.log(`launcher.test: probe → ${usable ? 'usable' : 'unusable'}`);
if (!usable) {
  if (requireIsolation) {
    console.error('launcher.test: NPIR_REQUIRE_PID_ISOLATION=1 but the functional probe failed');
    process.exit(1);
  }
  console.log('launcher.test: SKIP privileged assertions — launcher lacks usable file capabilities or namespace support');
  process.exit(0);
}

{
  const result = run(launcher, ['--probe']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'pid-isolate: ok\n');
}

{
  const result = run(launcher, ['--', '/bin/sh', '-c', 'printf command-ok']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'command-ok');
  assert.equal(run(launcher, ['--', '/bin/sh', '-c', 'exit 7']).status, 7);
}

{
  const result = run(launcher, [
    '--bind', '/proc', '/path-that-must-not-exist/destination',
    '--', '/bin/true',
  ]);
  assert.equal(result.status, LAUNCHER_FAILURE_EXIT);
  assert.match(result.stderr, /^pid-isolate-run: bind mount failed:/u);
}

{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'npir-bind-'));
  const source = path.join(dir, 'source');
  const destination = path.join(dir, 'destination');
  fs.mkdirSync(source);
  fs.mkdirSync(destination);
  fs.writeFileSync(path.join(source, 'identity'), 'alice');
  const result = run(launcher, [
    '--bind', source, destination,
    '--chdir', destination,
    '--', '/bin/sh', '-c', 'printf "cwd=%s identity=%s" "$PWD" "$(cat identity)"',
  ]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, `cwd=${destination} identity=alice`);
  assert.deepEqual(fs.readdirSync(destination), [], 'bind mount must remain private to the child namespace');
  fs.rmSync(dir, { recursive: true, force: true });
}

{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'npir-mask-'));
  const source = path.join(dir, 'source');
  const destination = path.join(dir, 'destination');
  const masked = path.join(dir, 'owner-roots');
  fs.mkdirSync(source);
  fs.mkdirSync(destination);
  fs.mkdirSync(masked);
  fs.writeFileSync(path.join(source, 'identity'), 'alice');
  fs.writeFileSync(path.join(masked, 'hash'), 'must-not-be-visible');
  const result = run(launcher, [
    '--bind', source, destination,
    '--mask', masked,
    '--chdir', destination,
    '--', '/bin/sh', '-c', `test "$(cat identity)" = alice && test ! -e ${masked}/hash`,
  ]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(path.join(masked, 'hash'), 'utf8'), 'must-not-be-visible');
  fs.rmSync(dir, { recursive: true, force: true });
}

function capabilityLines(status) {
  const fields = new Map(status.split('\n').flatMap(line => {
    const match = /^(Cap(?:Eff|Prm|Inh|Bnd)):\s*([0-9a-fA-F]+)$/.exec(line);
    return match === null ? [] : [[match[1], match[2]]];
  }));
  for (const name of ['CapEff', 'CapPrm', 'CapInh', 'CapBnd']) assert.ok(fields.has(name), `missing ${name}`);
  return fields;
}

function assertCapabilitiesDropped(status, subject) {
  const fields = capabilityLines(status);
  for (const name of ['CapEff', 'CapPrm', 'CapInh', 'CapBnd']) {
    const value = BigInt(`0x${fields.get(name)}`);
    assert.equal(value & REQUIRED_MASK, 0n, `${subject} ${name} retains CAP_SETPCAP or CAP_SYS_ADMIN`);
  }
  return fields;
}

async function waitForChildPid(parentPid) {
  const childrenFile = `/proc/${parentPid}/task/${parentPid}/children`;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const children = fs.readFileSync(childrenFile, 'utf8').trim().split(/\s+/u).filter(Boolean);
    if (children[0] !== undefined) return Number(children[0]);
    await delay(10);
  }
  throw new Error(`launcher.test: no child appeared under host PID ${parentPid}`);
}

{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'npir-capability-'));
  const release = path.join(dir, 'release');
  const child = spawn(launcher, ['--', '/bin/sh', '-c', `while [ ! -e ${release} ]; do sleep 0.02; done`], {
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  assert.ok(child.pid !== undefined);
  const isolatedHostPid = await waitForChildPid(child.pid);
  const parentStatus = fs.readFileSync(`/proc/${child.pid}/status`, 'utf8');
  const childStatus = fs.readFileSync(`/proc/${isolatedHostPid}/status`, 'utf8');
  const parentCaps = assertCapabilitiesDropped(parentStatus, 'launcher parent');
  const childCaps = assertCapabilitiesDropped(childStatus, 'isolated child');
  console.log(
    `launcher.test: /proc/${isolatedHostPid}/status → `
    + `CapEff=${childCaps.get('CapEff')} CapPrm=${childCaps.get('CapPrm')} `
    + `CapInh=${childCaps.get('CapInh')} CapBnd=${childCaps.get('CapBnd')}`,
  );
  console.log(
    `launcher.test: /proc/${child.pid}/status → `
    + `CapEff=${parentCaps.get('CapEff')} CapPrm=${parentCaps.get('CapPrm')} `
    + `CapInh=${parentCaps.get('CapInh')} CapBnd=${parentCaps.get('CapBnd')}`,
  );
  fs.writeFileSync(release, 'release');
  const [code] = await new Promise(resolve => child.once('exit', (...args) => resolve(args)));
  assert.equal(code, 0);
  fs.rmSync(dir, { recursive: true, force: true });
}

{
  const hostProcess = spawn('/bin/sleep', ['30'], { stdio: 'ignore' });
  assert.ok(hostProcess.pid !== undefined);
  try {
    const script = [
      `test ! -e /proc/${hostProcess.pid}/status`,
      `kill -0 ${hostProcess.pid} >/dev/null 2>&1; test $? -ne 0`,
      'set -- /proc/[0-9]*',
      'printf "visible-pids=%s\\n" "$#"',
    ].join('; ');
    const isolated = run(launcher, ['--', '/bin/sh', '-c', script]);
    assert.equal(isolated.status, 0, isolated.stderr);
    assert.match(isolated.stdout, /^visible-pids=[12]\n$/u);

    const signalAttempt = run(launcher, [
      '--', '/bin/sh', '-c',
      `kill -TERM ${hostProcess.pid} >/dev/null 2>&1; printf 'kill-status=%s' $?`,
    ]);
    assert.equal(signalAttempt.status, 0, signalAttempt.stderr);
    assert.notEqual(signalAttempt.stdout, 'kill-status=0');
    assert.equal(hostProcess.exitCode, null, 'host process must survive a signal attempt from the PID namespace');
  } finally {
    hostProcess.kill('SIGKILL');
    await new Promise(resolve => hostProcess.once('exit', resolve));
  }
}

assert.ok(fs.existsSync(dropNoop), `launcher.test: missing ${dropNoop}; run pnpm build:test-drop-noop`);
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'npir-drop-noop-'));
  const marker = path.join(dir, 'must-not-exist');
  const result = run(dropNoop, ['--', '/bin/sh', '-c', `printf escaped > ${marker}`]);
  assert.equal(result.status, LAUNCHER_FAILURE_EXIT);
  assert.match(result.stderr, /pid-isolate-run: capability drop verification failed/);
  assert.match(result.stderr, /CAP_SYS_ADMIN/);
  assert.match(result.stderr, /CAP_SETPCAP/);
  assert.equal(fs.existsSync(marker), false, 'DROP_NOOP verification failure must abort before exec');
  fs.rmSync(dir, { recursive: true, force: true });
}

assert.ok(
  fs.existsSync(capbsetReadFail),
  `launcher.test: missing ${capbsetReadFail}; run pnpm build:test-capbset-read-fail`,
);
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'npir-capbset-read-fail-'));
  const marker = path.join(dir, 'must-not-exist');
  const result = run(capbsetReadFail, ['--', '/bin/sh', '-c', `printf escaped > ${marker}`]);
  assert.equal(result.status, LAUNCHER_FAILURE_EXIT);
  assert.match(result.stderr, /PR_CAPBSET_READ failed for CAP_SYS_ADMIN/);
  assert.match(result.stderr, /PR_CAPBSET_READ failed for CAP_SETPCAP/);
  assert.doesNotMatch(result.stderr, /remaining/u);
  assert.equal(fs.existsSync(marker), false, 'bounding-set read failure must abort before exec');
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('launcher.test: ok');
