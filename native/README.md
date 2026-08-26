# native/

English | [简体中文](README.zh.md) | [繁體中文](README.zh-tw.md)

Native source and public packages maintained with DeepSeek Harness. [`landlock-run/`](landlock-run/README.md) owns filesystem confinement, while [`pid-isolate-run/`](pid-isolate-run/README.md) owns Linux PID/mount namespace setup and capability removal.

## Workspace and release boundary

Both native package families belong to the repository's root pnpm workspace and lockfile. Harness consumers use their current workspace entry packages during development and CI, so launcher protocol changes and consumer updates are tested together.

Dedicated workflows build and test each family on every supported architecture. Their release workflows assemble native artifacts, verify npm tarballs, and optionally publish one synchronized version per family. Entry packages declare platform packages as optional dependencies, so npm installs only the package matching the operating system and CPU. The PID helper additionally requires a post-install `setcap cap_sys_admin,cap_setpcap+ep` deployment step because npm does not preserve file capabilities.
