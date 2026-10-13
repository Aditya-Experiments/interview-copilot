import {
  AlertCircle,
  CheckCircle,
  Coffee,
  Eye,
  EyeOff,
  Mic,
  Plus,
  Save,
  Trash2,
  X,
  Zap
} from 'lucide-react'
import { useState } from 'react'
import { AppSettings, useInterviewStore } from '../store/interviewStore'

interface ModelOption {
  id: string
  name: string
}

const GROQ_MODELS: ModelOption[] = [
  { id: 'qwen/qwen3.6-27b', name: 'Qwen 3.6 27B (Recommended - Fast & Multilingual)' },
  { id: 'openai/gpt-oss-120b', name: 'GPT-OSS 120B (Most Capable)' },
  { id: 'deepseek-r1-distill-llama-70b', name: 'DeepSeek R1 70B (Reasoning)' }
]

const GEMINI_MODELS: ModelOption[] = [
  { id: 'gemini-3.5-flash-lite', name: 'Gemini 3.5 Flash Lite (Latest & Highest Free Limits)' },
  { id: 'gemini-3.1-flash-lite', name: 'Gemini 3.1 Flash Lite (Fast & Free)' },
  { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash (Free)' },
  { id: 'gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash Lite (Free)' },
  { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash (Free)' }
]

const OPENAI_MODELS: ModelOption[] = [
  { id: 'gpt-4o-mini', name: 'GPT-4o Mini (OpenAI)' },
  { id: 'gpt-4o', name: 'GPT-4o (OpenAI)' }
]

interface KeyListEditorProps {
  title: string
  badge?: string
  badgeColor?: string
  linkText: string
  linkUrl: string
  description: string
  keys: string[]
  onChange: (keys: string[]) => void
  placeholder: string
  modelId: string
  onModelChange: (model: string) => void
  modelOptions: ModelOption[]
  modelLabel: string
}

function KeyListEditor({
  title,
  badge,
  badgeColor = 'text-amber-400 bg-amber-400/10 border-amber-400/20',
  linkText,
  linkUrl,
  description,
  keys,
  onChange,
  placeholder,
  modelId,
  onModelChange,
  modelOptions,
  modelLabel
}: KeyListEditorProps): React.JSX.Element {
  const [showKeyIndex, setShowKeyIndex] = useState<Record<number, boolean>>({})

  const keyList = keys.length > 0 ? keys : ['']

  const handleKeyChange = (index: number, val: string): void => {
    const updated = [...keyList]
    updated[index] = val
    onChange(updated)
  }

  const handleAddKey = (): void => {
    onChange([...keyList, ''])
  }

  const handleRemoveKey = (index: number): void => {
    const updated = keyList.filter((_, i) => i !== index)
    onChange(updated.length > 0 ? updated : [''])
  }

  const toggleShow = (index: number): void => {
    setShowKeyIndex((prev) => ({ ...prev, [index]: !prev[index] }))
  }

  return (
    <div className="p-4 rounded-xl bg-dark-800/80 border border-dark-700 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <label className="text-sm font-semibold text-dark-100">{title}</label>
          {badge && (
            <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${badgeColor}`}>
              {badge}
            </span>
          )}
        </div>
        <a
          href={linkUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-blue-400 hover:text-blue-300 hover:underline font-medium"
        >
          {linkText}
        </a>
      </div>

      <p className="text-xs text-dark-400">{description}</p>

      {/* Model Selection */}
      <div className="space-y-1">
        <label className="text-xs font-medium text-dark-300">{modelLabel}</label>
        <select
          value={modelId}
          onChange={(e) => onModelChange(e.target.value)}
          className="w-full px-3 py-1.5 bg-dark-900 border border-dark-600 rounded-lg text-xs text-dark-100 focus:outline-none focus:border-blue-500 transition-colors"
        >
          {modelOptions.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </div>

      {/* Keys list */}
      <div className="space-y-2 pt-1">
        <label className="text-xs font-medium text-dark-300 flex items-center justify-between">
          <span>API Keys ({keyList.length})</span>
          {keyList.length > 1 && (
            <span className="text-[10px] text-green-400 flex items-center gap-1 font-normal">
              <CheckCircle size={10} /> Auto-rotates if tokens run out
            </span>
          )}
        </label>

        {keyList.map((keyVal, idx) => (
          <div key={idx} className="flex items-center gap-2">
            <div className="relative flex-1">
              <input
                type={showKeyIndex[idx] ? 'text' : 'password'}
                value={keyVal}
                onChange={(e) => handleKeyChange(idx, e.target.value)}
                placeholder={`${placeholder} ${idx > 0 ? `(Backup Key #${idx + 1})` : '(Primary)'}`}
                className="w-full px-3 py-1.5 pr-9 bg-dark-900 border border-dark-600 rounded-lg text-xs text-dark-100 placeholder-dark-500 focus:outline-none focus:border-blue-500 transition-colors"
              />
              <button
                type="button"
                onClick={() => toggleShow(idx)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-dark-400 hover:text-dark-200"
              >
                {showKeyIndex[idx] ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>

            {keyList.length > 1 && (
              <button
                type="button"
                onClick={() => handleRemoveKey(idx)}
                title="Remove key"
                className="p-1.5 rounded hover:bg-red-500/10 text-dark-400 hover:text-red-400 transition-colors"
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
        ))}

        <button
          type="button"
          onClick={handleAddKey}
          className="flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 font-medium pt-1 transition-colors"
        >
          <Plus size={13} />
          <span>Add Another Key (Auto-Token Rotation)</span>
        </button>
      </div>
    </div>
  )
}

export function SettingsModal(): React.JSX.Element | null {
  const { settings, showSettings, setShowSettings, setSettings } = useInterviewStore()
  const [localSettings, setLocalSettings] = useState<AppSettings>(settings)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [showDeepgramKey, setShowDeepgramKey] = useState(false)

  const [prevSettings, setPrevSettings] = useState(settings)
  if (settings !== prevSettings) {
    setPrevSettings(settings)
    setLocalSettings(settings)
  }

  if (!showSettings) return null

  // Ensure arrays exist
  const groqKeys = localSettings.groqApiKeys && localSettings.groqApiKeys.length > 0
    ? localSettings.groqApiKeys
    : localSettings.groqApiKey ? [localSettings.groqApiKey] : ['']

  const geminiKeys = localSettings.geminiApiKeys && localSettings.geminiApiKeys.length > 0
    ? localSettings.geminiApiKeys
    : localSettings.geminiApiKey ? [localSettings.geminiApiKey] : ['']

  const openaiKeys = localSettings.openaiApiKeys && localSettings.openaiApiKeys.length > 0
    ? localSettings.openaiApiKeys
    : (localSettings.openaiApiKey && localSettings.openaiApiKey.startsWith('sk-')) ? [localSettings.openaiApiKey] : ['']

  const handleSave = async (): Promise<void> => {
    try {
      setSaveStatus('saving')

      const cleanGroq = groqKeys.map((k) => k.trim()).filter(Boolean)
      const cleanGemini = geminiKeys.map((k) => k.trim()).filter(Boolean)
      const cleanOpenAI = openaiKeys.map((k) => k.trim()).filter(Boolean)

      const primaryGroq = cleanGroq[0] || ''
      const primaryGemini = cleanGemini[0] || ''
      const primaryOpenAI = cleanOpenAI[0] || ''

      const fallbackApiKey = primaryGroq || primaryGemini || primaryOpenAI || ''

      const updatedLocalSettings: AppSettings = {
        ...localSettings,
        groqApiKeys: cleanGroq,
        geminiApiKeys: cleanGemini,
        openaiApiKeys: cleanOpenAI,
        groqApiKey: primaryGroq,
        geminiApiKey: primaryGemini,
        openaiApiKey: fallbackApiKey,
        groqModel: localSettings.groqModel || 'qwen/qwen3.6-27b',
        geminiModel: localSettings.geminiModel || 'gemini-3.5-flash-lite',
        openaiModel: localSettings.openaiModel || 'gpt-4o-mini'
      }

      const updatedSettings = await window.api.updateSettings(updatedLocalSettings)
      setSettings(updatedSettings as AppSettings)
      setSaveStatus('saved')
      setTimeout(() => {
        setSaveStatus('idle')
        setShowSettings(false)
      }, 1000)
    } catch (err) {
      console.error('Failed to save settings:', err)
      setSaveStatus('error')
      setTimeout(() => setSaveStatus('idle'), 3000)
    }
  }

  const handleOpacityChange = async (value: number): Promise<void> => {
    setLocalSettings({ ...localSettings, windowOpacity: value })
    await window.api.setWindowOpacity(value)
  }

  const handleClose = (): void => {
    setLocalSettings(settings)
    setShowSettings(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-xl mx-4 bg-dark-900 rounded-xl border border-dark-700 shadow-2xl animate-fade-in flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-dark-700">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600">
              <Mic className="h-5 w-5 text-white" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-dark-100">Settings</h2>
              <p className="text-[11px] text-dark-400">Configure AI providers, models, and token rotation</p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="p-1.5 rounded hover:bg-dark-700 transition-colors text-dark-400 hover:text-dark-200"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="px-5 py-5 space-y-4 overflow-y-auto custom-scrollbar flex-1">
          {/* Failover / Token Rotation Banner */}
          <div className="p-3 rounded-lg bg-blue-950/40 border border-blue-800/40 flex items-start gap-2.5">
            <Zap className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
            <div className="text-xs text-dark-300 leading-relaxed">
              <strong className="text-dark-100 font-medium">Automatic Token Rotation:</strong> Add multiple keys
              for any provider. If one key runs out of daily tokens or rate limits, the app instantly switches
              to your backup key or falls back to the next provider without dropping your answer!
            </div>
          </div>

          {/* 1. Groq Section */}
          <KeyListEditor
            title="Groq (LPU Silicon)"
            badge="⚡ Instant ~150ms Speed"
            badgeColor="text-amber-400 bg-amber-400/10 border-amber-400/20"
            linkText="Get Free Groq Key (No Card) →"
            linkUrl="https://console.groq.com/keys"
            description="Ultra-fast LPU inference. Recommended for live job interviews for sub-second answers."
            keys={groqKeys}
            onChange={(keys) => setLocalSettings({ ...localSettings, groqApiKeys: keys })}
            placeholder="gsk_..."
            modelId={localSettings.groqModel || 'qwen/qwen3.6-27b'}
            onModelChange={(model) => setLocalSettings({ ...localSettings, groqModel: model })}
            modelOptions={GROQ_MODELS}
            modelLabel="Groq Model"
          />

          {/* 2. Google Gemini Section */}
          <KeyListEditor
            title="Google Gemini"
            badge="100% Free Multimodal"
            badgeColor="text-green-400 bg-green-400/10 border-green-400/20"
            linkText="Get Free Gemini Key →"
            linkUrl="https://aistudio.google.com/app/apikey"
            description="Google AI Studio provides generous free rate limits for Gemini Flash-Lite and Flash models."
            keys={geminiKeys}
            onChange={(keys) => setLocalSettings({ ...localSettings, geminiApiKeys: keys })}
            placeholder="AIza... or AQ..."
            modelId={localSettings.geminiModel || 'gemini-3.5-flash-lite'}
            onModelChange={(model) => setLocalSettings({ ...localSettings, geminiModel: model })}
            modelOptions={GEMINI_MODELS}
            modelLabel="Gemini Model"
          />

          {/* 3. OpenAI / ChatGPT Section */}
          <KeyListEditor
            title="OpenAI (ChatGPT)"
            badge="Standard API"
            badgeColor="text-blue-400 bg-blue-400/10 border-blue-400/20"
            linkText="Get OpenAI Key →"
            linkUrl="https://platform.openai.com/api-keys"
            description="Use your OpenAI account with GPT-4o Mini or GPT-4o."
            keys={openaiKeys}
            onChange={(keys) => setLocalSettings({ ...localSettings, openaiApiKeys: keys })}
            placeholder="sk-..."
            modelId={localSettings.openaiModel || 'gpt-4o-mini'}
            onModelChange={(model) => setLocalSettings({ ...localSettings, openaiModel: model })}
            modelOptions={OPENAI_MODELS}
            modelLabel="OpenAI Model"
          />

          {/* 4. Deepgram Section */}
          <div className="p-4 rounded-xl bg-dark-800/80 border border-dark-700 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <label className="text-sm font-semibold text-dark-100">Deepgram STT</label>
                <span className="text-[10px] font-medium px-2 py-0.5 rounded-full border text-purple-400 bg-purple-400/10 border-purple-400/20">
                  Nova-2 Live Audio
                </span>
              </div>
              <a
                href="https://console.deepgram.com/signup"
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-purple-400 hover:text-purple-300 hover:underline font-medium"
              >
                Get Free Key ($200 Credit) →
              </a>
            </div>
            <p className="text-xs text-dark-400">
              Optional. Live WebSocket streaming speech recognition with ~150ms latency. If left blank, uses Groq Whisper / Gemini audio.
            </p>
            <div className="relative">
              <input
                type={showDeepgramKey ? 'text' : 'password'}
                value={localSettings.deepgramApiKey || ''}
                onChange={(e) =>
                  setLocalSettings({ ...localSettings, deepgramApiKey: e.target.value })
                }
                placeholder="Enter Deepgram API Key"
                className="w-full px-3 py-1.5 pr-9 bg-dark-900 border border-dark-600 rounded-lg text-xs text-dark-100 placeholder-dark-500 focus:outline-none focus:border-purple-500 transition-colors"
              />
              <button
                type="button"
                onClick={() => setShowDeepgramKey(!showDeepgramKey)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-dark-400 hover:text-dark-200"
              >
                {showDeepgramKey ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>

          {/* Resume Description */}
          <div className="p-4 rounded-xl bg-dark-800/80 border border-dark-700 space-y-2">
            <label className="text-sm font-semibold text-dark-100">Candidate Resume & Background</label>
            <p className="text-xs text-dark-400">
              Paste your experience, projects, and skills. The AI uses this context to tailor first-person answers.
            </p>
            <textarea
              value={localSettings.resumeDescription}
              onChange={(e) =>
                setLocalSettings({ ...localSettings, resumeDescription: e.target.value })
              }
              placeholder="Paste your resume or background summary here..."
              rows={5}
              className="w-full px-3 py-2 bg-dark-900 border border-dark-600 rounded-lg text-xs text-dark-100 placeholder-dark-500 focus:outline-none focus:border-blue-500 transition-colors resize-y custom-scrollbar"
            />
          </div>

          {/* Silence Detection & Window Opacity */}
          <div className="p-4 rounded-xl bg-dark-800/80 border border-dark-700 space-y-4">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-dark-200">Silence Detection</span>
                <span className="text-dark-400 font-mono">{localSettings.pauseThreshold}ms</span>
              </div>
              <input
                type="range"
                min="500"
                max="3000"
                step="100"
                value={localSettings.pauseThreshold}
                onChange={(e) =>
                  setLocalSettings({ ...localSettings, pauseThreshold: Number(e.target.value) })
                }
                className="w-full accent-blue-500"
              />
              <p className="text-[11px] text-dark-500">Wait time after speaker pauses before answering (Default: 1500ms)</p>
            </div>

            <div className="space-y-1.5 pt-2 border-t border-dark-700">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-dark-200">Window Opacity</span>
                <span className="text-dark-400 font-mono">{Math.round(localSettings.windowOpacity * 100)}%</span>
              </div>
              <input
                type="range"
                min="0.3"
                max="1"
                step="0.05"
                value={localSettings.windowOpacity}
                onChange={(e) => handleOpacityChange(Number(e.target.value))}
                className="w-full accent-blue-500"
              />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3.5 border-t border-dark-700 bg-dark-900">
          <div className="flex items-center gap-3">
            <a
              href="https://buymeacoffee.com"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-3 py-1.5 bg-amber-600/90 hover:bg-amber-600 text-white text-xs font-medium rounded-lg transition-colors"
            >
              <Coffee size={14} />
              <span>Buy me a coffee</span>
            </a>
            {saveStatus === 'error' && (
              <div className="flex items-center gap-1.5 text-xs text-red-400">
                <AlertCircle size={14} />
                <span>Failed to save</span>
              </div>
            )}
            {saveStatus === 'saved' && (
              <div className="flex items-center gap-1.5 text-xs text-green-400">
                <CheckCircle size={14} />
                <span>Saved successfully!</span>
              </div>
            )}
          </div>

          <div className="flex gap-2">
            <button
              onClick={handleClose}
              className="px-3.5 py-1.5 text-xs font-medium text-dark-300 hover:text-dark-100 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saveStatus === 'saving'}
              className="flex items-center gap-1.5 px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium rounded-lg transition-colors disabled:opacity-50"
            >
              <Save size={14} />
              <span>{saveStatus === 'saving' ? 'Saving...' : 'Save Settings'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
