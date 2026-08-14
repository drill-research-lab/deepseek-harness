/** Regression tests for the zh-TW verification gate. */

import { describe, expect, it } from 'vitest'
import {
  checkZhTwDocument,
} from './verify-zh-tw.ts'

describe('zh-TW document check', () => {
  it('accepts clean Traditional Chinese prose', () => {
    expect(checkZhTwDocument('這個軟體需要最佳化，使用者權限請聯絡管理員。')).toEqual([])
  })

  it('flags residual Simplified Chinese characters', () => {
    const issues = checkZhTwDocument('这个软件需要优化，用户权限请联系管理员。')
    expect(issues.length).toBeGreaterThan(0)
    expect(issues.some(issue => issue.source === '这个')).toBe(true)
    expect(issues.some(issue => issue.source === '用户')).toBe(true)
  })

  it('ignores vocabulary-preference suggestions with no Simplified characters', () => {
    // 聲明/綁定 are already Traditional; the suggestion to use 宣告/繫結 is a
    // review call, not a residual-Simplified error.
    expect(checkZhTwDocument('聲明與綁定。')).toEqual([])
  })

  it('ignores code spans and fenced blocks', () => {
    const doc = '命令是 `打印文件` 和 `服务器`。\n\n```ts\nconst 信息 = "数据"\n```\n'
    expect(checkZhTwDocument(doc)).toEqual([])
  })

  it('flags only the prose around protected spans', () => {
    const doc = '这个软件 `服务器` 需要优化'
    const issues = checkZhTwDocument(doc)
    expect(issues.some(issue => issue.source === '这个')).toBe(true)
    expect(issues.some(issue => issue.source === '服务器')).toBe(false)
  })

  it('reports a stable issue shape with offsets', () => {
    const [issue] = checkZhTwDocument('用户')
    expect(issue).toBeDefined()
    if (issue === undefined) return
    expect(issue).toMatchObject({ source: '用户', target: '使用者' })
    expect(typeof issue.start).toBe('number')
    expect(typeof issue.end).toBe('number')
  })
})
