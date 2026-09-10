# @deepseek-ai/dsh-library-api

[English](README.md) | 简体中文 | [繁體中文](README.zh-tw.md)

面向浏览器的 library 网关（`ctx.library`）：`library` Remote 命名空间（客户端的 `ctx.remote.library.*`）把 librarian 服务投影成纯 JSON 线上契约 — 知识库 CRUD、资源列举与删除、粘贴文字入库、Markdown 预览载荷、有据 `ask`、以及知识库的持久 `askLog` 历史 — 加上仅接受 JSON 的 `/api` 网关载不动的 `/library` 二进制数据通道：`POST /library/upload?notebook=&name=&kind=` 接收一个 raw 请求体（由 `maxUploadBytes` 限字节），`GET /library/<resourceId>/raw` 行内流式传输保存的原始文件（PDF／文本预览的 `iframe` 来源），`GET /library/<resourceId>/download` 以附件流式传输。挂载鉴权服务时，每个数据通道请求都经 `ctx.auth` 重新鉴权；路由只在组合了 `webServer` 时注册。

## 模型体验

本包不注册工具、提示词区段或会话事件；它只面向浏览器。模型经 `@deepseek-ai/dsh-tool-library` 触及同一个 librarian 能力。

#### KV 缓存影响

无：这里没有任何内容进入模型请求，各步骤间提示词前缀字节不变。

## 已知限制与推迟工作

- 上传在入库前完整缓冲于内存（镜像 `/api` 桥接）；流式写入暂存文件推迟。
- 服务的文件不支持 `Range`；Chromium 的 PDF 查看器不需要分段抓取也能工作。
- 数据通道只信任同源 cookie；不重查 `/api` 的浏览器信任围栏，与它镜像的 writing PDF 路由一致。
- 线上视图没有分页；资源极多的知识库会返回一次完整列表。
