import { useRef, useEffect, useState } from 'react'

export const useCountdown = (isActive: boolean, onCountdownComplete: () => void) => {
  const [countdown, setCountdown] = useState(30)
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const countdownValueRef = useRef(30)
  const callbackRef = useRef(onCountdownComplete)

  useEffect(() => {
    callbackRef.current = onCountdownComplete
  })

  useEffect(() => {
    if (isActive) {
      countdownValueRef.current = 30
      setCountdown(30)
      countdownRef.current = setInterval(() => {
        countdownValueRef.current -= 1
        setCountdown(countdownValueRef.current)
        if (countdownValueRef.current <= 0) {
          countdownValueRef.current = 30
          setCountdown(30)
          callbackRef.current()
        }
      }, 1000)
    } else {
      if (countdownRef.current) clearInterval(countdownRef.current)
    }
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current)
    }
  }, [isActive])

  const resetCountdown = () => {
    countdownValueRef.current = 30
    setCountdown(30)
  }

  return { countdown, resetCountdown }
}