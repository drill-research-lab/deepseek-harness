/** Writing surface dictionary namespace and copy (zh is the product source). */

/** Repository-facing namespace identifier. */
export const NS = 'writing'

export const zh = {
  'view.writing': '寫作',
  title: '報告',
  newPlaceholder: '新增報告標題',
  create: '新增',
  save: '儲存',
  compile: '編譯',
  preview: 'PDF 預覽',
  noPreview: '編譯後即可預覽 PDF',
  compiling: '編譯中…',
  loading: '載入中…',
  saved: '已儲存',
  restored: '已還原',
  compiledOk: '編譯成功。',
  versions: '版本',
  more: '更多',
  listCollapse: '收合報告區',
  listExpand: '展開報告區',
  openPreview: '預覽視窗',
  previewWindowTitle: 'Latex 編譯與PDF預覽',
  close: '關閉',
} as const

export const zhTw = {
  'view.writing': '寫作',
  title: '報告',
  newPlaceholder: '新增報告標題',
  create: '新增',
  save: '儲存',
  compile: '編譯',
  preview: 'PDF 預覽',
  noPreview: '編譯後即可預覽 PDF',
  compiling: '編譯中…',
  loading: '載入中…',
  saved: '已儲存',
  restored: '已還原',
  compiledOk: '編譯成功。',
  versions: '版本',
  more: '更多',
  listCollapse: '收合報告區',
  listExpand: '展開報告區',
  openPreview: '預覽視窗',
  previewWindowTitle: 'Latex 編譯與PDF預覽',
  close: '關閉',
} as const

export const en = {
  'view.writing': 'Writing',
  title: 'Reports',
  newPlaceholder: 'New report title',
  create: 'Create',
  save: 'Save',
  compile: 'Compile',
  preview: 'PDF preview',
  noPreview: 'Compile to preview the PDF',
  compiling: 'Compiling…',
  loading: 'Loading…',
  saved: 'Saved',
  restored: 'Restored',
  compiledOk: 'Compiled successfully.',
  versions: 'Versions',
  more: 'more',
  listCollapse: 'Collapse reports',
  listExpand: 'Expand reports',
  openPreview: 'Preview',
  previewWindowTitle: 'LaTeX Compile & PDF Preview',
  close: 'Close',
} as const

export type WritingKey = keyof typeof zh
