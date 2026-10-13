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

export function sendAppLog(
  level: 'info' | 'warn' | 'error' | 'success',
  source: string,
  message: string
): void {
  mainWindow?.webContents.send('app-log', {
    id: `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    timestamp: Date.now(),
    level,
    source,
    message
  })
}

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

    // Reset vision service and update openai service if API keys or models changed
    if (
      updates.groqApiKeys !== undefined ||
      updates.geminiApiKeys !== undefined ||
      updates.openaiApiKeys !== undefined ||
      updates.openaiApiKey !== undefined ||
      updates.openaiModel !== undefined ||
      updates.groqModel !== undefined ||
      updates.geminiModel !== undefined ||
      updates.llmProvider !== undefined ||
      updates.resumeDescription !== undefined
    ) {
      visionService = null
      if (openaiService) {
        openaiService.updateConfig({
          groqApiKeys: updates.groqApiKeys,
          geminiApiKeys: updates.geminiApiKeys,
          openaiApiKeys: updates.openaiApiKeys,
          apiKey: updates.openaiApiKey,
          model: updates.openaiModel,
          groqModel: updates.groqModel,
          geminiModel: updates.geminiModel,
          resumeDescription: updates.resumeDescription,
          llmProvider: updates.llmProvider
        })
      }
    }

    // Apply window settings immediately — use overlay panel pattern
    if (updates.alwaysOnTop !== undefined && mainWindow) {
      if (updates.alwaysOnTop) {
        mainWindow.setAlwaysOnTop(true, 'screen-saver')
        if (process.platform === 'darwin') {
          mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
        }
      } else {
        mainWindow.setAlwaysOnTop(false)
        if (process.platform === 'darwin') {
          mainWindow.setVisibleOnAllWorkspaces(false)
        }
      }
    }
    if (updates.windowOpacity !== undefined && mainWindow) {
      mainWindow.setOpacity(updates.windowOpacity)
    }

    return settingsManager?.getSettings()
  })

  ipcMain.handle('has-api-keys', () => {
    return settingsManager?.hasApiKeys()
  })

  // Fetch AI models (Groq, Gemini & OpenAI)
  ipcMain.handle('fetch-openai-models', async (_event, apiKey: string) => {
    try {
      if (!apiKey || apiKey.trim().length === 0) {
        throw new Error('API key is required')
      }

      const trimmedKey = apiKey.trim()

      // Handle Groq API Keys (starts with gsk_)
      if (trimmedKey.startsWith('gsk_')) {
        const defaultGroqModels = [
          { id: 'qwen/qwen3.8-27b', name: 'Qwen 3.8 27B (Groq LPU - Ultra Fast ~150ms - Recommended)' },
          { id: 'openai/gpt-oss-20b', name: 'GPT-OSS 20B (Groq LPU - Fast)' },
          { id: 'openai/gpt-oss-120b', name: 'GPT-OSS 120B (Groq LPU - Reasoning)' },
          { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B Versatile' },
          { id: 'llama-3.1-8b-instant', name: 'Llama 3.1 8B Instant' }
        ]

        try {
          const OpenAI = (await import('openai')).default
          const client = new OpenAI({
            apiKey: trimmedKey,
            baseURL: 'https://api.groq.com/openai/v1'
          })
          const response = await client.models.list()
          const groqModels = response.data
            .filter((m) => !m.id.includes('whisper') && !m.id.includes('prompt-guard') && !m.id.includes('orpheus'))
            .map((m) => ({ id: m.id, name: `${m.id} (Groq LPU)` }))
          if (groqModels.length > 0) {
            const priorityIds = ['qwen/qwen3.8-27b', 'openai/gpt-oss-20b', 'openai/gpt-oss-120b', 'llama-3.3-70b-versatile', 'llama-3.1-8b-instant']
            const top = priorityIds
              .map((id) => groqModels.find((m) => m.id === id) || defaultGroqModels.find((m) => m.id === id)!)
              .filter(Boolean)
            const rest = groqModels.filter((m) => !priorityIds.includes(m.id))
            return { success: true, models: [...top, ...rest] }
          }
        } catch {
          // Fall back to default Groq models
        }

        return { success: true, models: defaultGroqModels }
      }

      // Handle OpenAI API Keys (starts with sk-)
      if (trimmedKey.startsWith('sk-')) {
        const OpenAI = (await import('openai')).default
        const client = new OpenAI({ apiKey: trimmedKey })
        const response = await client.models.list()
        const chatModels = response.data
          .filter((model) => model.id.includes('gpt'))
          .map((model) => ({
            id: model.id,
            name: model.id
          }))
        return {
          success: true,
          models: chatModels.length > 0 ? chatModels : [
            { id: 'gpt-4o-mini', name: 'GPT-4o Mini (OpenAI)' },
            { id: 'gpt-4o', name: 'GPT-4o (OpenAI)' }
          ]
        }
      }

      // Handle Google Gemini API Keys
      const defaultGeminiModels = [
        { id: 'gemini-3.5-flash-lite', name: 'Gemini 3.5 Flash Lite (Latest & Highest Free Limit)' },
        { id: 'gemini-3.1-flash-lite', name: 'Gemini 3.1 Flash Lite (Fast & Free)' },
        { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash (Free)' },
        { id: 'gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash Lite (Free)' },
        { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash (Free)' }
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
              return { success: true, models: fetched }
            }
          }
        }
      } catch {
        // Fall back to default
      }

      return { success: true, models: defaultGeminiModels }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to fetch models'
      console.error('Error fetching AI models:', errorMessage)
      return { success: false, error: errorMessage, models: [] }
    }
  })

  // Audio capture handlers
  ipcMain.handle('start-capture', async () => {
    const settings = settingsManager?.getSettings()

    // Debug: Log active keys summary
    const activeKeysSummary = [
      settings?.groqApiKeys?.length ? `Groq (${settings.groqApiKeys.length})` : '',
      settings?.geminiApiKeys?.length ? `Gemini (${settings.geminiApiKeys.length})` : '',
      settings?.openaiApiKeys?.length ? `OpenAI (${settings.openaiApiKeys.length})` : '',
      settings?.deepgramApiKeys?.length ? `Deepgram (${settings.deepgramApiKeys.length})` : ''
    ].filter(Boolean).join(', ') || (settings?.openaiApiKey ? 'Legacy Key' : 'None')

    console.log('API Keys configured:', activeKeysSummary)

    if (!settings || !settingsManager?.hasApiKeys()) {
      sendAppLog('error', 'System', 'API key not configured in Settings.')
      throw new Error('API key not configured. Please add your Groq, Gemini, or OpenAI API key in Settings.')
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

      // Select STT engine based on user preference (defaults to Groq Whisper)
      const requestedStt = settings.sttProvider || 'groq'
      const groqKey = (settings.groqApiKeys && settings.groqApiKeys[0]) || settings.groqApiKey || ''
      const openaiKey = (settings.openaiApiKeys && settings.openaiApiKeys[0]) || (settings.openaiApiKey?.startsWith('sk-') ? settings.openaiApiKey : '')
      const geminiKey = (settings.geminiApiKeys && settings.geminiApiKeys[0]) || settings.geminiApiKey || ''
      const deepgramKey = (settings.deepgramApiKeys && settings.deepgramApiKeys[0]) || settings.deepgramApiKey?.trim() || ''

      if (requestedStt === 'deepgram' && deepgramKey) {
        console.log('===> Using Deepgram Nova-2 live WebSocket streaming')
        sendAppLog('info', 'STT', 'Initializing Deepgram Nova-2 live WebSocket...')
        deepgramService = new DeepgramService({ apiKey: deepgramKey })
        activeSttService = deepgramService
      } else if (requestedStt === 'gemini' && geminiKey) {
        console.log('===> Using Gemini Audio STT')
        sendAppLog('info', 'STT', 'Initializing Gemini Audio STT...')
        whisperService = new WhisperService({ apiKey: geminiKey, language: 'hi' })
        activeSttService = whisperService
      } else if (requestedStt === 'openai' && openaiKey) {
        console.log('===> Using OpenAI Whisper STT')
        sendAppLog('info', 'STT', 'Initializing OpenAI Whisper (whisper-1)...')
        whisperService = new WhisperService({ apiKey: openaiKey, model: 'whisper-1', language: 'hi' })
        activeSttService = whisperService
      } else if (groqKey) {
        // Default / preferred: Groq Whisper
        console.log('===> Using Groq Whisper audio transcription (whisper-large-v3, Hindi/Hinglish)')
        sendAppLog('info', 'STT', 'Initializing Groq Whisper (whisper-large-v3, Hindi/Hinglish)...')
        whisperService = new WhisperService({
          apiKey: groqKey,
          model: 'whisper-large-v3',
          language: 'hi'
        })
        activeSttService = whisperService
      } else if (deepgramKey) {
        console.log('===> Using Deepgram Nova-2 (fallback)')
        sendAppLog('info', 'STT', 'Initializing Deepgram Nova-2 (fallback)...')
        deepgramService = new DeepgramService({ apiKey: deepgramKey })
        activeSttService = deepgramService
      } else if (geminiKey) {
        console.log('===> Using Gemini STT (fallback)')
        sendAppLog('info', 'STT', 'Initializing Gemini Audio STT (fallback)...')
        whisperService = new WhisperService({ apiKey: geminiKey, language: 'hi' })
        activeSttService = whisperService
      } else if (openaiKey) {
        console.log('===> Using OpenAI Whisper (fallback)')
        sendAppLog('info', 'STT', 'Initializing OpenAI Whisper (fallback)...')
        whisperService = new WhisperService({ apiKey: openaiKey, model: 'whisper-1', language: 'hi' })
        activeSttService = whisperService
      } else {
        throw new Error('No STT API key configured. Add a Groq, Deepgram, Gemini, or OpenAI key in Settings.')
      }

      // Initialize OpenAI/Groq/Gemini service for answer generation with multi-key failover
      openaiService = new OpenAIService({
        groqApiKeys: settings.groqApiKeys,
        geminiApiKeys: settings.geminiApiKeys,
        openaiApiKeys: settings.openaiApiKeys,
        apiKey: settings.openaiApiKey,
        groqApiKey: settings.groqApiKey,
        geminiApiKey: settings.geminiApiKey,
        model: settings.openaiModel,
        groqModel: settings.groqModel || 'qwen/qwen3.8-27b',
        geminiModel: settings.geminiModel || 'gemini-3.5-flash-lite',
        resumeDescription: settings.resumeDescription,
        llmProvider: settings.llmProvider || 'groq'
      })

      // Set up OpenAI event listeners ONCE
      openaiService.on('stream', (chunk) => {
        mainWindow?.webContents.send('answer-stream', chunk)
      })

      openaiService.on('warn', (warnMsg: string) => {
        sendAppLog('warn', 'Failover', warnMsg)
      })

      openaiService.on('complete', (answer) => {
        sendAppLog('success', 'AI', `Generated answer (${answer.length} chars)`)
        mainWindow?.webContents.send('answer-complete', answer)
      })

      // Set up STT event listeners
      activeSttService.on('transcript', async (event) => {
        console.log('Transcript received:', event.text)
        sendAppLog('info', 'STT', `[${event.isFinal ? 'FINAL' : 'LIVE'}] ${event.text}`)
        questionDetector?.addTranscript(event.text, event.isFinal)
        mainWindow?.webContents.send('transcript', event)

        // Try early detection for faster response on high-confidence questions
        if (event.isFinal && questionDetector && openaiService) {
          const earlyDetection = questionDetector.checkEarlyDetection(event.text)
          if (earlyDetection) {
            console.log('Early question detection triggered:', earlyDetection.text)
            sendAppLog('success', 'Detector', `⚡ Early question detected: "${earlyDetection.text}"`)
            mainWindow?.webContents.send('question-detected', earlyDetection)
            try {
              sendAppLog('info', 'AI', `Streaming answer for: "${earlyDetection.text.slice(0, 50)}..."`)
              await openaiService.generateAnswer(earlyDetection.text)
            } catch (error) {
              const errMsg = (error as Error).message
              sendAppLog('error', 'AI', `Answer error: ${errMsg}`)
              mainWindow?.webContents.send('answer-error', errMsg)
            }
          }
        }
      })

      activeSttService.on('utteranceEnd', () => {
        console.log('Processing utterance...')
        sendAppLog('info', 'Audio', 'Utterance pause detected')
        questionDetector?.onUtteranceEnd()
        mainWindow?.webContents.send('utterance-end')
      })

      activeSttService.on('speechStarted', () => {
        sendAppLog('info', 'Audio', 'Speech started')
        mainWindow?.webContents.send('speech-started')
      })

      activeSttService.on('started', () => {
        sendAppLog('success', 'STT', 'STT stream connection opened and ready')
      })

      activeSttService.on('error', (error) => {
        const errorMessage = error instanceof Error ? error.message : String(error)
        console.error('STT error:', errorMessage)
        sendAppLog('error', 'STT', `STT error: ${errorMessage}`)
        mainWindow?.webContents.send('capture-error', errorMessage)
      })

      // Set up question detector listener ONCE
      questionDetector?.on('questionDetected', async (detection) => {
        console.log('Question detected:', detection.text)
        sendAppLog('success', 'Detector', `Question detected: "${detection.text}" (${(detection.confidence * 100).toFixed(0)}% conf)`)
        mainWindow?.webContents.send('question-detected', detection)

        if (openaiService) {
          try {
            sendAppLog('info', 'AI', `Streaming answer for: "${detection.text.slice(0, 50)}..."`)
            await openaiService.generateAnswer(detection.text)
          } catch (error) {
            const errMsg = (error as Error).message
            sendAppLog('error', 'AI', `Answer error: ${errMsg}`)
            mainWindow?.webContents.send('answer-error', errMsg)
          }
        }
      })

      // Start STT service
      await activeSttService.start()
      isCapturing = true
      console.log('Audio capture started successfully')
      sendAppLog('success', 'System', 'Audio capture active & listening')

      return { success: true }
    } catch (error: any) {
      console.error('start-capture error:', error)
      const errorMessage =
        error?.message ||
        error?.error?.message ||
        (error instanceof Error ? error.message : 'Failed to start capture')
      sendAppLog('error', 'System', `Failed to start capture: ${errorMessage}`)
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
    if (mainWindow) {
      if (value) {
        mainWindow.setAlwaysOnTop(true, 'screen-saver')
        if (process.platform === 'darwin') {
          mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
        }
      } else {
        mainWindow.setAlwaysOnTop(false)
        if (process.platform === 'darwin') {
          mainWindow.setVisibleOnAllWorkspaces(false)
        }
      }
    }
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

  // Window mouse pass-through handler for click-through mode
  ipcMain.handle('set-ignore-mouse-events', (_event, ignore: boolean, forward?: boolean) => {
    mainWindow?.setIgnoreMouseEvents(ignore, { forward: forward ?? true })
    return true
  })

  // Renderer logging relay handler
  ipcMain.handle(
    'send-renderer-log',
    (
      _event,
      log: {
        level: 'info' | 'warn' | 'error' | 'success'
        source: string
        message: string
      }
    ) => {
      sendAppLog(log.level, log.source, log.message)
      return true
    }
  )

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
      } else if (mainWindow) {
        screenshotService.setWindow(mainWindow)
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

    if (!settingsManager?.hasApiKeys()) {
      return {
        success: false,
        error: 'API key not configured. Please add an API key in Settings.'
      }
    }

    try {
      // Find a vision-capable key (Gemini or OpenAI)
      const geminiKey =
        (settings?.geminiApiKeys && settings.geminiApiKeys.find((k) => k && !k.startsWith('gsk_') && !k.startsWith('sk-'))) ||
        (settings?.geminiApiKey && !settings.geminiApiKey.startsWith('gsk_') && !settings.geminiApiKey.startsWith('sk-') ? settings.geminiApiKey : '')
      const openaiKey =
        (settings?.openaiApiKeys && settings.openaiApiKeys.find((k) => k && k.startsWith('sk-'))) ||
        (settings?.openaiApiKey && settings.openaiApiKey.startsWith('sk-') ? settings.openaiApiKey : '')

      const visionKey = geminiKey || openaiKey

      if (!visionKey) {
        const errorMsg = 'Screenshot solving requires a vision-capable AI model. Please add a free Google Gemini API key in Settings (https://aistudio.google.com/app/apikey). Groq provides ultra-fast Voice STT & Answers, but does not support image analysis.'
        mainWindow?.webContents.send('answer-error', errorMsg)
        return {
          success: false,
          error: errorMsg
        }
      }

      // Initialize vision service with the actual vision key
      visionService = new VisionService({
        apiKey: visionKey,
        model: openaiKey && !geminiKey ? 'gpt-4o-mini' : undefined
      })

      if (!openaiService) {
        openaiService = new OpenAIService({
          groqApiKeys: settings?.groqApiKeys,
          geminiApiKeys: settings?.geminiApiKeys,
          openaiApiKeys: settings?.openaiApiKeys,
          apiKey: settings?.openaiApiKey,
          model: settings?.openaiModel,
          groqModel: settings?.groqModel,
          geminiModel: settings?.geminiModel,
          resumeDescription: settings?.resumeDescription
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
