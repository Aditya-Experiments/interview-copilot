import { Ghost, History, MessageSquare, Mic, Minus, MousePointer, Pin, PinOff, Settings, Terminal, X } from 'lucide-react'
import { useInterviewStore } from '../store/interviewStore'

export function Header(): React.JSX.Element {
  const {
    settings,
    updateSettings,
    setShowSettings,
    showHistory,
    setShowHistory,
    isClickThrough,
    toggleClickThrough,
    showDevLogs,
    setShowDevLogs
  } = useInterviewStore()

  const isAlwaysOnTop = settings.alwaysOnTop

  const handleMinimize = (): void => {
    window.api.minimizeWindow()
  }

  const handleClose = (): void => {
    window.api.closeWindow()
  }

  const toggleAlwaysOnTop = async (): Promise<void> => {
    const newValue = !isAlwaysOnTop
    await window.api.setAlwaysOnTop(newValue)
    updateSettings({ alwaysOnTop: newValue })
  }

  return (
    <header
      data-interactive="true"
      className="flex items-center justify-between px-3 py-1.5 bg-dark-900 border-b border-dark-700 select-none app-drag"
    >
      <div className="flex items-center gap-2">
        <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-primary shadow-sm">
          <Mic className="h-3.5 w-3.5 text-primary-foreground" />
        </div>
        <span className="text-xs font-bold text-dark-100 tracking-wide">Interview Copilot</span>
        {isClickThrough && (
          <span className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-500/15 text-amber-300 border border-amber-500/30 animate-pulse">
            <Ghost size={10} />
            <span>Click-Through</span>
          </span>
        )}
      </div>

      <div className="flex items-center gap-1 app-no-drag">
        {/* Click-through / untouchable mode toggle */}
        <button
          onClick={toggleClickThrough}
          className={`p-1.5 rounded transition-all flex items-center justify-center ${
            isClickThrough
              ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm'
              : 'text-dark-400 hover:text-dark-200 hover:bg-dark-800'
          }`}
          title={
            isClickThrough
              ? 'Click-Through Active: Answer & Transcript are untouchable (clicks pass through to desktop/browser). Click to disable.'
              : 'Click-Through Mode: Make Answer & Transcript untouchable so you can click desktop/browser buttons through them.'
          }
        >
          {isClickThrough ? <Ghost size={14} className="text-amber-400" /> : <MousePointer size={14} />}
        </button>

        {/* Developer mode live logs toggle */}
        <button
          onClick={() => setShowDevLogs(!showDevLogs)}
          className={`p-1.5 rounded transition-all flex items-center justify-center ${
            showDevLogs
              ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 shadow-sm'
              : 'text-dark-400 hover:text-emerald-400 hover:bg-dark-800'
          }`}
          title={showDevLogs ? 'Hide Developer Logs' : 'Developer Mode: Open Live App Logs'}
        >
          <Terminal size={14} />
        </button>

        <button
          onClick={() => setShowHistory(!showHistory)}
          className={`p-1.5 rounded hover:bg-dark-700 transition-colors ${
            showHistory ? 'text-blue-400' : 'text-dark-400'
          } hover:text-blue-400`}
          title={showHistory ? 'Back to interview session' : 'Show history'}
        >
          {showHistory ? <MessageSquare size={14} /> : <History size={14} />}
        </button>

        <button
          onClick={toggleAlwaysOnTop}
          className={`p-1.5 rounded hover:bg-dark-700 transition-colors ${
            isAlwaysOnTop ? 'text-blue-400' : 'text-dark-400'
          }`}
          title={isAlwaysOnTop ? 'Unpin window' : 'Pin window on top'}
        >
          {isAlwaysOnTop ? <Pin size={14} /> : <PinOff size={14} />}
        </button>

        <button
          onClick={() => setShowSettings(true)}
          className="p-1.5 rounded hover:bg-dark-700 transition-colors text-dark-400 hover:text-dark-200"
          title="Settings"
        >
          <Settings size={14} />
        </button>

        <button
          onClick={handleMinimize}
          className="p-1.5 rounded hover:bg-dark-700 transition-colors text-dark-400 hover:text-dark-200"
          title="Minimize"
        >
          <Minus size={14} />
        </button>

        <button
          onClick={handleClose}
          className="p-1.5 rounded hover:bg-red-500/20 transition-colors text-dark-400 hover:text-red-400"
          title="Close"
        >
          <X size={14} />
        </button>
      </div>
    </header>
  )
}
