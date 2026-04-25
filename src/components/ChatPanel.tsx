'use client'

import { useRef, useEffect } from 'react'
import { ChatEntry, TYPE_LABELS } from '@/types'

interface ChatPanelProps {
  chat: ChatEntry[]
  chatInput: string
  isLoadingChat: boolean
  onChatInputChange: (value: string) => void
  onChatSend: () => void
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

export const ChatPanel = ({
  chat,
  chatInput,
  isLoadingChat,
  onChatInputChange,
  onChatSend,
}: ChatPanelProps) => {
  const chatRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (chatRef.current) {
      chatRef.current.scrollTop = chatRef.current.scrollHeight
    }
  }, [chat])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') onChatSend()
  }

  return (
    <div style={col}>
      <div style={colHeader}>
        <span>3. Chat (detailed answers)</span>
        <span>session-only</span>
      </div>
      <div ref={chatRef} style={{ flex: 1, overflowY: 'auto', padding: 14 }}>
        {chat.length === 0 ? (
          <p style={{ color: 'var(--muted)', fontSize: 13, textAlign: 'center', padding: '30px 10px' }}>
            Click a suggestion or type a question below.
          </p>
        ) : (
          chat.map((msg, i) => (
            <div key={i} style={{ marginBottom: 14 }}>
              {/* User bubble */}
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>
                  You{msg.type ? ` · ${TYPE_LABELS[msg.type]}` : ''}
                </div>
                <div style={{
                  background: 'rgba(110,168,254,.08)', border: '1px solid rgba(110,168,254,.3)',
                  padding: '10px 12px', borderRadius: 8, fontSize: 13, lineHeight: 1.5, color: 'var(--text)',
                }}>
                  {msg.question}
                </div>
              </div>
              {/* Assistant bubble */}
              <div>
                <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>
                  Assistant
                </div>
                <div style={{
                  background: msg.answer.startsWith('⚠') ? 'rgba(239,68,68,.08)' : 'var(--panel-2)',
                  border: `1px solid ${msg.answer.startsWith('⚠') ? 'rgba(239,68,68,.4)' : 'var(--border)'}`,
                  padding: '10px 12px', borderRadius: 8, fontSize: 13, lineHeight: 1.5,
                  color: msg.answer.startsWith('⚠') ? 'var(--danger)' : 'var(--text)', whiteSpace: 'pre-wrap',
                }}>
                  {msg.answer || <span style={{ color: 'var(--muted)' }}>Thinking…</span>}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
      <div style={{ padding: 10, borderTop: '1px solid var(--border)', display: 'flex', gap: 8, flexShrink: 0 }}>
        <input
          type="text"
          value={chatInput}
          onChange={(e) => onChatInputChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask anything…"
          style={{
            flex: 1, background: 'var(--panel-2)', border: '1px solid var(--border)',
            color: 'var(--text)', padding: '8px 10px', borderRadius: 6, fontSize: 13,
            outline: 'none',
          }}
        />
        <button
          onClick={onChatSend}
          disabled={isLoadingChat || !chatInput.trim()}
          style={{
            background: 'var(--accent)', color: '#000', border: 'none',
            padding: '8px 14px', borderRadius: 6, cursor: isLoadingChat || !chatInput.trim() ? 'not-allowed' : 'pointer',
            fontSize: 13, fontWeight: 500, opacity: isLoadingChat || !chatInput.trim() ? 0.5 : 1,
          }}
        >
          Send
        </button>
      </div>
    </div>
  )
}