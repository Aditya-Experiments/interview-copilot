import { BrowserWindow, clipboard, desktopCapturer, ipcMain } from 'electron'
import { AnswerEntry } from '../../preload/index'
import { HistoryManager } from '../services/historyManager'
import { OpenAIService } from '../services/openaiService'
import { QuestionDetector } from '../services/questionDetector'
import { ScreenshotService } from '../services/screenshotService'
import { AppSettings, SettingsManager } from '../services/settingsManager'
import { VisionService } from '../services/visionService'
import { WhisperService } from '../services/whisperService'
import { DeepgramService } from '../services/deepgramService'

let whisperService: WhisperService | null = null
let deepgramService: DeepgramService | null = null
let activeSttService: DeepgramService | WhisperService | null = null
let openaiService: OpenAIService | null = null
let questionDetector: QuestionDetector | null = null
let settingsManager: SettingsManager | null = null
let historyManager: HistoryManager | null = null
let screenshotService: ScreenshotService | null = null
let visionService: VisionService | null = null
let mainWindow: BrowserWindow | null = null
let isCapturing = false

export function initializeIpcHandlers(window: BrowserWindow): void {
  mainWindow = window
  settingsManager = new SettingsManager()
  historyManager = new HistoryManager()
  questionDetector = new QuestionDetector()

  // Settings handlers
  ipcMain.handle('get-settings', () => {
    return settingsManager?.getSettings()
  })

  ipcMain.handle('update-settings', (_event, updates: Partial<AppSettings>) => {
    settingsManager?.updateSettings(updates)

    // Reset vision service and update openai service if API key or model changed
    if (updates.openaiApiKey !== undefined || updates.openaiModel !== undefined) {
      visionService = null
      if (openaiService) {
        openaiService.updateConfig({
          apiKey: updates.openaiApiKey,
          model: updates.openaiModel,
          resumeDescription: updates.resumeDescription
        })
      }
    }

    // Apply window settings immediately
    if (updates.alwaysOnTop !== undefined && mainWindow) {
      mainWindow.setAlwaysOnTop(updates.alwaysOnTop)
    }
    if (updates.windowOpacity !== undefined && mainWindow) {
      mainWindow.setOpacity(updates.windowOpacity)
    }

    return settingsManager?.getSettings()
  })

  ipcMain.handle('has-api-keys', () => {
    return settingsManager?.hasApiKeys()
  })

  // Fetch AI models (Gemini & OpenAI)
  ipcMain.handle('fetch-openai-models', async (_event, apiKey: string) => {
    try {
      if (!apiKey || apiKey.trim().length === 0) {
        throw new Error('API key is required')
      }

      const trimmedKey = apiKey.trim()

      // Handle Google Gemini API Keys (both legacy AIza and new AQ. auth keys)
      if (!trimmedKey.startsWith('sk-')) {
        const defaultGeminiModels = [
          { id: 'gemini-3.1-flash-lite', name: 'Gemini 3.1 Flash Lite (Recommended & Free)' },
          { id: 'gemini-3.5-flash-lite', name: 'Gemini 3.5 Flash Lite (Free)' },
          { id: 'gemini-3.5-flash', name: 'Gemini 3.5 Flash (Free)' },
          { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash (Free)' }
        ]

        try {
          const resp = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models?key=${trimmedKey}`
          )
          if (resp.ok) {
            const data = (await resp.json()) as {
              models?: Array<{ name: string; displayName?: string; supportedGenerationMethods?: string[] }>
            }
            if (data.models && data.models.length > 0) {
              const fetched = data.models
                .filter((m) => m.name.includes('gemini') && m.supportedGenerationMethods?.includes('generateContent'))
                .map((m) => {
                  const id = m.name.replace('models/', '')
                  return { id, name: m.displayName ? `${m.displayName} (${id})` : id }
                })
              if (fetched.length > 0) {
                // Filter out deprecated models and place gemini-3.1-flash-lite first
                const valid = fetched.filter((m) => !m.id.includes('2.0') && m.id !== 'gemini-2.5-flash')
                const without31 = valid.filter((m) => m.id !== 'gemini-3.1-flash-lite')
                const combined = [
                  { id: 'gemini-3.1-flash-lite', name: 'Gemini 3.1 Flash Lite (Recommended & Free)' },
                  ...without31
                ]
                return { success: true, models: combined }
              }
            }
          }
        } catch {
          // Fall back to predefined list if network/parsing error
        }

        return { success: true, models: defaultGeminiModels }
      }

      // Handle OpenAI API Keys
      const OpenAI = (await import('openai')).default
      const client = new OpenAI({ apiKey: trimmedKey })

      const response = await client.models.list()

      // Filter for chat completion models and sort them
      const chatModels = response.data.map((model) => ({
        id: model.id,
        name: model.id
      }))

      return { success: true, models: chatModels }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to fetch models'
      console.error('Error fetching AI models:', errorMessage)
      return { success: false, error: errorMessage, models: [] }
    }
  })

  // Audio capture handlers
  ipcMain.handle('start-capture', async () => {
    const settings = settingsManager?.getSettings()

    // Debug: Log API key status (not the actual keys)
    console.log('API Keys configured:', {
      configured: settings?.openaiApiKey ? `Yes (${settings.openaiApiKey.length} chars)` : 'No'
    })

    if (!settings?.openaiApiKey) {
      throw new Error('API key not configured. Please add your Gemini or OpenAI API key in Settings.')
    }

    try {
      // IMPORTANT: Clean up any existing services/listeners first to prevent duplicates
      if (activeSttService) {
        activeSttService.stop()
        activeSttService.removeAllListeners()
        activeSttService = null
        whisperService = null
        deepgramService = null
      }
      if (openaiService) {
        openaiService.removeAllListeners()
        openaiService = null
      }
      questionDetector?.removeAllListeners()

      // Choose STT Service: Deepgram Nova-2 if configured, else Whisper/Gemini
      const useDeepgram = Boolean(settings.deepgramApiKey?.trim())

      if (useDeepgram) {
        console.log('===> Using Deepgram Nova-2 live WebSocket streaming')
        deepgramService = new DeepgramService({
          apiKey: settings.deepgramApiKey!.trim()
        })
        activeSttService = deepgramService
      } else {
        console.log('===> Using Gemini/Whisper audio transcription')
        whisperService = new WhisperService({
          apiKey: settings.openaiApiKey,
          model: 'whisper-1',
          language: 'en'
        })
        activeSttService = whisperService
      }

      // Initialize OpenAI service for answer generation
      openaiService = new OpenAIService({
        apiKey: settings.openaiApiKey,
        model: settings.openaiModel,
        resumeDescription: settings.resumeDescription
      })

      // Set up OpenAI event listeners ONCE
      openaiService.on('stream', (chunk) => {
        mainWindow?.webContents.send('answer-stream', chunk)
      })

      openaiService.on('complete', (answer) => {
        mainWindow?.webContents.send('answer-complete', answer)
      })

      // Set up STT event listeners
      activeSttService.on('transcript', async (event) => {
        console.log('Transcript received:', event.text)
        questionDetector?.addTranscript(event.text, event.isFinal)
        mainWindow?.webContents.send('transcript', event)

        // Try early detection for faster response on high-confidence questions
        if (event.isFinal && questionDetector && openaiService) {
          const earlyDetection = questionDetector.checkEarlyDetection(event.text)
          if (earlyDetection) {
            console.log('Early question detection triggered:', earlyDetection.text)
            mainWindow?.webContents.send('question-detected', earlyDetection)
            try {
              await openaiService.generateAnswer(earlyDetection.text)
            } catch (error) {
              mainWindow?.webContents.send('answer-error', (error as Error).message)
            }
          }
        }
      })

      activeSttService.on('utteranceEnd', () => {
        console.log('Processing utterance...')
        questionDetector?.onUtteranceEnd()
        mainWindow?.webContents.send('utterance-end')
      })

      activeSttService.on('speechStarted', () => {
        mainWindow?.webContents.send('speech-started')
      })

      activeSttService.on('error', (error) => {
        const errorMessage = error instanceof Error ? error.message : String(error)
        console.error('STT error:', errorMessage)
        mainWindow?.webContents.send('capture-error', errorMessage)
      })

      // Set up question detector listener ONCE
      questionDetector?.on('questionDetected', async (detection) => {
        console.log('Question detected:', detection.text)
        mainWindow?.webContents.send('question-detected', detection)

        if (openaiService) {
          try {
            await openaiService.generateAnswer(detection.text)
          } catch (error) {
            mainWindow?.webContents.send('answer-error', (error as Error).message)
          }
        }
      })

      // Start STT service
      await activeSttService.start()
      isCapturing = true
      console.log('Audio capture started successfully')

      return { success: true }
    } catch (error) {
      console.error('start-capture error:', error)
      const errorMessage = error instanceof Error ? error.message : 'Failed to start capture'
      throw new Error(errorMessage)
    }
  })

  ipcMain.handle('stop-capture', async () => {
    isCapturing = false

    if (activeSttService) {
      activeSttService.stop()
      activeSttService.removeAllListeners()
      activeSttService = null
      whisperService = null
      deepgramService = null
    }

    if (openaiService) {
      openaiService.removeAllListeners()
      openaiService = null
    }

    // Remove question detector listeners to prevent duplicates on next start
    questionDetector?.removeAllListeners()
    questionDetector?.clearBuffer()
    console.log('Audio capture stopped')

    return { success: true }
  })

  ipcMain.handle('get-capture-status', () => {
    return isCapturing
  })

  // Audio data from renderer
  ipcMain.on('audio-data', (_event, audioData: ArrayBuffer) => {
    if (activeSttService && isCapturing) {
      activeSttService.addAudioData(audioData)
    }
  })

  // Get audio sources for system audio capture
  ipcMain.handle('get-audio-sources', async () => {
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      fetchWindowIcons: true
    })

    return sources.map((source) => ({
      id: source.id,
      name: source.name,
      thumbnail: source.thumbnail.toDataURL()
    }))
  })

  // Window control handlers
  ipcMain.handle('set-always-on-top', (_event, value: boolean) => {
    mainWindow?.setAlwaysOnTop(value)
    settingsManager?.setSetting('alwaysOnTop', value)
    return value
  })

  ipcMain.handle('set-window-opacity', (_event, value: number) => {
    mainWindow?.setOpacity(value)
    settingsManager?.setSetting('windowOpacity', value)
    return value
  })

  ipcMain.handle('minimize-window', () => {
    mainWindow?.minimize()
  })

  ipcMain.handle('close-window', () => {
    mainWindow?.close()
  })

  // Clear conversation history
  ipcMain.handle('clear-history', () => {
    openaiService?.clearHistory()
    return { success: true }
  })

  // History handlers
  ipcMain.handle('get-history', () => {
    return historyManager?.getHistory() || []
  })

  ipcMain.handle('save-history-entry', (_event, entry: AnswerEntry) => {
    historyManager?.addEntry(entry)
    return { success: true }
  })

  ipcMain.handle('save-history-entries', (_event, entries: AnswerEntry[]) => {
    historyManager?.addEntries(entries)
    return { success: true }
  })

  ipcMain.handle('clear-saved-history', () => {
    historyManager?.clearHistory()
    return { success: true }
  })

  ipcMain.handle('delete-history-entry', (_event, id: string) => {
    historyManager?.deleteEntry(id)
    return { success: true }
  })

  // Clipboard handlers
  ipcMain.handle('write-to-clipboard', (_event, text: string) => {
    try {
      clipboard.writeText(text)
      return { success: true }
    } catch (error) {
      console.error('Failed to write to clipboard:', error)
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  })

  // Screenshot handlers
  ipcMain.handle('capture-screenshot', async () => {
    try {
      if (!screenshotService) {
        screenshotService = new ScreenshotService(mainWindow || undefined)
      }

      const result = await screenshotService.captureActiveWindow()

      if (result.success && result.imageData) {
        mainWindow?.webContents.send('screenshot-captured', { imageData: result.imageData })
      }

      return result
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to capture screenshot'
      console.error('Screenshot capture error:', errorMessage)
      return {
        success: false,
        error: errorMessage
      }
    }
  })

  // Session API handler
  ipcMain.handle(
    'call-session-api',
    async (
      _event,
      payload: { sessionDuration: number; timestamp: number; [key: string]: unknown }
    ) => {
      try {
        // Placeholder API endpoint - can be configured via settings or environment variable
        const API_ENDPOINT = process.env.SESSION_API_URL || 'https://api.example.com/session'

        const response = await fetch(API_ENDPOINT, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload)
        })

        if (!response.ok) {
          throw new Error(`API call failed with status: ${response.status}`)
        }

        const result = await response.json()
        console.log('Session API called successfully:', result)
        return { success: true, data: result }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Failed to call session API'
        console.error('Session API error:', errorMessage)
        return {
          success: false,
          error: errorMessage
        }
      }
    }
  )

  ipcMain.handle('analyze-screenshot', async (_event, imageData: string) => {
    const settings = settingsManager?.getSettings()

    if (!settings?.openaiApiKey) {
      return {
        success: false,
        error: 'API key not configured. Please add your Gemini or OpenAI API key in Settings.'
      }
    }

    try {
      // Initialize services if needed
      if (!visionService) {
        visionService = new VisionService({
          apiKey: settings.openaiApiKey,
          model: 'gpt-4o'
        })
      }

      if (!openaiService) {
        openaiService = new OpenAIService({
          apiKey: settings.openaiApiKey,
          model: settings.openaiModel,
          resumeDescription: settings.resumeDescription
        })

        // Set up OpenAI event listeners
        openaiService.on('stream', (chunk) => {
          mainWindow?.webContents.send('answer-stream', chunk)
        })

        openaiService.on('complete', (answer) => {
          mainWindow?.webContents.send('answer-complete', answer)
        })
      }

      // Analyze screenshot for interview question
      console.log('Analyzing screenshot for interview question...')
      const analysis = await visionService.analyzeScreenshot(imageData)

      console.log('Analysis result:', {
        isQuestion: analysis.isQuestion,
        hasQuestionText: !!analysis.questionText,
        questionTextLength: analysis.questionText?.length || 0,
        questionType: analysis.questionType,
        confidence: analysis.confidence
      })

      // Check if question is detected - be more lenient
      if (analysis.isQuestion) {
        // If we have question text, use it. Otherwise, we'll extract from image directly
        const questionText = analysis.questionText?.trim() || 'Interview question from screenshot'

        console.log('Question detected:', questionText.substring(0, 100))
        console.log('Question type:', analysis.questionType)

        // Send question detected event
        mainWindow?.webContents.send('question-detected-from-image', {
          text: questionText,
          questionType: analysis.questionType,
          confidence: analysis.confidence
        })

        // Generate solution - pass questionText only if we have it, otherwise let the model extract from image
        try {
          await openaiService.generateSolutionFromImage(
            imageData,
            analysis.questionText && analysis.questionText.trim().length > 10
              ? questionText
              : undefined,
            analysis.questionType
          )
        } catch (error) {
          console.error('Solution generation error:', error)
          mainWindow?.webContents.send('answer-error', (error as Error).message)
          return {
            success: false,
            error: (error as Error).message
          }
        }

        return {
          success: true,
          isQuestion: true,
          questionText: questionText,
          questionType: analysis.questionType
        }
      } else {
        // No question detected - but if confidence is moderate, still try to generate solution
        if (analysis.confidence && analysis.confidence >= 0.3) {
          console.log('Low confidence but attempting solution generation anyway...')
          const questionText = analysis.questionText?.trim() || 'Technical problem from screenshot'

          mainWindow?.webContents.send('question-detected-from-image', {
            text: questionText,
            questionType: analysis.questionType || 'other',
            confidence: analysis.confidence
          })

          try {
            await openaiService.generateSolutionFromImage(
              imageData,
              analysis.questionText && analysis.questionText.trim().length > 10
                ? questionText
                : undefined,
              analysis.questionType || 'other'
            )

            return {
              success: true,
              isQuestion: true,
              questionText: questionText,
              questionType: analysis.questionType || 'other'
            }
          } catch (error) {
            console.error('Solution generation error:', error)
            // Fall through to no question message
          }
        }

        // No question detected - log why
        console.log('No question detected. Analysis:', {
          isQuestion: analysis.isQuestion,
          confidence: analysis.confidence,
          hasQuestionText: !!analysis.questionText
        })

        mainWindow?.webContents.send('screenshot-no-question', {
          message:
            'No interview question detected in the screenshot. Please make sure the question is clearly visible and try again.'
        })
        return {
          success: true,
          isQuestion: false,
          message: 'No interview question detected in the screenshot'
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to analyze screenshot'
      console.error('Screenshot analysis error:', errorMessage)
      mainWindow?.webContents.send('answer-error', errorMessage)
      return {
        success: false,
        error: errorMessage
      }
    }
  })
}

export function cleanupIpcHandlers(): void {
  if (activeSttService) {
    activeSttService.stop()
    activeSttService = null
    whisperService = null
    deepgramService = null
  }
  if (openaiService) {
    openaiService.removeAllListeners()
    openaiService = null
  }
  questionDetector = null
  settingsManager = null
  historyManager = null
  screenshotService = null
  visionService = null
  mainWindow = null
  isCapturing = false
}
