import { Suggestion, SuggestionType, TranscriptEntry, Settings } from '@/types'

export const transcribeAudio = async (audioBlob: Blob, apiKey: string): Promise<string> => {
  const formData = new FormData()
  // FIX: use .webm extension — MediaRecorder produces webm, not wav.
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

// Multilingual language instruction appended to every suggestion + chat call.
// We do NOT hardcode a language — we let the model detect it from the
// <current_focus> text itself. This works for English, Bengali, Hindi, Urdu,
// Spanish, Arabic, code-switched speech, etc.
const LANGUAGE_INSTRUCTION = `
LANGUAGE RULE — CRITICAL:
- Detect the language of the <current_focus> block (or the user question for chat).
- ALL suggestion "text" fields (or your chat answer) MUST be written in that SAME language and script.
- If <current_focus> is in Bengali, reply in Bengali. If Hindi, reply in Hindi. If Urdu, reply in Urdu (Nastaliq script). If English, reply in English. If Spanish, reply in Spanish. And so on.
- Field NAMES ("type", "text") and the "type" enum values ("question", "talking", "answer", "fact") stay in English — only the VALUE of "text" is translated.
- If the focus mixes two languages (code-switching), reply in the dominant language of the focus.
- If the focus is unintelligible or empty, fall back to English.`

// Anti-hallucination guardrail. The model is in a LIVE conversation surface,
// so a confidently wrong fact is worse than no fact. When the model is not
// sure of a specific name, date, number, citation, or attribution, it should
// downgrade that suggestion to a clarifying QUESTION instead of inventing.
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

  // FIX: previously this was /[a-zA-Z]/ which silently dropped every Bengali,
  // Hindi, Urdu, Arabic, Chinese, etc. transcript entry. Use the Unicode
  // "Letter" property so any script counts as readable. We still reject
  // entries that are pure punctuation / whitespace / digits.
  const isReadable = (text: string) => /\p{L}/u.test(text)

  // Focus on ONLY the most recent readable entry — what was *just* said.
  // Older entries flow in as <background_context> for situational awareness
  // but must NOT drive the suggestions (the system prompt enforces this).
  const readableEntries = transcript.filter((e) => isReadable(e.text))
  const focusText = readableEntries.slice(-1)[0]?.text ?? ''

  if (!focusText) return []

  // BACKGROUND: older readable entries (everything except the focus entry).
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
        // Always append the language + accuracy instructions so even old saved
        // prompts get multilingual behaviour AND anti-hallucination behaviour
        // without the user editing settings.
        {
          role: 'system',
          content:
            settings.suggestionPrompt +
            '\n\n' + LANGUAGE_INSTRUCTION +
            '\n\n' + ACCURACY_INSTRUCTION,
        },
        { role: 'user', content: userContent },
      ],
      // Non-Latin scripts (Bengali, Hindi, Urdu, Arabic, Chinese, etc.) cost
      // ~3-6x more tokens per character than Latin, so 1024 frequently truncated
      // the JSON mid-string. 2048 is a comfortable headroom for 3 short suggestions
      // in any script.
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
    // JSON parse failed — most often because the model ran out of tokens
    // mid-string (especially in non-Latin scripts where characters are
    // expensive). Salvage every complete {"type": "...", "text": "..."}
    // object we can find — the trailing one that got cut is just dropped.
    try {
      const objectRegex = /\{\s*"type"\s*:\s*"([^"]+)"\s*,\s*"text"\s*:\s*"((?:[^"\\]|\\.)*)"\s*\}/g
      const salvaged: { type: string; text: string }[] = []
      let m: RegExpExecArray | null
      while ((m = objectRegex.exec(content)) !== null) {
        // Reverse-translate JSON string escapes (\\ \" \n etc.).
        let text = m[2]
        try { text = JSON.parse('"' + m[2] + '"') } catch { /* keep raw */ }
        salvaged.push({ type: m[1], text })
      }
      if (salvaged.length > 0) parsed = normaliseSuggestions(salvaged)
    } catch {
      // fall through to text fallbacks
    }
  }

  if (parsed.length === 0) {
    parsed = content
      .split('\n')
      .filter((line: string) => line.trim() && /^\d+[\.\)]/.test(line))
      .map((line: string, i: number) => ({
        type: types[i % 3],
        text: line.replace(/^\d+[\.\)]\s*/, '').trim(),
      }))
      .slice(0, 3)
  }

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
        // Same language + accuracy rules applied to chat — answer in the
        // language of the user's question (or the clicked suggestion), and
        // refuse to invent specifics; flag uncertainty instead.
        {
          role: 'system',
          content:
            settings.chatPrompt +
            '\n\n' + LANGUAGE_INSTRUCTION +
            '\n\nACCURACY RULE — CRITICAL:\n' +
            '- If you are NOT highly confident in a specific name, date, number, statistic, citation, or attribution, do NOT invent one.\n' +
            '- Either state only the part you are confident about, or explicitly say what would need to be verified before answering (e.g. "I would need to verify the publication year before stating it.").\n' +
            '- A confidently wrong fact in a live meeting is worse than an honest "I am not sure of X — here is what I do know."\n' +
            '- Never use hedge words ("I think", "around", "approximately", "possibly") to disguise a guess as a fact.',
        },
        {
          role: 'user',
          content: `Full meeting transcript:\n\n${fullTranscript}${typeContext}\n\nQuestion/Suggestion: ${question}`,
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
        // skip malformed chunks
      }
    }
  }
}
