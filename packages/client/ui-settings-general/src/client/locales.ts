/** Shell chrome and General-nav dictionaries; feature rows own their copy. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'trigger': '设置',
  'title': '设置',
  'close': '关闭',
  'openDocument': '打开配置文件',
  'openDocument.error': '无法打开配置文件',
  'general.nav': '通用设置',
  'account.title': '账号',
  'account.loading': '正在加载账号信息…',
  'account.empty': '没有可显示的账号信息',
  'account.error': '无法加载账号信息',
  'account.retry': '重试',
  'account.logout': '登出',
} satisfies Record<string, string>

/** Traditional Chinese dictionary, checked complete against zh. */
export const zhTw = {
  'trigger': '設定',
  'title': '設定',
  'close': '關閉',
  'openDocument': '開啟設定檔案',
  'openDocument.error': '無法開啟設定檔案',
  'general.nav': '通用設定',
  'account.title': '帳號',
  'account.loading': '正在載入帳號資訊…',
  'account.empty': '沒有可顯示的帳號資訊',
  'account.error': '無法載入帳號資訊',
  'account.retry': '重試',
  'account.logout': '登出',
} satisfies Record<keyof typeof zh, string>

/** The settings namespace key union. */
export type SettingsKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'trigger': 'Settings',
  'title': 'Settings',
  'close': 'Close',
  'openDocument': 'Open configuration file',
  'openDocument.error': 'Could not open configuration file',
  'general.nav': 'General',
  'account.title': 'Account',
  'account.loading': 'Loading account information…',
  'account.empty': 'No account information is available',
  'account.error': 'Could not load account information',
  'account.retry': 'Retry',
  'account.logout': 'Log out',
} satisfies Record<SettingsKey, string>
