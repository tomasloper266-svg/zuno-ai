export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  ts: number
  /** True when the reply comes from the clearly-labeled demo engine (no live model). */
  demo?: boolean
}

export interface Conversation {
  id: string
  title: string
  createdAt: number
  messages: Message[]
}
