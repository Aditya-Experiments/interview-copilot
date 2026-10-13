import { EventEmitter } from 'events'

export type InterviewQuestionCategory = 'architecture_project' | 'behavioral' | 'coding' | 'conceptual' | 'unknown'

export interface DetectedQuestion {
  text: string
  confidence: number
  questionType: 'direct' | 'indirect' | 'rhetorical' | 'unknown'
  category?: InterviewQuestionCategory
  boundContext?: string
  previousTurn?: string
}

/**
 * QuestionDetector (Parakeet AI Turn Manager)
 * 
 * Gathers finalized clauses from the interviewer as they speak.
 * When the interviewer pauses or finishes speaking (End-of-Utterance), the complete acoustic
 * turn is emitted directly to the LLM.
 * Zero hardcoded regex lists: the fast LLM semantically understands question continuation,
 * synthesis, and topic transitions natively.
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
   * Called when candidate speaks into mic (kept for compatibility).
   */
  setCandidateSpeaking(speaking: boolean): void {
    this.isCandidateSpeaking = speaking
  }

  getCandidateSpeaking(): boolean {
    return this.isCandidateSpeaking
  }

  turnBoundaryReset(): void {
    const now = Date.now()
    if (this.turnChunks.length > 0 && now - this.turnStartTime < 12000 && this.lastEmittedTime === 0) {
      return
    }

    this.turnChunks = []
    this.turnStartTime = now
  }

  clearBuffer(): void {
    this.turnChunks = []
    this.turnStartTime = Date.now()
  }

  addTranscript(text: string, isFinal: boolean): void {
    if (!isFinal || !text.trim()) return

    const trimmed = text.trim()
    if (this.turnChunks.length === 0 || this.turnChunks[this.turnChunks.length - 1] !== trimmed) {
      this.turnChunks.push(trimmed)
    }
  }

  /**
   * Called on End-of-Utterance (EoU): when the interviewer finishes speaking or pauses.
   * Emits the complete interviewer speech turn with previous conversational turn context.
   */
  onUtteranceEnd(): void {
    if (this.turnChunks.length === 0) return

    const fullTurnText = this.turnChunks.join(' ').trim()
    if (!fullTurnText) return

    const words = fullTurnText.split(/\s+/).filter(Boolean)
    // Ignore trivial 1-word filler (e.g. "ok", "yeah")
    if (words.length < 2) {
      this.turnChunks = []
      return
    }

    // Exact duplicate echo check within 4 seconds (prevent STT duplicate loopback)
    if (this.isExactDuplicate(fullTurnText)) {
      console.log(`[QuestionDetector] Skipping exact duplicate turn: "${fullTurnText}"`)
      this.turnChunks = []
      return
    }

    // Pass previous turn within conversational window (25s) for AI semantic synthesis
    const elapsedMs = Date.now() - this.lastEmittedTime
    const previousTurn = elapsedMs <= 25000 ? this.lastEmittedQuestion : ''

    console.log(
      `[QuestionDetector] ✓ COMPLETE TURN CAPTURED: "${fullTurnText}" (${words.length} words)`
    )

    this.markEmitted(fullTurnText)
    this.turnChunks = []
    this.turnStartTime = Date.now()

    this.emit('questionDetected', {
      text: fullTurnText,
      confidence: 1.0,
      questionType: 'direct',
      previousTurn: previousTurn
    })
  }

  /**
   * Standalone check for compatibility if called explicitly.
   */
  checkEarlyDetection(_text: string): DetectedQuestion | null {
    return null
  }

  private isExactDuplicate(text: string): boolean {
    if (!this.lastEmittedQuestion) return false
    const now = Date.now()
    if (now - this.lastEmittedTime > 4000) {
      return false
    }

    const normCurrent = text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
    const normLast = this.lastEmittedQuestion.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')

    return Boolean(normCurrent && normLast && normCurrent === normLast)
  }

  private markEmitted(text: string): void {
    this.lastEmittedQuestion = text
    this.lastEmittedTime = Date.now()
  }
}
