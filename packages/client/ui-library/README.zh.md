# @deepseek-ai/dsh-client-ui-library

[English](README.md) | 简体中文 | [繁體中文](README.zh-tw.md)

Library 界面的浏览器半边：一个 `sidebar.section` 条目在会话浏览器下方列出知识库（rail 状态渲染一个书本图标），以及一个 `shell.overlay` 条目承载整页 Library 视图，版面按 NotebookLM 的知识库页 — 带新增来源入口（上传文件、粘贴文字、拖放）的来源栏、作为主区的持久有据问答串、以及可收起、有独立 **Markdown** 与**原始文件（PDF／raw）**模式的预览面板。Markdown 经共用的 `MarkdownText` 原语渲染；知识库改名／新建／删除与来源删除用 `Modal` 对话框；回答引用是可点的 pill，点了在预览面板打开被引用的文件。

显示中的知识库与打开的预览资源住在共享页面状态里，它同时是页面的地址：插件把它镜像进 `#library/<notebookId>[/resource/<resourceId>]` URL hash（启动与 `hashchange` 时应用、以 `history.replaceState` 改写），所以文件与问答串能从页面外链接进来。问答串是持久的 — 它渲染知识库在主机端的问答记录，包括 agent 从聊天中问的（有标记），重新加载与切换知识库都不会消失。每个持久事实都经 `ctx.remote.library`（JSON）或 `/library` 数据通道（上传 `POST`、预览／下载 `GET`，靠同源身份 cookie）传递。

## 模型体验

无：这是纯浏览器界面；没有内容进入模型请求。Agent 用 `@deepseek-ai/dsh-tool-library` 的 `library_*` 工具对着同一个 librarian 服务。

#### KV 缓存影响

无：提示词前缀字节不变。

## 已知限制与推迟工作

- 资源清单与问答串靠共享修订计数器或自身变动后重新抓取；还没有主机推送（`$on`）订阅，别的客户端上传要等下次抓取才出现。
- 引用会打开被引用的文件，但不会滚动到被引用的标题。
- 问答输入框没有模型选择器；提问走 librarian 配置的路由。
- 新增来源对话框不支持 URL 入库；请粘贴内容或上传存好的文件。
