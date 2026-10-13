import { useEffect, useRef } from 'react'
import { useInterviewStore } from '../store/interviewStore'

/**
 * This hook sets up IPC event listeners ONCE.
 * It should only be called from App.tsx to prevent duplicate listeners.
 */
export function useInterviewEvents(): void {
  const {
    addTranscript,
    setCurrentTranscript,
    setSpeaking,
    setCandidateSpeaking,
    setCurrentQuestion,
    updateCurrentAnswer,
    finalizeAnswer,
    setError,
    setCapturing,
    setProcessingScreenshot,
    clearAll,
    setSettings,
    addLog
  } = useInterviewStore()

  // Use ref to ensure listeners are only set up once
  const listenersSetUp = useRef(false)

  // Load settings on mount
  useEffect(() => {
    const loadSettings = async (): Promise<void> => {
      try {
        const savedSettings = await window.api.getSettings()
        setSettings(savedSettings)
      } catch (err) {
        console.error('Failed to load settings:', err)
      }
    }
    loadSettings()
  }, [setSettings])

  // Set up event listeners ONCE
  useEffect(() => {
    // Prevent setting up listeners multiple times
    if (listenersSetUp.current) {
      return
    }
    listenersSetUp.current = true

    console.log('Setting up IPC event listeners (once)')

    const unsubTranscript = window.api.onTranscript((event) => {
      if (event.isFinal) {
        addTranscript({
          id: Date.now().toString(),
          text: event.text,
          timestamp: Date.now(),
          isFinal: true
        })
        setCurrentTranscript('')
      } else {
        setCurrentTranscript(event.text)
      }
    })

    const unsubSpeechStarted = window.api.onSpeechStarted(() => {
      setSpeaking(true)
    })

    const unsubUtteranceEnd = window.api.onUtteranceEnd(() => {
      setSpeaking(false)
    })

    const unsubCandidateSpeaking = window.api.onCandidateSpeaking((isSpeaking) => {
      setCandidateSpeaking(isSpeaking)
    })

    const unsubQuestionDetected = window.api.onQuestionDetected((question) => {
      setCurrentQuestion(question.text, question.category, question.isContinuation)
    })

    const unsubAnswerStream = window.api.onAnswerStream((chunk) => {
      updateCurrentAnswer(chunk)
    })

    const unsubAnswerComplete = window.api.onAnswerComplete(() => {
      finalizeAnswer()
    })

    const unsubCaptureError = window.api.onCaptureError((errorMsg) => {
      setError(errorMsg)
      setCapturing(false)
    })

    const unsubAnswerError = window.api.onAnswerError((errorMsg) => {
      setError(`Answer generation failed: ${errorMsg}`)
      finalizeAnswer()
    })

    const unsubQuestionDetectedFromImage = window.api.onQuestionDetectedFromImage((question) => {
      console.log('Question detected from screenshot:', question.text)
      const mappedCategory =
        question.questionType === 'leetcode'
          ? 'coding'
          : question.questionType === 'system-design'
          ? 'architecture_project'
          : 'conceptual'
      setCurrentQuestion(question.text, mappedCategory)
    })

    const unsubScreenshotNoQuestion = window.api.onScreenshotNoQuestion((data) => {
      console.log('No question detected in screenshot:', data.message)
      setError(data.message)
    })

    const unsubAppLog = window.api.onAppLog((log) => {
      addLog(log)
    })

    // Global Stealth Shortcuts (Cmd/Ctrl + Shift + S / C)
    const unsubTriggerScreenshotSolve = window.api.onTriggerScreenshotSolve(async () => {
      try {
        setError(null)
        setProcessingScreenshot(true)
        const captureResult = await window.api.captureScreenshot()
        if (captureResult.success && captureResult.imageData) {
          const analysisResult = await window.api.analyzeScreenshot(captureResult.imageData)
          if (!analysisResult.success) {
            setError(analysisResult.error || 'Failed to analyze screenshot')
          }
        }
      } catch (err: any) {
        console.error('Stealth screenshot hotkey error:', err)
      } finally {
        setProcessingScreenshot(false)
      }
    })

    const unsubTriggerStealthClear = window.api.onTriggerStealthClear(async () => {
      try {
        await window.api.clearHistory()
        clearAll()
      } catch (err) {
        console.error('Stealth clear error:', err)
      }
    })

    return () => {
      console.log('Cleaning up IPC event listeners')
      unsubTranscript()
      unsubSpeechStarted()
      unsubUtteranceEnd()
      unsubCandidateSpeaking()
      unsubQuestionDetected()
      unsubAnswerStream()
      unsubAnswerComplete()
      unsubCaptureError()
      unsubAnswerError()
      unsubQuestionDetectedFromImage()
      unsubScreenshotNoQuestion()
      unsubAppLog()
      unsubTriggerScreenshotSolve()
      unsubTriggerStealthClear()
      listenersSetUp.current = false
    }
  }, [
    addTranscript,
    setCurrentTranscript,
    setSpeaking,
    setCandidateSpeaking,
    setCurrentQuestion,
    updateCurrentAnswer,
    finalizeAnswer,
    setError,
    setCapturing,
    setProcessingScreenshot,
    clearAll,
    addLog
  ])
}
