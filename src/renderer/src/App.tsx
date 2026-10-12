import { useEffect } from 'react'
import { AnswerPanel } from './components/AnswerPanel'
import { DevLogsModal } from './components/DevLogsModal'
import { Header } from './components/Header'
import { HistoryPanel } from './components/HistoryPanel'
import { SettingsModal } from './components/SettingsModal'
import { StatusBar } from './components/StatusBar'
import { TranscriptPanel } from './components/TranscriptPanel'
import { useInterviewEvents } from './hooks/useInterviewEvents'
import { useInterviewStore } from './store/interviewStore'

function App(): React.JSX.Element {
  const { setShowSettings, settings, showHistory, setShowHistory, isClickThrough } =
    useInterviewStore()

  // Set up IPC event listeners ONCE at the app level
  useInterviewEvents()

  // Check for API keys on mount
  useEffect(() => {
    const checkApiKeys = async (): Promise<void> => {
      try {
        // Check if API key is missing
        const hasApiKeys = await window.api.hasApiKeys()

        // Show settings modal if API keys are not configured
        if (!hasApiKeys) {
          setShowSettings(true)
        }
      } catch (err) {
        console.error('Failed to check required configuration:', err)
      }
    }
    checkApiKeys()
  }, [setShowSettings])

  // Apply window opacity from settings
  useEffect(() => {
    if (settings.windowOpacity && settings.windowOpacity !== 1) {
      window.api.setWindowOpacity(settings.windowOpacity)
    }
  }, [settings.windowOpacity])

  // Handle Click-Through / Ghost Mode with intelligent mouse forwarding
  useEffect(() => {
    if (!isClickThrough) {
      window.api.setIgnoreMouseEvents(false)
      return
    }

    // Default to passing clicks through to background apps
    window.api.setIgnoreMouseEvents(true, true)

    const handleMouseMove = (e: MouseEvent): void => {
      const target = e.target as HTMLElement | null
      // Keep navbar, status bar, modals, and buttons interactive
      const isInteractive = Boolean(
        target?.closest('[data-interactive="true"]') ||
        target?.closest('header') ||
        target?.closest('button') ||
        target?.closest('input') ||
        target?.closest('.modal-container')
      )

      if (isInteractive) {
        window.api.setIgnoreMouseEvents(false)
      } else {
        window.api.setIgnoreMouseEvents(true, true)
      }
    }

    window.addEventListener('mousemove', handleMouseMove)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.api.setIgnoreMouseEvents(false)
    }
  }, [isClickThrough])

  return (
    <div className="flex flex-col h-screen bg-dark-950 text-dark-100 overflow-hidden">
      <Header />
      <StatusBar />
      <main
        className={`flex-1 flex flex-col min-h-0 overflow-hidden relative transition-all ${
          isClickThrough ? 'pointer-events-none select-none opacity-90' : ''
        }`}
      >
        {isClickThrough && (
          <div className="absolute top-2 right-3 z-30 pointer-events-none flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 text-[10px] font-medium shadow-lg backdrop-blur-md animate-pulse">
            <span>👻 Click-Through Active (Answers Untouchable)</span>
          </div>
        )}
        {showHistory ? <HistoryPanel onClose={() => setShowHistory(false)} /> : <AnswerPanel />}
        <TranscriptPanel />
      </main>
      <DevLogsModal />
      <SettingsModal />
    </div>
  )
}

export default App
