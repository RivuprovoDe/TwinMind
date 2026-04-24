import { useRef, useCallback } from 'react'

interface UseAudioRecorderReturn {
  isRecording: boolean
  startRecording: (onDataAvailable: (blob: Blob) => void) => Promise<void>
  stopRecording: () => void
  mediaRecorderRef: React.MutableRefObject<MediaRecorder | null>
}

export const useAudioRecorder = (): UseAudioRecorderReturn => {
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)

  const startRecording = useCallback(async (onDataAvailable: (blob: Blob) => void) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mediaRecorder = new MediaRecorder(stream)
      mediaRecorderRef.current = mediaRecorder

      mediaRecorder.ondataavailable = async (event) => {
        if (event.data.size > 0) {
          const audioBlob = new Blob([event.data], { type: event.data.type || 'audio/webm' })
          onDataAvailable(audioBlob)
        }
      }

      mediaRecorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop())
      }

      mediaRecorder.start(30000)
    } catch (error) {
      throw error
    }
  }, [])

  const stopRecording = useCallback(() => {
    mediaRecorderRef.current?.stop()
  }, [])

  return {
    isRecording: mediaRecorderRef.current?.state === 'recording' || false,
    startRecording,
    stopRecording,
    mediaRecorderRef,
  }
}
