'use client'

/* eslint-disable react-hooks/exhaustive-deps */
import { useState, useRef, useEffect, useCallback } from 'react'
import { TranscriptPanel } from '@/components/TranscriptPanel'
import { SuggestionsPanel } from '@/components/SuggestionsPanel'
import { ChatPanel } from '@/components/ChatPanel'
import { SettingsModal } from '@/components/SettingsModal'
import { useCountdown } from '@/hooks/useCountdown'
import { transcribeAudio, generateSuggestions, sendChatMessage } from '@/lib/groq'
import { exportSession } from '@/lib/exportSession'
import {
  TranscriptEntry,
  SuggestionBatch,
  ChatEntry,
  Settings,
  SuggestionType,
  TYPE_LABELS,
} from '@/types'

const DEFAULT_SUGGESTION_PROMPT = `You are an AI meeting copilot. Analyze the conversation and generate exactly 3 diverse, high-value suggestions.

Rules:
1. Output ONLY a valid JSON array of exactly 3 objects. No markdown, no explanation, no preamble.
2. Each object must have exactly two fields: "type" and "text".
3. "type" must be one of: "question", "talking", "answer", "fact"
   - "question": A sharp follow-up question the speaker should ask next
   - "talking": A non-obvious talking point worth raising or expanding on
   - "answer": A direct, specific answer to a question just asked in the transcript
   - "fact": A precise fact-check or clarification on a claim made in the transcript
4. TOPIC FOCUS — MOST IMPORTANT RULE:
   - The user input has a <current_focus> block and optionally a <background_context> block.
   - ALL 3 suggestions MUST be strictly about the topic in <current_focus>.
   - If <current_focus> contains a question (e.g. "What is the capital of X?"), at least one suggestion must directly answer it with type "answer".
   - If <current_focus> contains multiple topics, pick the LAST one mentioned and base all 3 suggestions on it exclusively.
   - NEVER generate suggestions about topics only in <background_context>. Treat background as read-only context.
5. LANGUAGE — CRITICAL:
   - Detect the language of <current_focus> and write every "text" field in that SAME language and script.
   - Bengali focus → Bengali text. Hindi focus → Hindi (Devanagari) text. Urdu focus → Urdu (Nastaliq) text. Spanish → Spanish. English → English. And so on.
   - Field names ("type", "text") and the type enum values stay in English. Only translate the value of "text".
   - If the focus is code-switched between two languages, reply in the dominant language of the focus.
6. ACCURACY — CRITICAL (anti-hallucination):
   - If you are NOT highly confident in a specific name, date, number, statistic, citation, or attribution, you MUST NOT invent one.
   - Downgrade that suggestion to type "question" and frame it as a clarifying question that surfaces the uncertainty (e.g. "Who is the author of this work, and in what year was it first published?").
   - Prefer a useful question to a wrong fact. A confidently wrong fact in a live meeting is worse than no fact.
   - Never use hedge words ("I think", "around", "approximately", "possibly") inside a "fact" or "answer" — those disguise a guess. Either you know it, or it becomes a "question".
   - This rule overrides rule 7 below: if a question was asked and you do not actually know the answer, the lead suggestion becomes a clarifying question instead of an "answer".
7. NO REPETITION — CRITICAL:
   - Never surface a fact or talking point that is already obvious or that a 10-year-old would know.
   - Every suggestion must contain a non-obvious insight, a specific number, a named source, or a counterintuitive angle the speaker likely does not have top of mind.
   - Do not repeat a fact or point across suggestions in the same batch.
8. Choose types based on what is most useful RIGHT NOW:
   - If a direct question was just asked AND you are confident in the answer → lead with "answer" containing the specific answer + one surprising related fact
   - If a direct question was just asked AND you are NOT confident in the answer → lead with a clarifying "question" (per rule 6)
   - If a debatable claim was made → lead with "fact" that challenges or nuances it
   - If a topic is introduced broadly → use "question" + "talking" + "fact" to deepen it
9. Keep each "text" under 20 words — scannable at a glance, already useful without clicking.
10. Adapt depth to context:
   - Simple factual question → answer it precisely, then add depth (history, controversy, or implication)
   - Technical topic → specific numbers, tradeoffs, named examples
   - Debate topic → strongest steelman of the less-obvious side
   - Comparison question → the single most decisive differentiating metric

Example for "What is the capital of Egypt?":
[
  {"type": "answer", "text": "Cairo — population 21M, largest city in Africa and Arab world."},
  {"type": "fact", "text": "Egypt is building a new administrative capital east of Cairo, relocating government by 2025."},
  {"type": "question", "text": "Should the debate include Egypt's new administrative capital as a separate entity?"}
]

Example for "ভারতের রাজধানী কী?" (Bengali — "What is the capital of India?"):
[
  {"type": "answer", "text": "নয়াদিল্লি — ভারতের রাজধানী, মেট্রো এলাকার জনসংখ্যা প্রায় ৩.২ কোটি।"},
  {"type": "fact", "text": "১৯১১ সালে কলকাতা থেকে রাজধানী সরিয়ে নয়াদিল্লি করা হয়েছিল ব্রিটিশ শাসনামলে।"},
  {"type": "question", "text": "দিল্লির বায়ু দূষণ রাজধানী হিসেবে এর ভবিষ্যৎকে কীভাবে প্রভাবিত করছে?"}
]`

const DEFAULT_CHAT_PROMPT = `You are an expert AI meeting copilot. A user is in a live meeting and has clicked on a suggestion or asked a question.

The user is in a LIVE meeting — lead with the most useful point in your first sentence. They may only have 30 seconds to read this.

You have access to the full meeting transcript provided below. Ground every answer in what was actually said. Do not invent context that is not in the transcript.

Your job: provide a detailed, actionable, and accurate answer.

LANGUAGE — CRITICAL:
- Detect the language of the user's question (or the clicked suggestion text).
- Reply in that SAME language and script. Bengali question → Bengali answer. Hindi → Hindi. Urdu → Urdu (Nastaliq). Spanish → Spanish. English → English.
- If the question is code-switched, reply in the dominant language of the question.

Guidelines:
- Be specific and concrete. Avoid vague generalities.
- Reference what was actually said in the transcript when relevant.
- If it is a "fact" type suggestion, verify or correct the claim clearly.
- If it is a "question" type, help the user understand what answer to expect or how to frame it.
- If it is an "answer" type, expand on it with supporting detail.
- If it is a "talking" type, help them articulate it persuasively.
- Keep responses focused: 2-4 paragraphs max. Use bullet points for lists.
- End with one concrete next step or follow-up action.`

export const LiveSuggestionsApp = () => {
  const [isRecording, setIsRecording] = useState(false)
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([])
  const [suggestionBatches, setSuggestionBatches] = useState<SuggestionBatch[]>([])
  const [chat, setChat] = useState<ChatEntry[]>([])
  const [apiKey, setApiKey] = useState('')
  const [showSettings, setShowSettings] = useState(false)
  const [chatInput, setChatInput] = useState('')
  const [status, setStatus] = useState<string>('Ready')
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false)
  const [isLoadingChat, setIsLoadingChat] = useState(false)
  const [settings, setSettings] = useState<Settings>({
    model: 'openai/gpt-oss-120b',
    suggestionPrompt: DEFAULT_SUGGESTION_PROMPT,
    chatPrompt: DEFAULT_CHAT_PROMPT,
    suggestionContextWindow: 2000,
    chatContextWindow: 6000,
  })

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const transcriptStateRef = useRef<TranscriptEntry[]>([])
  const isRecordingRef = useRef(false)
  const settingsRef = useRef(settings)
  const apiKeyRef = useRef(apiKey)
  const isLoadingSuggestionsRef = useRef(false)

  useEffect(() => { transcriptStateRef.current = transcript }, [transcript])
  useEffect(() => { isRecordingRef.current = isRecording }, [isRecording])
  useEffect(() => { settingsRef.current = settings }, [settings])
  useEffect(() => { apiKeyRef.current = apiKey }, [apiKey])

  const runGenerateSuggestions = useCallback(async (src: TranscriptEntry[]) => {
    const key = apiKeyRef.current
    const s = settingsRef.current
    if (!key || src.length === 0 || isLoadingSuggestionsRef.current) return

    isLoadingSuggestionsRef.current = true
    setIsLoadingSuggestions(true)
    setStatus('Generating suggestions...')

    try {
      const parsed = await generateSuggestions(src, s, key)
      if (parsed.length > 0) {
        setSuggestionBatches((prev) => [{ suggestions: parsed, timestamp: new Date() }, ...prev])
        setStatus(`${parsed.length} suggestions ready`)
      } else {
        setStatus('No valid suggestions returned — check your prompt format')
      }
    } catch (error) {
      setStatus(`Suggestions error: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      isLoadingSuggestionsRef.current = false
      setIsLoadingSuggestions(false)
    }
  }, [])

  const handleSendToChat = useCallback(async (question: string, type: SuggestionType | null) => {
    const key = apiKeyRef.current
    const s = settingsRef.current
    if (!key) {
      setStatus('Please enter your Groq API key in Settings')
      return
    }
    setIsLoadingChat(true)
    setStatus('Thinking...')

    setChat((prev) => [...prev, { question, type, answer: '', timestamp: new Date() }])

    try {
      await sendChatMessage(
        question,
        type,
        transcriptStateRef.current,
        s,
        key,
        TYPE_LABELS,
        (chunk) => {
          setChat((prev) =>
            prev.map((entry, i) =>
              i === prev.length - 1
                ? { ...entry, answer: entry.answer + chunk }
                : entry
            )
          )
        }
      )
      setStatus('Response received')
    } catch (error) {
      setStatus(`Chat error: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setIsLoadingChat(false)
    }
  }, [])

  const streamRef = useRef<MediaStream | null>(null)
  const activeRecordersRef = useRef<Set<MediaRecorder>>(new Set())

  // FIX: align the boundary between two adjacent transcript entries.
  //
  // Adjacent chunks overlap by ~2 seconds of audio. Whisper transcribes
  // the END of a chunk less reliably than the START of one (it has no
  // future audio to disambiguate the half-cut last word — e.g. it heard
  // "trans-" and guessed "transformation" instead of "transcript"). So
  // simply trimming the start of `next` against the end of `prev` fails
  // when the two transcriptions of the overlap audio differ.
  //
  // Strategy: search for the LONGEST matching word run anywhere in the
  // last K words of `prev` and the first K words of `next`. The matched
  // run is the bridge — keep it once at the start of `next`, and trim
  // `prev` from where the matched run begins (which discards Whisper's
  // unreliable end-of-chunk guess as well).
  const alignBoundary = useCallback(
    (prev: string, next: string): { newPrev: string | null; newNext: string } => {
      if (!prev || !next) return { newPrev: null, newNext: next }

      const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').trim()
      const prevWords = prev.split(/\s+/).filter(Boolean)
      const nextWords = next.split(/\s+/).filter(Boolean)
      const prevNorm = prevWords.map(norm)
      const nextNorm = nextWords.map(norm)

      const K = 15
      const tailStartIdx = Math.max(0, prevNorm.length - K)
      const tail = prevNorm.slice(tailStartIdx)
      const head = nextNorm.slice(0, Math.min(K, nextNorm.length))

      // Longest common contiguous word run.
      let bestLen = 0
      let bestTailPos = -1
      for (let i = 0; i < tail.length; i++) {
        for (let j = 0; j < head.length; j++) {
          let len = 0
          while (
            i + len < tail.length &&
            j + len < head.length &&
            tail[i + len].length > 0 &&
            tail[i + len] === head[j + len]
          ) {
            len++
          }
          if (len > bestLen) {
            bestLen = len
            bestTailPos = i
          }
        }
      }

      // Require at least 2 matching words to count as a real overlap.
      if (bestLen < 2) return { newPrev: null, newNext: next }

      const cutIdx = tailStartIdx + bestTailPos
      const matchEndIdx = cutIdx + bestLen
      const prevSuffix = prevWords.slice(matchEndIdx)

      // FALSE-POSITIVE GUARD #1 — sentence-end punctuation after the match.
      //
      // A real audio overlap puts the matched words at the very END of `prev`.
      // If `prev` still has words AFTER the matched portion AND any of those
      // trailing words ends with sentence-final punctuation, then `prev` is a
      // complete utterance whose START coincidentally shares a prefix with
      // `next`. They are two different questions, NOT one cut-in-half utterance.
      //
      // Example that previously merged incorrectly:
      //   prev = "What is the capital of Egypt?"
      //   next = "What is the capital of India?"
      //   match = "What is the capital of" (5 words, at start of both)
      //   suffix of prev after match = ["Egypt?"] → contains "?" → reject merge.
      //
      // Punctuation set covers Latin (.!?), Devanagari/Bengali (।), Arabic (؟),
      // and CJK (。！？) so the guard works across the multilingual transcripts
      // this app supports.
      const SENTENCE_END = /[.!?।؟。！？]/
      if (prevSuffix.some((w) => SENTENCE_END.test(w))) {
        return { newPrev: null, newNext: next }
      }

      // FALSE-POSITIVE GUARD #2 — too much unmatched content after the match.
      //
      // Real audio overlap with Whisper end-of-chunk noise leaves at most
      // ~1-2 unmatched trailing words in prev. If much more than that follows
      // the match, the match is in the middle of prev (not at its tail) — it
      // is a coincidence, not an overlap.
      const MAX_TAIL_NOISE = 2
      if (prevSuffix.length > MAX_TAIL_NOISE) {
        return { newPrev: null, newNext: next }
      }

      // Trim `prev` from the start of the matched run onward — that drops
      // both the matched bridge (kept in `next`) and any unreliable
      // boundary words Whisper invented after it.
      const trimmedPrev = prevWords.slice(0, cutIdx).join(' ').trim()
      return { newPrev: trimmedPrev, newNext: next }
    },
    []
  )

  const startChunkRecorder = useCallback((stream: MediaStream) => {
    if (!isRecordingRef.current) return

    const recorder = new MediaRecorder(stream)
    mediaRecorderRef.current = recorder
    activeRecordersRef.current.add(recorder)

    const chunks: Blob[] = []
    let nextStarted = false
    let overlapTimer: ReturnType<typeof setTimeout> | null = null
    let stopTimer: ReturnType<typeof setTimeout> | null = null

    const startNext = () => {
      if (nextStarted) return
      nextStarted = true
      if (isRecordingRef.current && streamRef.current) {
        startChunkRecorder(streamRef.current)
      }
    }

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data)
    }

    recorder.onstop = async () => {
      if (overlapTimer) clearTimeout(overlapTimer)
      if (stopTimer) clearTimeout(stopTimer)
      activeRecordersRef.current.delete(recorder)

      if (isRecordingRef.current) startNext()

      if (chunks.length === 0) return

      const audioBlob = new Blob(chunks, { type: chunks[0].type || 'audio/webm' })
      const key = apiKeyRef.current
      if (!key) { setStatus('Please enter your Groq API key in Settings'); return }

      setStatus('Transcribing...')
      try {
        const text = await transcribeAudio(audioBlob, key)
        if (text) {
          const prevTranscript = transcriptStateRef.current
          const lastEntry = prevTranscript[prevTranscript.length - 1]
          const aligned = lastEntry
            ? alignBoundary(lastEntry.text, text)
            : { newPrev: null, newNext: text }

          if (lastEntry && aligned.newNext === lastEntry.text) {
            // Same text as the previous chunk. Common cases:
            //   1. The user deliberately repeated the same question (e.g.
            //      because the first attempt failed with a rate-limit error
            //      and produced no suggestions).
            //   2. Whisper re-transcribed the same audio after a silent gap.
            // In either case we do NOT want to append a duplicate transcript
            // line, BUT we DO want to re-fire suggestions — otherwise a
            // rate-limited first ask leaves the user stuck with no way to
            // retry just by speaking again.
            setStatus('Same as last chunk — regenerating suggestions')
            resetCountdown()
            runGenerateSuggestions(prevTranscript)
          } else if (!aligned.newNext) {
            // Overlap fully matched the previous entry's tail — nothing new
            // to append. Treat this as another retry trigger so the user can
            // recover from a failed previous suggestion call.
            setStatus('Overlap fully matched — regenerating suggestions')
            resetCountdown()
            runGenerateSuggestions(prevTranscript)
          } else {
            const head = prevTranscript.slice(0, -1)
            const next: TranscriptEntry[] = [...head]
            if (lastEntry) {
              if (aligned.newPrev === null) {
                next.push(lastEntry)
              } else if (aligned.newPrev.length > 0) {
                next.push({ ...lastEntry, text: aligned.newPrev })
              }
              // aligned.newPrev === '' means the entire previous entry was
              // duplicated — drop it so the new entry stands alone.
            }
            next.push({ text: aligned.newNext, timestamp: new Date() })

            transcriptStateRef.current = next
            setTranscript(next)
            setStatus('Transcribed successfully')
            resetCountdown()
            runGenerateSuggestions(next)
          }
        } else {
          setStatus('No speech detected in this chunk')
        }
      } catch (error) {
        setStatus(`Transcription error: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    recorder.start()

    const CHUNK_MS = 30000
    const OVERLAP_MS = 2000

    overlapTimer = setTimeout(startNext, CHUNK_MS - OVERLAP_MS)

    stopTimer = setTimeout(() => {
      if (recorder.state === 'recording') recorder.stop()
    }, CHUNK_MS)
  }, [runGenerateSuggestions, alignBoundary])

  const { countdown, resetCountdown } = useCountdown(isRecording, () => {
    runGenerateSuggestions(transcriptStateRef.current)
  })

  const handleManualRefresh = useCallback(() => {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop()
    }
    resetCountdown()
    runGenerateSuggestions(transcriptStateRef.current)
  }, [resetCountdown, runGenerateSuggestions])

  const handleToggleRecording = async () => {
    if (isRecording) {
      isRecordingRef.current = false
      for (const r of Array.from(activeRecordersRef.current)) {
        if (r.state === 'recording') r.stop()
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop())
        streamRef.current = null
      }
      setIsRecording(false)
      setStatus('Stopped. Click to resume.')
    } else {
      if (!apiKey) {
        setStatus('Please enter your Groq API key in Settings first')
        setShowSettings(true)
        return
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        streamRef.current = stream
        isRecordingRef.current = true
        setIsRecording(true)
        setStatus('Recording... transcript updates every 30s')
        startChunkRecorder(stream)
      } catch (error) {
        setStatus(`Microphone error: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }

  const handleChatSend = () => {
    const v = chatInput.trim()
    if (!v || isLoadingChat) return
    handleSendToChat(v, null)
    setChatInput('')
  }

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg)', color: 'var(--text)', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', borderBottom: '1px solid var(--border)', background: 'var(--panel)', flexShrink: 0 }}>
        <h1 style={{ fontSize: 14, fontWeight: 600, margin: 0, letterSpacing: '.3px' }}>TwinMind — Live Suggestions</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>
            {isRecording ? '● recording' : 'idle'}
          </span>
          <button
            onClick={() => exportSession(transcript, suggestionBatches, chat)}
            style={{ background: 'var(--panel-2)', color: 'var(--text)', border: '1px solid var(--border)', padding: '6px 12px', borderRadius: 6, fontSize: 12, cursor: 'pointer' }}
          >
            Export JSON
          </button>
          <button
            onClick={() => setShowSettings(!showSettings)}
            style={{ background: 'var(--panel-2)', color: 'var(--text)', border: '1px solid var(--border)', padding: '6px 12px', borderRadius: 6, fontSize: 12, cursor: 'pointer' }}
          >
            ⚙ Settings
          </button>
        </div>
      </div>

      <div style={{ padding: '6px 16px', background: 'rgba(110,168,254,.08)', borderBottom: '1px solid rgba(110,168,254,.3)', fontSize: 12, color: '#cfd3dc', flexShrink: 0 }}>
        {status}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, padding: 12, flex: 1, minHeight: 0, overflow: 'hidden' }}>
        <TranscriptPanel
          transcript={transcript}
          isRecording={isRecording}
          onToggleRecording={handleToggleRecording}
        />

        <SuggestionsPanel
          suggestionBatches={suggestionBatches}
          countdown={countdown}
          isRecording={isRecording}
          isLoadingSuggestions={isLoadingSuggestions}
          onRefresh={handleManualRefresh}
          onSuggestionClick={(text, type) =>
            handleSendToChat(text, type as SuggestionType)
          }
        />

        <ChatPanel
          chat={chat}
          chatInput={chatInput}
          isLoadingChat={isLoadingChat}
          onChatInputChange={setChatInput}
          onChatSend={handleChatSend}
        />
      </div>

      <SettingsModal
        isOpen={showSettings}
        apiKey={apiKey}
        settings={settings}
        onApiKeyChange={setApiKey}
        onSettingsChange={setSettings}
        onClose={() => setShowSettings(false)}
      />
    </div>
  )
}
