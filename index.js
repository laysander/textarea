initUI()

const article = document.querySelector('article')
const editor = new Editor(article, parseMarkdown)
article.addEventListener('input', debounce(500, save))
article.addEventListener('blur', save)
article.addEventListener('click', event => {
  if (event.target.tagName === 'A') window.open(event.target.getAttribute('href'), '_blank')
})
addEventListener('DOMContentLoaded', load)
addEventListener('hashchange', load)
addEventListener('load', () => new MutationObserver(save).observe(article, {attributeFilter: ['style']}))
addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && e.code === 'KeyS') {
    e.preventDefault()
    downloadHTML()
  }
})
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js')
}

async function load() {
  try {
    if (location.hash !== '') await set(location.hash)
    else {
      await set(localStorage.getItem('hash') ?? '')
      if (article.textContent) history.replaceState({}, '', await get())
    }
  } catch (e) {
    article.textContent = ''
    article.removeAttribute('style')
  }
  updateTitle()
}

async function save() {
  const hash = await get()
  if (location.hash !== hash) history.replaceState({}, '', hash)
  try {
    localStorage.setItem('hash', hash)
  } catch (e) {
  }
  updateTitle()
}

async function set(hash) {
  if (!hash) return
  const [content, style] = (await decompress(hash.slice(1))).split('\x00')
  editor.set(content)
  if (style) article.setAttribute('style', style)
}

async function get() {
  const style = article.getAttribute('style')
  const content = article.textContent + (style !== null ? '\x00' + style : '')
  return '#' + await compress(content)
}

function updateTitle() {
  const match = article.textContent.match(/^\n*#(.+)\n/)
  document.title = match?.[1] ?? 'Textarea'
}

async function compress(string) {
  const byteArray = new TextEncoder().encode(string)
  const stream = new CompressionStream('deflate-raw')
  const writer = stream.writable.getWriter()
  writer.write(byteArray)
  writer.close()
  const buffer = await new Response(stream.readable).arrayBuffer()
  return new Uint8Array(buffer).toBase64({alphabet: 'base64url'})
}

async function decompress(b64) {
  const byteArray = Uint8Array.fromBase64(b64, {alphabet: 'base64url'})
  const stream = new DecompressionStream('deflate-raw')
  const writer = stream.writable.getWriter()
  writer.write(byteArray)
  writer.close()
  const buffer = await new Response(stream.readable).arrayBuffer()
  return new TextDecoder().decode(buffer)
}

function debounce(ms, fn) {
  let timer
  return (...args) => {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), ms)
  }
}

function getStylesText() {
  return Array.from(document.styleSheets).map((sheet) => {
    try {
      return Array.from(sheet.cssRules).map((rule) => rule.cssText).join('\n')
    } catch (e) {
      return ''
    }
  }).filter(Boolean).join('\n\n')
}

async function downloadFile(content, {extension, mimeType, description, accept}) {
  if ('showSaveFilePicker' in window) {
    try {
      const handle = await showSaveFilePicker({
        suggestedName: document.title + '.' + extension,
        types: [{
          description,
          accept: {[mimeType]: accept},
        }],
      })
      const writable = await handle.createWritable()
      await writable.write(content)
      await writable.close()
      return
    } catch (e) {
      if (e.name === 'AbortError') return
    }
  }

  const blob = new Blob([content], {type: mimeType})
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = document.title + '.' + extension
  anchor.click()
  URL.revokeObjectURL(url)
}

async function downloadHTML() {
  updateTitle()
  const doc = document.documentElement.cloneNode(true)
  const styles = getStylesText()
  if (styles) {
    doc.querySelectorAll('link[rel="stylesheet"]').forEach((link) => link.remove())
    doc.querySelectorAll('style').forEach((style) => style.remove())
    const styleTag = document.createElement('style')
    styleTag.textContent = styles
    doc.querySelector('head').appendChild(styleTag)
  }
  doc.querySelectorAll('script').forEach(s => s.remove())
  doc.querySelectorAll('.noprint').forEach(s => s.remove())
  doc.querySelector('article').removeAttribute('contenteditable')
  const html = '<!DOCTYPE html>\n' + doc.outerHTML
  await downloadFile(html, {
    extension: 'html',
    mimeType: 'text/html',
    description: 'HTML file',
    accept: ['.html'],
  })
}

async function downloadTXT() {
  updateTitle()
  const text = article.textContent
  await downloadFile(text, {
    extension: 'txt',
    mimeType: 'text/plain',
    description: 'TXT file',
    accept: ['.txt'],
  })
}

async function downloadMD() {
  updateTitle()
  const markdown = article.textContent
  await downloadFile(markdown, {
    extension: 'md',
    mimeType: 'text/markdown',
    description: 'Markdown file',
    accept: ['.md', '.markdown'],
  })
}

function parseMarkdown(element) {
  const input = element.textContent
  const frag = document.createDocumentFragment()

  function tokenSpan(className, text) {
    const span = document.createElement('span')
    span.className = className
    span.textContent = text
    return span
  }

  function appendDelimitedToken(className, raw, delimiter) {
    const span = document.createElement('span')
    span.className = className
    span.appendChild(tokenSpan('md-symbol', delimiter))
    span.appendChild(tokenSpan('md-token-content', raw.slice(delimiter.length, -delimiter.length)))
    span.appendChild(tokenSpan('md-symbol', delimiter))
    frag.appendChild(span)
  }

  function appendHeadingToken(className, raw) {
    const match = raw.match(/^(#{1,6}[ \t]+)(.*)$/)
    const span = document.createElement('span')
    span.className = className
    if (!match) {
      span.textContent = raw
      frag.appendChild(span)
      return
    }
    span.appendChild(tokenSpan('md-symbol', match[1]))
    span.appendChild(tokenSpan('md-token-content', match[2]))
    frag.appendChild(span)
  }

  function appendCodeblockToken(raw) {
    const fence = raw.startsWith('```') ? '```' : '~~~'
    const openingNewline = raw.indexOf('\n')
    const closingFenceLine = raw.lastIndexOf('\n' + fence)
    const span = document.createElement('span')
    span.className = 'md-codeblock'

    if (openingNewline === -1 || closingFenceLine === -1 || closingFenceLine <= openingNewline) {
      span.textContent = raw
      frag.appendChild(span)
      return
    }

    const openingFence = raw.slice(0, openingNewline + 1)
    const body = raw.slice(openingNewline + 1, closingFenceLine + 1)
    const closingFence = raw.slice(closingFenceLine + 1)

    span.appendChild(tokenSpan('md-symbol', openingFence))
    span.appendChild(tokenSpan('md-token-content', body))
    span.appendChild(tokenSpan('md-symbol', closingFence))
    frag.appendChild(span)
  }

  const matchers = [
    {name: 'md-codeblock', re: /```[^\n]*\n[\s\S]*?\n```/y},
    {name: 'md-codeblock', re: /~~~[^\n]*\n[\s\S]*?\n~~~/y},
    {name: 'md-h1', re: /^#[ \t]+[^\n]*$/my},
    {name: 'md-h2', re: /^##[ \t]+[^\n]*$/my},
    {name: 'md-h3', re: /^###[ \t]+[^\n]*$/my},
    {name: 'md-h4', re: /^####[ \t]+[^\n]*$/my},
    {name: 'md-h5', re: /^#####[ \t]+[^\n]*$/my},
    {name: 'md-h6', re: /^######[ \t]+[^\n]*$/my},
    {name: 'md-code', re: /`[^`\n]*`/y},
    {name: 'md-bold', re: /\*\*[^*\n]+?\*\*/y},
    {name: 'md-bold', re: /(?<![A-Za-z0-9_])__(?=\S)[^_\n]*?\S__(?![A-Za-z0-9_])/y},
    {name: 'md-strike', re: /~~[^~\n]+?~~/y},
    {name: 'md-italic', re: /\*[^*\n]+?\*/y},
    {name: 'md-italic', re: /(?<![A-Za-z0-9_])_(?=\S)[^_\n]*?\S_(?![A-Za-z0-9_])/y},
    {name: 'md-url', re: /https?:\/\/[^\s<>()\[\]{}"'`]+/y},
  ]

  const specials = ['`', '~', '*', '#', '_', 'h']

  let i = 0
  while (i < input.length) {
    let matched = false
    for (const m of matchers) {
      m.re.lastIndex = i
      const res = m.re.exec(input)
      if (res && res.index === i) {
        const raw = res[0]
        if (m.name === 'md-url') {
          const a = document.createElement('a')
          a.className = 'md-url'
          a.href = raw
          a.textContent = raw
          a.target = '_blank'
          a.rel = 'noopener noreferrer'
          frag.appendChild(a)
        } else if (m.name === 'md-codeblock') {
          appendCodeblockToken(raw)
        } else if (m.name.startsWith('md-h')) {
          appendHeadingToken(m.name, raw)
        } else if (m.name === 'md-bold') {
          appendDelimitedToken(m.name, raw, raw.startsWith('**') ? '**' : '__')
        } else if (m.name === 'md-italic') {
          appendDelimitedToken(m.name, raw, raw.startsWith('*') ? '*' : '_')
        } else if (m.name === 'md-strike') {
          appendDelimitedToken(m.name, raw, '~~')
        } else if (m.name === 'md-code') {
          appendDelimitedToken(m.name, raw, '`')
        } else {
          const span = document.createElement('span')
          span.className = m.name
          span.textContent = raw
          frag.appendChild(span)
        }
        i += raw.length
        matched = true
        break
      }
    }

    if (matched) continue

    let next = input.length
    for (const ch of specials) {
      const idx = input.indexOf(ch, i)
      if (idx !== -1 && idx < next) next = idx
    }

    if (next === i) {
      frag.appendChild(document.createTextNode(input[i]))
      i++
      continue
    }

    frag.appendChild(document.createTextNode(input.slice(i, next)))
    i = next
  }

  element.textContent = ''
  element.appendChild(frag)
  element.normalize()
}

function initUI() {
  const menu = document.querySelector('#menu')
  const button = document.querySelector('#button')
  const qr = document.querySelector('#qr')
  const shareLink = document.querySelector('#share-link')
  const saveAsHTML = document.querySelector('#save-as-html')
  const saveAsText = document.querySelector('#save-as-text')
  const saveAsMD = document.querySelector('#save-as-md')

  button.addEventListener('click', event => {
    if (event.clientX || event.targetTouches) ripple(event)
    menu.classList.toggle('visible')
    qr.setAttribute('href', '/qr' + location.hash)
    shareLink.setAttribute('href', location.href)
  })

  function hideMenu() {
    menu.classList.remove('visible')
  }

  function notify(message) {
    const notification = document.querySelector('#notification')
    notification.classList.add('visible')
    notification.textContent = message
    setTimeout(() => notification.classList.remove('visible'), 2e3)
  }

  document.body.addEventListener('click', event => {
    let t = event.target
    if (t.closest('#menu')) return
    if (t.closest('#button')) return
    if (t.closest('.ripple')) return
    menu.classList.remove('visible')
  })

  shareLink.addEventListener('click', event => {
    event.preventDefault()
    if (!navigator.clipboard) {
      alert('Your browser does not support clipboard API')
      return
    }
    navigator.clipboard.writeText(location.href)
    notify('Link copied')
    hideMenu()
  })
  saveAsHTML.addEventListener('click', event => {
    event.preventDefault()
    downloadHTML()
    hideMenu()
  })
  saveAsText.addEventListener('click', event => {
    event.preventDefault()
    downloadTXT()
    hideMenu()
  })
  saveAsMD.addEventListener('click', event => {
    event.preventDefault()
    downloadMD()
    hideMenu()
  })
}

function ripple(event) {
  const button = event.currentTarget
  const circle = document.createElement('span')
  const diameter = Math.max(button.clientWidth, button.clientHeight)
  const radius = diameter / 2
  circle.style.width = circle.style.height = `${diameter}px`
  circle.style.left = `${(event.clientX || event.targetTouches[0].pageX) - button.offsetLeft - radius}px`
  circle.style.top = `${(event.clientY || event.targetTouches[0].pageY) - button.offsetTop - radius}px`
  circle.classList.add('ripple')
  const ripple = button.getElementsByClassName('ripple')[0]
  if (ripple) ripple.remove()
  button.appendChild(circle)
}

function Editor(element, highlight) {
  const listeners = []
  const history = []
  let at = -1, prev

  const debounceHighlight = debounce(30, () => {
    const pos = save()
    highlight(element)
    restore(pos)
  })

  const shouldRecord = (event) => {
    return !isUndo(event) && !isRedo(event)
      && event.key !== 'Meta'
      && event.key !== 'Control'
      && event.key !== 'Alt'
      && !event.key.startsWith('Arrow')
  }

  let recording = false
  const debounceRecordHistory = debounce(300, (event) => {
    if (shouldRecord(event)) {
      recordHistory()
      recording = false
    }
  })

  const on = (type, fn) => {
    listeners.push([type, fn])
    element.addEventListener(type, fn)
  }
  on('keydown', event => {
    if (event.defaultPrevented) return
    prev = toString()
    if (handleTab(event)) return
    if (handleEnter(event)) return
    if (handleBackspace(event)) return
    if (handleAutoPair(event)) return
    if (isUndo(event)) doUndo(event)
    if (isRedo(event)) doRedo(event)
    if (shouldRecord(event) && !recording) {
      recordHistory()
      recording = true
    }
  })
  on('keyup', event => {
    if (event.defaultPrevented) return
    if (event.isComposing) return
    if (prev !== toString()) debounceHighlight()
    debounceRecordHistory(event)
  })
  on('paste', () => setTimeout(recordHistory, 10))
  on('cut', () => setTimeout(recordHistory, 10))
  on('beforeinput', event => {
    if (event.inputType === 'historyUndo') doUndo(event)
    if (event.inputType === 'historyRedo') doRedo(event)
  })

  const PAIRS = {
    '(': ')',
    '[': ']',
    '{': '}',
    '"': '"',
    '\'': '\'',
    '`': '`',
  }
  const CLOSERS = new Set(Object.values(PAIRS))

  function handleTab(event) {
    if (event.key !== 'Tab') return false
    if (isCtrl(event) || event.altKey) return false
    preventDefault(event)
    beginRecordIfNeeded()

    const current = toString()
    const pos = save()
    const next = applyTabToText(current, pos, event.shiftKey)
    applyEditorChange(next)
    return true
  }

  function handleEnter(event) {
    if (event.key !== 'Enter') return false
    if (event.isComposing) return false
    if (isCtrl(event) || event.altKey) return false
    preventDefault(event)
    beginRecordIfNeeded()

    const current = toString()
    const pos = save()
    const next = applyEnterToText(current, pos)
    applyEditorChange(next)
    return true
  }

  function handleBackspace(event) {
    if (event.key !== 'Backspace') return false
    if (event.isComposing) return false
    if (isCtrl(event) || event.altKey) return false

    const current = toString()
    const pos = save()
    const selectionStart = Math.min(pos.start, pos.end)
    const selectionEnd = Math.max(pos.start, pos.end)
    if (selectionStart !== selectionEnd) return false
    if (selectionStart === 0) return false

    const lineStart = current.lastIndexOf('\n', Math.max(0, selectionStart - 1)) + 1
    const line = current.slice(lineStart)
    const leadingWhitespaceLength = (line.match(/^[\t ]*/) || [''])[0].length
    const indentBoundary = lineStart + leadingWhitespaceLength
    if (selectionStart > indentBoundary) return false

    let removeStart = selectionStart
    if (current[selectionStart - 1] === '\t') {
      removeStart = selectionStart - 1
    } else {
      let spaces = 0
      let i = selectionStart - 1
      while (i >= lineStart && current[i] === ' ' && spaces < 4) {
        spaces++
        i--
      }
      if (spaces === 0) return false
      removeStart = selectionStart - spaces
    }

    preventDefault(event)
    beginRecordIfNeeded()

    const nextText = current.slice(0, removeStart) + current.slice(selectionStart)
    const nextPos = {start: removeStart, end: removeStart, dir: pos.dir || '->'}
    applyEditorChange({text: nextText, pos: nextPos})
    return true
  }

  function handleAutoPair(event) {
    if (event.isComposing) return false
    if (isCtrl(event) || event.altKey) return false
    if (event.key.length !== 1) return false

    const current = toString()
    const pos = save()
    const selectionStart = Math.min(pos.start, pos.end)
    const selectionEnd = Math.max(pos.start, pos.end)
    const typed = event.key

    // Skip over existing closing char (IDE-like overtype behavior).
    if (
      selectionStart === selectionEnd
      && CLOSERS.has(typed)
      && current[selectionStart] === typed
    ) {
      preventDefault(event)
      const nextCursor = selectionStart + 1
      restore({start: nextCursor, end: nextCursor, dir: '->'})
      prev = toString()
      return true
    }

    const close = PAIRS[typed]
    if (!close) return false

    if ((typed === '\'' || typed === '"') && /[A-Za-z0-9_]/.test(current[selectionStart - 1] || '')) {
      return false
    }

    preventDefault(event)
    beginRecordIfNeeded()

    const selected = current.slice(selectionStart, selectionEnd)
    const pairText = typed + selected + close
    const nextText = current.slice(0, selectionStart) + pairText + current.slice(selectionEnd)

    const nextPos = selectionStart === selectionEnd
      ? {start: selectionStart + 1, end: selectionStart + 1, dir: '->'}
      : {start: selectionStart + 1, end: selectionStart + 1 + selected.length, dir: pos.dir || '->'}

    applyEditorChange({text: nextText, pos: nextPos})
    return true
  }

  function beginRecordIfNeeded() {
    if (!recording) {
      recordHistory()
      recording = true
    }
  }

  function applyEditorChange(next) {
    element.textContent = next.text
    restore(next.pos)

    // Apply highlighting immediately to keep cursor stable and avoid delayed jump.
    const stablePos = save()
    highlight(element)
    restore(stablePos)
    prev = toString()
  }

  function applyTabToText(text, pos, outdent) {
    const dir = pos.dir || '->'
    const selectionStart = Math.min(pos.start, pos.end)
    const selectionEnd = Math.max(pos.start, pos.end)

    if (selectionStart === selectionEnd) {
      const lineStart = text.lastIndexOf('\n', Math.max(0, selectionStart - 1)) + 1

      if (!outdent) {
        const nextText = text.slice(0, selectionStart) + '\t' + text.slice(selectionStart)
        const nextPos = {start: selectionStart + 1, end: selectionStart + 1, dir}
        return {text: nextText, pos: nextPos}
      }

      let removed = 0
      if (text.startsWith('\t', lineStart)) {
        removed = 1
      } else {
        while (removed < 4 && text[lineStart + removed] === ' ') removed++
      }

      if (removed === 0) return {text, pos}

      const nextText = text.slice(0, lineStart) + text.slice(lineStart + removed)
      const cursor = selectionStart - Math.min(removed, selectionStart - lineStart)
      const nextPos = {start: cursor, end: cursor, dir}
      return {text: nextText, pos: nextPos}
    }

    const firstLineStart = text.lastIndexOf('\n', Math.max(0, selectionStart - 1)) + 1
    const normalizedEnd = (
      selectionEnd > selectionStart && text[selectionEnd - 1] === '\n'
    ) ? selectionEnd - 1 : selectionEnd
    const endLineBreak = text.indexOf('\n', normalizedEnd)
    const lastLineEnd = endLineBreak === -1 ? text.length : endLineBreak
    const block = text.slice(firstLineStart, lastLineEnd)
    const lines = block.split('\n')

    const lineOffsets = []
    let offset = 0
    for (const line of lines) {
      lineOffsets.push(offset)
      offset += line.length + 1
    }

    const deltas = []
    const nextLines = lines.map((line) => {
      if (!outdent) {
        deltas.push(1)
        return '\t' + line
      }
      if (line.startsWith('\t')) {
        deltas.push(-1)
        return line.slice(1)
      }
      let removed = 0
      while (removed < 4 && line[removed] === ' ') removed++
      if (removed > 0) {
        deltas.push(-removed)
        return line.slice(removed)
      }
      deltas.push(0)
      return line
    })

    const nextBlock = nextLines.join('\n')
    const nextText = text.slice(0, firstLineStart) + nextBlock + text.slice(lastLineEnd)

    const deltaBefore = (index) => {
      let delta = 0
      for (let i = 0; i < lineOffsets.length; i++) {
        const absoluteLineStart = firstLineStart + lineOffsets[i]
        if (absoluteLineStart < index) delta += deltas[i]
      }
      return delta
    }

    const nextSelectionStart = selectionStart + deltaBefore(selectionStart)
    const nextSelectionEnd = selectionEnd + deltaBefore(selectionEnd)
    const nextPos = dir === '<-'
      ? {start: nextSelectionEnd, end: nextSelectionStart, dir}
      : {start: nextSelectionStart, end: nextSelectionEnd, dir}

    return {text: nextText, pos: nextPos}
  }

  function applyEnterToText(text, pos) {
    const selectionStart = Math.min(pos.start, pos.end)
    const selectionEnd = Math.max(pos.start, pos.end)
    const lineStart = text.lastIndexOf('\n', Math.max(0, selectionStart - 1)) + 1
    const lineEndIndex = text.indexOf('\n', selectionStart)
    const lineEnd = lineEndIndex === -1 ? text.length : lineEndIndex
    const lineBeforeCursor = text.slice(lineStart, selectionStart)
    const lineAfterCursor = text.slice(selectionStart, lineEnd)
    const linePrefix = text.slice(lineStart, selectionStart)
    const indent = (linePrefix.match(/^[\t ]*/) || [''])[0]
    const unorderedList = lineBeforeCursor.match(/^(\s*)([-+*])(\s+)/)
    const orderedList = lineBeforeCursor.match(/^(\s*)(\d+)([.)])(\s+)/)

    let continuation = indent
    if (unorderedList) {
      const [, baseIndent, marker, gap] = unorderedList
      continuation = baseIndent + marker + gap

      const beforeContent = lineBeforeCursor.slice(unorderedList[0].length)
      const afterContent = lineAfterCursor
      if (beforeContent.trim() === '' && afterContent.trim() === '') {
        continuation = baseIndent
      }
    } else if (orderedList) {
      const [, baseIndent, number, delimiter, gap] = orderedList
      continuation = baseIndent + (Number(number) + 1) + delimiter + gap

      const beforeContent = lineBeforeCursor.slice(orderedList[0].length)
      const afterContent = lineAfterCursor
      if (beforeContent.trim() === '' && afterContent.trim() === '') {
        continuation = baseIndent
      }
    }

    const nextText = text.slice(0, selectionStart) + '\n' + continuation + text.slice(selectionEnd)
    const cursor = selectionStart + 1 + indent.length
    const nextPos = {start: cursor + (continuation.length - indent.length), end: cursor + (continuation.length - indent.length), dir: '->'}

    return {text: nextText, pos: nextPos}
  }

  function save() {
    const s = getSelection()
    const pos = {start: 0, end: 0, dir: '->'}
    const {anchorNode, anchorOffset, focusNode, focusOffset} = s
    if (!anchorNode || !focusNode) throw 'error1'

    const totalLength = (element.textContent || '').length
    const start = clamp(getTextOffset(anchorNode, anchorOffset), 0, totalLength)
    const end = clamp(getTextOffset(focusNode, focusOffset), 0, totalLength)
    pos.start = start
    pos.end = end
    pos.dir = end >= start ? '->' : '<-'
    return pos
  }

  function getTextOffset(node, offset) {
    try {
      const range = document.createRange()
      range.selectNodeContents(element)
      range.setEnd(node, offset)
      return range.toString().length
    } catch (error) {
      return (element.textContent || '').length
    }
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value))
  }

  function restore(pos) {
    const s = getSelection()
    let startNode, startOffset = 0
    let endNode, endOffset = 0

    if (!pos.dir) pos.dir = '->'
    if (pos.start < 0) pos.start = 0
    if (pos.end < 0) pos.end = 0

    if (pos.dir === '<-') {
      const {start, end} = pos
      pos.start = end
      pos.end = start
    }

    let current = 0

    visit(element, el => {
      if (el.nodeType !== Node.TEXT_NODE) return

      const len = (el.nodeValue || '').length
      if (current + len > pos.start) {
        if (!startNode) {
          startNode = el
          startOffset = pos.start - current
        }
        if (current + len > pos.end) {
          endNode = el
          endOffset = pos.end - current
          return 'stop'
        }
      }
      current += len
    })

    if (!startNode) {
      startNode = element
      startOffset = element.childNodes.length
    }
    if (!endNode) {
      endNode = element
      endOffset = element.childNodes.length
    }

    if (pos.dir === '<-') {
      [startNode, startOffset, endNode, endOffset] = [endNode, endOffset, startNode, startOffset]
    }

    {
      const startEl = uneditable(startNode)
      if (startEl) {
        const node = document.createTextNode('')
        startEl.parentNode?.insertBefore(node, startEl)
        startNode = node
        startOffset = 0
      }
      const endEl = uneditable(endNode)
      if (endEl) {
        const node = document.createTextNode('')
        endEl.parentNode?.insertBefore(node, endEl)
        endNode = node
        endOffset = 0
      }
    }

    s.setBaseAndExtent(startNode, startOffset, endNode, endOffset)
    element.normalize()
  }

  function uneditable(node) {
    while (node && node !== element) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        if (node.getAttribute('contenteditable') === 'false') {
          return node
        }
      }
      node = node.parentNode
    }
  }

  function doUndo(event) {
    preventDefault(event)
    at--
    const record = history[at]
    if (record) {
      element.innerHTML = record.html
      restore(record.pos)
    }
    if (at < 0) at = 0
  }

  function doRedo(event) {
    preventDefault(event)
    at++
    const record = history[at]
    if (record) {
      element.innerHTML = record.html
      restore(record.pos)
    }
    if (at >= history.length) at--
  }

  function recordHistory() {
    const html = element.innerHTML
    const pos = save()
    const lastRecord = history[at]
    if (
      lastRecord
      && lastRecord.html === html
      && lastRecord.pos.start === pos.start
      && lastRecord.pos.end === pos.end
    ) return
    at++
    history[at] = {html, pos}
    history.splice(at + 1)
    const maxHistory = 10_000
    if (at > maxHistory) {
      at = maxHistory
      history.splice(0, 1)
    }
  }

  function visit(editor, visitor) {
    const queue = []
    if (editor.firstChild) queue.push(editor.firstChild)
    let el = queue.pop()
    while (el) {
      if (visitor(el) === 'stop') break
      if (el.nextSibling) queue.push(el.nextSibling)
      if (el.firstChild) queue.push(el.firstChild)
      el = queue.pop()
    }
  }

  function isCtrl(event) {
    return event.metaKey || event.ctrlKey
  }

  function isUndo(event) {
    return isCtrl(event) && !event.shiftKey && event.code === 'KeyZ'
  }

  function isRedo(event) {
    return isCtrl(event) && event.shiftKey && event.code === 'KeyZ'
  }

  function toString() {
    return element.textContent || ''
  }

  function preventDefault(event) {
    event.preventDefault()
  }

  function getSelection() {
    return element.getRootNode().getSelection()
  }

  return {
    set(content) {
      element.textContent = content
      highlight(element)
    },
    destroy() {
      for (const [type, fn] of listeners) editor.removeEventListener(type, fn)
    },
  }
}
