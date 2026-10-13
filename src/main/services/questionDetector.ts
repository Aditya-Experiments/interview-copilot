import { EventEmitter } from 'events'

export type InterviewQuestionCategory = 'architecture_project' | 'behavioral' | 'coding' | 'conceptual' | 'unknown'

export interface DetectedQuestion {
  text: string
  confidence: number
  questionType: 'direct' | 'indirect' | 'rhetorical' | 'unknown'
  category?: InterviewQuestionCategory
  boundContext?: string
}

// Question starters that appear at clause or sentence boundaries
const CLAUSE_QUESTION_STARTERS = [
  /\b(what|when|where|who|whom|whose|which|why|how)\b/i,
  /\b(can|could|would|will|shall|should|may|might|must)\s+you\b/i,
  /\b(do|does|did)\s+(you|we|they)\b/i,
  /\b(have|has)\s+(you|we|they)\b/i,
  /\b(is|are|was|were)\s+(there|this|that|it|your)\b/i,
  // Hindi & Hinglish question starters
  /(^|\s)(क्या|कैसे|क्यों|कहाँ|कहा|कब|कौन|किसका|किसकी|किसके|कितना|कितनी|कितने|किधर)(\s|$)/i,
  /\b(kya|kaise|kyu|kyun|kahan|kaha|kab|kaun|kiska|kiski|kiske|kitna|kitni|kitne|kidhar)\b/i
]

// Imperative question verbs common in interviews
const CLAUSE_IMPERATIVE_STARTERS = [
  /\b(tell me|describe|explain|walk me through|give me|share with me|elaborate on|clarify|detail)\b/i,
  // Hindi & Hinglish imperatives
  /(^|\s)(बताइए|बताओ|समझाइए|समझाओ|वर्णन कीजिए|बोलिए|बोलो)(\s|$)/i,
  /\b(bataiye|batao|samjhaiye|samjhao|explain karo|batao zara|boliye|bolo)\b/i
]

// Question ending patterns
const QUESTION_ENDINGS = [
  /\?$/,
  /\b(right|correct)\s*\??\s*$/i,
  /(^|\s)(है ना|सही है|है क्या)\s*\??\s*$/i,
  /\b(hai na|sahi hai|hai kya)\s*\??\s*$/i
]

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
  /what did you learn from/i,

  // Imperative & architectural interview patterns
  /\b(explain|walk me through|break down|detail|clarify)\b/i,
  /explain (the|your|a|an|how|what|why|our|this|that)?\s*(architecture|data flow|flow|design|system|component|implementation|working|pipeline|trade-offs|solution|code|approach|decision)?/i,
  /walk (me )?through (the|your|a|an|how|what|why|this|that)?\s*(architecture|data flow|flow|design|system|project|solution|code|approach|process)?/i,
  /describe (the|your|a|an|how|what|why|this|that)?\s*(architecture|data flow|flow|design|system|project|solution|code|approach|process)?/i,
  /tell me about (the|your|a|an)?\s*(architecture|data flow|project|system|background|experience)/i,
  /give (me )?(an? )?(overview|explanation|example|breakdown|walkthrough)/i,
  /how does .+ work/i,
  /how did you (implement|solve|build|design|handle|architect|approach|scale)/i,
  /from (the )?(user'?s? )?input to (the )?(final )?output/i,
  /what (is|was) your (role|responsibility|contribution)/i,

  // Hindi & Hinglish interview patterns
  /(अपने बारे में|तुम्हारा परिचय|आपका परिचय|इंट्रोडक्शन|इंट्रो)/i,
  /\b(apne baare mein|apna introduction|tell me about yourself)\b/i,
  /(आपका अनुभव|तुम्हारा अनुभव|प्रोजेक्ट के बारे में|काम किया)/i,
  /\b(aapka experience|project ke baare mein|kaam kiya)\b/i,
  /(ताकत|कमजोरी|चुनौती|समस्या)/i
]

// Common topics probed during interviews
const INTERVIEW_TOPICS = [
  /\b(edge|strength|weakness|background|experience|education|degree|college|university)\b/i,
  /\b(project|projects|architecture|stack|tech stack|frontend|backend|database|framework|api|apis)\b/i,
  /\b(role|company|team|leadership|challenge|conflict|failure|achievement)\b/i,
  /\b(scale|scaling|performance|optimization|algorithm|dsa|system design)\b/i,
  /\b(resume|cv|career|internship|job|hire|join)\b/i,
  /\b(data flow|dataflow|flow|pipeline|input|output|user input|final output|platform|service|services|production|cloud|server|client|microservices|srs)\b/i
]

// Common short phrases to IGNORE (only standalone pleasantries & feedback)
const IGNORE_PATTERNS = [
  /^(yes|no|yeah|yep|nope|okay|ok|sure|right|correct|exactly|absolutely|definitely|great|good|fine|thanks|thank you|bye|hello|hi|hey)[\s.,!?]*$/i,
  /^(great effort on that response|nicely articulated|well done|good job|sounds great)[\s.,!?]*$/i,
  /^(mm+|uh+|um+|ah+|oh+|hmm+)[\s.,!?]*$/i,
  /^(I see|I understand|got it|makes sense|sounds good|no problem)[\s.,!?]*$/i,
  /^(see you|have a nice day|take care|nice to meet you|pleasure meeting you)[\s.,!?]*$/i,
  /^(let me see|let me think|let's see)[\s.,!?]*$/i,
  // Hindi & Hinglish pleasantries / acknowledgments to ignore
  /^(हाँ|हां|नहीं|अच्छा|ठीक है|नमस्ते|धन्यवाद|शुक्रिया|जी|हाँजी)[\s.,!?]*$/i,
  /^(haan|nahi|theek hai|achha|namaste|dhanyawad|shukriya|ji|haanji)[\s.,!?]*$/i
]

// Anaphora patterns (referential pronouns and demonstratives that require premise context)
const ANAPHORA_PATTERNS = [
  /\b(this|that|it|these|those)\b/i,
  /\b(solve this|check this|do this|handle this|approach this|fix this|deal with this)\b/i,
  /\b(how did you (solve|build|do|handle|fix|scale|approach) (it|this|that))\b/i,
  /\b(walk me through (this|that|how you would do this|how you would check this))\b/i,
  /\b(explain (this|that|it))\b/i,
  /\b(why did you (choose|pick|use) (this|that))\b/i,
  /\b(what was (the reason|the bottleneck|the challenge) (there|for that))\b/i
]

interface RecentChunk {
  text: string
  timestamp: number
}

export class QuestionDetector extends EventEmitter {
  private transcriptBuffer: string[] = []
  private recentChunks: RecentChunk[] = []
  private interviewerTurnChunks: RecentChunk[] = []
  private turnStartTime: number = Date.now()
  private isCandidateSpeaking: boolean = false
  private minQuestionLength = 8 // Allow concise Hindi/English questions
  private minWordCount = 2 // Minimum 2 words (e.g. "क्या किया?", "tell me")
  private confidenceThreshold = 0.55 // Threshold for utteranceEnd detection
  private earlyDetectionThreshold = 0.75 // Threshold for instantaneous early detection
  private lastEmittedQuestion: string = ''
  private lastEmittedTime: number = 0

  constructor() {
    super()
  }

  /**
   * Called by Dual-Channel audio engine when candidate speaks into mic.
   * Tracks speaker state for turn context management.
   */
  setCandidateSpeaking(speaking: boolean): void {
    this.isCandidateSpeaking = speaking
  }

  getCandidateSpeaking(): boolean {
    return this.isCandidateSpeaking
  }

  /**
   * Resets the turn boundary (T=0) when the candidate finishes speaking.
   * Preserves recent interviewer speech if candidate noise was transient.
   */
  turnBoundaryReset(): void {
    const now = Date.now()
    // Safety guard: If interviewer spoke recently (within last 12s) and no question was answered yet,
    // preserve the interviewer turn context rather than wiping it out due to transient candidate noise.
    const hasRecentInterviewerSpeech = this.interviewerTurnChunks.some((c) => now - c.timestamp < 12000)
    if (hasRecentInterviewerSpeech && (now - this.lastEmittedTime > 12000 || this.lastEmittedTime === 0)) {
      console.log('[QuestionDetector] 🛡️ Preserving recent interviewer speech despite turn reset request')
      this.turnStartTime = now
      return
    }

    console.log('[QuestionDetector] ──> Turn boundary reset: T=0 (Candidate finished speaking)')
    this.turnStartTime = now
    this.interviewerTurnChunks = []
    this.transcriptBuffer = []
  }

  addTranscript(text: string, isFinal: boolean): void {
    if (isFinal && text.trim()) {
      const trimmed = text.trim()
      const now = Date.now()
      this.transcriptBuffer.push(trimmed)
      this.recentChunks.push({ text: trimmed, timestamp: now })
      this.interviewerTurnChunks.push({ text: trimmed, timestamp: now })

      // Keep recent chunks within the last 60 seconds (up to 25 chunks)
      const cutoff = now - 60000
      this.recentChunks = this.recentChunks.filter((c) => c.timestamp >= cutoff).slice(-25)

      // Turn window keeps accumulating across pauses (up to 90 seconds for deep scenarios)
      const turnCutoff = now - 90000
      this.interviewerTurnChunks = this.interviewerTurnChunks
        .filter((c) => c.timestamp >= turnCutoff)
        .slice(-30)
    }
  }

  /**
   * Binds anaphoric references ("this", "that", "it") to antecedent entities
   * mentioned earlier in the turn or in the immediate previous discussion.
   */
  private resolveAnaphora(triggerText: string, fullTurnText: string): { boundText: string; boundContext?: string } {
    const hasAnaphora = ANAPHORA_PATTERNS.some((p) => p.test(triggerText))

    // 1. If full turn text already has premise before the question prompt, dispatch the full scenario
    if (fullTurnText && fullTurnText !== triggerText && fullTurnText.length > triggerText.length + 10) {
      return {
        boundText: fullTurnText,
        boundContext: `Cumulative scenario premise: "${fullTurnText.slice(0, 150)}..."`
      }
    }

    // 2. If question is a short anaphoric follow-up (e.g., "How did you solve it?")
    // and current turn lacks a premise, bind to the previous topic in history
    if (hasAnaphora && this.lastEmittedQuestion) {
      const antecedent = this.lastEmittedQuestion.slice(0, 140)
      const bound = `Regarding our discussion on "${antecedent}": ${triggerText}`
      return {
        boundText: bound,
        boundContext: `Bound antecedent: "${antecedent}"`
      }
    }

    return { boundText: fullTurnText || triggerText }
  }

  /**
   * Reconstructs the complete question by joining all chunks spoken since the turn began.
   * Chunks are deduplicated and joined in strict chronological order.
   */
  private getFullQuestionText(): string {
    const orderedChunks: string[] = []

    for (const c of this.interviewerTurnChunks) {
      if (c.timestamp >= this.turnStartTime) {
        const text = c.text.trim()
        if (text && !orderedChunks.includes(text)) {
          orderedChunks.push(text)
        }
      }
    }

    for (const bufText of this.transcriptBuffer) {
      const text = bufText.trim()
      if (text && !orderedChunks.includes(text)) {
        orderedChunks.push(text)
      }
    }

    return orderedChunks.join(' ').trim()
  }

  /**
   * Classify the question category for Glance Mode formatting
   */
  public categorizeQuestion(text: string): InterviewQuestionCategory {
    // 1. Coding / LeetCode
    if (
      /\b(write (a|the) (function|code|algorithm|script|query)|implement (a|the)|solve this problem|leetcode|two sum|reverse a linked list|binary search|dsa|time complexity of your code|space complexity of your code|big o)\b/i.test(
        text
      )
    ) {
      return 'coding'
    }

    // 2. Behavioral / HR (STAR format)
    if (
      /\b(tell me about a (time|situation|project)|describe a (time|situation|challenge)|how do you handle (conflict|pressure|disagreement)|what is your biggest (weakness|strength|failure|achievement)|give me an example of|why do you want to (join|work)|where do you see yourself|why should we hire you|tell me about yourself)\b/i.test(
        text
      )
    ) {
      return 'behavioral'
    }

    // 3. Project / Architecture / System Design
    if (
      /\b(tech stack|technology stack|architecture|system design|design a|scale|scaling|database schema|postgres|redis|queue|microservice|monolith|funprint|funprinting|trade-offs|tradeoff|how would you architect|load balancer|latency|throughput|caching|kafka|rabbitmq|bullmq|acid)\b/i.test(
        text
      )
    ) {
      return 'architecture_project'
    }

    // 4. Conceptual / Verbal
    return 'conceptual'
  }

  /**
   * Check for question immediately (early detection) for high-confidence standalone questions.
   */
  checkEarlyDetection(text: string): DetectedQuestion | null {
    const trimmedText = text.trim()
    if (!trimmedText) return null

    // Do not trigger early detection if chunk ends on an incomplete preposition/conjunction
    if (
      /\b(in|of|with|for|about|on|at|to|whether|whether the|and|or|because|if|as|that|into|from)\s*$/i.test(
        trimmedText
      )
    ) {
      return null
    }

    const detection = this.evaluateCandidate(trimmedText)
    if (detection && detection.confidence >= this.earlyDetectionThreshold) {
      const fullTurnText = this.getFullQuestionText() || trimmedText
      const { boundText, boundContext } = this.resolveAnaphora(trimmedText, fullTurnText)

      if (this.isDuplicateOrRecent(boundText)) {
        return null
      }

      const category = this.categorizeQuestion(boundText)

      console.log(
        `[QuestionDetector] ⚡ EARLY DETECTION [${category}]: "${boundText}" (confidence: ${detection.confidence.toFixed(2)})`
      )

      this.markEmitted(boundText)
      this.transcriptBuffer = []
      this.interviewerTurnChunks = []
      this.turnStartTime = Date.now()

      return {
        ...detection,
        text: boundText,
        category,
        boundContext
      }
    }

    return null
  }

  onUtteranceEnd(): void {
    const fullTurnText = this.getFullQuestionText()
    if (!fullTurnText) return

    const detection = this.evaluateCandidate(fullTurnText)

    if (!detection || detection.confidence < this.confidenceThreshold) {
      console.log(
        `[QuestionDetector] Not a question: "${fullTurnText}" (confidence: ${detection?.confidence.toFixed(2) || '0.00'})`
      )
      return
    }

    const { boundText, boundContext } = this.resolveAnaphora(fullTurnText, fullTurnText)

    if (this.isDuplicateOrRecent(boundText)) {
      console.log(`[QuestionDetector] Skipping utterance end - duplicate or recent: "${boundText}"`)
      return
    }

    const category = this.categorizeQuestion(boundText)

    console.log(
      `[QuestionDetector] ✓ QUESTION DETECTED [${category}]: "${boundText}" (confidence: ${detection.confidence.toFixed(2)})`
    )

    this.markEmitted(boundText)
    // Clear turn buffers so next interviewer turn starts fresh
    this.transcriptBuffer = []
    this.interviewerTurnChunks = []
    this.turnStartTime = Date.now()

    this.emit('questionDetected', {
      ...detection,
      text: boundText,
      category,
      boundContext
    })
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
    this.interviewerTurnChunks = []
    this.lastEmittedQuestion = ''
    this.lastEmittedTime = 0
  }

  setConfidenceThreshold(threshold: number): void {
    this.confidenceThreshold = Math.max(0.1, Math.min(1.0, threshold))
  }
}
