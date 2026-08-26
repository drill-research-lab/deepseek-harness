# @deepseek-ai/node-addon-pid-isolate-run-linux-x64

[English](README.md) | 简体中文 | [繁體中文](README.zh-tw.md)

面向 linux-x64 的静态 musl `pid-isolate-run` binary（可执行文件）。入口包把此 payload（载荷）解析为文件路径；它不含 JavaScript，也不会被导入。

npm tarball 不保留 file capability 扩展属性，因此部署必须在安装后执行 `setcap cap_sys_admin,cap_setpcap+ep`。
