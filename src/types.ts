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
}

export interface Conversation {
  id: string
  title: string
  createdAt: number
  messages: Message[]
}
