import { ElectronAPI } from '@electron-toolkit/preload'

export interface TranscriptEvent {
  text: string
  isFinal: boolean
  confidence: number
}

export interface DetectedQuestion {
  text: string
  confidence: number
  questionType: 'direct' | 'indirect' | 'rhetorical' | 'unknown'
  category?: 'architecture_project' | 'behavioral' | 'coding' | 'conceptual' | 'unknown'
  boundContext?: string
  isContinuation?: boolean
}

export interface DetectedQuestionFromImage {
  text: string
  questionType?: 'leetcode' | 'system-design' | 'other'
  confidence?: number
}

export type CodingLanguage = 'cpp' | 'python' | 'java'

export interface AppSettings {
  sttProvider?: 'groq' | 'deepgram' | 'gemini' | 'openai'
  llmProvider?: 'groq' | 'gemini' | 'openai'
  visionProvider?: 'gemini' | 'openai' | 'groq'
  codingLanguage?: CodingLanguage

  groqApiKeys?: string[]
  geminiApiKeys?: string[]
  openaiApiKeys?: string[]
  deepgramApiKeys?: string[]

  groqApiKey?: string
  geminiApiKey?: string
  openaiApiKey: string
  deepgramApiKey?: string

  openaiModel: string
  groqModel?: string
  geminiModel?: string

  alwaysOnTop: boolean
  windowOpacity: number
  pauseThreshold: number
  autoStart: boolean
  resumeDescription: string
}

export interface AudioSource {
  id: string
  name: string
  thumbnail: string
}

export interface AnswerEntry {
  id: string
  question: string
  answer: string
  timestamp: number
  isStreaming: boolean
  category?: 'architecture_project' | 'behavioral' | 'coding' | 'conceptual' | 'unknown'
}

export interface Api {
  // Settings
  getSettings: () => Promise<AppSettings>
  updateSettings: (updates: Partial<AppSettings>) => Promise<AppSettings>
  hasApiKeys: () => Promise<boolean>
  fetchOpenAIModels: (
    apiKey: string
  ) => Promise<{ success: boolean; models: Array<{ id: string; name: string }>; error?: string }>

  // Audio capture
  startCapture: () => Promise<{ success: boolean }>
  stopCapture: () => Promise<{ success: boolean }>
  getCaptureStatus: () => Promise<boolean>
  sendAudioData: (audioData: ArrayBuffer) => void
  sendCandidateSpeakingState: (isSpeaking: boolean, wasAnswer?: boolean) => void
  resetTurnBoundary: () => Promise<{ success: boolean }>
  getAudioSources: () => Promise<AudioSource[]>

  // Window controls
  setAlwaysOnTop: (value: boolean) => Promise<boolean>
  setWindowOpacity: (value: number) => Promise<number>
  minimizeWindow: () => Promise<void>
  closeWindow: () => Promise<void>
  setIgnoreMouseEvents: (ignore: boolean, forward?: boolean) => Promise<boolean>
  sendRendererLog: (log: {
    level: 'info' | 'warn' | 'error' | 'success'
    source: string
    message: string
  }) => Promise<boolean>

  // Conversation
  clearHistory: () => Promise<{ success: boolean }>

  // History
  getHistory: () => Promise<AnswerEntry[]>
  saveHistoryEntry: (entry: AnswerEntry) => Promise<{ success: boolean }>
  saveHistoryEntries: (entries: AnswerEntry[]) => Promise<{ success: boolean }>
  clearSavedHistory: () => Promise<{ success: boolean }>
  deleteHistoryEntry: (id: string) => Promise<{ success: boolean }>

  // Clipboard
  writeToClipboard: (text: string) => Promise<{ success: boolean; error?: string }>

  // Screenshot
  captureScreenshot: () => Promise<{ success: boolean; imageData?: string; error?: string }>
  analyzeScreenshot: (imageData: string) => Promise<{
    success: boolean
    isQuestion?: boolean
    questionText?: string
    questionType?: 'leetcode' | 'system-design' | 'other'
    error?: string
    message?: string
  }>

  // Session API
  callSessionApi: (payload: {
    sessionDuration: number
    timestamp: number
    [key: string]: unknown
  }) => Promise<{ success: boolean; data?: unknown; error?: string }>

  // Event listeners
  onTranscript: (callback: (event: TranscriptEvent) => void) => () => void
  onUtteranceEnd: (callback: () => void) => () => void
  onSpeechStarted: (callback: () => void) => () => void
  onCandidateSpeaking: (callback: (isSpeaking: boolean) => void) => () => void
  onQuestionDetected: (callback: (question: DetectedQuestion) => void) => () => void
  onAnswerStream: (callback: (chunk: string) => void) => () => void
  onAnswerComplete: (callback: (answer: string) => void) => () => void
  onCaptureError: (callback: (error: string) => void) => () => void
  onAnswerError: (callback: (error: string) => void) => () => void
  onScreenshotCaptured: (callback: (data: { imageData: string }) => void) => () => void
  onQuestionDetectedFromImage: (
    callback: (question: DetectedQuestionFromImage) => void
  ) => () => void
  onScreenshotNoQuestion: (callback: (data: { message: string }) => void) => () => void
  onAppLog: (
    callback: (log: {
      id: string
      timestamp: number
      level: 'info' | 'warn' | 'error' | 'success'
      source: string
      message: string
    }) => void
  ) => () => void
  onTriggerScreenshotSolve: (callback: () => void) => () => void
  onTriggerStealthClear: (callback: () => void) => () => void
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: Api
  }
}
