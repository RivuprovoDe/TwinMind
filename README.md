# TwinMind Live Suggestions

A web app that listens to live audio from the user's microphone and continuously surfaces three useful, context-aware suggestions every ~30 seconds. Clicking a suggestion opens a detailed answer in a chat panel on the right, grounded in the full transcript.

Built for the TwinMind Live Suggestions assignment (April 2026).

- **Live demo:** (https://twin-mind-sm5w.vercel.app/)
- **Stack:** Next.js (App Router) + React + TypeScript + Tailwind, Groq API for both speech-to-text and LLM.

---

## Quick start

```bash
git clone <repo-url>
cd <repo-folder>
npm install
npm run dev
```

Then open `http://localhost:3000`, click the gear icon, and paste your Groq API key. No `.env` setup is required — the key lives only in browser memory for the session, never in source.

You can grab a free Groq API key at [console.groq.com](https://console.groq.com).

---

## Stack & model choices

| Layer | Choice | Why |
|---|---|---|
| Framework | **Next.js 14 (App Router)** | Single deployable that serves the React UI; trivially deployable to Vercel/Netlify. |
| Language | **TypeScript** | The transcript / suggestion / chat data flow is non-trivial — types prevent shape drift between the three panels. |
| Styling | **Tailwind CSS** | Speed of iteration on the prototype layout. |
| Transcription | **Groq Whisper Large V3** | Required by the assignment. Streaming-friendly, strong multilingual coverage. |
| Suggestions + Chat | **Groq `openai/gpt-oss-120b`** | Required by the assignment. Fast enough for the 30-second cadence, capable enough for nuanced suggestion mixing. |
| Audio capture | **Browser `MediaRecorder` API** | No extra dependency, native to every modern browser, gives us `webm/opus` chunks Groq Whisper accepts directly. |

**No backend of our own.** The browser talks straight to the Groq API with the user's key. There is no proxy server, no database, no auth, no analytics. This keeps the deploy footprint zero, the latency low, and the user's API key out of any system we operate.

---

## Architecture

Three columns, one continuous session per page load:

```
┌─────────────────┬─────────────────────┬─────────────────┐
│ Transcript      │ Live suggestions    │ Chat            │
│ (left)          │ (middle)            │ (right)         │
│                 │                     │                 │
│ Mic on/off      │ Refresh button      │ Type a question │
│ Auto-scroll     │ 30s countdown       │ Click a card    │
│ 30s chunks      │ 3 cards per batch   │ Streaming reply │
│                 │ Newest batch on top │ Full transcript │
│                 │                     │ as context      │
└─────────────────┴─────────────────────┴─────────────────┘
```

### Audio chunking

`MediaRecorder` is started in **30-second windows with a 2-second overlap** between adjacent chunks. The overlap is critical: without it, words that straddle a chunk boundary get cut in half, and Whisper transcribes garbage at both seams. With overlap, both chunks contain the boundary words, and we de-duplicate them in software (see _Boundary alignment_ below).

When a chunk finishes recording, the next chunk has already been recording for ~2 seconds, so there is no audio gap during recording — only a perceptible processing gap when Whisper is called.

### Boundary alignment (de-duplicating the overlap)

Two adjacent transcripts share the words spoken during the 2-second overlap, but Whisper's transcription of the **end** of a chunk is less reliable than its transcription of the **start** of one (it has no future audio to disambiguate the half-cut last word). Strategy:

1. Find the longest contiguous matching word run between the **last 15 words of `prev`** and the **first 15 words of `next`**.
2. Reject the match if it would constitute a false-positive (see _Challenges_ below).
3. Otherwise: keep the matched bridge once at the start of `next`, and trim `prev` from where the matched run begins. This also discards Whisper's unreliable end-of-chunk guess.

### Suggestion generation flow

On every chunk completion (~30s) and on every manual refresh:

1. Filter the transcript to readable entries (uses `\p{L}` Unicode letter property — works for Latin, Bengali, Hindi, Urdu, Arabic, CJK, etc.).
2. Take the **most recent** readable entry as the `<current_focus>` block — that's what the suggestions must be about.
3. Take the previous up-to-10 readable entries (windowed by `suggestionContextWindow` characters) as `<background_context>` — for situational awareness only.
4. Send to Groq with a system prompt that strictly enforces JSON-array output of exactly 3 suggestions.
5. Parse, prepend to the suggestion-batch list, render. Older batches stay visible below.

### Chat flow

Clicking a suggestion (or typing a question) sends the **full transcript** as context (windowed by `chatContextWindow`) plus the question. The response is **streamed token-by-token** into the chat panel for low time-to-first-token.

### Export

A single button writes a JSON file containing the transcript, every suggestion batch, and the full chat — all with timestamps. This is the artifact reviewers use to evaluate the session.

---

## Prompt strategy

The single most important design decision in this app is the prompt structure. Five things matter:

### 1. Focus vs. background split

The model is told that `<current_focus>` drives all three suggestions and `<background_context>` is read-only situational awareness. Without this split, the model drifts — it produces suggestions about whatever it found most interesting in the transcript, which is rarely what the user just said. With it, the suggestions consistently track the active topic.

### 2. Strict JSON output, exactly three items, no preamble

The prompt opens with hard rules: output ONLY a JSON array of exactly 3 objects, no markdown, no explanation. This is enforced because the renderer parses the response as JSON. If the model adds even a single line of prose around the array, the parse fails and the user sees no suggestions. The prompt's first three rules are entirely about output discipline.

### 3. Mixed-type contract with priority logic

The four suggestion types — `question`, `talking`, `answer`, `fact` — are defined explicitly, with rules for *when* each one is appropriate:

- A direct question was asked → lead with `answer`.
- A debatable claim was made → lead with `fact`.
- A topic introduced broadly → use `question` + `talking` + `fact` to deepen it.

This is what makes the suggestion mix feel intelligent rather than random.

### 4. Multilingual

A dedicated `LANGUAGE RULE` block in the prompt tells the model to detect the language of `<current_focus>` and write every suggestion's `text` field in that same language and script. Field names and the `type` enum stay in English (so the JSON is parseable). Bengali in → Bengali suggestions out. Hindi → Hindi. Urdu → Urdu (Nastaliq). Spanish → Spanish. Verified working on real session exports.

### 5. Anti-hallucination

A dedicated `ACCURACY RULE` block tells the model: if you are not highly confident in a specific name, date, number, citation, or attribution, **do not invent one** — downgrade the suggestion to type `question` and frame it as a clarifying question. This is critical in a live-meeting surface where a confident wrong fact is worse than no fact. Hedge words (`"I think"`, `"approximately"`, `"around"`) are explicitly banned inside `fact` and `answer` types because they disguise a guess.

### Defaults are configurable

All four prompts (live suggestion prompt, chat prompt) and both context windows are exposed as editable fields in Settings. The defaults shipped in the code are the values I tuned to. Power users can experiment.

---

## Tradeoffs I made

- **No backend.** Pro: zero deploy cost, no key handling on a server we operate, no auth flow to build. Con: the user's Groq key lives in browser memory only and must be re-entered on reload. For a take-home this is the right call; for production we'd add an auth layer and stash the key encrypted server-side.
- **No persistence.** Sessions disappear on reload by design (the assignment explicitly allows this). The Export button is the user's persistence mechanism.
- **No streaming on suggestions.** The chat answer streams (low time-to-first-token), but the 3-suggestion JSON arrives all-at-once because we need to parse it as a complete array. Streaming the JSON would shave ~1–2s off perceived latency but would require a partial-JSON parser. I built a salvage regex for the truncation case (see _Challenges_) but did not go full streaming.
- **No proper-noun correction.** Whisper occasionally mis-transcribes proper nouns (`Geoffrey → Joffrey`, `Yann LeCun → Jan LeCun`). Rather than try to correct them, the system prompt's accuracy rule means the model handles them gracefully — it asks "Who is Joffrey?" rather than inventing a biography. That's a better failure mode than trying to second-guess Whisper.
- **No language hint to Whisper.** Whisper auto-detects language per chunk, which can occasionally produce cross-script artifacts on low-confidence audio (e.g. silence + faint speech transliterated into Bengali script). Pinning a language would eliminate this but break the multilingual story. See _Future improvements_.

---

## Challenges I ran into

These are real bugs I found while testing and the fixes I shipped.

### 1. Multilingual transcripts were silently dropped

The original readability filter was `/[a-zA-Z]/`. Any transcript entry with no Latin letters — every Bengali, Hindi, Urdu, Arabic, or CJK utterance — was silently filtered out before being sent to the model, so the user spoke Bengali and saw zero suggestions with no error message.

**Fix:** changed the regex to `/\p{L}/u`. The Unicode `Letter` property matches any script's letters. Pure punctuation / digits / whitespace are still rejected.

### 2. Suggestions were truncated mid-JSON when the model hit the token cap

With `max_tokens = 1024`, longer multilingual responses (Bengali characters cost more tokens than Latin) were cut off mid-string. The JSON parser then failed on the entire response and the user saw nothing.

**Fix:** bumped `max_tokens` to 2048, and added a partial-JSON salvage regex that extracts complete `{"type", "text"}` objects from a truncated array. Two complete suggestions are better than zero suggestions.

### 3. The model sometimes hallucinated specific facts

Asked "Who wrote *Hutom Pyanchar Naksha*?", the model would confidently answer with the wrong author. In a live meeting surface this is dangerous — the user might quote it.

**Fix:** added the `ACCURACY RULE` block to both the suggestion and chat system prompts (described above). The model now downgrades uncertain facts to clarifying questions instead of inventing. Verified in a real test where Whisper transcribed "Geoffrey Hinton" as "Joffrey Hinton" — the model produced "Who is Joffrey, and what were his key contributions?" rather than inventing a fake bio.

### 4. Consecutive similar-prefix questions ate each other in the transcript

Asking "What is the capital of Egypt?" then "What is the capital of India?" resulted in the Egypt line disappearing entirely from the transcript. The boundary aligner found the 5-word shared prefix `"What is the capital of"` and treated it as audio overlap, trimming `prev` down to nothing.

**Fix:** added two false-positive guards in `alignBoundary`:

- **Sentence-end punctuation guard:** if `prev` has any unmatched word *after* the matched portion that ends with sentence-final punctuation (`.`, `!`, `?`, `।` for Bengali/Devanagari, `؟` for Arabic/Urdu, `。！？` for CJK), `prev` is a complete utterance and the match is a coincidental shared prefix — reject.
- **Tail-noise length guard:** real audio overlap leaves at most ~1–2 unmatched trailing words in `prev` (Whisper's misheard last guess). More than that means the match is in the middle of `prev`, not its tail — reject.

Verified on a 9-line test session covering Egypt → India → Germany followed by a 4-chunk AI-history paragraph: all transcript lines preserved, all suggestion batches correctly targeted, all chunk seams clean.

### 5. Duplicate-chunk skip blocked rate-limit retries

If a Groq call failed with HTTP 429 (rate limit), the user's natural recovery was to repeat their question. But the chunk-handler used to detect "same as last chunk" and silently skip it — leaving the user stuck with no suggestions and no obvious way to retry.

**Fix:** when a duplicate or fully-overlapping chunk is detected, instead of just setting a "skipped" status, the handler now re-fires `runGenerateSuggestions` against the existing transcript. The user can recover from a rate-limit failure simply by speaking again.

---

## Future improvements

I'd add these next, in priority order:

1. **Pin transcription language from Settings.** Add a language dropdown (`Auto-detect` / `English` / `Bengali` / `Hindi` / `Urdu` / `Spanish` / …) that gets passed to the Whisper API as the `language` parameter. Whisper's per-chunk auto-detection can produce cross-script artifacts on low-confidence audio; letting the user pin the source language eliminates this class of bug for monolingual sessions while preserving auto-detect as the default for multilingual ones.
2. **Stream the suggestion JSON.** Build a partial-JSON parser that extracts complete `{"type", "text"}` objects as they arrive, rendering each card the moment it's complete. Should shave 1–2 seconds off perceived latency.
3. **Automatic 429 retry with exponential backoff.** Instead of relying on the user re-speaking, retry the Groq call automatically on rate-limit errors with backoff. Surface a brief inline notice during the wait.
4. **Persist Settings (prompts, context windows, API key) to localStorage.** Right now defaults reload fresh on every page load, which is annoying for a power user iterating on prompts. The API key should be opt-in (a "Remember key on this device" checkbox) so users who don't want it stored can decline.
5. **Speaker diarization.** Whisper Large V3 doesn't separate speakers. Adding a diarization pass (or labeling speakers manually in the UI) would meaningfully improve suggestion relevance in multi-person meetings.
6. **Rolling summary of older transcript.** Right now the suggestion call uses the last 10 readable entries as background. For long meetings this drops important early context. A rolling LLM-generated summary would let the model "remember" the whole meeting cheaply.

---

## File layout

```
app/
  layout.tsx          Root layout
  page.tsx            Mounts <LiveSuggestionsApp />
  globals.css         Tailwind base
components/
  LiveSuggestionsApp.tsx   Top-level state, chunk recorder, boundary aligner
  TranscriptPanel.tsx      Left column
  SuggestionsPanel.tsx     Middle column
  ChatPanel.tsx            Right column
  SettingsModal.tsx        Gear-icon modal — API key, prompts, context windows
hooks/
  useAudioRecorder.ts
  useCountdown.ts          30s refresh countdown
lib/
  groq.ts             All Groq API calls — transcribe, suggestions, chat (streaming)
  exportSession.ts    Build the JSON export blob
types/
  index.ts            Suggestion / TranscriptEntry / ChatEntry / Settings shapes
```

---

## Notes on evaluation

- The prompts in `LiveSuggestionsApp.tsx` are the defaults. They are also editable in Settings, so reviewers can A/B test their own variants live during the interview.
- All API calls go directly from the browser to Groq — there is no server-side logging of transcripts, prompts, or API keys.
- The export JSON is the source of truth for evaluating session quality. Run a real conversation, hit Export, and the file contains everything: transcript, every suggestion batch, every chat exchange, all with timestamps.
