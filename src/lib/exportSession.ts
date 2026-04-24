import { TranscriptEntry, SuggestionBatch, ChatEntry } from '@/types'

export const exportSession = (
  transcript: TranscriptEntry[],
  suggestionBatches: SuggestionBatch[],
  chat: ChatEntry[]
) => {
  const data = {
    exportedAt: new Date().toISOString(),
    transcript: transcript.map((e) => ({
      timestamp: e.timestamp.toISOString(),
      text: e.text,
    })),
    suggestionBatches: suggestionBatches.map((b) => ({
      timestamp: b.timestamp.toISOString(),
      suggestions: b.suggestions,
    })),
    chat: chat.map((c) => ({
      timestamp: c.timestamp.toISOString(),
      type: c.type,
      question: c.question,
      answer: c.answer,
    })),
  }
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `twinmind-session-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.json`
  a.click()
  URL.revokeObjectURL(url)
}
