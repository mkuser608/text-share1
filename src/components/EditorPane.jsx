import React, { useEffect, useRef, useState } from 'react'
import { EditorView, basicSetup } from 'codemirror'
import { EditorState } from '@codemirror/state'
import { oneDark } from '@codemirror/theme-one-dark'
import { yCollab } from 'y-codemirror.next'
import { markdown } from '@codemirror/lang-markdown'
import { javascript } from '@codemirror/lang-javascript'
import { python } from '@codemirror/lang-python'
import { html } from '@codemirror/lang-html'
import { css } from '@codemirror/lang-css'
import { json } from '@codemirror/lang-json'

const LANGS = {
  markdown: { label: 'Markdown', ext: () => markdown() },
  javascript: { label: 'JS / TS', ext: () => javascript({ jsx: true, typescript: true }) },
  python: { label: 'Python', ext: () => python() },
  html: { label: 'HTML', ext: () => html() },
  css: { label: 'CSS', ext: () => css() },
  json: { label: 'JSON', ext: () => json() },
  plain: { label: 'Plain text', ext: () => [] },
}

export default function EditorPane({ ydoc, awareness }) {
  const hostRef = useRef(null)
  const viewRef = useRef(null)
  const meta = ydoc.getMap('meta')
  const [lang, setLang] = useState(() => meta.get('language') || 'markdown')

  // language synced across the room via the Yjs meta map
  useEffect(() => {
    const ob = () => setLang(meta.get('language') || 'markdown')
    meta.observe(ob)
    return () => meta.unobserve(ob)
  }, [])

  useEffect(() => {
    const ytext = ydoc.getText('content')
    const view = new EditorView({
      state: EditorState.create({
        doc: ytext.toString(),
        extensions: [
          basicSetup,
          (LANGS[lang] || LANGS.plain).ext(),
          oneDark,
          yCollab(ytext, awareness),
          EditorView.lineWrapping,
          EditorView.theme({
            '&': { backgroundColor: 'transparent', height: '100%' },
            '.cm-gutters': { backgroundColor: 'transparent', border: 'none' },
          }),
        ],
      }),
      parent: hostRef.current,
    })
    viewRef.current = view
    return () => view.destroy()
  }, [lang])

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-800/70 shrink-0">
        <label className="text-xs text-slate-500">Language</label>
        <select
          value={lang}
          onChange={(e) => meta.set('language', e.target.value)}
          className="text-sm bg-slate-800 border border-slate-700 rounded-md px-2 py-1.5 outline-none focus:border-sky-500"
        >
          {Object.entries(LANGS).map(([id, l]) => <option key={id} value={id}>{l.label}</option>)}
        </select>
        <span className="ml-auto text-xs text-slate-600 hidden sm:block">changes sync live to everyone</span>
      </div>
      <div ref={hostRef} className="flex-1 min-h-0 overflow-hidden" />
    </div>
  )
}
