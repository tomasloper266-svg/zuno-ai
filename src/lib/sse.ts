/**
 * Minimal SSE reader for the browser: decodes a fetch body and yields each
 * event's name and data payload, in arrival order. Handles CRLF, multi-byte
 * characters split across chunks, `:` comments, and events spread over several
 * `data:` lines (joined with "\n" per the SSE spec).
 */
export interface SseEvent {
  event: string
  data: string
}

export async function* sseEvents(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<SseEvent, void, void> {
  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  let eventName: string | null = null
  let dataLines: string[] = []

  /** Consume one line; returns the completed event when a blank line closes it. */
  const consume = (rawLine: string): SseEvent | null => {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
    if (line === '') {
      if (dataLines.length === 0 && eventName === null) return null // keep-alive
      const event: SseEvent = { event: eventName ?? 'message', data: dataLines.join('\n') }
      eventName = null
      dataLines = []
      return event
    }
    if (line.startsWith(':')) return null // SSE comment (keep-alive)
    const colon = line.indexOf(':')
    const field = colon === -1 ? line : line.slice(0, colon)
    let value = colon === -1 ? '' : line.slice(colon + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    if (field === 'data') dataLines.push(value)
    else if (field === 'event') eventName = value
    return null
  }

  const reader = body.getReader()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let breakAt = buffer.search(/\r?\n/)
      while (breakAt !== -1) {
        const line = buffer.slice(0, breakAt)
        buffer = buffer.slice(breakAt + (buffer.charCodeAt(breakAt) === 13 /* \r */ ? 2 : 1))
        const event = consume(line)
        if (event !== null) yield event
        breakAt = buffer.search(/\r?\n/)
      }
    }
    // Stream ended: flush the decoder, then dispatch any final unterminated event.
    buffer += decoder.decode()
    if (buffer !== '') {
      const event = consume(buffer)
      if (event !== null) yield event
    }
    if (dataLines.length > 0) {
      const event: SseEvent = { event: eventName ?? 'message', data: dataLines.join('\n') }
      eventName = null
      dataLines = []
      yield event
    }
  } finally {
    reader.releaseLock()
  }
}
