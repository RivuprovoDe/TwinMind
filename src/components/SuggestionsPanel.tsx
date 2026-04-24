'use client'

import { SuggestionBatch, TYPE_LABELS } from '@/types'

interface SuggestionsPanelProps {
  suggestionBatches: SuggestionBatch[]
  countdown: number
  isRecording: boolean
  isLoadingSuggestions: boolean
  onRefresh: () => void
  onSuggestionClick: (text: string, type: string) => void
}

const col: React.CSSProperties = {
  background: 'var(--panel)',
  border: '1px solid var(--border)',
  borderRadius: 10,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  minHeight: 0,
}

const colHeader: React.CSSProperties = {
  padding: '10px 14px',
  borderBottom: '1px solid var(--border)',
  fontSize: 12,
  textTransform: 'uppercase',
  letterSpacing: 1,
  color: 'var(--muted)',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
}

const TAG_STYLES: Record<string, React.CSSProperties> = {
  question: { background: 'rgba(110,168,254,.15)', color: 'var(--accent)' },
  talking:  { background: 'rgba(179,136,255,.15)', color: 'var(--accent-2)' },
  answer:   { background: 'rgba(74,222,128,.15)',  color: 'var(--good)' },
  fact:     { background: 'rgba(251,191,36,.15)',  color: 'var(--warn)' },
}

export const SuggestionsPanel = ({
  suggestionBatches,
  countdown,
  isRecording,
  isLoadingSuggestions,
  onRefresh,
  onSuggestionClick,
}: SuggestionsPanelProps) => {
  return (
    <div style={col}>
      <div style={colHeader}>
        <span>2. Live Suggestions</span>
        <span>{suggestionBatches.length} batch{suggestionBatches.length !== 1 ? 'es' : ''}</span>
      </div>
      <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
        <button
          onClick={onRefresh}
          disabled={isLoadingSuggestions}
          style={{
            background: 'var(--panel-2)', color: 'var(--text)', border: '1px solid var(--border)',
            padding: '6px 12px', borderRadius: 6, fontSize: 12, cursor: isLoadingSuggestions ? 'not-allowed' : 'pointer',
            opacity: isLoadingSuggestions ? 0.5 : 1,
          }}
        >
          {isLoadingSuggestions ? 'Generating…' : '↻ Reload suggestions'}
        </button>
        {isRecording && (
          <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 'auto' }}>
            auto-refresh in {countdown}s
          </span>
        )}
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: 14 }}>
        {suggestionBatches.length === 0 ? (
          <p style={{ color: 'var(--muted)', fontSize: 13, textAlign: 'center', padding: '30px 10px' }}>
            Suggestions appear here once recording starts.
          </p>
        ) : (
          suggestionBatches.map((batch, batchIndex) => (
            <div key={batchIndex}>
              {batch.suggestions.map((suggestion, si) => (
                <div
                  key={si}
                  onClick={() => onSuggestionClick(suggestion.text, suggestion.type)}
                  style={{
                    border: `1px solid ${batchIndex === 0 ? 'var(--accent)' : 'var(--border)'}`,
                    background: 'var(--panel-2)',
                    borderRadius: 8,
                    padding: 12,
                    marginBottom: 10,
                    cursor: 'pointer',
                    opacity: batchIndex === 0 ? 1 : 0.55,
                    transition: 'border-color .15s, transform .15s',
                  }}
                  onMouseEnter={e => {
                    (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--accent)'
                    ;(e.currentTarget as HTMLDivElement).style.transform = 'translateY(-1px)'
                    ;(e.currentTarget as HTMLDivElement).style.opacity = '1'
                  }}
                  onMouseLeave={e => {
                    (e.currentTarget as HTMLDivElement).style.borderColor = batchIndex === 0 ? 'var(--accent)' : 'var(--border)'
                    ;(e.currentTarget as HTMLDivElement).style.transform = 'none'
                    ;(e.currentTarget as HTMLDivElement).style.opacity = batchIndex === 0 ? '1' : '0.55'
                  }}
                >
                  <span style={{
                    display: 'inline-block', fontSize: 10, textTransform: 'uppercase',
                    letterSpacing: 1, padding: '2px 6px', borderRadius: 4, marginBottom: 6,
                    ...TAG_STYLES[suggestion.type],
                  }}>
                    {TYPE_LABELS[suggestion.type]}
                  </span>
                  <div style={{ fontSize: 14, fontWeight: 500, lineHeight: 1.4, color: 'var(--text)' }}>
                    {suggestion.text}
                  </div>
                </div>
              ))}
              <div style={{ fontSize: 10, color: 'var(--muted)', textAlign: 'center', padding: '6px 0', textTransform: 'uppercase', letterSpacing: 1 }}>
                — Batch {suggestionBatches.length - batchIndex} · {batch.timestamp.toLocaleTimeString()} —
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
