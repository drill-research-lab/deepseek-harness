/** Admin queue page dictionaries. */

/** Simplified Chinese dictionary and key-set source. */
export const zh = {
  'nav': '排队管理',
  'title': 'LLM 排队管理',
  'description': '内部 vLLM 后端的准入队列。正在运行的排在最上面;拖动等待中的行来调整谁先跑,外部 API 供应商的请求不经过这个队列。',
  'checking': '正在确认权限…',
  'forbidden': '你没有权限查看这个页面。',
  'loading': '正在读取队列快照…',
  'loadFailed': '无法读取队列快照',
  'retry': '重试',
  'empty': '目前没有排队或运行中的请求。',
  'colPosition': '位置',
  'colUser': '使用者',
  'colState': '状态',
  'stateWaiting': '等待中',
  'stateRunning': '运行中',
  'rowDragHint': '可拖动的等待列;用方向键上下移动',
} satisfies Record<string, string>

/** Traditional Chinese dictionary. */
export const zhTw = {
  'nav': '排隊管理',
  'title': 'LLM 排隊管理',
  'description': '內部 vLLM 後端的准入佇列。正在運行的排在最上面;拖曳等待中的列來調整誰先跑,外部 API 供應商的請求不經過這個佇列。',
  'checking': '正在確認權限…',
  'forbidden': '你沒有權限檢視這個頁面。',
  'loading': '正在讀取佇列快照…',
  'loadFailed': '無法讀取佇列快照',
  'retry': '重試',
  'empty': '目前沒有排隊或運行中的請求。',
  'colPosition': '位置',
  'colUser': '使用者',
  'colState': '狀態',
  'stateWaiting': '等待中',
  'stateRunning': '運行中',
  'rowDragHint': '可拖曳的等待列;用方向鍵上下移動',
} satisfies Record<keyof typeof zh, string>

/** Admin queue key union. */
export type AdminQueueKey = keyof typeof zh

/** English dictionary. */
export const en = {
  'nav': 'Queue management',
  'title': 'LLM queue management',
  'description': 'The internal-vLLM admission queue. Running requests sit at the top; drag a waiting row to set who runs next. External API provider requests never pass through it.',
  'checking': 'Checking permission…',
  'forbidden': 'You do not have permission to view this page.',
  'loading': 'Reading the queue snapshot…',
  'loadFailed': 'Could not read the queue snapshot',
  'retry': 'Retry',
  'empty': 'No requests are queued or running right now.',
  'colPosition': 'Position',
  'colUser': 'User',
  'colState': 'State',
  'stateWaiting': 'Waiting',
  'stateRunning': 'Running',
  'rowDragHint': 'Draggable waiting row; use the arrow keys to move it',
} satisfies Record<AdminQueueKey, string>
