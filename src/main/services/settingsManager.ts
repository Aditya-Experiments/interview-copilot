import { config } from 'dotenv'
import { app, safeStorage } from 'electron'
import * as fs from 'fs'
import * as path from 'path'

// Load environment variables from .env file
config()

export type SttProvider = 'groq' | 'deepgram' | 'gemini' | 'openai'
export type LlmProvider = 'groq' | 'gemini' | 'openai'
export type VisionProvider = 'gemini' | 'openai' | 'groq'

export interface AppSettings {
  sttProvider?: SttProvider
  llmProvider?: LlmProvider
  visionProvider?: VisionProvider

  groqApiKeys?: string[]
  geminiApiKeys?: string[]
  openaiApiKeys?: string[]
  deepgramApiKeys?: string[]

  // Legacy single key fields kept for backward compatibility:
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

// Load from environment variables if available
const getEnvApiKey = (key: string): string => {
  return process.env[key] || process.env[`VITE_${key}`] || ''
}

const DEFAULT_SETTINGS: AppSettings = {
  sttProvider: 'groq',
  llmProvider: 'groq',
  visionProvider: 'gemini',
  groqApiKeys: [],
  geminiApiKeys: [],
  openaiApiKeys: [],
  deepgramApiKeys: [],
  groqApiKey: getEnvApiKey('GROQ_API_KEY') || '',
  geminiApiKey: getEnvApiKey('GEMINI_API_KEY') || '',
  openaiApiKey: getEnvApiKey('OPENAI_API_KEY') || '',
  openaiModel:
    process.env.GROQ_MODEL ||
    process.env.VITE_GROQ_MODEL ||
    process.env.GEMINI_MODEL ||
    process.env.VITE_GEMINI_MODEL ||
    process.env.OPENAI_MODEL ||
    process.env.VITE_OPENAI_MODEL ||
    'qwen/qwen3.8-27b',
  groqModel: 'llama-3.3-70b-versatile',
  geminiModel: 'gemini-3.5-flash-lite',
  deepgramApiKey: getEnvApiKey('DEEPGRAM_API_KEY') || '',
  alwaysOnTop: true,
  windowOpacity: 1.0,
  pauseThreshold: 1500,
  autoStart: false,
  resumeDescription: ''
}

const decryptKeyList = (savedSettings: Record<string, any>, keyField: string, encField: string): string[] => {
  const result: string[] = []
  if (Array.isArray(savedSettings[keyField])) {
    for (const k of savedSettings[keyField]) {
      if (typeof k === 'string' && k.trim() && !result.includes(k.trim())) {
        result.push(k.trim())
      }
    }
  }
  if (Array.isArray(savedSettings[encField]) && safeStorage.isEncryptionAvailable()) {
    for (const enc of savedSettings[encField]) {
      try {
        const decrypted = safeStorage.decryptString(Buffer.from(enc, 'base64')).trim()
        if (decrypted && !result.includes(decrypted)) {
          result.push(decrypted)
        }
      } catch {
        // ignore decryption error
      }
    }
    delete savedSettings[encField]
  }
  return result
}

const encryptKeyList = (settingsToSave: Record<string, any>, keyField: string, encField: string): void => {
  const keys: string[] = Array.isArray(settingsToSave[keyField])
    ? (settingsToSave[keyField] as string[]).map((k) => k.trim()).filter(Boolean)
    : []
  if (keys.length > 0 && safeStorage.isEncryptionAvailable()) {
    settingsToSave[encField] = keys.map((k) => safeStorage.encryptString(k).toString('base64'))
    settingsToSave[keyField] = []
  }
}

export class SettingsManager {
  private settingsPath: string
  private settings: AppSettings

  constructor() {
    const userDataPath = app.getPath('userData')
    this.settingsPath = path.join(userDataPath, 'settings.json')
    this.settings = this.loadSettings()
  }

  private loadSettings(): AppSettings {
    try {
      if (fs.existsSync(this.settingsPath)) {
        const data = fs.readFileSync(this.settingsPath, 'utf-8')
        const savedSettings = JSON.parse(data)

        // Decrypt key arrays
        const groqKeys = decryptKeyList(savedSettings, 'groqApiKeys', 'groqApiKeysEncrypted')
        const geminiKeys = decryptKeyList(savedSettings, 'geminiApiKeys', 'geminiApiKeysEncrypted')
        const openaiKeys = decryptKeyList(savedSettings, 'openaiApiKeys', 'openaiApiKeysEncrypted')
        const deepgramKeys = decryptKeyList(savedSettings, 'deepgramApiKeys', 'deepgramApiKeysEncrypted')

        // Decrypt legacy single keys
        if (safeStorage.isEncryptionAvailable()) {
          if (savedSettings.groqApiKeyEncrypted) {
            try {
              const k = safeStorage.decryptString(Buffer.from(savedSettings.groqApiKeyEncrypted, 'base64')).trim()
              if (k && !groqKeys.includes(k)) groqKeys.push(k)
              delete savedSettings.groqApiKeyEncrypted
            } catch {
              // ignore
            }
          }
          if (savedSettings.geminiApiKeyEncrypted) {
            try {
              const k = safeStorage.decryptString(Buffer.from(savedSettings.geminiApiKeyEncrypted, 'base64')).trim()
              if (k && !geminiKeys.includes(k)) geminiKeys.push(k)
              delete savedSettings.geminiApiKeyEncrypted
            } catch {
              // ignore
            }
          }
          if (savedSettings.openaiApiKeyEncrypted) {
            try {
              const k = safeStorage.decryptString(Buffer.from(savedSettings.openaiApiKeyEncrypted, 'base64')).trim()
              if (k) {
                if (k.startsWith('gsk_') && !groqKeys.includes(k)) groqKeys.push(k)
                else if ((k.startsWith('AIza') || k.startsWith('AQ.')) && !geminiKeys.includes(k)) geminiKeys.push(k)
                else if (!openaiKeys.includes(k)) openaiKeys.push(k)
              }
              delete savedSettings.openaiApiKeyEncrypted
            } catch {
              // ignore
            }
          }
          if (savedSettings.deepgramApiKeyEncrypted) {
            try {
              const k = safeStorage.decryptString(Buffer.from(savedSettings.deepgramApiKeyEncrypted, 'base64')).trim()
              if (k && !deepgramKeys.includes(k)) deepgramKeys.push(k)
              delete savedSettings.deepgramApiKeyEncrypted
            } catch {
              // ignore
            }
          }
        }

        // Migrate plain single keys if any
        if (savedSettings.groqApiKey && !groqKeys.includes(savedSettings.groqApiKey.trim())) {
          groqKeys.push(savedSettings.groqApiKey.trim())
        }
        if (savedSettings.geminiApiKey && !geminiKeys.includes(savedSettings.geminiApiKey.trim())) {
          geminiKeys.push(savedSettings.geminiApiKey.trim())
        }
        if (savedSettings.openaiApiKey) {
          const k = savedSettings.openaiApiKey.trim()
          if (k.startsWith('gsk_') && !groqKeys.includes(k)) groqKeys.push(k)
          else if ((k.startsWith('AIza') || k.startsWith('AQ.')) && !geminiKeys.includes(k)) geminiKeys.push(k)
          else if (!openaiKeys.includes(k)) openaiKeys.push(k)
        }
        if (savedSettings.deepgramApiKey && !deepgramKeys.includes(savedSettings.deepgramApiKey.trim())) {
          deepgramKeys.push(savedSettings.deepgramApiKey.trim())
        }

        if (!savedSettings.groqModel) {
          savedSettings.groqModel = 'llama-3.3-70b-versatile'
        }
        if (savedSettings.geminiModel === 'gemini-2.5-flash' || savedSettings.geminiModel === 'gemini-2.5-flash-lite') {
          savedSettings.geminiModel = 'gemini-3.5-flash-lite'
        }

        const loaded: AppSettings = {
          ...DEFAULT_SETTINGS,
          ...savedSettings,
          groqApiKeys: groqKeys,
          geminiApiKeys: geminiKeys,
          openaiApiKeys: openaiKeys,
          deepgramApiKeys: deepgramKeys,
          groqApiKey: groqKeys[0] || savedSettings.groqApiKey || '',
          geminiApiKey: geminiKeys[0] || savedSettings.geminiApiKey || '',
          openaiApiKey: openaiKeys[0] || groqKeys[0] || geminiKeys[0] || savedSettings.openaiApiKey || '',
          deepgramApiKey: deepgramKeys[0] || savedSettings.deepgramApiKey || ''
        }

        return loaded
      }
    } catch (error) {
      console.error('Failed to load settings:', error)
    }
    return { ...DEFAULT_SETTINGS }
  }

  private saveSettings(): void {
    try {
      const settingsToSave: Record<string, any> = { ...this.settings }

      // Encrypt arrays of keys
      encryptKeyList(settingsToSave, 'groqApiKeys', 'groqApiKeysEncrypted')
      encryptKeyList(settingsToSave, 'geminiApiKeys', 'geminiApiKeysEncrypted')
      encryptKeyList(settingsToSave, 'openaiApiKeys', 'openaiApiKeysEncrypted')
      encryptKeyList(settingsToSave, 'deepgramApiKeys', 'deepgramApiKeysEncrypted')

      // Clear plain key strings in file for security
      delete settingsToSave.groqApiKey
      delete settingsToSave.geminiApiKey
      delete settingsToSave.openaiApiKey
      delete settingsToSave.deepgramApiKey

      fs.writeFileSync(this.settingsPath, JSON.stringify(settingsToSave, null, 2))
    } catch (error) {
      console.error('Failed to save settings:', error)
    }
  }

  getSettings(): AppSettings {
    return { ...this.settings }
  }

  updateSettings(updates: Partial<AppSettings>): AppSettings {
    // If arrays were updated, ensure single key aliases stay synced
    const newSettings = { ...this.settings, ...updates }
    if (updates.groqApiKeys) {
      newSettings.groqApiKey = updates.groqApiKeys[0] || ''
    }
    if (updates.geminiApiKeys) {
      newSettings.geminiApiKey = updates.geminiApiKeys[0] || ''
    }
    if (updates.openaiApiKeys) {
      newSettings.openaiApiKey = updates.openaiApiKeys[0] || ''
    }
    if (updates.deepgramApiKeys) {
      newSettings.deepgramApiKey = updates.deepgramApiKeys[0] || ''
    }

    // Ensure fallback openaiApiKey alias is never wiped empty if other keys exist
    if (!newSettings.openaiApiKey) {
      newSettings.openaiApiKey =
        (newSettings.openaiApiKeys && newSettings.openaiApiKeys[0]) ||
        (newSettings.groqApiKeys && newSettings.groqApiKeys[0]) ||
        (newSettings.geminiApiKeys && newSettings.geminiApiKeys[0]) ||
        newSettings.groqApiKey ||
        newSettings.geminiApiKey ||
        updates.openaiApiKey ||
        ''
    }

    this.settings = newSettings
    this.saveSettings()
    return this.getSettings()
  }

  hasApiKeys(): boolean {
    return Boolean(
      (this.settings.groqApiKeys && this.settings.groqApiKeys.length > 0) ||
      (this.settings.geminiApiKeys && this.settings.geminiApiKeys.length > 0) ||
      (this.settings.openaiApiKeys && this.settings.openaiApiKeys.length > 0) ||
      this.settings.groqApiKey ||
      this.settings.geminiApiKey ||
      this.settings.openaiApiKey ||
      this.settings.deepgramApiKey
    )
  }

  getSetting<K extends keyof AppSettings>(key: K): AppSettings[K] {
    return this.settings[key]
  }

  setSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]): void {
    this.settings[key] = value
    this.saveSettings()
  }
}
