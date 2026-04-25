import { Suggestion, SuggestionType, TranscriptEntry, Settings } from '@/types'

export const transcribeAudio = async (audioBlob: Blob, apiKey: string): Promise<string> => {
  const formData = new FormData()
  // MediaRecorder outputs webm, not wav, so the filename extension matters here.
  formData.append('file', audioBlob, 'audio.webm')
  formData.append('model', 'whisper-large-v3')

  const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData,
  })

  if (!response.ok) {
    const errorData = await response.json()
    throw new Error(errorData.error?.message || JSON.stringify(errorData))
  }

  const data = await response.json()
  return data.text?.trim() || ''
}

// Language is detected from the question/suggestion text for chat, and from
// <current_focus> for suggestions. We never hardcode a language so the app
// works for Bengali, Hindi, Arabic, Spanish, etc. out of the box.
const SUGGESTION_LANGUAGE_INSTRUCTION = `
LANGUAGE RULE — CRITICAL:
- Detect the language of the <current_focus> block.
- ALL suggestion "text" fields MUST be written in that SAME language and script.
- Bengali focus → Bengali text. Hindi → Hindi (Devanagari). Urdu → Urdu (Nastaliq). Spanish → Spanish. English → English. And so on.
- Field NAMES ("type", "text") and the "type" enum values stay in English — only the VALUE of "text" is translated.
- If the focus mixes two languages, reply in the dominant one.
- If the focus is unintelligible or empty, fall back to English.`

// For chat we detect language from the QUESTION TEXT ONLY, not the transcript.
// The transcript may contain Bengali or other languages from earlier in the
// session, but if the user clicked an English suggestion or typed in English,
// they expect an English answer.
const CHAT_LANGUAGE_INSTRUCTION = `
LANGUAGE RULE — CRITICAL:
- Detect the language of <user_question> below.
- Your ENTIRE answer MUST be in that SAME language and script, regardless of what language the transcript is in.
- English question → English answer. Bengali question → Bengali answer. Hindi → Hindi. Urdu → Urdu (Nastaliq). Spanish → Spanish. And so on.
- Never let the transcript language override the question language.
- If the question mixes two languages, reply in the dominant one.`

// A wrong fact stated confidently in a live meeting is worse than no fact at all.
// When the model isn't sure about a specific name, number, or date, it should
// surface a clarifying question instead of guessing.
const ACCURACY_INSTRUCTION = `
ACCURACY RULE — CRITICAL:
- If you are NOT highly confident in a specific name, date, number, statistic, citation, or attribution, you MUST NOT invent one.
- In that case, downgrade the suggestion to type "question" and frame it as a clarifying question that surfaces the uncertainty (e.g. "Who is the author of this work, and in what year was it first published?").
- Prefer a useful question to a wrong fact. Reviewers will fact-check confident claims; a hallucinated author/date/number is worse than no fact.
- If only PART of a claim is certain, state only the certain part and turn the uncertain part into the question.
- Never hedge inside a "fact" or "answer" suggestion with phrases like "I think", "possibly", "around", "approximately" to disguise a guess — either you know the number, or it becomes a question.
- This rule overrides the "must lead with answer when a question was asked" rule: if you do not actually know the answer, the lead suggestion becomes a clarifying question instead.`

export const generateSuggestions = async (
  transcript: TranscriptEntry[],
  settings: Settings,
  apiKey: string
): Promise<Suggestion[]> => {
  if (!apiKey || transcript.length === 0) return []

  // The old /[a-zA-Z]/ check silently dropped every non-Latin transcript entry.
  // Unicode \p{L} catches any script: Bengali, Hindi, Arabic, Chinese, etc.
  const isReadable = (text: string) => /\p{L}/u.test(text)

  // Only the most recent chunk drives suggestions. Older entries are passed as
  // background context so the model stays aware of the conversation without
  // drifting away from what was just said.
  const readableEntries = transcript.filter((e) => isReadable(e.text))
  const focusText = readableEntries.slice(-1)[0]?.text ?? ''

  if (!focusText) return []

  const backgroundEntries = readableEntries.slice(-10, -1)
  const backgroundText = backgroundEntries
    .map((e) => e.text)
    .join(' ')
    .slice(-settings.suggestionContextWindow)

  const userContent = backgroundText
    ? `<background_context>\n${backgroundText}\n</background_context>\n\n<current_focus>\n${focusText}\n</current_focus>`
    : `<current_focus>\n${focusText}\n</current_focus>`

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: settings.model,
      messages: [
        // Language and accuracy rules are appended here so they apply even if
        // the user edits the system prompt in Settings.
        {
          role: 'system',
          content:
            settings.suggestionPrompt +
            '\n\n' + SUGGESTION_LANGUAGE_INSTRUCTION +
            '\n\n' + ACCURACY_INSTRUCTION,
        },
        { role: 'user', content: userContent },
      ],
      // Non-Latin scripts cost 3-6x more tokens per character than Latin, so
      // 1024 tokens was cutting off mid-JSON for Bengali / Arabic responses.
      max_tokens: 2048,
      temperature: 0.7,
    }),
  })

  if (!response.ok) {
    const errorData = await response.json()
    throw new Error(errorData.error?.message || JSON.stringify(errorData))
  }

  const data = await response.json()
  const content = data.choices?.[0]?.message?.content || ''

  const VALID_TYPES = ['question', 'talking', 'answer', 'fact']
  const types: SuggestionType[] = ['question', 'talking', 'fact']

  const normaliseSuggestions = (arr: unknown[]): Suggestion[] =>
    arr
      .filter(
        (item): item is { type: string; text: string } =>
          typeof item === 'object' && item !== null && 'type' in item && 'text' in item
      )
      .map((item) => ({
        type: (VALID_TYPES.includes(item.type) ? item.type : 'question') as SuggestionType,
        text: String(item.text),
      }))
      .slice(0, 3)

  let parsed: Suggestion[] = []

  try {
    const jsonMatch = content.match(/\[[\s\S]*\]|\{[\s\S]*\}/)
    const cleaned = jsonMatch ? jsonMatch[0] : content.replace(/```json|```/g, '').trim()
    const raw = JSON.parse(cleaned)

    if (Array.isArray(raw)) {
      parsed = normaliseSuggestions(raw)
    } else if (raw && typeof raw === 'object') {
      const nested = Object.values(raw).find(Array.isArray) as unknown[] | undefined
      if (nested) parsed = normaliseSuggestions(nested)
    }
  } catch {
    // The model sometimes runs out of tokens mid-JSON, especially in non-Latin
    // scripts. Try to salvage any complete objects before giving up.
    try {
      const objectRegex = /\{\s*"type"\s*:\s*"([^"]+)"\s*,\s*"text"\s*:\s*"((?:[^"\\]|\\.)*)"\s*\}/g
      const salvaged: { type: string; text: string }[] = []
      let m: RegExpExecArray | null
      while ((m = objectRegex.exec(content)) !== null) {
        let text = m[2]
        try { text = JSON.parse('"' + m[2] + '"') } catch { /* keep raw */ }
        salvaged.push({ type: m[1], text })
      }
      if (salvaged.length > 0) parsed = normaliseSuggestions(salvaged)
    } catch {
      // fall through to text fallbacks
    }
  }

  // Numbered list fallback (e.g. "1. ..." or "1) ...")
  if (parsed.length === 0) {
    parsed = content
      .split('\n')
      .filter((line: string) => line.trim() && /^\d+[\.)]/.test(line))
      .map((line: string, i: number) => ({
        type: types[i % 3],
        text: line.replace(/^\d+[\.)] */, '').trim(),
      }))
      .slice(0, 3)
  }

  // Bullet list fallback
  if (parsed.length === 0) {
    parsed = content
      .split('\n')
      .filter((line: string) => line.trim() && /^[-•*]/.test(line.trim()))
      .map((line: string, i: number) => ({
        type: types[i % 3],
        text: line.replace(/^[-•*]\s*/, '').trim(),
      }))
      .slice(0, 3)
  }

  if (parsed.length === 0) {
    console.warn('[generateSuggestions] Could not parse model response:\n', content)
  }

  return parsed
}

export const sendChatMessage = async (
  question: string,
  type: SuggestionType | null,
  transcript: TranscriptEntry[],
  settings: Settings,
  apiKey: string,
  typeLabels: Record<SuggestionType, string>,
  onChunk: (chunk: string) => void
): Promise<void> => {
  const fullTranscript = transcript
    .map((e) => e.text)
    .join(' ')
    .slice(-settings.chatContextWindow)

  const typeContext = type ? `\nSuggestion type context: ${typeLabels[type]}` : ''

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: settings.model,
      stream: true,
      messages: [
        {
          role: 'system',
          content:
            settings.chatPrompt +
            '\n\n' + CHAT_LANGUAGE_INSTRUCTION +
            '\n\nACCURACY RULE — CRITICAL:\n' +
            '- If you are NOT highly confident in a specific name, date, number, statistic, citation, or attribution, do NOT invent one.\n' +
            '- Either state only the part you are confident about, or explicitly say what would need to be verified before answering (e.g. "I would need to verify the publication year before stating it.").\n' +
            '- A confidently wrong fact in a live meeting is worse than an honest "I am not sure of X — here is what I do know."\n' +
            '- Never use hedge words ("I think", "around", "approximately", "possibly") to disguise a guess as a fact.',
        },
        {
          role: 'user',
          // Question comes first so the model reads the language to reply in
          // before seeing the transcript. If transcript comes first, the model
          // tends to latch onto its language even when the question is different.
          content: `<user_question>\n${question}\n</user_question>${typeContext}\n\nMeeting transcript for context:\n\n${fullTranscript}`,
        },
      ],
      max_tokens: 1500,
      temperature: 0.5,
    }),
  })

  if (!response.ok) {
    const errorData = await response.json()
    throw new Error(errorData.error?.message || JSON.stringify(errorData))
  }

  const reader = response.body!.getReader()
  const decoder = new TextDecoder()

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    const chunk = decoder.decode(value)
    const lines = chunk.split('\n').filter((line) => line.startsWith('data: '))

    for (const line of lines) {
      const data = line.replace('data: ', '')
      if (data === '[DONE]') return
      try {
        const parsed = JSON.parse(data)
        const text = parsed.choices?.[0]?.delta?.content || ''
        if (text) onChunk(text)
      } catch {
        // skip malformed SSE chunks
      }
    }
  }
}
