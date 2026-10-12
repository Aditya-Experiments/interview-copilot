import { EventEmitter } from 'events'

export interface DetectedQuestion {
  text: string
  confidence: number
  questionType: 'direct' | 'indirect' | 'rhetorical' | 'unknown'
}

// Question starters that appear at clause or sentence boundaries
const CLAUSE_QUESTION_STARTERS = [
  /\b(what|when|where|who|whom|whose|which|why|how)\b/i,
  /\b(can|could|would|will|shall|should|may|might|must)\s+you\b/i,
  /\b(do|does|did)\s+(you|we|they)\b/i,
  /\b(have|has)\s+(you|we|they)\b/i,
  /\b(is|are|was|were)\s+(there|this|that|it|your)\b/i
]

// Imperative question verbs common in interviews
const CLAUSE_IMPERATIVE_STARTERS = [
  /\b(tell me|describe|explain|walk me through|give me|share with me|elaborate on|clarify|detail)\b/i
]

// Question ending patterns
const QUESTION_ENDINGS = [/\?$/, /\b(right|correct)\s*\??\s*$/i]

// Common interview question patterns
const INTERVIEW_PATTERNS = [
  /tell me about (a time|your|the|yourself)/i,
  /why (do|did|should|would|are) you/i,
  /what (is|are|was|were) your/i,
  /what (is|are) the/i,
  /how (do|did|would|could|have) you/i,
  /describe (a time|a situation|a scenario|your|how)/i,
  /give (me )?(an )?example/i,
  /what (would|do|did) you (do|say|think|learn)/i,
  /where do you see yourself/i,
  /what (is|are) your (greatest )?(strength|weakness)/i,
  /why (are you|do you want|did you)/i,
  /what motivates you/i,
  /how do you handle/i,
  /tell me about a challenge/i,
  /can you (describe|explain|tell|give|walk)/i,
  /what (challenges|problems|issues)/i,
  /how (would|do) you (approach|solve|handle|deal)/i,
  /what (makes|made) you/i,
  /why (should|would) we/i,
  /what do you know about/i,
  /what are your (career|salary|long.term|short.term)/i,
  /do you have (any )?questions/i,
  /what (tools|technologies|languages|frameworks)/i,
  /have you (ever|worked|used|experienced)/i,

  // Technical interview patterns
  /what happens when/i,
  /explain .+ in .+ words/i,
  /what is (the|a|an) .+ (in|for|with)/i,
  /when (would|should) you use/i,
  /pros and cons of/i,
  /advantages (of|and)/i,
  /trade.?offs (of|between)/i,
  /compare .+ (with|and|to|vs)/i,
  /what are (some|the) (best practices|common mistakes)/i,
  /how (can|do) you (optimize|improve|debug|test)/i,
  /what (design pattern|architecture|approach)/i,
  /walk me through (your|the|a)/i,
  /what is your (approach|process|methodology)/i,

  // System design patterns
  /how would you (design|build|architect|scale)/i,
  /what (database|cache|queue|service) would you/i,

  // Behavioral patterns
  /give me an example (of|when)/i,
  /how did you (handle|manage|resolve|approach)/i,
  /what was (the outcome|the result|your role)/i,
  /what did you learn from/i
]

// Common topics probed during interviews
const INTERVIEW_TOPICS = [
  /\b(edge|strength|weakness|background|experience|education|degree|college|university)\b/i,
  /\b(project|projects|architecture|stack|tech stack|frontend|backend|database|framework|api|apis)\b/i,
  /\b(role|company|team|leadership|challenge|conflict|failure|achievement)\b/i,
  /\b(scale|scaling|performance|optimization|algorithm|dsa|system design)\b/i,
  /\b(resume|cv|career|internship|job|hire|join)\b/i
]

// Common short phrases to IGNORE (only standalone pleasantries & feedback)
const IGNORE_PATTERNS = [
  /^(yes|no|yeah|yep|nope|okay|ok|sure|right|correct|exactly|absolutely|definitely|great|good|fine|thanks|thank you|bye|hello|hi|hey)[\s.,!?]*$/i,
  /^(great effort on that response|nicely articulated|well done|good job|sounds great)[\s.,!?]*$/i,
  /^(mm+|uh+|um+|ah+|oh+|hmm+)[\s.,!?]*$/i,
  /^(I see|I understand|got it|makes sense|sounds good|no problem)[\s.,!?]*$/i,
  /^(see you|have a nice day|take care|nice to meet you|pleasure meeting you)[\s.,!?]*$/i,
  /^(let me see|let me think|let's see)[\s.,!?]*$/i
]

interface RecentChunk {
  text: string
  timestamp: number
}

export class QuestionDetector extends EventEmitter {
  private transcriptBuffer: string[] = []
  private recentChunks: RecentChunk[] = []
  private minQuestionLength = 12 // Allow concise questions like "Explain your edge."
  private minWordCount = 3 // Minimum 3 words
  private confidenceThreshold = 0.55 // Threshold for utteranceEnd detection
  private earlyDetectionThreshold = 0.75 // Threshold for instantaneous early detection
  private lastEmittedQuestion: string = ''
  private lastEmittedTime: number = 0

  constructor() {
    super()
  }

  addTranscript(text: string, isFinal: boolean): void {
    if (isFinal && text.trim()) {
      const trimmed = text.trim()
      this.transcriptBuffer.push(trimmed)
      this.recentChunks.push({ text: trimmed, timestamp: Date.now() })
      // Keep recent chunks within the last 20 seconds (up to 6 chunks)
      const cutoff = Date.now() - 20000
      this.recentChunks = this.recentChunks.filter((c) => c.timestamp >= cutoff).slice(-6)
    }
  }

  /**
   * Check for question immediately (early detection) for high-confidence questions
   * Checks both current chunk and stitched text with previous recent chunk
   */
  checkEarlyDetection(text: string): DetectedQuestion | null {
    const trimmedText = text.trim()
    if (!trimmedText) return null

    // Check direct candidate
    let candidateText = trimmedText
    let detection = this.evaluateCandidate(candidateText)

    // If candidate text alone is not high confidence, check stitched with previous recent chunk
    if ((!detection || detection.confidence < this.earlyDetectionThreshold) && this.recentChunks.length > 0) {
      // Find previous chunk (skip current if it was already pushed to recentChunks)
      const prev = this.recentChunks
        .filter((c) => c.text !== trimmedText && Date.now() - c.timestamp < 5000)
        .slice(-1)[0]

      if (prev) {
        const stitched = `${prev.text} ${trimmedText}`.trim()
        const stitchedDetection = this.evaluateCandidate(stitched)
        if (stitchedDetection && stitchedDetection.confidence > (detection?.confidence || 0)) {
          candidateText = stitched
          detection = stitchedDetection
        }
      }
    }

    if (detection && detection.confidence >= this.earlyDetectionThreshold) {
      if (this.isDuplicateOrRecent(candidateText)) {
        return null
      }
      console.log(
        `[QuestionDetector] ⚡ EARLY DETECTION: "${candidateText}" (confidence: ${detection.confidence.toFixed(2)})`
      )
      this.markEmitted(candidateText)
      return { ...detection, text: candidateText }
    }

    return null
  }

  onUtteranceEnd(): void {
    const fullText = this.transcriptBuffer.join(' ').trim()
    this.transcriptBuffer = []

    let candidateText = fullText
    let detection = this.evaluateCandidate(candidateText)

    // If utterance buffer alone didn't reach confidence, try stitching with last recent chunk
    if ((!detection || detection.confidence < this.confidenceThreshold) && this.recentChunks.length >= 2) {
      const lastTwo = this.recentChunks.slice(-2).map((c) => c.text).join(' ')
      const stitchedDetection = this.evaluateCandidate(lastTwo)
      if (stitchedDetection && stitchedDetection.confidence >= this.confidenceThreshold) {
        candidateText = lastTwo
        detection = stitchedDetection
      }
    }

    if (!detection || detection.confidence < this.confidenceThreshold) {
      if (candidateText) {
        console.log(
          `[QuestionDetector] Not a question: "${candidateText}" (confidence: ${detection?.confidence.toFixed(2) || '0.00'})`
        )
      }
      return
    }

    if (this.isDuplicateOrRecent(candidateText)) {
      console.log(`[QuestionDetector] Skipping utterance end - duplicate or recent: "${candidateText}"`)
      return
    }

    console.log(
      `[QuestionDetector] ✓ QUESTION DETECTED: "${candidateText}" (confidence: ${detection.confidence.toFixed(2)})`
    )
    this.markEmitted(candidateText)
    this.emit('questionDetected', { ...detection, text: candidateText })
  }

  private isDuplicateOrRecent(text: string): boolean {
    if (!this.lastEmittedQuestion) return false
    const now = Date.now()
    if (now - this.lastEmittedTime > 8000) {
      return false
    }

    const normCurrent = text.toLowerCase().replace(/[^a-z0-9]/g, '')
    const normLast = this.lastEmittedQuestion.toLowerCase().replace(/[^a-z0-9]/g, '')

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

  private evaluateCandidate(text: string): DetectedQuestion | null {
    const trimmed = text.trim()
    if (!trimmed) return null
    if (this.shouldIgnore(trimmed)) return null

    const wordCount = trimmed.split(/\s+/).length
    if (trimmed.length < this.minQuestionLength || wordCount < this.minWordCount) {
      return null
    }

    return this.analyzeQuestion(trimmed)
  }

  private shouldIgnore(text: string): boolean {
    for (const pattern of IGNORE_PATTERNS) {
      if (pattern.test(text)) {
        return true
      }
    }
    return false
  }

  private analyzeQuestion(text: string): DetectedQuestion {
    let confidence = 0
    let questionType: DetectedQuestion['questionType'] = 'unknown'

    // 1. Check for question mark (strong indicator)
    if (text.includes('?')) {
      confidence += 0.45
      questionType = 'direct'
    }

    // 2. Break into sentences/clauses to handle conversational preambles
    // e.g., "Building on our discussion, consider this. Explain your edge"
    const sentences = text
      .split(/(?<=[.!?])\s+|[\n\r]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0)

    let hasClauseStarter = false
    let hasImperative = false

    for (const sentence of sentences) {
      for (const starter of CLAUSE_QUESTION_STARTERS) {
        if (starter.test(sentence)) {
          hasClauseStarter = true
          if (questionType === 'unknown') questionType = 'direct'
          break
        }
      }
      for (const imp of CLAUSE_IMPERATIVE_STARTERS) {
        if (imp.test(sentence)) {
          hasImperative = true
          if (questionType === 'unknown') questionType = 'indirect'
          break
        }
      }
    }

    if (hasClauseStarter) confidence += 0.35
    if (hasImperative) confidence += 0.40

    // 3. Interview specific patterns
    for (const pattern of INTERVIEW_PATTERNS) {
      if (pattern.test(text)) {
        confidence += 0.35
        if (questionType === 'unknown') questionType = 'direct'
        break
      }
    }

    // 4. Interview topic keywords (boosts imperative questions like "Explain your edge educational background")
    let hasInterviewTopic = false
    for (const topic of INTERVIEW_TOPICS) {
      if (topic.test(text)) {
        hasInterviewTopic = true
        break
      }
    }

    if (hasInterviewTopic && (hasImperative || hasClauseStarter || text.includes('?'))) {
      confidence += 0.25
    }

    // 5. Question endings
    for (const pattern of QUESTION_ENDINGS) {
      if (pattern.test(text)) {
        confidence += 0.15
        break
      }
    }

    // 6. Sentence depth boost
    const wordCount = text.split(/\s+/).length
    if (wordCount >= 6) confidence += 0.05
    if (wordCount >= 10) confidence += 0.05

    // Normalize confidence to max 1.0
    confidence = Math.min(confidence, 1.0)

    return {
      text,
      confidence,
      questionType
    }
  }

  isQuestion(text: string): boolean {
    const result = this.evaluateCandidate(text)
    return Boolean(result && result.confidence >= this.confidenceThreshold)
  }

  clearBuffer(): void {
    this.transcriptBuffer = []
    this.recentChunks = []
    this.lastEmittedQuestion = ''
    this.lastEmittedTime = 0
  }

  setConfidenceThreshold(threshold: number): void {
    this.confidenceThreshold = Math.max(0.1, Math.min(1.0, threshold))
  }
}
