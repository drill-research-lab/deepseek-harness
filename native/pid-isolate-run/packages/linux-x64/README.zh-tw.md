# @deepseek-ai/node-addon-pid-isolate-run-linux-x64

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

面向 linux-x64 的靜態 musl `pid-isolate-run` binary（二進位執行檔）。入口包把此 payload（載荷）解析為檔案路徑；它不含 JavaScript，也不會被匯入。

npm tarball 不保留 file capability 延伸屬性，因此部署必須在安裝後執行 `setcap cap_sys_admin,cap_setpcap+ep`。
