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

  function save() {
    const s = getSelection()
    const pos = {start: 0, end: 0, dir: undefined}
    let {anchorNode, anchorOffset, focusNode, focusOffset} = s
    if (!anchorNode || !focusNode) throw 'error1'
    if (anchorNode === element && focusNode === element) {
      pos.start = (anchorOffset > 0 && element.textContent) ? element.textContent.length : 0
      pos.end = (focusOffset > 0 && element.textContent) ? element.textContent.length : 0
      pos.dir = (focusOffset >= anchorOffset) ? '->' : '<-'
      return pos
    }
    if (anchorNode.nodeType === Node.ELEMENT_NODE) {
      const node = document.createTextNode('')
      anchorNode.insertBefore(node, anchorNode.childNodes[anchorOffset])
      anchorNode = node
      anchorOffset = 0
    }
    if (focusNode.nodeType === Node.ELEMENT_NODE) {
      const node = document.createTextNode('')
      focusNode.insertBefore(node, focusNode.childNodes[focusOffset])
      focusNode = node
      focusOffset = 0
    }
    visit(element, el => {
      if (el === anchorNode && el === focusNode) {
        pos.start += anchorOffset
        pos.end += focusOffset
        pos.dir = anchorOffset <= focusOffset ? '->' : '<-'
        return 'stop'
      }
      if (el === anchorNode) {
        pos.start += anchorOffset
        if (!pos.dir) {
          pos.dir = '->'
        } else {
          return 'stop'
        }
      } else if (el === focusNode) {
        pos.end += focusOffset
        if (!pos.dir) {
          pos.dir = '<-'
        } else {
          return 'stop'
        }
      }
      if (el.nodeType === Node.TEXT_NODE) {
        if (pos.dir !== '->') pos.start += el.nodeValue.length
        if (pos.dir !== '<-') pos.end += el.nodeValue.length
      }
    })

    element.normalize()
    return pos
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
