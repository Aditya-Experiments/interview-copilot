import { EventEmitter } from 'events'
import fs from 'fs'
import OpenAI from 'openai'
import { GoogleGenAI } from '@google/genai'
import { compressBase64Image } from './imageCompressor'

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
  openaiModel?: string
  maxTokens?: number
  temperature?: number
  resumeDescription?: string
  llmProvider?: 'groq' | 'gemini' | 'openai'
  visionProvider?: 'gemini' | 'openai' | 'groq'
}

export type QuestionGlanceCategory = 'architecture_project' | 'behavioral' | 'coding' | 'conceptual' | 'unknown'

export const getGlanceModeSystemPrompt = (
  resumeDescription?: string
): string => {
  const resumeText = resumeDescription?.trim() || ''

  return `You are an elite software engineering candidate answering questions live in a real-time interview.
Your answer is rendered in PARAKEET AI GLANCE MODE—formatted in clean, natural spoken paragraphs that the candidate can READ OUT LOUD VERBATIM to the interviewer without hesitation.
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

FOLLOWED IMMEDIATELY ON LINE 2 BY YOUR NATURAL SPOKEN ANSWER:

SPOKEN PARAGRAPH FORMATTING RULES (READ-OUT-LOUD VERBATIM):

1. STRICTLY ZERO "Topic: Answer" OR COLON-TAG BULLETS:
   - NEVER write colon-prefixed labels like "Database: ...", "Serverless: ...", "Cache: ...", "Trade-off: ...", "Async Job Queue: ...", or "Real-Time UX: ...".
   - Nobody talks like that in an interview. All text must be natural, full sentences that flow conversationally.

2. STRUCTURED IN 2–3 NATURAL SPOKEN PARAGRAPHS WITH A BLANK LINE AFTER EVERY PARAGRAPH:
   - MANDATORY EMPTY LINE: You MUST put an empty blank line (double newline \n\n) after every single paragraph. NEVER put paragraphs on consecutive lines without a blank line separating them.
   - PARAGRAPH 1 (Spoken Opener - Read Immediately in First 3s):
     1–2 punchy spoken sentences that directly state the thesis or bottom-line answer. The candidate speaks this immediately to kill awkward silence.

   - PARAGRAPH 2 (Technical Architecture & Implementation):
     2–3 natural spoken sentences detailing the exact technologies, data flow, and architecture. Integrate **bold technical keywords** naturally into sentences (e.g., "On the database side, I used **PostgreSQL and Prisma**..."). Use natural spoken transitions ("To handle the data load...", "For heavy PDF rendering...", "On the frontend...").

   - PARAGRAPH 3 (Trade-offs, Scaling & Prioritization - If applicable):
     1–2 spoken sentences articulating a conscious trade-off or scaling decision ("If I had to prioritize, I’d tackle the **database connection pool** first because read latency is the primary bottleneck...").

3. ADAPTIVE LENGTH (PROPORTIONAL TO THE QUESTION):
   - NARROW / SHORT QUESTIONS (e.g., "Which DB did you use for the queue?", "Is it ACID compliant?"):
     Keep it to ONLY 1 short paragraph (2–3 spoken sentences total). Do NOT pad with extra paragraphs.
   - BROAD SYSTEM DESIGN / ARCHITECTURE SCENARIOS:
     2–3 short paragraphs as described above (30–50 seconds total speaking time).
   - BEHAVIORAL QUESTIONS:
     2–3 spoken narrative paragraphs (Situation & Task -> Specific Actions with bold verbs -> Measurable Outcome).
   - CODING / DSA / LEETCODE QUESTIONS:
     - 1 spoken approach paragraph (1–2 sentences explaining intuition & optimal data structures).
     - Followed by a clean, optimal syntax-highlighted code block in C++ (modern C++17/C++20 using standard STL like vector, unordered_map, unordered_set, priority_queue, stack, etc.). Do NOT use any other language unless explicitly requested. Include brief clean inline comments for key logic.
     - 1 spoken complexity sentence on the final line (e.g., **Time Complexity:** O(N), **Space Complexity:** O(1)).

4. LEETCODE & CODING LANGUAGE REQUIREMENT:
   - For all coding problems, algorithms, data structures, and LeetCode questions, you MUST write the code solution in C++ (C++17/C++20 standard).
   - Use standard C++ headers and idioms (e.g., vector, unordered_map, string, queue, algorithm, climits).
   - Write modern, production-grade C++ with optimal time and space complexity.

5. NATURAL SPOKEN CONSTRAINTS:
   - ZERO AI filler ("Sure!", "That's a great question", "Certainly", "In conclusion"). Jump straight into the first spoken sentence.
   - Write for the ear: short, punchy clauses (8–14 words) that are easy to speak naturally while looking at the camera.
   - Always answer in crisp, professional English regardless of whether the interviewer spoke in English, Hindi, or Hinglish.

6. ATTRIBUTION SIGNATURE (MANDATORY ON THE FINAL LINE):
   - At the absolute end of every answer, leave one blank line and write your engine attribution signature in italics:
     _— by Groq_ (if powered by Groq LPU)
     _— by ChatGPT_ (if powered by OpenAI / ChatGPT)
     _— by Gemini_ (if powered by Google Gemini)`
}

const getSolutionSystemPrompt = (
  questionType?: 'leetcode' | 'system-design' | 'other',
  resumeDescription?: string
): string => {
  const basePrompt = getGlanceModeSystemPrompt(resumeDescription)
  if (questionType === 'leetcode') {
    return `${basePrompt}\n\nLEETCODE INSTRUCTION: You MUST provide the complete, optimal code implementation in C++ (C++17/C++20). Use modern C++ STL structures and write clean, competitive-programming/interview-ready C++ code.`
  }
  return basePrompt
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

  private getProviderAttempts(override?: 'groq' | 'gemini' | 'openai'): ProviderAttempt[] {
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

    // 3. OpenAI Keys (ChatGPT & GitHub Models)
    const openaiKeys: string[] = []
    if (this.config.openaiApiKeys && Array.isArray(this.config.openaiApiKeys)) {
      for (const k of this.config.openaiApiKeys) {
        if (k && k.trim() && !openaiKeys.includes(k.trim())) openaiKeys.push(k.trim())
      }
    }
    if (
      this.config.apiKey?.trim() &&
      (this.config.apiKey.trim().startsWith('sk-') ||
        this.config.apiKey.trim().startsWith('ghp_') ||
        this.config.apiKey.trim().startsWith('github_pat_')) &&
      !openaiKeys.includes(this.config.apiKey.trim())
    ) {
      openaiKeys.push(this.config.apiKey.trim())
    }
    openaiKeys.forEach((key, idx) => {
      let oModel = this.config.openaiModel || this.config.model || 'gpt-4o-mini'
      if (
        !oModel.includes('gpt') &&
        !oModel.startsWith('o1') &&
        !oModel.startsWith('o3')
      ) {
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
    const preferred = override || this.config.llmProvider || 'groq'
    if (preferred === 'gemini') {
      return [...geminiAttempts, ...openaiAttempts, ...groqAttempts]
    } else if (preferred === 'openai') {
      return [...openaiAttempts, ...geminiAttempts, ...groqAttempts]
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

    try {
      fs.appendFileSync(
        '/tmp/groq_test.log',
        `\n[${new Date().toISOString()}] generateAnswer called: "${question.slice(0, 80)}..."\nAttempts: ${JSON.stringify(attempts.map((a) => ({ provider: a.provider, model: a.model, keyPrefix: a.key.slice(0, 8) })))}\n`
      )
    } catch {}

    for (let i = 0; i < attempts.length; i++) {
      if (currentAbortController.signal.aborted) {
        console.log('[OpenAIService] Generation aborted before provider attempt')
        return ''
      }

      const attempt = attempts[i]
      const engineName =
        attempt.provider === 'groq' ? 'Groq' : attempt.provider === 'openai' ? 'ChatGPT' : 'Gemini'
      const attemptSystemPrompt = `${activeSystemPrompt}\n\nSIGNATURE INSTRUCTION: You are powered by ${engineName}. At the absolute end of your entire answer, leave one empty blank line and write your signature in italics: "_— by ${engineName}_".`

      try {
        let streamResult: { fullResponse: string; isSuppressed: boolean; wasAborted: boolean }

        if (attempt.provider === 'groq') {
          const client = new OpenAI({
            apiKey: attempt.key,
            baseURL: 'https://api.groq.com/openai/v1'
          })

          const candidateModels = [
            attempt.model,
            'llama-3.3-70b-versatile',
            'llama-3.1-8b-instant',
            'deepseek-r1-distill-llama-70b',
            'deepseek-r1-distill-qwen-32b',
            'qwen/qwen3.8-27b',
            'openai/gpt-oss-120b'
          ].filter((m, idx, arr) => Boolean(m) && arr.indexOf(m) === idx)

          let stream: any = null
          let lastGroqErr: any = null

          for (const candModel of candidateModels) {
            if (currentAbortController.signal.aborted) return ''
            try {
              const isDeepseek = candModel.includes('deepseek')
              const modelMessages: Message[] = isDeepseek
                ? [
                    { role: 'user', content: attemptSystemPrompt },
                    { role: 'assistant', content: 'Understood. I will strictly follow Glance Mode, bullet points, and the required signature.' },
                    ...this.conversationHistory
                  ]
                : [
                    { role: 'system', content: attemptSystemPrompt },
                    ...this.conversationHistory
                  ]

              stream = await client.chat.completions.create(
                {
                  model: candModel,
                  messages: modelMessages,
                  max_completion_tokens: isDeepseek ? 4096 : (this.config.maxTokens || 1200),
                  temperature: this.config.temperature || 0.7,
                  stream: true
                },
                { signal: currentAbortController.signal }
              )
              try {
                fs.appendFileSync(
                  '/tmp/groq_test.log',
                  `[${new Date().toISOString()}] Groq SUCCESS with model ${candModel}\n`
                )
              } catch {}
              break
            } catch (candErr: any) {
              if (currentAbortController.signal.aborted || candErr?.name === 'AbortError') {
                return ''
              }
              lastGroqErr = candErr
              const errMsg = `[${new Date().toISOString()}] Groq model "${candModel}" failed: status=${candErr?.status}, message=${candErr?.message}\n`
              console.warn(errMsg)
              try {
                fs.appendFileSync('/tmp/groq_test.log', errMsg)
              } catch {}
            }
          }

          if (!stream) {
            throw lastGroqErr
          }

          let inThinkTag = false
          async function* getGroqChunks() {
            for await (const chunk of stream) {
              const content = chunk.choices[0]?.delta?.content || ''
              if (!content) continue

              // Strip <think>...</think> chain-of-thought tokens from DeepSeek models so user gets clean answers
              if (content.includes('<think>')) {
                inThinkTag = true
              }
              if (inThinkTag) {
                if (content.includes('</think>')) {
                  inThinkTag = false
                  const afterThink = content.split('</think>')[1]
                  if (afterThink && afterThink.trim()) yield afterThink.trimStart()
                }
                continue
              }
              yield content
            }
          }

          streamResult = await this.processStreamWithFilter(
            getGroqChunks(),
            currentAbortController.signal,
            { question, category }
          )
        } else if (attempt.provider === 'openai') {
          const isGitHub = attempt.key.startsWith('ghp_') || attempt.key.startsWith('github_pat_')
          if (isGitHub) {
            throw new Error(
              'GitHub Models was officially retired by GitHub. Please use an official OpenAI key (sk-...) from platform.openai.com or use free Google Gemini / Groq.'
            )
          }

          const client = new OpenAI({
            apiKey: attempt.key
          })

          const isReasoning = attempt.model.startsWith('o1') || attempt.model.startsWith('o3')
          const messages: Message[] = [
            { role: isReasoning ? 'user' : 'system', content: attemptSystemPrompt },
            ...this.conversationHistory
          ]

          const requestParams: any = {
            model: attempt.model,
            messages: messages,
            max_completion_tokens: this.config.maxTokens || 4096,
            stream: true
          }

          if (!isReasoning) {
            requestParams.temperature = this.config.temperature || 0.7
          }

          const stream: any = await client.chat.completions.create(
            requestParams,
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
                  systemInstruction: attemptSystemPrompt,
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
                  systemInstruction: attemptSystemPrompt,
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

        // Guarantee signature attribution exists at the end of the answer
        if (
          streamResult.fullResponse &&
          !/(?:—\s*by|by)\s+(groq|chatgpt|openai|gemini)/i.test(streamResult.fullResponse)
        ) {
          const sig = `\n\n_— by ${engineName}_`
          streamResult.fullResponse += sig
          this.emit('stream', sig)
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
    // If question text is available, respect the user's chosen LLM engine (e.g. Groq); otherwise use visionProvider
    const preferredProvider =
      questionText && questionText.trim().length > 10
        ? (this.config.llmProvider || this.config.visionProvider || 'groq')
        : (this.config.visionProvider || 'groq')

    const attempts = this.getProviderAttempts(preferredProvider)
    if (attempts.length === 0) {
      throw new Error('No API keys configured. Please add an API key in Settings.')
    }

    // Compress image to lightweight JPEG (drops ~12MB down to ~150KB) so API uploads don't timeout
    const compressed = compressBase64Image(imageBase64, 1600, 82)
    const base64Data = compressed.base64
    const mimeType = compressed.mimeType
    const dataUrl = compressed.dataUrl
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
        ? `Here is the coding problem: "${questionText}"\n\nExplain your approach briefly in 1-2 spoken sentences, provide the clean, optimal code solution in C++ (modern C++17/C++20 STL), and state time/space complexity.`
        : `Here is the interview question: "${questionText}"\n\nProvide a concise, speakable answer in bullet points with bold keywords. STRICTLY DO NOT generate code blocks unless code was explicitly requested.`
      : `Analyze this screenshot carefully. Extract the interview question or problem statement from the image.
If it is a coding/algorithm/LeetCode problem asking to write code, provide the approach and clean, optimal code solution in C++ (modern C++17/C++20 STL), followed by time and space complexity.
If it is a project, conceptual, situational, or multiple-choice question, provide a concise, speakable answer in bullet points—STRICTLY DO NOT generate code blocks.`

    try {
      fs.appendFileSync(
        '/tmp/groq_test.log',
        `\n[${new Date().toISOString()}] generateSolutionFromImage called, questionText: "${questionText?.slice(0, 80)}..."\nAttempts: ${JSON.stringify(attempts.map((a) => ({ provider: a.provider, model: a.model, keyPrefix: a.key.slice(0, 8) })))}\n`
      )
    } catch {}

    let lastError: unknown = null

    for (let i = 0; i < attempts.length; i++) {
      const attempt = attempts[i]
      const engineName =
        attempt.provider === 'groq' ? 'Groq' : attempt.provider === 'openai' ? 'ChatGPT' : 'Gemini'
      const attemptSolutionPrompt = `${solutionPrompt}\n\nSIGNATURE INSTRUCTION: You are powered by ${engineName}. At the absolute end of your entire answer, leave one empty blank line and write your signature in italics: "_— by ${engineName}_".`
      let fullResponse = ''

      try {
        if (attempt.provider === 'groq') {
          const client = new OpenAI({
            apiKey: attempt.key,
            baseURL: 'https://api.groq.com/openai/v1'
          })

          const hasExtractedText = Boolean(questionText && questionText.trim().length > 10)
          const userContent: any = hasExtractedText
            ? promptText
            : [
                { type: 'text', text: promptText },
                {
                  type: 'image_url',
                  image_url: { url: dataUrl }
                }
              ]

          // For raw images without extracted text, use Groq's multimodal vision model (qwen/qwen3.8-27b)
          // When question text is available, use user's selected Groq model or llama-3.3-70b-versatile
          const groqModelToUse = hasExtractedText
            ? (this.config.groqModel || 'llama-3.3-70b-versatile')
            : 'qwen/qwen3.8-27b'

          const isDeepseek = groqModelToUse.includes('deepseek')
          const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = isDeepseek
            ? [
                { role: 'user', content: attemptSolutionPrompt },
                { role: 'assistant', content: 'Understood. I will provide the optimal solution, approach, and signature.' },
                { role: 'user', content: userContent }
              ]
            : [
                { role: 'system', content: attemptSolutionPrompt },
                { role: 'user', content: userContent }
              ]

          const stream = await client.chat.completions.create({
            model: groqModelToUse,
            messages: messages,
            max_completion_tokens: isDeepseek ? 4096 : (this.config.maxTokens || 4096),
            temperature: this.config.temperature || 0.7,
            stream: true
          })

          let inThink = false
          try {
            for await (const chunk of stream) {
              const content = chunk.choices[0]?.delta?.content || ''
              if (!content) continue

              if (content.includes('<think>')) inThink = true
              if (inThink) {
                if (content.includes('</think>')) {
                  inThink = false
                  const after = content.split('</think>')[1]
                  if (after && after.trim()) {
                    fullResponse += after.trimStart()
                    this.emit('stream', after.trimStart())
                  }
                }
                continue
              }

              fullResponse += content
              this.emit('stream', content)
            }
          } catch (streamErr: any) {
            if (fullResponse.trim().length > 50 && (streamErr?.message?.includes('EOF') || streamErr?.message?.includes('stream'))) {
              console.warn(`Groq stream ended with unexpected EOF, preserved response (${fullResponse.length} chars)`)
            } else {
              throw streamErr
            }
          }
        } else if (attempt.provider === 'openai') {
          const isGitHub = attempt.key.startsWith('ghp_') || attempt.key.startsWith('github_pat_')
          if (isGitHub) {
            throw new Error(
              'GitHub Models was officially retired by GitHub. Please use an official OpenAI key (sk-...) from platform.openai.com or use free Google Gemini / Groq.'
            )
          }
          const client = new OpenAI({
            apiKey: attempt.key
          })
          const isReasoning = attempt.model.startsWith('o1') || attempt.model.startsWith('o3')
          const isTextOnlyReasoning = attempt.model.startsWith('o1-mini') || attempt.model.startsWith('o3-mini')

          if (isTextOnlyReasoning && !questionText) {
            // Text-only reasoning models cannot process raw images without extracted text
            continue
          }

          const userContent: any = isTextOnlyReasoning
            ? promptText
            : [
                { type: 'text', text: promptText },
                {
                  type: 'image_url',
                  image_url: { url: dataUrl }
                }
              ]

          const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
            { role: isReasoning ? 'user' : 'system', content: attemptSolutionPrompt },
            {
              role: 'user',
              content: userContent
            }
          ]

          const requestParams: any = {
            model: attempt.model || 'gpt-4o',
            messages: messages,
            max_completion_tokens: this.config.maxTokens || 4096,
            stream: true
          }

          if (!isReasoning) {
            requestParams.temperature = this.config.temperature || 0.7
          }

          const stream: any = await client.chat.completions.create(requestParams)

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
                      mimeType: mimeType,
                      data: base64Data
                    }
                  }
                ]
              }
            ],
            config: {
              systemInstruction: attemptSolutionPrompt,
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

        // Guarantee signature attribution exists at the end of the answer
        if (
          fullResponse &&
          !/(?:—\s*by|by)\s+(groq|chatgpt|openai|gemini)/i.test(fullResponse)
        ) {
          const sig = `\n\n_— by ${engineName}_`
          fullResponse += sig
          this.emit('stream', sig)
        }

        this.emit('complete', fullResponse)
        return fullResponse
      } catch (err: any) {
        lastError = err
        try {
          fs.appendFileSync(
            '/tmp/groq_test.log',
            `[${new Date().toISOString()}] Attempt ${attempt.provider} Key #${attempt.index} FAILED: ${err?.message || err}\n`
          )
        } catch {}
        const hasNext = i + 1 < attempts.length
        if (hasNext) {
          const next = attempts[i + 1]
          const warnMsg = `⚠️ Rate limit on vision query for ${attempt.provider.toUpperCase()} Key #${attempt.index} (${err?.message || 'Error'}). Auto-switching to ${next.provider.toUpperCase()} Key #${next.index}...`
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
