import { EventEmitter } from 'events'
import OpenAI from 'openai'
import { GoogleGenAI } from '@google/genai'

export interface Message {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface OpenAIConfig {
  apiKey?: string
  groqApiKeys?: string[]
  geminiApiKeys?: string[]
  openaiApiKeys?: string[]
  model?: string
  groqModel?: string
  geminiModel?: string
  maxTokens?: number
  temperature?: number
  resumeDescription?: string
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

const getSolutionSystemPrompt = (questionType?: 'leetcode' | 'system-design' | 'other'): string => {
  if (questionType === 'leetcode') {
    return `You are a candidate solving a coding problem in a real-time interview. The interviewer is watching you think through the problem. Respond as if you're speaking naturally to the interviewer, explaining your thought process as you work through the solution.

CRITICAL - Interview Style:
- Speak conversationally, like you're thinking out loud with the interviewer
- Show your thought process - explain why you're choosing a particular approach
- Be natural and authentic - not overly rehearsed or robotic
- Use casual transitions like "So...", "Okay...", "I think...", "Let me...", "Actually..." when appropriate
- Don't sound like you're reading from a script or tutorial
- Show confidence but also show you're thinking through it

CRITICAL - Answer simplicity:
- For simple questions, give a straightforward, simple answer—NO explanation unless the question specifically asks for one
- If the question is "What is X?" or "Do you know Y?", just answer directly—don't explain unless asked
- Only provide explanations when the question requires understanding "why" or "how", not just "what"
- Match the complexity of your answer to the complexity of the question
- Simple question = simple answer. Complex question = explanation only if needed

CRITICAL - Avoid AI-sounding patterns:
- NEVER start with phrases like "Certainly!", "I'd be happy to...", "Let me explain...", "That's a great question", or "I understand..."
- DON'T be overly helpful or explanatory—just answer the question
- AVOID perfect, overly polished language—real people don't speak like that
- DON'T use phrases that sound like ChatGPT responses
- NO qualifiers like "I think", "I believe", "In my opinion" unless they're genuinely needed
- DON'T over-explain or provide unnecessary context
- AVOID sounding like you're teaching or lecturing—just answer naturally

Structure your response as if you're walking through the problem with the interviewer:

1. **Understanding the Problem**: Briefly restate what you understand the problem is asking. Keep it concise - just show you understand it.

2. **Approach**: Explain your thinking process. Why this approach? What data structures or algorithms come to mind? Talk through your reasoning naturally.

3. **Solution Walkthrough**: Break down the solution step by step, but explain it conversationally. Like "First, I'll...", "Then I need to...", "The tricky part here is..."

4. **Code**: Provide clean, well-commented code. Use the same programming language shown in the screenshot (Python, Java, C++, JavaScript, etc.). Add brief comments for clarity, but don't over-comment.

5. **Complexity**: Mention time and space complexity naturally - "This runs in O(n) time because...", "We're using O(n) space for..."

6. **Edge Cases**: Mention important edge cases you'd consider - "We should handle...", "One thing to watch out for is..."

7. **Alternative Approaches** (if relevant): Briefly mention if there are other ways to solve it, but keep it brief unless the interviewer asks.

Format with clear headings and code blocks, but write the explanations in a conversational, natural tone. Sound like a real candidate explaining their solution, not a textbook or AI assistant.`
  } else if (questionType === 'system-design') {
    return `You are a candidate designing a system in a real-time interview. The interviewer is asking you to design a system, and you're walking through your thought process. Respond as if you're speaking naturally to the interviewer, explaining your design decisions as you think through them.

CRITICAL - Interview Style:
- Speak conversationally, like you're discussing the design with the interviewer
- Show your reasoning - explain WHY you're making design choices
- Ask clarifying questions naturally (but also make reasonable assumptions)
- Be natural and authentic - not overly formal or robotic
- Use transitions like "So...", "I think we need...", "One thing to consider...", "Actually, let me think about..."
- Don't sound like you're reading from a textbook
- Show you understand trade-offs and are thinking critically

CRITICAL - Answer simplicity:
- For simple questions, give a straightforward, simple answer—NO explanation unless the question specifically asks for one
- If the question is "What is X?" or "Do you know Y?", just answer directly—don't explain unless asked
- Only provide explanations when the question requires understanding "why" or "how", not just "what"
- Match the complexity of your answer to the complexity of the question
- Simple question = simple answer. Complex question = explanation only if needed

CRITICAL - Avoid AI-sounding patterns:
- NEVER start with phrases like "Certainly!", "I'd be happy to...", "Let me explain...", "That's a great question", or "I understand..."
- DON'T be overly helpful or explanatory—just answer the question
- AVOID perfect, overly polished language—real people don't speak like that
- DON'T use phrases that sound like ChatGPT responses
- NO qualifiers like "I think", "I believe", "In my opinion" unless they're genuinely needed
- DON'T over-explain or provide unnecessary context
- AVOID sounding like you're teaching or lecturing—just answer naturally

Structure your response as if you're designing the system with the interviewer:

1. **Clarifying Requirements**: Start by asking a few clarifying questions or making reasonable assumptions. Show you're thinking about what the system needs to do. "So I want to make sure I understand...", "I'm assuming we need to handle..."

2. **Scale Estimation**: Roughly estimate the scale. "Let's say we have...", "That means we're looking at roughly...". Keep it practical, not overly precise.

3. **High-Level Architecture**: Walk through the main components. "I'm thinking we'll need...", "The main pieces would be...". Use simple ASCII diagrams if helpful, but keep them simple.

4. **Core Components**: Dive into the key parts:
   - **APIs**: "We'll need endpoints for...", "The main operations are..."
   - **Database**: "For storage, I'm thinking...", "We'll need tables for..."
   - **Caching**: "We should probably cache...", "Redis would help with..."
   - **Load Balancing**: "We'll need load balancers to..."
   - **Other components** as relevant

5. **Trade-offs and Decisions**: Explain your thinking. "I chose X because...", "The trade-off here is...", "We could also do Y, but..."

6. **Scaling Considerations**: Mention how you'd scale further. "If we need to scale, we could...", "One bottleneck might be..."

Format with clear headings, but write the explanations conversationally. Sound like a real engineer discussing a design, not reading from documentation. Be thorough but natural.`
  } else {
    return `You are a candidate answering a technical question in a real-time interview. Respond as if you're speaking naturally to the interviewer, explaining your thought process.

CRITICAL - Interview Style:
- Speak conversationally and naturally
- Show your thinking process
- Be authentic - not overly formal or robotic
- Use natural transitions and explanations
- Don't sound like you're reading from a script

Structure your response:
1. **Understanding**: Briefly show you understand the question
2. **Approach**: Explain your thinking and approach
3. **Solution**: Walk through the solution step by step, conversationally
4. **Details**: Provide code or detailed explanations as needed
5. **Considerations**: Mention edge cases, complexity, or other relevant points

Format with clear headings, but write naturally. Sound like a real candidate explaining their answer, not a textbook.`
  }
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

  private getProviderAttempts(): Array<{
    provider: 'groq' | 'gemini' | 'openai'
    key: string
    model: string
    index: number
  }> {
    const attempts: Array<{
      provider: 'groq' | 'gemini' | 'openai'
      key: string
      model: string
      index: number
    }> = []

    // 1. Groq Keys (Priority 1: Ultra-fast ~150ms answers)
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
      attempts.push({
        provider: 'groq',
        key,
        model: this.config.groqModel || this.config.model || 'llama-3.3-70b-versatile',
        index: idx + 1
      })
    })

    // 2. Gemini Keys (Priority 2: 100% Free Multimodal)
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
      let gModel = this.config.geminiModel || this.config.model || 'gemini-3.5-flash-lite'
      if (gModel.includes('llama') || gModel.includes('gpt')) {
        gModel = 'gemini-3.5-flash-lite'
      }
      attempts.push({
        provider: 'gemini',
        key,
        model: gModel,
        index: idx + 1
      })
    })

    // 3. OpenAI Keys (Priority 3: ChatGPT)
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
      attempts.push({
        provider: 'openai',
        key,
        model: oModel,
        index: idx + 1
      })
    })

    return attempts
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

          const stream = await client.chat.completions.create({
            model: attempt.model,
            messages: messages,
            max_completion_tokens: this.config.maxTokens || 500,
            temperature: this.config.temperature || 0.7,
            stream: true
          })

          for await (const chunk of stream) {
            const content = chunk.choices[0]?.delta?.content || ''
            if (content) {
              fullResponse += content
              this.emit('stream', content)
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
            max_completion_tokens: this.config.maxTokens || 500,
            temperature: this.config.temperature || 0.7,
            stream: true
          })

          for await (const chunk of stream) {
            const content = chunk.choices[0]?.delta?.content || ''
            if (content) {
              fullResponse += content
              this.emit('stream', content)
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
                  maxOutputTokens: this.config.maxTokens || 500,
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
                  maxOutputTokens: this.config.maxTokens || 500,
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

          for await (const chunk of stream) {
            const content = chunk.text || ''
            if (content) {
              fullResponse += content
              this.emit('stream', content)
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
    const solutionPrompt = getSolutionSystemPrompt(questionType)
    const promptText = questionText
      ? `Here is the interview question: "${questionText}"\n\nProvide a detailed step-by-step solution with code examples:`
      : `Analyze this screenshot carefully. Extract the interview question/problem statement from the image, then provide a detailed step-by-step solution with code examples.

First, identify what the question is asking, then provide:
- Problem understanding
- Approach explanation
- Step-by-step solution
- Code implementation with comments
- Complexity analysis`

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
            model: 'llama-3.2-11b-vision-preview',
            messages: messages,
            max_completion_tokens: this.config.maxTokens || 2000,
            temperature: this.config.temperature || 0.7,
            stream: true
          })

          for await (const chunk of stream) {
            const content = chunk.choices[0]?.delta?.content || ''
            if (content) {
              fullResponse += content
              this.emit('stream', content)
            }
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
            max_completion_tokens: this.config.maxTokens || 2000,
            temperature: this.config.temperature || 0.7,
            stream: true
          })

          for await (const chunk of stream) {
            const content = chunk.choices[0]?.delta?.content || ''
            if (content) {
              fullResponse += content
              this.emit('stream', content)
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
              maxOutputTokens: this.config.maxTokens || 2000,
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

          for await (const chunk of stream) {
            const content = chunk.text || ''
            if (content) {
              fullResponse += content
              this.emit('stream', content)
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

  /**
   * Fast, lightweight translation of non-English transcript to clean English.
   * Used in the multilingual pipeline to normalize Hindi/Hinglish/other languages
   * before question detection. Non-streaming for speed.
   */
  async quickTranslate(text: string): Promise<string> {
    const attempts = this.getProviderAttempts()
    if (attempts.length === 0) return text

    const translationPrompt = `Translate the following speech transcript to clear, natural English.
The speaker may be mixing Hindi, Hinglish, or other languages with English (code-switching).
Preserve the original meaning and intent. If it's already in English, return it as-is.
If it sounds like an interview question or instruction, format it as a clear question or instruction.
Return ONLY the translated text, nothing else.

Transcript: "${text}"`

    for (const attempt of attempts) {
      try {
        if (attempt.provider === 'gemini') {
          const ai = new GoogleGenAI({ apiKey: attempt.key })
          const response = await ai.models.generateContent({
            model: attempt.model,
            contents: translationPrompt
          })
          const translated = response.text?.trim()
          if (translated) return translated
        } else {
          // Groq or OpenAI — use OpenAI-compatible API
          const baseURL =
            attempt.provider === 'groq'
              ? 'https://api.groq.com/openai/v1'
              : 'https://api.openai.com/v1'
          const client = new OpenAI({ apiKey: attempt.key, baseURL })
          const response = await client.chat.completions.create({
            model: attempt.model,
            messages: [
              { role: 'system', content: 'You are a fast translator. Output only the translated English text.' },
              { role: 'user', content: translationPrompt }
            ],
            max_tokens: 300,
            temperature: 0.1
          })
          const translated = response.choices?.[0]?.message?.content?.trim()
          if (translated) return translated
        }
      } catch (err) {
        console.warn(`quickTranslate failed with ${attempt.provider} key #${attempt.index}:`, err)
        continue
      }
    }

    // Fallback: return original text if all translation attempts fail
    return text
  }

  updateConfig(config: Partial<OpenAIConfig>): void {
    this.config = { ...this.config, ...config }
    if (config.resumeDescription !== undefined) {
      this.systemPrompt = getSystemPrompt(config.resumeDescription || '')
    }
  }
}
