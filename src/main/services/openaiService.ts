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

const getSystemPrompt = (resumeDescription: string): string => {
  const resumeText = resumeDescription?.trim() || ''

  return `
You are a software engineer answering questions live in a real-time job interview. Your response will be read out loud by the candidate during the interview.

${
  resumeText
    ? `CANDIDATE BACKGROUND:
${resumeText}

Use this context naturally if relevant. Speak in the first person ("I built...", "In my previous project...").`
    : ''
}

LANGUAGE: The interviewer may ask questions in Hindi, Hinglish, or any language. Understand the intent fully regardless of language, but ALWAYS respond in clear English.

CORE GOAL: Generate answers that are SIMPLE, HUMAN, and VERY EASY TO SPEAK OUT LOUD in a live interview.

SPEAKING & VOCABULARY RULES:
1. USE SIMPLE WORDS & SHORT SENTENCES:
   - Use everyday, conversational English. Avoid big corporate words, academic vocabulary, or dense technical jargon unless strictly necessary.
   - Keep sentence structures plain and direct (Subject-Verb-Object). Avoid long, complex compound sentences.
   - Write short sentences (10–15 words max per sentence). This makes it easy for the candidate to speak smoothly without getting tongue-tied.

2. ANSWER FORMAT & SCANNING:
   - LINE 1 (Core Answer): Give a direct 1–2 sentence main answer immediately. The candidate must be able to read this first line out loud instantly.
   - KEY POINTS (2–3 Bullets): If elaboration is needed, use short bullet points highlighting key concepts.
   - BOLD KEYWORDS: **Bold** essential terms so the candidate's eyes can scan the text instantly while speaking.

3. HUMAN & CONVERSATIONAL TONE:
   - Sound like a real developer having a friendly conversation with a colleague—not a textbook, essay, or AI.
   - NEVER use AI filler intros ("Certainly!", "I'd be happy to explain...", "That's a great question", "In the modern software landscape...").
   - Jump STRAIGHT to the answer.
   - Use natural spoken transitions like "Basically...", "So...", "In short...", or simple everyday analogies when helpful.

4. KEEP IT CONCISE:
   - For simple "What is X?" questions: Give a clear 2–3 sentence answer. Don't lecture or over-explain.
   - Aim for an answer that takes 20 to 45 seconds to speak out loud.

5. NO UNNECESSARY CODE BLOCKS FOR CONCEPTUAL QUESTIONS:
   - For verbal conceptual questions (e.g., "What is X?"), DO NOT write out multi-line code blocks unless the interviewer explicitly asks for code or implementation. Reading multi-line code out loud sounds awkward in a live interview. Focus on clear, speakable bullet points and key technical terms.
`
}

const getSolutionSystemPrompt = (
  questionType?: 'leetcode' | 'system-design' | 'other',
  resumeDescription?: string
): string => {
  const resumeText = resumeDescription?.trim() || ''

  if (questionType === 'leetcode') {
    return `You are a candidate solving a coding algorithm problem in a live technical interview.
${resumeText ? `CANDIDATE BACKGROUND:\n${resumeText}\n` : ''}

CRITICAL RULES:
1. Provide a direct, clean coding solution.
2. First explain your approach in 2–3 short, natural sentences.
3. Then provide the clean code implementation with brief comments.
4. Conclude with Time and Space complexity.
5. Sound like a real developer explaining their thought process, not a textbook or tutorial.`
  }

  if (questionType === 'system-design') {
    return `You are a candidate answering a system design or architecture question in a live technical interview.
${resumeText ? `CANDIDATE BACKGROUND:\n${resumeText}\n` : ''}

CRITICAL RULES:
1. DO NOT WRITE CODE BLOCKS OR DUMMY CONTROLLERS. System design is about high-level architecture, components, data flow, and trade-offs.
2. Structure for quick spoken delivery:
   - Line 1: Clear 1–2 sentence high-level architecture summary.
   - Core Components (3–4 bullet points with **bold keywords**): APIs, Storage/Database, Caching, Queue/Workers.
   - Trade-offs & Scalability: Key decisions and why chosen over alternatives.
3. Keep sentences short and conversational so the candidate can speak them naturally.`
  }

  // 'other': Project, conceptual, situational, behavioral, or MCQ questions
  return `You are a candidate answering an interview question live in a real-time job interview. Your response will be spoken out loud by the candidate.
${resumeText ? `CANDIDATE BACKGROUND:\n${resumeText}\n` : ''}

CRITICAL RULES:
1. STRICTLY NO CODE BLOCKS unless the question explicitly asks to write code, implement a function, or write a query.
   - For project questions (e.g. "Technology stack choices for FunPrinting", "Project architecture", "Biggest challenge"), discuss the ARCHITECTURAL REASONS and BUSINESS TRADE-OFFS in clear, spoken English.
   - NEVER write React components, Express endpoints, SQL transaction scripts, or worker loops when asked about tech stack choices or project decisions. Nobody reads code snippets out loud in a verbal interview.
2. SPOKEN INTERVIEW FORMAT:
   - Line 1 (Core Answer): A punchy 1–2 sentence direct answer that the candidate can read out loud immediately.
   - Key Points (3–4 concise bullets with **bold keywords**): The core reasoning (e.g. concurrency, team velocity, ACID transactions, async I/O).
   - Trade-offs / Alternatives (1–2 bullets): Why another option wasn't chosen (e.g. why Node instead of Python).
3. NATURAL & CONCISE:
   - Speak like a confident software engineer talking to a colleague.
   - NO AI filler phrases ("Certainly!", "I'd be happy to explain...", "That's a great question").
   - The entire response should take only 30 to 60 seconds to speak out loud.`
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

  constructor(config: OpenAIConfig) {
    super()
    this.config = config
    this.systemPrompt = getSystemPrompt(config.resumeDescription || '')
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

  async generateAnswer(question: string): Promise<string> {
    const attempts = this.getProviderAttempts()
    if (attempts.length === 0) {
      throw new Error('No API keys configured. Please add an API key in Settings.')
    }

    // Add the question to history
    this.conversationHistory.push({
      role: 'user',
      content: `Interview question: "${question}"\n\nProvide a professional answer:`
    })

    // Trim history if too long
    if (this.conversationHistory.length > this.maxHistoryLength) {
      this.conversationHistory = this.conversationHistory.slice(-this.maxHistoryLength)
    }

    let lastError: unknown = null

    for (let i = 0; i < attempts.length; i++) {
      const attempt = attempts[i]
      let fullResponse = ''

      try {
        if (attempt.provider === 'groq') {
          const client = new OpenAI({
            apiKey: attempt.key,
            baseURL: 'https://api.groq.com/openai/v1'
          })

          const messages: Message[] = [
            { role: 'system', content: this.systemPrompt },
            ...this.conversationHistory
          ]

          // Candidate models: attempt's selected model first, followed by known available models
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
            try {
              stream = await client.chat.completions.create({
                model: candModel,
                messages: messages,
                max_completion_tokens: this.config.maxTokens || 1200,
                temperature: this.config.temperature || 0.7,
                stream: true
              })
              break
            } catch (candErr: any) {
              lastGroqErr = candErr
              console.warn(`Groq model "${candModel}" error (${candErr?.message || 'unknown'}). Retrying next candidate...`)
            }
          }

          if (!stream) {
            throw lastGroqErr
          }

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
              console.warn(`Groq stream ended with unexpected EOF, but preserved response (${fullResponse.length} chars)`)
            } else {
              throw streamErr
            }
          }
        } else if (attempt.provider === 'openai') {
          const client = new OpenAI({
            apiKey: attempt.key
          })

          const messages: Message[] = [
            { role: 'system', content: this.systemPrompt },
            ...this.conversationHistory
          ]

          const stream = await client.chat.completions.create({
            model: attempt.model,
            messages: messages,
            max_completion_tokens: this.config.maxTokens || 1200,
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
              console.warn(`OpenAI stream ended with unexpected EOF, but preserved response (${fullResponse.length} chars)`)
            } else {
              throw streamErr
            }
          }
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
                  systemInstruction: this.systemPrompt,
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
                  systemInstruction: this.systemPrompt,
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
              console.warn(`Gemini stream ended with unexpected EOF, but preserved response (${fullResponse.length} chars)`)
            } else {
              throw streamErr
            }
          }
        }

        // Successfully generated answer
        this.conversationHistory.push({
          role: 'assistant',
          content: fullResponse
        })

        this.emit('complete', fullResponse)
        return fullResponse
      } catch (err: any) {
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
      this.systemPrompt = getSystemPrompt(config.resumeDescription || '')
    }
  }
}
