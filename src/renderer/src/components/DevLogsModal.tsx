import { Check, Copy, Play, Terminal, Trash2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { AppLogEntry, useInterviewStore } from '../store/interviewStore'

export function DevLogsModal(): React.JSX.Element | null {
  const { showDevLogs, setShowDevLogs, logs, clearLogs, addLog } = useInterviewStore()
  const [filter, setFilter] = useState<'all' | 'stt' | 'gemini' | 'audio' | 'error'>('all')
  const [copied, setCopied] = useState(false)
  const [autoScroll, setAutoScroll] = useState(true)
  const logContainerRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom when new logs appear
  useEffect(() => {
    if (autoScroll && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight
    }
  }, [logs, autoScroll, showDevLogs])

  if (!showDevLogs) return null

  const filteredLogs = logs.filter((log) => {
    if (filter === 'all') return true
    if (filter === 'error') return log.level === 'error'
    if (filter === 'stt') return log.source.toLowerCase().includes('stt')
    if (filter === 'gemini') return log.source.toLowerCase().includes('gemini') || log.source.toLowerCase().includes('detector')
    if (filter === 'audio') return log.source.toLowerCase().includes('audio') || log.source.toLowerCase().includes('system')
    return true
  })

  const handleCopyLogs = (): void => {
    const text = logs
      .map(
        (l) =>
          `[${new Date(l.timestamp).toLocaleTimeString()}] [${l.level.toUpperCase()}] [${l.source}]: ${l.message}`
      )
      .join('\n')
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleSimulateLog = (): void => {
    const testEntry: AppLogEntry = {
      id: `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      timestamp: Date.now(),
      level: 'info',
      source: 'DevMode',
      message: 'Developer mode test ping: Console is active and monitoring live events.'
    }
    addLog(testEntry)
    window.api.sendRendererLog({
      level: 'info',
      source: 'Renderer',
      message: 'Renderer test log verified.'
    })
  }

  const getLevelBadgeClass = (level: AppLogEntry['level']): string => {
    switch (level) {
      case 'error':
        return 'text-rose-400 bg-rose-500/10 border-rose-500/20'
      case 'warn':
        return 'text-amber-400 bg-amber-500/10 border-amber-500/20'
      case 'success':
        return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
      case 'info':
      default:
        return 'text-sky-400 bg-sky-500/10 border-sky-500/20'
    }
  }

  return (
    <div
      data-interactive="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm modal-container"
    >
      <div className="w-full max-w-2xl mx-4 bg-dark-900 rounded-xl border border-dark-700 shadow-2xl flex flex-col max-h-[85vh] animate-fade-in">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-dark-700">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
              <Terminal className="h-4 w-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-dark-100">Developer Mode · Live Logs</h3>
                <span className="px-1.5 py-0.5 text-[10px] font-mono rounded bg-dark-800 text-dark-300 border border-dark-700">
                  {logs.length} events
                </span>
              </div>
              <p className="text-[11px] text-dark-400">Real-time STT WebSocket, question detection & Gemini streaming events</p>
            </div>
          </div>
          <button
            onClick={() => setShowDevLogs(false)}
            className="p-1.5 rounded hover:bg-dark-700 transition-colors text-dark-400 hover:text-dark-200"
          >
            <X size={16} />
          </button>
        </div>

        {/* Filter bar */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-dark-800 bg-dark-950/50 text-xs">
          <div className="flex items-center gap-1.5">
            {(
              [
                { id: 'all', label: 'All' },
                { id: 'stt', label: 'STT / Deepgram' },
                { id: 'gemini', label: 'AI / Gemini' },
                { id: 'audio', label: 'Audio / System' },
                { id: 'error', label: 'Errors' }
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                onClick={() => setFilter(tab.id)}
                className={`px-2 py-1 rounded text-xs transition-colors ${
                  filter === tab.id
                    ? 'bg-primary text-primary-foreground font-medium'
                    : 'text-dark-400 hover:text-dark-200 hover:bg-dark-800'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-3 text-[11px] text-dark-400">
            <label className="flex items-center gap-1 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={autoScroll}
                onChange={(e) => setAutoScroll(e.target.checked)}
                className="rounded bg-dark-800 border-dark-700 text-primary focus:ring-0 w-3 h-3"
              />
              <span>Auto-scroll</span>
            </label>
          </div>
        </div>

        {/* Terminal Log Output */}
        <div
          ref={logContainerRef}
          className="flex-1 p-3 overflow-y-auto font-mono text-xs space-y-1.5 bg-dark-950 min-h-[280px] max-h-[420px] custom-scrollbar"
        >
          {filteredLogs.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-dark-500 gap-2">
              <Terminal size={24} className="opacity-40" />
              <p>No logs captured yet for this filter.</p>
              <p className="text-[11px] text-dark-600">Start capture or press "Test Log" below to verify.</p>
            </div>
          ) : (
            filteredLogs.map((log) => (
              <div
                key={log.id}
                className="flex items-start gap-2 py-0.5 px-1.5 rounded hover:bg-dark-900/60 transition-colors leading-relaxed group"
              >
                <span className="text-dark-500 flex-shrink-0 text-[10px] select-none pt-0.5">
                  {new Date(log.timestamp).toLocaleTimeString([], {
                    hour12: false,
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit'
                  })}
                </span>
                <span
                  className={`text-[9px] px-1 py-0.5 rounded border uppercase font-semibold flex-shrink-0 ${getLevelBadgeClass(
                    log.level
                  )}`}
                >
                  {log.source}
                </span>
                <span
                  className={`break-all ${
                    log.level === 'error'
                      ? 'text-rose-300 font-semibold'
                      : log.level === 'warn'
                        ? 'text-amber-300'
                        : log.level === 'success'
                          ? 'text-emerald-300'
                          : 'text-dark-200'
                  }`}
                >
                  {log.message}
                </span>
              </div>
            ))
          )}
        </div>

        {/* Footer actions */}
        <div className="flex items-center justify-between px-4 py-2.5 border-t border-dark-700 bg-dark-900">
          <div className="flex items-center gap-2">
            <button
              onClick={handleClearLogs}
              disabled={logs.length === 0}
              className="flex items-center gap-1.5 px-2.5 py-1 text-xs text-dark-400 hover:text-rose-400 hover:bg-rose-500/10 rounded border border-dark-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Trash2 size={12} />
              <span>Clear</span>
            </button>
            <button
              onClick={handleSimulateLog}
              className="flex items-center gap-1.5 px-2.5 py-1 text-xs text-dark-400 hover:text-emerald-400 hover:bg-emerald-500/10 rounded border border-dark-700 transition-colors"
            >
              <Play size={12} />
              <span>Test Log</span>
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleCopyLogs}
              disabled={logs.length === 0}
              className="flex items-center gap-1.5 px-3 py-1 text-xs bg-dark-800 hover:bg-dark-700 text-dark-200 rounded border border-dark-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
              <span>{copied ? 'Copied!' : 'Copy Logs'}</span>
            </button>
            <button
              onClick={() => setShowDevLogs(false)}
              className="px-3 py-1 text-xs bg-primary hover:bg-primary/90 text-primary-foreground font-medium rounded transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  )

  function handleClearLogs(): void {
    clearLogs()
  }
}
