'use client'

import { useRef, useEffect } from 'react'
import { TranscriptEntry } from '@/types'

interface TranscriptPanelProps {
  transcript: TranscriptEntry[]
  isRecording: boolean
  onToggleRecording: () => void
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

export const TranscriptPanel = ({ transcript, isRecording, onToggleRecording }: TranscriptPanelProps) => {
  const transcriptRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight
    }
  }, [transcript])

  return (
    <div style={col}>
      <div style={colHeader}>
        <span>1. Mic &amp; Transcript</span>
        <span>{isRecording ? '● recording' : 'idle'}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 14, borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <button
          onClick={onToggleRecording}
          className={isRecording ? 'mic-recording' : ''}
          style={{
            width: 44, height: 44, borderRadius: '50%', border: 'none', cursor: 'pointer',
            background: isRecording ? 'var(--danger)' : 'var(--accent)',
            color: isRecording ? '#fff' : '#000',
            fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'background .2s', flexShrink: 0,
          }}
        >
          {isRecording ? '■' : '●'}
        </button>
        <p style={{ fontSize: 13, color: 'var(--muted)', margin: 0 }}>
          {isRecording ? 'Listening… transcript updates every 30s.' : 'Click mic to start. Transcript appends every ~30s.'}
        </p>
      </div>
      <div ref={transcriptRef} style={{ flex: 1, overflowY: 'auto', padding: 14 }}>
        {transcript.length === 0 ? (
          <p style={{ color: 'var(--muted)', fontSize: 13, textAlign: 'center', padding: '30px 10px' }}>
            No transcript yet — start the mic.
          </p>
        ) : (
          transcript.map((entry, i) => (
            <div
              key={i}
              className="transcript-new"
              style={{ fontSize: 14, lineHeight: 1.55, marginBottom: 10, color: '#cfd3dc' }}
            >
              <span style={{ color: 'var(--muted)', fontSize: 11, marginRight: 6 }}>
                {entry.timestamp.toLocaleTimeString()}
              </span>
              {entry.text}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
