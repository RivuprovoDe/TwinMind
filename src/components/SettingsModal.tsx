'use client'

import { Settings } from '@/types'

interface SettingsModalProps {
  isOpen: boolean
  apiKey: string
  settings: Settings
  onApiKeyChange: (value: string) => void
  onSettingsChange: (newSettings: Settings) => void
  onClose: () => void
}

export const SettingsModal = ({
  isOpen,
  apiKey,
  settings,
  onApiKeyChange,
  onSettingsChange,
  onClose,
}: SettingsModalProps) => {
  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-gray-800 rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto border border-gray-700">
        <div className="px-6 py-4 border-b border-gray-600 flex items-center justify-between">
          <h3 className="font-semibold text-gray-100">Settings</h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-200 text-2xl leading-none"
          >
            &times;
          </button>
        </div>
        <div className="px-6 py-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-200 mb-1">Groq API Key</label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => onApiKeyChange(e.target.value)}
              className="w-full text-sm px-3 py-2 border border-gray-600 rounded-lg focus:outline-none focus:border-blue-500 bg-gray-700 text-gray-100 placeholder-gray-400"
              placeholder="gsk_..."
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-200 mb-1">Model</label>
            <div className="w-full text-sm px-3 py-2 border border-gray-600 rounded-lg bg-gray-700 text-gray-300 select-none">
              openai/gpt-oss-120b
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-200 mb-1">Live Suggestion Prompt</label>
            <textarea
              value={settings.suggestionPrompt}
              onChange={(e) =>
                onSettingsChange({ ...settings, suggestionPrompt: e.target.value })
              }
              className="w-full text-xs px-3 py-2 border border-gray-600 rounded-lg focus:outline-none focus:border-blue-500 bg-gray-700 text-gray-100 placeholder-gray-400 h-40 resize-y font-mono"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-200 mb-1">
              Chat / Detailed Answer Prompt
            </label>
            <textarea
              value={settings.chatPrompt}
              onChange={(e) => onSettingsChange({ ...settings, chatPrompt: e.target.value })}
              className="w-full text-xs px-3 py-2 border border-gray-600 rounded-lg focus:outline-none focus:border-blue-500 bg-gray-700 text-gray-100 placeholder-gray-400 h-32 resize-y font-mono"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-200 mb-1">
                Suggestion Context Window (chars)
              </label>
              <input
                type="number"
                value={settings.suggestionContextWindow}
                onChange={(e) =>
                  onSettingsChange({
                    ...settings,
                    suggestionContextWindow: parseInt(e.target.value, 10) || 2000,
                  })
                }
                className="w-full text-sm px-3 py-2 border border-gray-600 rounded-lg focus:outline-none focus:border-blue-500 bg-gray-700 text-gray-100"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-200 mb-1">
                Chat Context Window (chars)
              </label>
              <input
                type="number"
                value={settings.chatContextWindow}
                onChange={(e) =>
                  onSettingsChange({
                    ...settings,
                    chatContextWindow: parseInt(e.target.value, 10) || 6000,
                  })
                }
                className="w-full text-sm px-3 py-2 border border-gray-600 rounded-lg focus:outline-none focus:border-blue-500 bg-gray-700 text-gray-100"
              />
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
          >
            Save &amp; Close
          </button>
        </div>
      </div>
    </div>
  )
}
