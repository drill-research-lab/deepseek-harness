/** LaTeX source editor with a scroll-synced line-number gutter. */

import { useRef } from 'react'
import type { RefObject } from 'react'
import css from './writing.module.css'

export interface SourceEditorProps {
  readonly value: string
  readonly onChange: (value: string) => void
  readonly textareaRef: RefObject<HTMLTextAreaElement>
}

/** A textarea plus a gutter of line numbers that tracks its vertical scroll. */
export function SourceEditor({ value, onChange, textareaRef }: SourceEditorProps): JSX.Element {
  const gutterRef = useRef<HTMLDivElement>(null)
  const lines = value.split('\n')
  const onScroll = (event: React.UIEvent<HTMLTextAreaElement>): void => {
    if (gutterRef.current !== null) gutterRef.current.scrollTop = event.currentTarget.scrollTop
  }
  return (
    <div className={css.editorWrap}>
      <div ref={gutterRef} className={css.gutter} aria-hidden>
        {lines.map((_, index) => index + 1).join('\n')}
      </div>
      <textarea
        ref={textareaRef}
        className={css.source}
        value={value}
        onChange={event => onChange(event.target.value)}
        onScroll={onScroll}
        spellCheck={false}
      />
    </div>
  )
}
