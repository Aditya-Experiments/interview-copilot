import { Check, Clock, Copy, Layers, MessageSquare, Mic, Sparkles, Terminal } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useInterview } from '../hooks/useInterview'
import { MarkdownRenderer } from './MarkdownRenderer'

export function AnswerPanel(): React.JSX.Element {
  const { answers, currentAnswer, currentQuestion, currentQuestionCategory, isGenerating } =
    useInterview()
  const scrollRef = useRef<HTMLDivElement>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [answers, currentAnswer])

  const copyToClipboard = async (text: string, id: string): Promise<void> => {
    try {
      const result = await window.api.writeToClipboard(text)
      if (result.success) {
        setCopiedId(id)
        setTimeout(() => setCopiedId(null), 2000)
      } else {
        console.error('Failed to copy:', result.error)
        try {
          await navigator.clipboard.writeText(text)
          setCopiedId(id)
          setTimeout(() => setCopiedId(null), 2000)
        } catch (fallbackErr) {
          console.error('Fallback clipboard copy failed:', fallbackErr)
        }
      }
    } catch (err) {
      console.error('Failed to copy:', err)
      try {
        await navigator.clipboard.writeText(text)
        setCopiedId(id)
        setTimeout(() => setCopiedId(null), 2000)
      } catch (fallbackErr) {
        console.error('Fallback clipboard copy failed:', fallbackErr)
      }
    }
  }

  const renderCategoryBadge = (category?: string) => {
    if (category === 'architecture_project') {
      return (
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
          <Layers className="w-3 h-3" /> Architecture & System
        </span>
      )
    }
    if (category === 'behavioral') {
      return (
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-500/15 text-amber-300 border border-amber-500/30">
          <MessageSquare className="w-3 h-3" /> Behavioral (STAR)
        </span>
      )
    }
    if (category === 'coding') {
      return (
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-500/15 text-blue-300 border border-blue-500/30">
          <Terminal className="w-3 h-3" /> LeetCode & Coding
        </span>
      )
    }
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-purple-500/15 text-purple-300 border border-purple-500/30">
        <Sparkles className="w-3 h-3" /> Verbal Concept
      </span>
    )
  }

  const getEstimatedTalkTime = (text: string): string => {
    const words = text.trim().split(/\s+/).filter(Boolean).length
    const seconds = Math.max(15, Math.min(60, Math.round(words / 2.3)))
    return `~${seconds}s talk time`
  }

  const hasContent = answers.length > 0 || currentAnswer

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-dark-900/30">
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-4 custom-scrollbar">
        {!hasContent ? (
          <div className="flex flex-col items-center justify-center h-full text-center py-8">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary mb-3 shadow-md shadow-blue-500/20">
              <Mic className="h-6 w-6 text-primary-foreground" />
            </div>
            <p className="text-sm text-dark-300 font-medium">
              Glance Mode ready & listening for questions
            </p>
            <p className="text-xs text-dark-500 mt-1">
              Turn window persists across pauses • 30–45s spoken talking points
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-2 text-[11px] text-dark-400">
              <span className="px-2 py-0.5 rounded bg-dark-800 border border-dark-700">
                <kbd className="text-dark-200">⌘⇧S</kbd> Screenshot & Solve
              </span>
              <span className="px-2 py-0.5 rounded bg-dark-800 border border-dark-700">
                <kbd className="text-dark-200">⌘⇧C</kbd> Stealth Clear
              </span>
              <span className="px-2 py-0.5 rounded bg-dark-800 border border-dark-700">
                <kbd className="text-dark-200">⌘⇧H</kbd> Hide/Show Overlay
              </span>
            </div>
          </div>
        ) : (
          <>
            {answers.map((answer) => (
              <div
                key={answer.id}
                className="bg-dark-800/50 rounded-lg border border-dark-700/50 overflow-hidden animate-fade-in"
              >
                <div className="px-3 py-2 bg-dark-700/30 border-b border-dark-700/50 flex items-center justify-between gap-2">
                  <p className="text-xs text-dark-300 font-medium truncate flex-1">
                    Q: {answer.question}
                  </p>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    {renderCategoryBadge(answer.category)}
                    <span className="flex items-center gap-0.5 text-[10px] text-dark-400 font-medium px-1.5 py-0.5 rounded bg-dark-800/60 border border-dark-700/40">
                      <Clock className="w-2.5 h-2.5" />
                      {getEstimatedTalkTime(answer.answer)}
                    </span>
                  </div>
                </div>
                <div className="p-3">
                  <MarkdownRenderer content={answer.answer} />
                  <div className="mt-2 flex justify-end">
                    <button
                      onClick={() => copyToClipboard(answer.answer, answer.id)}
                      className="flex items-center gap-1 px-2 py-1 text-xs text-dark-400 hover:text-blue-400 hover:bg-blue-500/10 rounded transition-colors"
                    >
                      {copiedId === answer.id ? (
                        <>
                          <Check className="w-3 h-3" />
                          <span>Copied!</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3" />
                          <span>Copy</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            ))}

            {/* Current streaming answer */}
            {(currentAnswer || isGenerating) && (
              <div className="bg-gradient-to-br from-purple-900/20 to-blue-900/20 rounded-lg border border-purple-500/30 overflow-hidden animate-fade-in">
                {currentQuestion && (
                  <div className="px-3 py-2 bg-purple-900/20 border-b border-purple-500/20 flex items-center justify-between gap-2">
                    <p className="text-xs text-purple-200 font-medium truncate flex-1">
                      Q: {currentQuestion}
                    </p>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {renderCategoryBadge(currentQuestionCategory)}
                    </div>
                  </div>
                )}
                <div className="p-3">
                  {currentAnswer ? (
                    <div>
                      <MarkdownRenderer content={currentAnswer} />
                      <span className="inline-block w-0.5 h-4 bg-purple-400 ml-1 animate-pulse" />
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 text-sm text-purple-400">
                      <div className="flex gap-1">
                        <span
                          className="w-1.5 h-1.5 bg-purple-400 rounded-full animate-bounce"
                          style={{ animationDelay: '0ms' }}
                        />
                        <span
                          className="w-1.5 h-1.5 bg-purple-400 rounded-full animate-bounce"
                          style={{ animationDelay: '150ms' }}
                        />
                        <span
                          className="w-1.5 h-1.5 bg-purple-400 rounded-full animate-bounce"
                          style={{ animationDelay: '300ms' }}
                        />
                      </div>
                      <span>Generating Glance Mode answer...</span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
