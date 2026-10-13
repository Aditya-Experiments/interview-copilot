import { EventEmitter } from 'events'

export type InterviewQuestionCategory = 'architecture_project' | 'behavioral' | 'coding' | 'conceptual' | 'unknown'

export interface DetectedQuestion {
  text: string
  confidence: number
  questionType: 'direct' | 'indirect' | 'rhetorical' | 'unknown'
  category?: InterviewQuestionCategory
  boundContext?: string
}

/**
 * QuestionDetector (Parakeet AI Turn Manager)
 * 
 * Replaces hardcoded regex scoring with a robust turn-based accumulator.
 * As the interviewer speaks, finalized clauses are gathered in strict chronological order.
 * When the speaker pauses (End-of-Utterance), the complete accumulated turn is emitted
 * directly to the LLM for semantic intent analysis and Glance Mode generation.
 */
export class QuestionDetector extends EventEmitter {
  private turnChunks: string[] = []
  private turnStartTime: number = Date.now()
  private isCandidateSpeaking: boolean = false
  private lastEmittedQuestion: string = ''
  private lastEmittedTime: number = 0

  constructor() {
    super()
  }

  /**
   * Called when candidate speaks into mic (Dual-Channel speaker separation).
   */
  setCandidateSpeaking(speaking: boolean): void {
    this.isCandidateSpeaking = speaking
  }

  getCandidateSpeaking(): boolean {
    return this.isCandidateSpeaking
  }

  /**
   * Resets the turn boundary when the candidate finishes answering.
   * If the interviewer spoke recently (within last 12s), preserves speech.
   */
  turnBoundaryReset(): void {
    const now = Date.now()
    // Safety guard: do not wipe if interviewer was just speaking in the last 12 seconds
    if (this.turnChunks.length > 0 && now - this.turnStartTime < 12000 && this.lastEmittedTime === 0) {
      console.log('[QuestionDetector] 🛡️ Preserving recent interviewer speech despite turn reset request')
      return
    }

    console.log('[QuestionDetector] ──> Turn boundary reset: T=0')
    this.turnChunks = []
    this.turnStartTime = now
  }

  /**
   * Clears accumulated turn buffers.
   */
  clearBuffer(): void {
    this.turnChunks = []
    this.turnStartTime = Date.now()
  }

  /**
   * Called on every STT transcript event.
   * Finalized clauses are appended chronologically to the current turn buffer.
   */
  addTranscript(text: string, isFinal: boolean): void {
    if (!isFinal || !text.trim()) return

    const trimmed = text.trim()
    // Deduplicate identical consecutive chunks
    if (this.turnChunks.length === 0 || this.turnChunks[this.turnChunks.length - 1] !== trimmed) {
      this.turnChunks.push(trimmed)
    }
  }

  /**
   * Called on End-of-Utterance (EoU): when the interviewer finishes speaking or pauses.
   * Reconstructs the complete question across breathing pauses and emits for LLM generation.
   */
  onUtteranceEnd(): void {
    if (this.turnChunks.length === 0) return

    const fullTurnText = this.turnChunks.join(' ').trim()
    if (!fullTurnText) return

    const words = fullTurnText.split(/\s+/).filter(Boolean)
    // Ignore trivial background noise or 1-word filler (e.g. "ok", "yeah")
    if (words.length < 2) {
      this.turnChunks = []
      return
    }

    // Deduplication check: prevent re-firing identical questions within 8s
    if (this.isDuplicateOrRecent(fullTurnText)) {
      console.log(`[QuestionDetector] Skipping duplicate/recent turn: "${fullTurnText}"`)
      this.turnChunks = []
      return
    }

    console.log(
      `[QuestionDetector] ✓ COMPLETE TURN CAPTURED: "${fullTurnText}" (${words.length} words)`
    )

    this.markEmitted(fullTurnText)
    // Clear turn chunks so subsequent interviewer speech starts clean
    this.turnChunks = []
    this.turnStartTime = Date.now()

    this.emit('questionDetected', {
      text: fullTurnText,
      confidence: 1.0,
      questionType: 'direct'
    })
  }

  /**
   * Standalone check for compatibility if called explicitly.
   */
  checkEarlyDetection(_text: string): DetectedQuestion | null {
    // Intentionally disabled in Parakeet AI:
    // We do NOT fire mid-sentence on partial clauses. We wait for End-of-Utterance.
    return null
  }

  private isDuplicateOrRecent(text: string): boolean {
    if (!this.lastEmittedQuestion) return false
    const now = Date.now()
    if (now - this.lastEmittedTime > 8000) {
      return false
    }

    const normCurrent = text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
    const normLast = this.lastEmittedQuestion.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')

    if (!normCurrent || !normLast) return false

    if (normCurrent === normLast) return true
    if (normCurrent.includes(normLast) || normLast.includes(normCurrent)) {
      return true
    }

    return false
  }

  private markEmitted(text: string): void {
    this.lastEmittedQuestion = text
    this.lastEmittedTime = Date.now()
  }
}
