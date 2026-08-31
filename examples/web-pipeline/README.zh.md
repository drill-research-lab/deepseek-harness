# 排程流水线

[English](README.md) | 简体中文 | [繁體中文](README.zh-tw.md)

本 overlay 让一个 `dsh web` 进程接入排程流水线 seam，不改变出厂默认的 Web 组合：

```sh
dsh web --patch examples/web-pipeline/cordis.yml
```

该组合挂载文件支撑的引擎（`@deepseek-ai/dsh-pipeline-local`）并关闭调度器，因此运行只经手动通道（`pipelines/triggerNow`）或模型工具调用启动——cron 触发在部署显式开启前保持关闭。run-session 投影词汇（`@deepseek-ai/dsh-session` 与 JSONL 持久化）把每次运行的日志落到 `./.sessions`（每次运行一个目录）；定义与运行记录在 `./.pipelines`。

引擎随附 Scheduled Search 模板（`scheduled-search/*` 内建步骤）：通过 UI 模板画廊或 `pipelines/createFromTemplate` 创建流水线时，会展开为 trigger → search → normalize → dedupe → persist（可选 summarize）节点。search 步骤每次运行在 arXiv 的礼貌窗口内向 arXiv API 发一次真实请求；需要确定性或离线运行的部署改为注册自己的内建步骤（`tests/` 里的 snapshot 测试展示了注册与一次全程无网络的手动运行）。

每次运行把节点生命周期——started/settled 结果、JSON 输出、耗时与错误——投影进自己的后台会话，事件附带 `ignorable` 读取安全标记；`pipelines/run` 把该投影折叠回编辑器的运行详情。删除流水线保留其运行记录与产物；保留上界（`retainedRuns`，默认 50）会连同运行日志一起修剪最旧的记录。

已知限制：随附的 llm 节点只聚合 text-delta 输出。回应走 reasoning 通道的推理模型会得到空摘要；部署可选择文本优先的模型，或使用按节点的模型覆写（后续切片会聚合 reasoning 内容）。
