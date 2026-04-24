export type SuggestionType = 'question' | 'talking' | 'answer' | 'fact'

export interface Suggestion {
  type: SuggestionType
  text: string
}

export interface SuggestionBatch {
  suggestions: Suggestion[]
  timestamp: Date
}

export interface TranscriptEntry {
  text: string
  timestamp: Date
}

export interface ChatEntry {
  question: string
  type: SuggestionType | null
  answer: string
  timestamp: Date
}

export interface Settings {
  model: string
  suggestionPrompt: string
  chatPrompt: string
  suggestionContextWindow: number
  chatContextWindow: number
}

export const TYPE_LABELS: Record<SuggestionType, string> = {
  question: 'Question to ask',
  talking: 'Talking point',
  answer: 'Answer',
  fact: 'Fact-check',
}

export const TYPE_COLORS: Record<SuggestionType, string> = {
  question: 'bg-blue-900/50 text-blue-200 border-blue-700',
  talking: 'bg-purple-900/50 text-purple-200 border-purple-700',
  answer: 'bg-green-900/50 text-green-200 border-green-700',
  fact: 'bg-yellow-900/50 text-yellow-200 border-yellow-700',
}
