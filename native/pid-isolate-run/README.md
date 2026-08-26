# pid-isolate-run

English | [简体中文](README.zh.md) | [繁體中文](README.zh-tw.md)

`pid-isolate-run` creates private PID and mount namespaces, mounts a private procfs, removes its setup capabilities, verifies that removal, and then executes one command. It is distributed as static Linux binaries plus a JavaScript entry package that resolves and probes the matching binary.

## Deployment

Builds require Linux and `musl-gcc`:

```sh
pnpm build:ts
pnpm build:native
```

The deployed binary must receive exactly the two setup capabilities:

```sh
setcap cap_sys_admin,cap_setpcap+ep /absolute/path/to/pid-isolate-run
```

npm tarballs do not preserve Linux `security.capability` extended attributes. The deployment step must apply `setcap` after installation and repeat it after copying, stripping, replacing, or re-signing the binary. `--probe` fails closed unless namespace setup, private procfs mounting, capability removal, and self-verification all succeed.

## Use

```ts
import { launcherPath, probe } from '@deepseek-ai/node-addon-pid-isolate-run';

const launcher = launcherPath();
if (probe(launcher)) {
  const argv = [launcher, '--', 'bash', '-c', command];
}
```

The CLI is `pid-isolate-run [--bind <src> <dst>] [--chdir <path>] -- <argv>...`; the absolute bind destination must already exist. The bind and directory change occur only in the new private mount namespace before setup capabilities are removed. `pid-isolate-run --probe` performs the full setup without executing a caller command. Launcher failures exit `125` and do not execute the command.

## Packages and support

- `@deepseek-ai/node-addon-pid-isolate-run`: JavaScript resolver and functional probe, plus the auditable C source.
- `@deepseek-ai/node-addon-pid-isolate-run-linux-x64`: static linux-x64 binary.
- `@deepseek-ai/node-addon-pid-isolate-run-linux-arm64`: static linux-arm64 binary.

Linux x64 and arm64 are supported. The host must permit file capabilities, PID and mount namespace creation, and procfs mounting. See [the architecture](docs/architecture.md), [CLI contract](docs/cli-contract.md), [support matrix](docs/support-matrix.md), and [release procedure](docs/release.md).
