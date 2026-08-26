/** Keyless JavaScript entry-package tests; no native binary is required. */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  LAUNCHER_BIN,
  LAUNCHER_FAILURE_EXIT,
  launcherPath,
  probe,
} from '@deepseek-ai/node-addon-pid-isolate-run';

assert.equal(LAUNCHER_BIN, 'pid-isolate-run');
assert.equal(LAUNCHER_FAILURE_EXIT, 125);

const platformPackage = `@deepseek-ai/node-addon-pid-isolate-run-${process.platform}-${process.arch}`;
const resolved = launcherPath((specifier) => {
  assert.equal(specifier, `${platformPackage}/package.json`);
  return path.join('/fake-install', specifier);
});
assert.equal(resolved, path.join('/fake-install', platformPackage, 'bin', LAUNCHER_BIN));

const fallback = launcherPath(() => {
  throw new Error('not installed');
});
assert.ok(path.isAbsolute(fallback));
assert.ok(fallback.includes(path.join('node_modules', ...platformPackage.split('/'), 'bin', LAUNCHER_BIN)));
assert.ok(path.isAbsolute(launcherPath()));

assert.equal(probe(path.join(os.tmpdir(), 'npir-no-such-launcher')), false);

if (process.platform !== 'win32') {
  const fakeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'npir-entry-test-'));
  const fake = (name, script) => {
    const file = path.join(fakeDir, name);
    fs.writeFileSync(file, `#!/bin/sh\n${script}\n`, { mode: 0o755 });
    return file;
  };

  assert.equal(probe(fake('usable', 'printf "pid-isolate: ok\\n"; exit 0')), true);
  assert.equal(probe(fake('wrong-report', 'echo wrong; exit 0')), false);
  assert.equal(probe(fake('failing', `exit ${LAUNCHER_FAILURE_EXIT}`)), false);
  assert.equal(probe(fake('hanging', 'sleep 10'), { timeoutMs: 200 }), false);
  fs.rmSync(fakeDir, { recursive: true, force: true });
}

console.log('entry.test: ok');
