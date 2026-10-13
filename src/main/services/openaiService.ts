import { EventEmitter } from 'events'
import OpenAI from 'openai'
import { GoogleGenAI } from '@google/genai'

export interface Message {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface OpenAIConfig {
  apiKey?: string
  groqApiKey?: string
  geminiApiKey?: string
  groqApiKeys?: string[]
  geminiApiKeys?: string[]
  openaiApiKeys?: string[]
  model?: string
  groqModel?: string
  geminiModel?: string
  maxTokens?: number
  temperature?: number
  resumeDescription?: string
  llmProvider?: 'groq' | 'gemini' | 'openai'
}

export type QuestionGlanceCategory = 'architecture_project' | 'behavioral' | 'coding' | 'conceptual' | 'unknown'

export const getGlanceModeSystemPrompt = (
  resumeDescription?: string
): string => {
  const resumeText = resumeDescription?.trim() || ''

  return `You are an elite software engineering candidate answering questions live in a real-time interview.
Your answer is rendered in PARAKEET AI GLANCE MODE—designed so the candidate can START SPEAKING OUT LOUD IMMEDIATELY within 2 seconds of the interviewer finishing, and glance at concise points as they speak.
${
  resumeText
    ? `CANDIDATE BACKGROUND & RESUME:
${resumeText}
Ground technical choices in this background. Speak in the first person ("I built...", "In FunPrinting, I chose...").`
    : ''
}

TURN & TOPIC SEMANTIC UNDERSTANDING (CRITICAL - LINE 1):
1. Pure Acknowledgment / Filler:
   If the interviewer's turn is purely conversational filler, acknowledgment, small talk, pleasantry, or positive feedback without asking a question or technical scenario (e.g., "Sounds good", "Okay great", "Thanks", "I see", "Yeah right", "Let's move on", "Understood"), you MUST reply with STRICTLY and ONLY:
[NO_QUESTION]

2. Semantic Routing & Question Synthesis:
   If it contains an interview question, technical scenario, or problem, output line 1 in this exact format:
[QUESTION: <full synthesized question>] [TOPIC:NEW|CONTINUATION] [CATEGORY:architecture_project|behavioral|coding|conceptual]

- QUESTION SYNTHESIS:
  - If the interviewer's turn completes, continues, or expands an incomplete thought or earlier question across a pause, synthesize the FULL, COHESIVE question inside [QUESTION: <complete question>].
  - Otherwise, output the interviewer's clean question inside [QUESTION: <clean question>].
- TOPIC ROUTING:
  - Output [TOPIC:CONTINUATION] if this question continues, follows up on, or is within the SAME topic/project previously discussed.
  - Output [TOPIC:NEW] if the interviewer is switching to a completely NEW topic (e.g. from system design to LeetCode coding, or to behavioral STAR, or starting an unrelated domain).
- CATEGORY TAG:
  [CATEGORY:architecture_project]  <- For project architecture, system design, databases, scaling, trade-offs
  [CATEGORY:behavioral]            <- For behavioral, HR, conflict, leadership (STAR format)
  [CATEGORY:coding]                <- For DSA, LeetCode, write code, algorithms, Big-O
  [CATEGORY:conceptual]            <- For conceptual, technical verbal questions, differences, definitions

FOLLOWED IMMEDIATELY ON LINE 2 BY YOUR ANSWER DESIGNED FOR INSTANT VERBAL DELIVERY:

PARAKEET AI ANSWER DELIVERY RULES:

1. LINE 2 - THE IMMEDIATE SPOKEN OPENER (CRITICAL - SAY THIS FIRST):
   - The very first sentence of your response MUST be a punchy, direct conversational opener (1–2 sentences max).
   - This sentence gives the direct bottom-line answer or architectural thesis immediately.
   - The candidate will read this sentence out loud within 2-3 seconds of the interviewer finishing, eliminating awkward pauses and freezing.
   - Example (Architecture): "To support instant prefix search and orders, I used PostgreSQL for ACID-compliant transactions paired with Redis for sub-millisecond prefix caching."
   - Example (Targeted question): "I chose BullMQ over Kafka because our throughput was under 5k RPS, so Kafka would have added unnecessary operational overhead."
   - Example (Conceptual): "The core difference is that optimistic locking checks for conflicts at commit time via a version column, while pessimistic locking takes an exclusive database lock upfront."

2. ADAPTIVE LENGTH - PROPORTIONAL TO THE QUESTION (NEVER A RIGID FIXED FORMAT):
   Scale your answer's length and depth strictly to match the question's scope:
   
   - A. NARROW / QUICK / FOLLOW-UP QUESTIONS (e.g., "What DB did you use for the queue?", "Is it ACID compliant?", "What's the Big-O time complexity?"):
     - SHORT (10–15 seconds spoken).
     - Give ONLY the spoken opener + 1 concise supporting sentence.
     - ZERO unnecessary fluff, NO forced templates, NO extra bullets. Keep it sharp and direct.
   
   - B. MEDIUM / CONCEPTUAL / COMPARISON QUESTIONS (e.g., "What problem did it solve?", "Why not MongoDB?", "How do you handle token expiry?"):
     - MEDIUM (20–30 seconds spoken).
     - Spoken opener + 2–3 concise bullets with **bold technical keywords**.
   
   - C. BROAD / SYSTEM DESIGN / ARCHITECTURAL SCENARIOS (e.g., "Walk me through how you built FunPrinting", "How would you store the data to support instant prefix search, order management, and cloud storage?"):
     - DEEP & STRUCTURED (40–60 seconds spoken).
     - Spoken opener setting the overarching architectural blueprint.
     - 3–4 structured bullets detailing core subsystems with **bold keywords** (e.g., **Storage & Schema**, **Prefix Search Indexing**, **Cloud Ingestion & S3**, **Async Worker Queues**).
     - 1 conscious trade-off bullet (e.g., *Chose Redis Trie over Elasticsearch to minimize memory overhead for our scale*).
   
   - D. BEHAVIORAL QUESTIONS (STAR Method):
     - Spoken opener summarizing the challenge and resolution.
     - **Situation & Task**: 1 concise sentence.
     - **Action**: 2–3 bullets with **bold action verbs** of what *I* did.
     - **Result**: 1 sentence with concrete measurable outcome.
   
   - E. CODING / DSA QUESTIONS:
     - Spoken opener: 1 sentence approach ("We can solve this in O(N) using a two-pointer sliding window...").
     - Clean syntax-highlighted code block with brief inline comments.
     - Time & Space complexity on the final line (e.g., **Time:** O(N), **Space:** O(1)).

3. NATURAL SPOKEN CONSTRAINTS:
   - ZERO AI filler ("Sure!", "That's a great question", "Certainly", "In conclusion"). Jump directly into the spoken opener.
   - Write for the ear: short, punchy clauses (8–14 words) that are easy to speak naturally while looking at the camera.
   - Always answer in crisp, professional English regardless of whether the interviewer spoke in English, Hindi, or Hinglish.`
}

const getSolutionSystemPrompt = (
  _questionType?: 'leetcode' | 'system-design' | 'other',
  resumeDescription?: string
): string => {
  return getGlanceModeSystemPrompt(resumeDescription)
}

interface ProviderAttempt {
  provider: 'groq' | 'gemini' | 'openai'
  key: string
  model: string
  index: number
}

export class OpenAIService extends EventEmitter {
  private config: OpenAIConfig
  private conversationHistory: Message[] = []
  private maxHistoryLength = 10
  private systemPrompt: string = ''
  private activeAbortController: AbortController | null = null
  private lastTopicCategory: QuestionGlanceCategory | null = null

  constructor(config: OpenAIConfig) {
    super()
    this.config = config
    this.systemPrompt = getGlanceModeSystemPrompt(config.resumeDescription || '')
  }

  /**
   * Aborts any in-flight LLM generation (e.g. when a new turn arrives or candidate speaks).
   */
  public abortActiveGeneration(): void {
    if (this.activeAbortController) {
      console.log('[OpenAIService] 🛑 Aborting active generation in flight')
      this.activeAbortController.abort()
      this.activeAbortController = null
    }
  }

  private getProviderAttempts(): ProviderAttempt[] {
    const groqAttempts: ProviderAttempt[] = []
    const geminiAttempts: ProviderAttempt[] = []
    const openaiAttempts: ProviderAttempt[] = []

    // 1. Groq Keys (Ultra-fast ~150ms answers)
    const groqKeys: string[] = []
    if (this.config.groqApiKeys && Array.isArray(this.config.groqApiKeys)) {
      for (const k of this.config.groqApiKeys) {
        if (k && k.trim() && !groqKeys.includes(k.trim())) groqKeys.push(k.trim())
      }
    }
    if (this.config.apiKey?.trim().startsWith('gsk_') && !groqKeys.includes(this.config.apiKey.trim())) {
      groqKeys.push(this.config.apiKey.trim())
    }
    groqKeys.forEach((key, idx) => {
      groqAttempts.push({
        provider: 'groq',
        key,
        model: this.config.groqModel || 'qwen/qwen3.8-27b',
        index: idx + 1
      })
    })

    // 2. Gemini Keys (100% Free Multimodal)
    const geminiKeys: string[] = []
    if (this.config.geminiApiKeys && Array.isArray(this.config.geminiApiKeys)) {
      for (const k of this.config.geminiApiKeys) {
        if (k && k.trim() && !geminiKeys.includes(k.trim())) geminiKeys.push(k.trim())
      }
    }
    if (
      this.config.apiKey?.trim() &&
      !this.config.apiKey.trim().startsWith('gsk_') &&
      !this.config.apiKey.trim().startsWith('sk-') &&
      !geminiKeys.includes(this.config.apiKey.trim())
    ) {
      geminiKeys.push(this.config.apiKey.trim())
    }
    geminiKeys.forEach((key, idx) => {
      let gModel = this.config.geminiModel || 'gemini-3.5-flash-lite'
      if (gModel.includes('llama') || gModel.includes('gpt')) {
        gModel = 'gemini-3.5-flash-lite'
      }
      geminiAttempts.push({
        provider: 'gemini',
        key,
        model: gModel,
        index: idx + 1
      })
    })

    // 3. OpenAI Keys (ChatGPT)
    const openaiKeys: string[] = []
    if (this.config.openaiApiKeys && Array.isArray(this.config.openaiApiKeys)) {
      for (const k of this.config.openaiApiKeys) {
        if (k && k.trim() && !openaiKeys.includes(k.trim())) openaiKeys.push(k.trim())
      }
    }
    if (this.config.apiKey?.trim().startsWith('sk-') && !openaiKeys.includes(this.config.apiKey.trim())) {
      openaiKeys.push(this.config.apiKey.trim())
    }
    openaiKeys.forEach((key, idx) => {
      let oModel = this.config.model || 'gpt-4o-mini'
      if (!oModel.includes('gpt')) {
        oModel = 'gpt-4o-mini'
      }
      openaiAttempts.push({
        provider: 'openai',
        key,
        model: oModel,
        index: idx + 1
      })
    })

    // Order by user preference (default: groq first for maximum speed)
    const preferred = this.config.llmProvider || 'groq'
    if (preferred === 'gemini') {
      return [...geminiAttempts, ...groqAttempts, ...openaiAttempts]
    } else if (preferred === 'openai') {
      return [...openaiAttempts, ...groqAttempts, ...geminiAttempts]
    } else {
      return [...groqAttempts, ...geminiAttempts, ...openaiAttempts]
    }
  }

  /**
   * Consumes an async stream of tokens from any LLM provider.
   * - Filters out [NO_QUESTION] small-talk/acknowledgment responses silently without emitting.
   * - Emits 'questionConfirmed' on the very first confirmed token.
   * - Honors AbortSignal on every chunk.
   */
  private async processStreamWithFilter(
    chunkIterator: AsyncIterable<string>,
    abortSignal: AbortSignal,
    questionContext: { question: string; category?: QuestionGlanceCategory }
  ): Promise<{ fullResponse: string; isSuppressed: boolean; wasAborted: boolean }> {
    let fullResponse = ''
    let isSuppressed = false
    let isConfirmed = false
    let buffer = ''
    const NO_QUESTION_TAG = '[NO_QUESTION]'

    try {
      for await (const chunk of chunkIterator) {
        if (abortSignal.aborted) {
          return { fullResponse, isSuppressed: false, wasAborted: true }
        }

        if (!chunk) continue

        if (isSuppressed) {
          fullResponse += chunk
          continue
        }

        if (isConfirmed) {
          fullResponse += chunk
          this.emit('stream', chunk)
          continue
        }

        // We are in the initial buffering phase
        buffer += chunk
        const trimmed = buffer.trimStart()

        if (trimmed.length === 0) {
          continue
        }

        const normalized = trimmed.replace(/^[\s*#_`]+/, '').toUpperCase()

        if (
          normalized.startsWith(NO_QUESTION_TAG) ||
          normalized.startsWith('NO_QUESTION') ||
          normalized.startsWith('NO QUESTION')
        ) {
          isSuppressed = true
          fullResponse += buffer
          console.log(`[OpenAIService] 🤫 Suppressed conversational filler response: "${trimmed.trim()}"`)
          continue
        }

        // If buffer is still a prefix of '[NO_QUESTION]' and shorter, wait for more chunks
        if (NO_QUESTION_TAG.startsWith(normalized) && normalized.length < NO_QUESTION_TAG.length) {
          continue
        }

        // If buffer might be starting with [QUESTION: or [TOPIC: or [CATEGORY:, wait until line 1 is complete or buffer is long enough
        if (
          (normalized.startsWith('[') ||
            normalized.startsWith('QUESTION:') ||
            normalized.startsWith('TOPIC:') ||
            normalized.startsWith('CATEGORY:')) &&
          !buffer.includes('\n') &&
          buffer.length < 450
        ) {
          continue
        }

        // Confirmed real question response!
        isConfirmed = true

        let synthesizedQuestion = questionContext.question
        const qMatch = buffer.match(/\[QUESTION:\s*([^\]]+)\]\s*/i)
        if (qMatch) {
          synthesizedQuestion = qMatch[1].trim()
          buffer = buffer.replace(qMatch[0], '')
        }

        let isNewTopic = false
        const topicMatch = buffer.match(/\[TOPIC:\s*(NEW|CONTINUATION)\]\s*/i)
        if (topicMatch) {
          isNewTopic = topicMatch[1].toUpperCase() === 'NEW'
          buffer = buffer.replace(topicMatch[0], '')
        }

        let detectedCategory = questionContext.category
        const catMatch = buffer.match(/\[CATEGORY:\s*([a-zA-Z0-9_]+)\]\s*\n?/i)
        if (catMatch) {
          const raw = catMatch[1].toLowerCase()
          if (
            raw === 'architecture_project' ||
            raw === 'behavioral' ||
            raw === 'coding' ||
            raw === 'conceptual'
          ) {
            detectedCategory = raw as QuestionGlanceCategory
          }
          buffer = buffer.replace(catMatch[0], '')
        }

        // Category shift between distinct domains also confirms a new topic transition
        if (
          this.lastTopicCategory &&
          detectedCategory &&
          this.lastTopicCategory !== detectedCategory
        ) {
          isNewTopic = true
        }

        if (isNewTopic) {
          console.log(
            `[OpenAIService] 🔄 Next topic detected [${detectedCategory || 'new'}] ──> Deleting old topic context history`
          )
          this.clearHistory()
          this.conversationHistory.push({
            role: 'user',
            content: `Interview question: "${synthesizedQuestion}"\n\nProvide a professional answer:`
          })
        }

        this.lastTopicCategory = detectedCategory || null

        this.emit('questionConfirmed', {
          question: synthesizedQuestion,
          category: detectedCategory || 'conceptual',
          isContinuation: !isNewTopic
        })

        // Clean leading newlines/whitespace from answer
        buffer = buffer.replace(/^[\s\r\n]+/, '')

        if (buffer) {
          fullResponse += buffer
          this.emit('stream', buffer)
        }
        buffer = ''
      }
    } catch (streamErr: any) {
      if (abortSignal.aborted) {
        return { fullResponse, isSuppressed: false, wasAborted: true }
      }
      if (
        fullResponse.trim().length > 30 &&
        (streamErr?.message?.includes('EOF') || streamErr?.message?.includes('stream'))
      ) {
        console.warn(`[OpenAIService] Stream ended with unexpected EOF, preserved response (${fullResponse.length} chars)`)
      } else {
        throw streamErr
      }
    }

    if (!isConfirmed && !isSuppressed && buffer.length > 0) {
      const normalized = buffer.trim().replace(/^[\s*#_`]+/, '').toUpperCase()
      if (
        normalized.startsWith(NO_QUESTION_TAG) ||
        normalized.startsWith('NO_QUESTION') ||
        normalized.startsWith('NO QUESTION')
      ) {
        isSuppressed = true
      } else {
        let synthesizedQuestion = questionContext.question
        const qMatch = buffer.match(/\[QUESTION:\s*([^\]]+)\]\s*/i)
        if (qMatch) {
          synthesizedQuestion = qMatch[1].trim()
          buffer = buffer.replace(qMatch[0], '')
        }

        let isNewTopic = false
        const topicMatch = buffer.match(/\[TOPIC:\s*(NEW|CONTINUATION)\]\s*/i)
        if (topicMatch) {
          isNewTopic = topicMatch[1].toUpperCase() === 'NEW'
          buffer = buffer.replace(topicMatch[0], '')
        }

        let detectedCategory = questionContext.category
        const catMatch = buffer.match(/\[CATEGORY:\s*([a-zA-Z0-9_]+)\]\s*\n?/i)
        if (catMatch) {
          const raw = catMatch[1].toLowerCase()
          if (
            raw === 'architecture_project' ||
            raw === 'behavioral' ||
            raw === 'coding' ||
            raw === 'conceptual'
          ) {
            detectedCategory = raw as QuestionGlanceCategory
          }
          buffer = buffer.replace(catMatch[0], '')
        }

        if (
          this.lastTopicCategory &&
          detectedCategory &&
          this.lastTopicCategory !== detectedCategory
        ) {
          isNewTopic = true
        }

        if (isNewTopic) {
          console.log(
            `[OpenAIService] 🔄 Next topic detected [${detectedCategory || 'new'}] ──> Deleting old topic context history`
          )
          this.clearHistory()
          this.conversationHistory.push({
            role: 'user',
            content: `Interview question: "${synthesizedQuestion}"\n\nProvide a professional answer:`
          })
        }

        this.lastTopicCategory = detectedCategory || null

        this.emit('questionConfirmed', {
          question: synthesizedQuestion,
          category: detectedCategory || 'conceptual',
          isContinuation: !isNewTopic
        })

        buffer = buffer.replace(/^[\s\r\n]+/, '')
        if (buffer) {
          fullResponse += buffer
          this.emit('stream', buffer)
        }
      }
    }

    return { fullResponse, isSuppressed, wasAborted: abortSignal.aborted }
  }

  async generateAnswer(
    question: string,
    category?: QuestionGlanceCategory,
    options?: { previousTurn?: string }
  ): Promise<string> {
    const attempts = this.getProviderAttempts()
    if (attempts.length === 0) {
      throw new Error('No API keys configured. Please add an API key in Settings.')
    }

    // Single-flight guarantee: abort any previous answer generation
    this.abortActiveGeneration()
    const currentAbortController = new AbortController()
    this.activeAbortController = currentAbortController

    const activeSystemPrompt = this.systemPrompt

    // Add user turn to conversation history with previous turn context if present
    const userPromptContent = options?.previousTurn
      ? `Interviewer previous speech turn: "${options.previousTurn}"\nInterviewer current speech turn: "${question}"\n\nAnalyze intent, synthesize full question if continuation, and provide Glance Mode answer:`
      : `Interviewer speech turn: "${question}"\n\nAnalyze intent, synthesize full question if continuation, and provide Glance Mode answer:`

    this.conversationHistory.push({
      role: 'user',
      content: userPromptContent
    })

    // Trim history if too long
    if (this.conversationHistory.length > this.maxHistoryLength) {
      this.conversationHistory = this.conversationHistory.slice(-this.maxHistoryLength)
    }

    let lastError: unknown = null

    for (let i = 0; i < attempts.length; i++) {
      if (currentAbortController.signal.aborted) {
        console.log('[OpenAIService] Generation aborted before provider attempt')
        return ''
      }

      const attempt = attempts[i]

      try {
        let streamResult: { fullResponse: string; isSuppressed: boolean; wasAborted: boolean }

        if (attempt.provider === 'groq') {
          const client = new OpenAI({
            apiKey: attempt.key,
            baseURL: 'https://api.groq.com/openai/v1'
          })

          const messages: Message[] = [
            { role: 'system', content: activeSystemPrompt },
            ...this.conversationHistory
          ]

          const candidateModels = [
            attempt.model,
            'qwen/qwen3.8-27b',
            'openai/gpt-oss-20b',
            'openai/gpt-oss-120b',
            'llama-3.3-70b-versatile',
            'llama-3.1-8b-instant'
          ].filter((m, idx, arr) => Boolean(m) && arr.indexOf(m) === idx)

          let stream: any = null
          let lastGroqErr: any = null

          for (const candModel of candidateModels) {
            if (currentAbortController.signal.aborted) return ''
            try {
              stream = await client.chat.completions.create(
                {
                  model: candModel,
                  messages: messages,
                  max_completion_tokens: this.config.maxTokens || 1200,
                  temperature: this.config.temperature || 0.7,
                  stream: true
                },
                { signal: currentAbortController.signal }
              )
              break
            } catch (candErr: any) {
              if (currentAbortController.signal.aborted || candErr?.name === 'AbortError') {
                return ''
              }
              lastGroqErr = candErr
              console.warn(
                `Groq model "${candModel}" error (${candErr?.message || 'unknown'}). Retrying next candidate...`
              )
            }
          }

          if (!stream) {
            throw lastGroqErr
          }

          async function* getGroqChunks() {
            for await (const chunk of stream) {
              const content = chunk.choices[0]?.delta?.content || ''
              if (content) yield content
            }
          }

          streamResult = await this.processStreamWithFilter(
            getGroqChunks(),
            currentAbortController.signal,
            { question, category }
          )
        } else if (attempt.provider === 'openai') {
          const client = new OpenAI({
            apiKey: attempt.key
          })

          const messages: Message[] = [
            { role: 'system', content: activeSystemPrompt },
            ...this.conversationHistory
          ]

          const stream = await client.chat.completions.create(
            {
              model: attempt.model,
              messages: messages,
              max_completion_tokens: this.config.maxTokens || 1200,
              temperature: this.config.temperature || 0.7,
              stream: true
            },
            { signal: currentAbortController.signal }
          )

          async function* getOpenAiChunks() {
            for await (const chunk of stream) {
              const content = chunk.choices[0]?.delta?.content || ''
              if (content) yield content
            }
          }

          streamResult = await this.processStreamWithFilter(
            getOpenAiChunks(),
            currentAbortController.signal,
            { question, category }
          )
        } else {
          // Google Gemini (with zero thinking tokens)
          const ai = new GoogleGenAI({ apiKey: attempt.key })
          const contents = this.conversationHistory.map((msg) => ({
            role: msg.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: msg.content }]
          }))

          const createStream = async (targetModel: string) => {
            try {
              return await ai.models.generateContentStream({
                model: targetModel,
                contents: contents,
                config: {
                  systemInstruction: activeSystemPrompt,
                  maxOutputTokens: this.config.maxTokens || 1200,
                  temperature: this.config.temperature || 0.7,
                  thinkingConfig: {
                    thinkingBudget: 0
                  }
                }
              })
            } catch {
              return await ai.models.generateContentStream({
                model: targetModel,
                contents: contents,
                config: {
                  systemInstruction: activeSystemPrompt,
                  maxOutputTokens: this.config.maxTokens || 1200,
                  temperature: this.config.temperature || 0.7
                }
              })
            }
          }

          let stream
          try {
            stream = await createStream(attempt.model)
          } catch {
            stream = await createStream('gemini-3.5-flash-lite')
          }

          async function* getGeminiChunks() {
            for await (const chunk of stream) {
              const content = chunk.text || ''
              if (content) yield content
            }
          }

          streamResult = await this.processStreamWithFilter(
            getGeminiChunks(),
            currentAbortController.signal,
            { question, category }
          )
        }

        if (streamResult.wasAborted) {
          console.log('[OpenAIService] Generation aborted during streaming')
          return ''
        }

        if (streamResult.isSuppressed) {
          console.log('[OpenAIService] Non-question acknowledgment suppressed. Trimming conversational history.')
          if (
            this.conversationHistory.length > 0 &&
            this.conversationHistory[this.conversationHistory.length - 1].role === 'user'
          ) {
            this.conversationHistory.pop()
          }
          return ''
        }

        // Successfully generated answer
        this.conversationHistory.push({
          role: 'assistant',
          content: streamResult.fullResponse
        })

        this.emit('complete', streamResult.fullResponse)
        return streamResult.fullResponse
      } catch (err: any) {
        if (currentAbortController.signal.aborted || err?.name === 'AbortError' || err?.message?.includes('abort')) {
          console.log('[OpenAIService] Generation aborted by new turn request')
          return ''
        }

        lastError = err
        const hasNext = i + 1 < attempts.length
        if (hasNext) {
          const next = attempts[i + 1]
          const warnMsg = `⚠️ Rate limit/error on ${attempt.provider.toUpperCase()} Key #${attempt.index} (${err?.message || 'Error'}). Auto-switching to ${next.provider.toUpperCase()} Key #${next.index}...`
          console.warn(warnMsg)
          this.emit('warn', warnMsg)
          continue
        }
      }
    }

    this.emit('error', lastError)
    throw lastError
  }

  clearHistory(): void {
    this.conversationHistory = []
  }

  async generateSolutionFromImage(
    imageBase64: string,
    questionText?: string,
    questionType?: 'leetcode' | 'system-design' | 'other'
  ): Promise<string> {
    const attempts = this.getProviderAttempts()
    if (attempts.length === 0) {
      throw new Error('No API keys configured. Please add an API key in Settings.')
    }

    const base64Data = imageBase64.includes(',') ? imageBase64.split(',')[1] : imageBase64
    const solutionPrompt = getSolutionSystemPrompt(questionType, this.config.resumeDescription)

    const isExplicitCoding =
      questionType === 'leetcode' ||
      Boolean(
        questionText &&
          /\b(write (a )?(code|function|program|query|script|method|class)|implement (a |the )?(function|method|class|algorithm|solution)|leetcode|hackerrank|code a |def\s+\w+|public class|function\s+\w+\(|find the (minimum|maximum|shortest|longest|kth))\b/i.test(
            questionText
          )
      )

    const promptText = questionText
      ? isExplicitCoding
        ? `Here is the coding problem: "${questionText}"\n\nExplain your approach briefly, provide the clean code solution, and state time/space complexity.`
        : `Here is the interview question: "${questionText}"\n\nProvide a concise, speakable answer in bullet points with bold keywords. STRICTLY DO NOT generate code blocks unless code was explicitly requested.`
      : `Analyze this screenshot carefully. Extract the interview question or problem statement from the image.
If it is a coding/algorithm problem asking to write code, provide the approach and clean code.
If it is a project, conceptual, situational, or multiple-choice question, provide a concise, speakable answer in bullet points—STRICTLY DO NOT generate code blocks.`

    let lastError: unknown = null

    for (let i = 0; i < attempts.length; i++) {
      const attempt = attempts[i]
      let fullResponse = ''

      try {
        if (attempt.provider === 'groq') {
          // If question text was already extracted by vision, Groq can solve it directly via text (ultra fast)!
          if (questionText && questionText.trim().length > 10) {
            const client = new OpenAI({
              apiKey: attempt.key,
              baseURL: 'https://api.groq.com/openai/v1'
            })

            const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
              { role: 'system', content: solutionPrompt },
              { role: 'user', content: promptText }
            ]

            const stream = await client.chat.completions.create({
              model: this.config.groqModel || 'qwen/qwen3.8-27b',
              messages: messages,
              max_completion_tokens: this.config.maxTokens || 4096,
              temperature: this.config.temperature || 0.7,
              stream: true
            })

            try {
              for await (const chunk of stream) {
                const content = chunk.choices[0]?.delta?.content || ''
                if (content) {
                  fullResponse += content
                  this.emit('stream', content)
                }
              }
            } catch (streamErr: any) {
              if (fullResponse.trim().length > 50 && (streamErr?.message?.includes('EOF') || streamErr?.message?.includes('stream'))) {
                console.warn(`Groq stream ended with unexpected EOF, preserved response (${fullResponse.length} chars)`)
              } else {
                throw streamErr
              }
            }
          } else {
            // Groq does not have a raw vision model on this project tier, let Gemini or OpenAI process the raw image
            continue
          }
        } else if (attempt.provider === 'openai') {
          const client = new OpenAI({ apiKey: attempt.key })
          const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
            { role: 'system', content: solutionPrompt },
            {
              role: 'user',
              content: [
                { type: 'text', text: promptText },
                {
                  type: 'image_url',
                  image_url: { url: `data:image/png;base64,${base64Data}` }
                }
              ]
            }
          ]

          const stream = await client.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: messages,
            max_completion_tokens: this.config.maxTokens || 4096,
            temperature: this.config.temperature || 0.7,
            stream: true
          })

          try {
            for await (const chunk of stream) {
              const content = chunk.choices[0]?.delta?.content || ''
              if (content) {
                fullResponse += content
                this.emit('stream', content)
              }
            }
          } catch (streamErr: any) {
            if (fullResponse.trim().length > 50 && (streamErr?.message?.includes('EOF') || streamErr?.message?.includes('stream'))) {
              console.warn(`OpenAI image stream ended with unexpected EOF, preserved response (${fullResponse.length} chars)`)
            } else {
              throw streamErr
            }
          }
        } else {
          // Gemini Multimodal
          const ai = new GoogleGenAI({ apiKey: attempt.key })
          const payload = {
            contents: [
              {
                role: 'user',
                parts: [
                  { text: promptText },
                  {
                    inlineData: {
                      mimeType: 'image/png',
                      data: base64Data
                    }
                  }
                ]
              }
            ],
            config: {
              systemInstruction: solutionPrompt,
              maxOutputTokens: this.config.maxTokens || 4096,
              temperature: this.config.temperature || 0.7
            }
          }

          let stream
          try {
            stream = await ai.models.generateContentStream({
              model: attempt.model,
              ...payload
            })
          } catch {
            stream = await ai.models.generateContentStream({
              model: 'gemini-3.5-flash-lite',
              ...payload
            })
          }

          try {
            for await (const chunk of stream) {
              const content = chunk.text || ''
              if (content) {
                fullResponse += content
                this.emit('stream', content)
              }
            }
          } catch (streamErr: any) {
            if (fullResponse.trim().length > 50 && (streamErr?.message?.includes('EOF') || streamErr?.message?.includes('stream'))) {
              console.warn(`Gemini image stream ended with unexpected EOF, preserved response (${fullResponse.length} chars)`)
            } else {
              throw streamErr
            }
          }
        }

        this.emit('complete', fullResponse)
        return fullResponse
      } catch (err: any) {
        lastError = err
        const hasNext = i + 1 < attempts.length
        if (hasNext) {
          const next = attempts[i + 1]
          const warnMsg = `⚠️ Rate limit on vision query for ${attempt.provider.toUpperCase()} Key #${attempt.index}. Auto-switching to ${next.provider.toUpperCase()} Key #${next.index}...`
          console.warn(warnMsg)
          this.emit('warn', warnMsg)
          continue
        }
      }
    }

    this.emit('error', lastError)
    throw lastError
  }

  updateConfig(config: Partial<OpenAIConfig>): void {
    this.config = { ...this.config, ...config }
    if (config.resumeDescription !== undefined) {
      this.systemPrompt = getGlanceModeSystemPrompt(config.resumeDescription || '')
    }
  }
}
