# @deepseek-ai/node-addon-pid-isolate-run-linux-x64

English | [简体中文](README.zh.md) | [繁體中文](README.zh-tw.md)

Static musl `pid-isolate-run` binary for linux-x64. The entry package resolves this payload as a file path; it contains no JavaScript and is never imported.

Deployment must apply `setcap cap_sys_admin,cap_setpcap+ep` after npm installation because tarballs do not preserve file capability extended attributes.
