/** Inference dashboard dictionaries. */

/** Simplified Chinese dictionary and key-set source. */
export const zh = {
  'nav': '推理状态',
  'title': '模型运行状态',
  'description': '当前 vLLM 服务的实时负载与资源指标。',
  'loading': '正在读取推理服务指标…',
  'loadFailed': '无法读取推理服务指标',
  'unconfigured': '此部署尚未配置推理指标地址。',
  'retry': '重试',
  'backend': '推理后端',
  'online': '在线',
  'requests': '请求',
  'running': '运行中',
  'waiting': '等待中',
  'queueNote': '这里显示总请求数，不代表当前任务的排队序位。',
  'kvCache': 'KV 缓存',
  'unavailable': '未提供',
  'tokens': 'Token 累计',
  'promptTokens': '输入',
  'generationTokens': '输出',
  'preemptions': '抢占次数',
  'updated': '更新时间',
} satisfies Record<string, string>

/** Traditional Chinese dictionary. */
export const zhTw = {
  'nav': '推論狀態',
  'title': '模型運行狀態',
  'description': '目前 vLLM 服務的即時負載與資源指標。',
  'loading': '正在讀取推論服務指標…',
  'loadFailed': '無法讀取推論服務指標',
  'unconfigured': '此部署尚未設定推論指標位址。',
  'retry': '重試',
  'backend': '推論後端',
  'online': '在線',
  'requests': '請求',
  'running': '運行中',
  'waiting': '等待中',
  'queueNote': '這裡顯示總請求數，不代表目前任務的排隊序位。',
  'kvCache': 'KV 快取',
  'unavailable': '未提供',
  'tokens': 'Token 累計',
  'promptTokens': '輸入',
  'generationTokens': '輸出',
  'preemptions': '搶佔次數',
  'updated': '更新時間',
} satisfies Record<keyof typeof zh, string>

/** Inference dashboard key union. */
export type InferenceDashboardKey = keyof typeof zh

/** English dictionary. */
export const en = {
  'nav': 'Inference status',
  'title': 'Model runtime status',
  'description': 'Live load and resource metrics from the current vLLM service.',
  'loading': 'Reading inference service metrics…',
  'loadFailed': 'Could not read inference service metrics',
  'unconfigured': 'This deployment has not configured an inference metrics endpoint.',
  'retry': 'Retry',
  'backend': 'Inference backend',
  'online': 'Online',
  'requests': 'Requests',
  'running': 'Running',
  'waiting': 'Waiting',
  'queueNote': 'These are aggregate request counts, not the current task’s queue position.',
  'kvCache': 'KV cache',
  'unavailable': 'Unavailable',
  'tokens': 'Cumulative tokens',
  'promptTokens': 'Prompt',
  'generationTokens': 'Generated',
  'preemptions': 'Preemptions',
  'updated': 'Updated',
} satisfies Record<InferenceDashboardKey, string>
