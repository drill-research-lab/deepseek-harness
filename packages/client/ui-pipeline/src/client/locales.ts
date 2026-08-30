/** `pipeline` namespace dictionaries. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'nav.title': '流水线',
  'nav.empty': '还没有流水线',
  'nav.new': '新建流水线',
  'nav.lastRun': '上次运行',
  'nav.nextRun': '下次运行',
  'nav.failureStreak': '连续失败',
  'nav.skipped': '已跳过',
  'status.idle': '空闲',
  'status.running': '运行中',
  'run.completed': '已完成',
  'run.failed': '失败',
  'action.pause': '暂停',
  'action.resume': '恢复',
  'action.runNow': '立即运行',
  'action.close': '关闭',
  'editor.runs': '运行历史',
  'editor.noRuns': '还没有运行记录',
  'error.load': '加载流水线失败',
} satisfies Record<string, string>

/** Traditional Chinese dictionary, checked complete against zh. */
export const zhTw = {
  'nav.title': '流水線',
  'nav.empty': '還沒有流水線',
  'nav.new': '新增流水線',
  'nav.lastRun': '上次執行',
  'nav.nextRun': '下次執行',
  'nav.failureStreak': '連續失敗',
  'nav.skipped': '已跳過',
  'status.idle': '閒置',
  'status.running': '執行中',
  'run.completed': '已完成',
  'run.failed': '失敗',
  'action.pause': '暫停',
  'action.resume': '恢復',
  'action.runNow': '立即執行',
  'action.close': '關閉',
  'editor.runs': '執行歷史',
  'editor.noRuns': '還沒有執行記錄',
  'error.load': '載入流水線失敗',
} satisfies Record<keyof typeof zh, string>

/** The pipeline namespace key union. */
export type PipelineKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'nav.title': 'Pipelines',
  'nav.empty': 'No pipelines yet',
  'nav.new': 'New pipeline',
  'nav.lastRun': 'Last run',
  'nav.nextRun': 'Next run',
  'nav.failureStreak': 'failing',
  'nav.skipped': 'skipped',
  'status.idle': 'Idle',
  'status.running': 'Running',
  'run.completed': 'Completed',
  'run.failed': 'Failed',
  'action.pause': 'Pause',
  'action.resume': 'Resume',
  'action.runNow': 'Run now',
  'action.close': 'Close',
  'editor.runs': 'Runs',
  'editor.noRuns': 'No runs yet',
  'error.load': 'Failed to load pipelines',
} satisfies Record<keyof typeof zh, string>
