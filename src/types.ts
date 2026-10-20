export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  ts: number
  /** True when the reply comes from the clearly-labeled demo engine (no live model). */
  demo?: boolean
  /**
   * True for the app-authored conversation greeting seeded at creation: it is
   * display copy, not a model turn, so it never enters the thread sent to the
   * model (see toThread) — that also keeps threads from starting assistant-first.
   */
  seeded?: boolean
  /**
   * True when this reply was cut short before finishing — the stop button or
   * the stall watchdog — and the partial text shown so far was kept. Rendered
   * with a distinct visual state (see MessageBubble); absent on normal replies.
   */
  stopped?: boolean
  /**
   * True when this reply's stream FAILED midway and the partial text shown so
   * far was salvaged instead of lost. Distinct from `stopped` (the user's or
   * watchdog's intent) — it renders a Failed badge and its own retry, which
   * re-runs the request replacing this message in place (same stable id).
   */
  failed?: boolean
}

export interface Conversation {
  id: string
  title: string
  createdAt: number
  messages: Message[]
  /**
   * True while `title` is still the creation-time slice of the first user
   * message; the heuristic title (lib/title deriveTitle) replaces it when the
   * first reply completes. Conversations stored before this field existed have
   * it undefined — treated as provisional, so their next completed reply
   * upgrades the title too.
   */
  titleProvisional?: boolean
}
