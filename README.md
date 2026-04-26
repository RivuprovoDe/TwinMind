# TwinMind Live Suggestions

A web app that listens to your microphone and surfaces three useful suggestions every ~30 seconds based on what's being said. Clicking a suggestion opens a detailed answer in the chat panel, grounded in the full transcript.

Built for the TwinMind Live Suggestions assignment (April 2026).

- **Live demo:** _ https://twin-mind-rho.vercel.app/
- **Stack:** Next.js (App Router) + React + TypeScript + Tailwind, Groq API for transcription and chat.

---

## Quick start

```bash
git clone <repo-url>
cd <repo-folder>
npm install
npm run dev
```

Open `http://localhost:3000`, click the gear icon, and paste your Groq API key. No `.env` file needed — the key stays in browser memory for the session and is never written to disk or sent anywhere except Groq.

You can get a free Groq API key at [console.groq.com](https://console.groq.com).

---

## Stack and model choices

| Layer | Choice | Why |
|---|---|---|
| Framework | **Next.js 14 (App Router)** | One codebase, deploys to Vercel or Netlify with zero config. |
| Language | **TypeScript** | The data flowing between the three panels has enough shape that types genuinely help. |
| Styling | **Tailwind CSS** | Fast to iterate on layout without writing custom CSS. |
| Transcription | **Groq Whisper Large V3** | Required by the assignment. Good multilingual coverage and fast enough for 30-second chunks. |
| Suggestions + Chat | **Groq `openai/gpt-oss-120b`** | Required by the assignment. Handles the 30-second cadence well and produces varied suggestion mixes. |
| Audio capture | **Browser `MediaRecorder` API** | No extra dependency. Works in every modern browser and outputs webm/opus chunks that Whisper accepts directly. |

**No backend.** The browser talks straight to the Groq API using the user's own key. No proxy, no database, no auth, no server logs. This means zero deploy cost and the user's key never touches any system we run.

---

## Architecture

Three columns, one session per page load:

```
+------------------+---------------------+-----------------+
| Transcript       | Live suggestions    | Chat            |
| (left)           | (middle)            | (right)         |
|                  |                     |                 |
| Mic on/off       | Refresh button      | Type a question |
| Auto-scroll      | 30s countdown       | Click a card    |
| 30s chunks       | 3 cards per batch   | Streaming reply |
|                  | Newest batch on top | Full transcript |
|                  |                     | as context      |
+------------------+---------------------+-----------------+
```

### Audio chunking

`MediaRecorder` records in 30-second windows with a 2-second overlap between chunks. The overlap matters: without it, words at a chunk boundary get cut in half and Whisper produces garbage at both ends. With it, both chunks contain the boundary words, and we remove the duplicate in code (see _Boundary alignment_ below).

When a chunk finishes, the next one has already been recording for 2 seconds, so there's no gap in the audio. The only pause the user notices is while Whisper processes the chunk.

### Boundary alignment

Two adjacent transcripts share whatever was said during the 2-second overlap, but Whisper is less reliable at the end of a chunk than the start (it has no future audio to resolve the last half-cut word). The approach:

1. Find the longest matching word run between the last 15 words of `prev` and the first 15 words of `next`.
2. Check for false positives (see _Challenges_ below).
3. If the match looks real, keep it once at the start of `next` and trim `prev` from where the match begins. This also drops Whisper's shaky end-of-chunk guess.

### Suggestion generation

On every chunk (~30s) and every manual refresh:

1. Filter to readable transcript entries using `\p{L}` (Unicode letter property, works for any script).
2. Use the most recent entry as `<current_focus>` — this is what the suggestions must address.
3. Use the previous up-to-10 entries (capped by `suggestionContextWindow` chars) as `<background_context>` for general awareness.
4. Send to Groq with a prompt that requires a JSON array of exactly 3 suggestions.
5. Parse, prepend to the batch list, render. Old batches stay visible below.

### Chat

Clicking a suggestion (or typing a question) sends the full transcript as context (capped by `chatContextWindow`) along with the question. The reply streams token by token into the chat panel. If the request fails, the entry shows an error message instead of sitting on "Thinking..." forever.

### Export

One button writes a JSON file with the transcript, every suggestion batch, and the full chat, all timestamped. This is the file reviewers use to check session quality.

---

## Prompt strategy

The prompt structure is the most important part of this app. Five things matter:

### 1. Focus vs. background split

The model is told that `<current_focus>` drives all three suggestions and `<background_context>` is read-only. Without this, the model drifts and picks up whatever it found most interesting in the transcript, which is often not what the user just said. With it, suggestions stay on the active topic.

### 2. Strict JSON output

The prompt opens with hard constraints: output only a JSON array of exactly 3 objects, no markdown, no explanation. If the model wraps the array in even one line of prose, the parse fails and the user sees nothing. The first three rules in the prompt are entirely about keeping the output clean.

### 3. Mixed types with priority rules

The four types (`question`, `talking`, `answer`, `fact`) are defined with rules for when to use each:

- Direct question asked and answer is known: lead with `answer`.
- Debatable claim made: lead with `fact`.
- Topic introduced broadly: use `question` + `talking` + `fact` to open it up.

This is what makes the mix feel considered rather than random.

### 4. Multilingual

A `LANGUAGE RULE` block tells the model to detect the language of `<current_focus>` and write every suggestion in that same language and script. For chat, the rule is stricter: detect from `<user_question>` only, and ignore the transcript language entirely. This is what prevents Bengali transcript entries from bleeding into English chat answers. Bengali in, Bengali suggestions out. Hindi in, Hindi out. Verified on real exports.

### 5. Anti-hallucination

An `ACCURACY RULE` block tells the model: if you are not confident in a specific name, date, number, or citation, don't invent one. Downgrade it to a `question` type instead. Hedge words like "I think" or "approximately" are banned inside `fact` and `answer` types because they hide a guess. A clarifying question is a better outcome than a wrong fact stated confidently in a live meeting.

### Defaults are configurable

Both prompts and both context windows are editable in the Settings panel. What ships in the code are the values I landed on after testing. Anyone can tweak them live.

---

## Tradeoffs

- **No backend.** Upside: zero hosting cost, no key handling on our side, nothing to auth. Downside: the Groq key lives in browser memory and has to be re-entered on reload. Fine for a take-home; in production you'd encrypt it server-side behind an auth layer.
- **No persistence.** Sessions reset on reload, which the assignment explicitly allows. Export is the escape hatch.
- **No streaming on suggestions.** Chat streams token by token, but suggestions arrive all at once because we need a complete JSON array to parse. Streaming would feel faster but needs a partial-JSON parser. I built a salvage regex for the truncation case but stopped short of full streaming.
- **No proper noun correction.** Whisper sometimes mis-transcribes names. Rather than try to fix them, the accuracy rule handles it gracefully by turning uncertain attributions into questions instead of inventing wrong answers.
- **No language hint to Whisper.** Whisper auto-detects language per chunk, which can produce cross-script noise on low-confidence audio. Pinning a language would fix this for monolingual sessions but break multilingual ones. See _Future improvements_.

---

## Challenges I ran into

These are real bugs I found while testing and the fixes I shipped.

### 1. Non-Latin transcripts were silently dropped

The readability filter was `/[a-zA-Z]/`. Any entry with no Latin letters (Bengali, Hindi, Urdu, Arabic, CJK) was filtered out before reaching the model, so the user would speak in Bengali and see zero suggestions with no error.

**Fix:** changed the regex to `/\p{L}/u`. The Unicode Letter property matches letters in any script. Pure punctuation, digits, and whitespace are still filtered out.

### 2. Suggestions cut off mid-JSON

With `max_tokens = 1024`, longer multilingual responses got truncated mid-string. The JSON parser then rejected the entire response and the user saw nothing.

**Fix:** bumped `max_tokens` to 2048 and added a fallback regex that salvages complete `{"type", "text"}` objects out of a truncated array. Two suggestions are better than none.

### 3. The model made up facts

Asked "Who wrote Hutom Pyanchar Naksha?", the model would confidently name the wrong author. In a live meeting that's a real problem — someone might repeat it.

**Fix:** added the `ACCURACY RULE` block to both the suggestion and chat prompts. The model now turns uncertain claims into clarifying questions. Tested with Whisper transcribing "Geoffrey Hinton" as "Joffrey Hinton" — the model asked "Who is Joffrey?" instead of inventing a biography.

### 4. Two similar questions merged in the transcript

Saying "What is the capital of Egypt?" then "What is the capital of India?" caused the Egypt line to disappear. The boundary aligner found the shared 5-word prefix "What is the capital of" and treated it as audio overlap, trimming `prev` to nothing.

**Fix:** two guards added to `alignBoundary`:

- If `prev` has any word after the match that ends with sentence-final punctuation (`.!?` for Latin, `।` for Bengali/Devanagari, `؟` for Arabic/Urdu, `。！？` for CJK), the match is a shared prefix, not real overlap. Reject it.
- If more than 2 words follow the matched run in `prev`, the match landed in the middle of `prev`, not the tail. Reject it.

Tested on a 9-line session covering Egypt, India, Germany, and a multi-chunk paragraph. All lines preserved, all seams clean.

### 5. Bengali transcript made English chat answers come back in Bengali

After even one Bengali transcript entry, clicking an English suggestion would sometimes return a Bengali answer. The model was reading the transcript first, picking up Bengali, and then ignoring the English question at the bottom.

**Fix:** two things together. Split the language instruction into two: `SUGGESTION_LANGUAGE_INSTRUCTION` (detects from `<current_focus>`) and `CHAT_LANGUAGE_INSTRUCTION` (detects from `<user_question>` only, with an explicit "never let the transcript language override the question language" rule). Also moved `<user_question>` to the top of the chat user message so the model reads the question's language before it ever sees the transcript.

### 6. Failed chat entries stayed on "Thinking..." forever

If a request hit the rate limit, the chat entry would just sit there showing "Thinking..." with no way to know it had failed. The user's only hint was the status bar at the top. When they clicked the suggestion again, a new entry appeared with the answer, but the stuck one remained.

**Fix:** the error handler now writes an error message directly into the stuck entry's answer field. The entry also renders with a red background so it's visually obvious. It only overwrites if the entry's answer is still empty, so a partially streamed response that errors partway through keeps what it got.

---

## Future improvements

In priority order:

1. **Copy and retry buttons on chat responses.** A copy button so the user can grab the answer without selecting text, and a retry button that re-fires the same question in place if the previous attempt failed or the answer wasn't good enough. The retry would replace the old entry rather than adding a new one below it.
2. **Pin transcription language from Settings.** A dropdown (Auto-detect / English / Bengali / Hindi / Urdu / Spanish / ...) passed to Whisper as the `language` parameter. Per-chunk auto-detection can produce cross-script noise on low-confidence audio. Letting the user pin the language fixes this for monolingual sessions while keeping auto-detect as the default.
3. **Stream the suggestion JSON.** Parse and render each suggestion card as it arrives rather than waiting for the full array. Should knock 1-2 seconds off perceived latency.
4. **Auto-retry on rate limit.** Instead of surfacing an error, retry automatically with exponential backoff and show a small inline notice while waiting.
5. **Persist settings across reloads.** Right now the prompts, context windows, and API key reset on every page load. Saving them to localStorage would help anyone iterating on prompts. The API key save should be opt-in.
6. **Speaker labels.** Whisper doesn't separate speakers. Even a simple manual label in the UI (or a diarization pass) would improve suggestion relevance in meetings with multiple people.
7. **Rolling transcript summary.** The suggestion call currently uses the last 10 entries as background. For long meetings that misses early context. A rolling LLM summary would let the model stay aware of the whole session cheaply.

---

## File layout

```
app/
  layout.tsx               Root layout
  page.tsx                 Mounts LiveSuggestionsApp
  globals.css              Tailwind base + CSS variables
components/
  LiveSuggestionsApp.tsx   All state, chunk recorder, boundary aligner
  TranscriptPanel.tsx      Left column
  SuggestionsPanel.tsx     Middle column
  ChatPanel.tsx            Right column
  SettingsModal.tsx        API key, prompts, context window settings
hooks/
  useCountdown.ts          30s refresh countdown
lib/
  groq.ts                  All Groq API calls: transcribe, suggestions, streaming chat
  exportSession.ts         Builds the JSON export blob
types/
  index.ts                 Suggestion, TranscriptEntry, ChatEntry, Settings types
```

---