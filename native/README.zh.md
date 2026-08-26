# native/

[English](README.md) | 简体中文

与 DeepSeek Harness 一同维护的原生源码和公开包。[`landlock-run/`](landlock-run/README.md) 负责文件系统围堵，[`pid-isolate-run/`](pid-isolate-run/README.md) 负责 Linux PID/mount namespace 初始化与 capability（能力）移除。

## Workspace 与发布边界

两个原生包家族都属于仓库根 pnpm workspace，并共用根锁文件。开发和 CI 中的 harness 消费方直接使用当前 workspace 的入口包，因此 launcher 协议变更与消费方更新会一起测试。

专用工作流会在每个受支持架构上构建并测试各包家族。发布工作流汇集原生产物、验证 npm tarball，并可选择为每个家族发布一个同步版本。入口包把平台包声明为 npm 可选依赖，因此 npm 只安装与操作系统和 CPU 匹配的包。PID helper 还需要在安装后执行 `setcap cap_sys_admin,cap_setpcap+ep`，因为 npm 不保留 file capabilities。
