import { UpstreamError } from "./types"

/**
 * Minimal SSE reader for provider streams: decodes a byte body and yields the
 * `data:` payload of every event, in arrival order. Handles CRLF, multi-byte
 * characters split across chunks, `:` comments, and events spread over several
 * `data:` lines (joined with "\n" per the SSE spec). `event:`/`id:`/`retry:`
 * fields are ignored — providers encode everything we need inside the JSON
 * payload.
 */
export async function* sseDataEvents(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<string, void, void> {
  const decoder = new TextDecoder("utf-8")
  let buffer = ""
  let dataLines: string[] = []

  /** Consume one line; returns the completed event's data on a blank line. */
  const consume = (rawLine: string): string | null => {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine
    if (line === "") {
      if (dataLines.length === 0) return null // keep-alive or comment-only event
      const data = dataLines.join("\n")
      dataLines = []
      return data
    }
    if (line.startsWith(":")) return null // SSE comment (keep-alive)
    const colon = line.indexOf(":")
    const field = colon === -1 ? line : line.slice(0, colon)
    let value = colon === -1 ? "" : line.slice(colon + 1)
    if (value.startsWith(" ")) value = value.slice(1)
    if (field === "data") dataLines.push(value)
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
        const data = consume(line)
        if (data !== null) yield data
        breakAt = buffer.search(/\r?\n/)
      }
    }
    // Stream ended: flush the decoder, then dispatch any final unterminated event.
    buffer += decoder.decode()
    if (buffer !== "") {
      const data = consume(buffer)
      if (data !== null) yield data
    }
    if (dataLines.length > 0) {
      const data = dataLines.join("\n")
      dataLines = []
      yield data
    }
  } finally {
    reader.releaseLock()
  }
}

/**
 * Parse one SSE `data:` payload as JSON, or raise the standard mid-stream
 * failure. Provider garbage never reaches the client as text.
 */
export function parseSseChunk(data: string, provider: string): unknown {
  try {
    return JSON.parse(data)
  } catch {
    throw new UpstreamError("upstream_error", `${provider} sent a malformed stream chunk`, {
      status: 502,
    })
  }
}
