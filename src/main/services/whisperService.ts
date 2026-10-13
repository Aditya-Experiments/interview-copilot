import { EventEmitter } from 'events'
import * as fs from 'fs'
import OpenAI from 'openai'
import { GoogleGenAI } from '@google/genai'
import * as os from 'os'
import * as path from 'path'

export interface TranscriptEvent {
  text: string
  isFinal: boolean
  confidence: number
}

export interface WhisperConfig {
  apiKey: string
  model?: string
  language?: string
}

export class WhisperService extends EventEmitter {
  private client: OpenAI | null = null
  private config: WhisperConfig
  private audioBuffer: Buffer[] = []
  private isProcessing = false
  private isRunning = false
  private processInterval: NodeJS.Timeout | null = null
  private lastAudioTime = 0
  private readonly SAMPLE_RATE = 16000
  private readonly BYTES_PER_SAMPLE = 2 // 16-bit audio
  private readonly MIN_AUDIO_DURATION_MS = 800 // Minimum 800ms of audio (avoids micro-noise hallucinations)
  private readonly SILENCE_THRESHOLD_MS = 600 // 600ms of silence before processing
  private readonly MAX_BUFFER_DURATION_MS = 15000 // Max 15 seconds before forced processing

  constructor(config: WhisperConfig) {
    super()
    this.config = config
    const apiKeyTrimmed = config.apiKey?.trim() || ''
    if (apiKeyTrimmed.startsWith('gsk_')) {
      this.client = new OpenAI({
        apiKey: apiKeyTrimmed,
        baseURL: 'https://api.groq.com/openai/v1'
      })
    } else if (apiKeyTrimmed.startsWith('sk-')) {
      this.client = new OpenAI({ apiKey: apiKeyTrimmed })
    }
  }

  start(): void {
    if (this.isRunning) return

    this.isRunning = true
    this.audioBuffer = []
    this.lastAudioTime = Date.now()

    // Check for silence every 100ms for rapid dispatch
    this.processInterval = setInterval(() => {
      this.checkAndProcess()
    }, 100)

    console.log('WhisperService started')
    this.emit('started')
  }

  stop(): void {
    this.isRunning = false

    if (this.processInterval) {
      clearInterval(this.processInterval)
      this.processInterval = null
    }

    // Process any remaining audio
    if (this.audioBuffer.length > 0) {
      this.processAudioBuffer()
    }

    this.audioBuffer = []
    console.log('WhisperService stopped')
    this.emit('stopped')
  }

  addAudioData(audioData: Buffer | ArrayBuffer): void {
    if (!this.isRunning) return

    const buffer = audioData instanceof ArrayBuffer ? Buffer.from(audioData) : audioData

    // Check if this chunk has actual audio (not silence)
    if (this.hasAudio(buffer)) {
      this.audioBuffer.push(buffer)
      this.lastAudioTime = Date.now()
    }
  }

  // Check if audio buffer contains actual sound (not silence)
  private hasAudio(buffer: Buffer): boolean {
    // Calculate RMS (root mean square) to detect if there's actual audio
    let sum = 0
    const samples = buffer.length / this.BYTES_PER_SAMPLE

    for (let i = 0; i < buffer.length; i += 2) {
      const sample = buffer.readInt16LE(i)
      sum += sample * sample
    }

    const rms = Math.sqrt(sum / samples)
    // Threshold for considering it as actual audio vs silence
    return rms > 500
  }

  private getBufferDurationMs(): number {
    const totalBytes = this.audioBuffer.reduce((sum, buf) => sum + buf.length, 0)
    const samples = totalBytes / this.BYTES_PER_SAMPLE
    return (samples / this.SAMPLE_RATE) * 1000
  }

  private checkAndProcess(): void {
    if (this.isProcessing || !this.isRunning) return

    const bufferDuration = this.getBufferDurationMs()
    const timeSinceLastAudio = Date.now() - this.lastAudioTime

    // Process if:
    // 1. We have enough audio AND enough silence has passed
    // 2. OR buffer is getting too large (force process)
    const hasEnoughAudio = bufferDuration >= this.MIN_AUDIO_DURATION_MS
    const hasSilence = timeSinceLastAudio >= this.SILENCE_THRESHOLD_MS
    const bufferTooLarge = bufferDuration >= this.MAX_BUFFER_DURATION_MS

    if ((hasEnoughAudio && hasSilence) || bufferTooLarge) {
      console.log(
        `===> Processing: ${(bufferDuration / 1000).toFixed(2)}s audio, ${(timeSinceLastAudio / 1000).toFixed(2)}s since last audio`
      )
      this.processAudioBuffer()
    }
  }

  private async processAudioBuffer(): Promise<void> {
    if (this.audioBuffer.length === 0 || this.isProcessing) return

    this.isProcessing = true

    // Combine all buffers
    const combinedBuffer = Buffer.concat(this.audioBuffer)
    this.audioBuffer = []

    // Skip if audio is too short
    const durationMs = (combinedBuffer.length / this.BYTES_PER_SAMPLE / this.SAMPLE_RATE) * 1000
    if (durationMs < this.MIN_AUDIO_DURATION_MS) {
      console.log(`===> Skipping: audio too short (${(durationMs / 1000).toFixed(2)}s)`)
      this.isProcessing = false
      return
    }

    try {
      // Create WAV file from raw PCM data
      const wavBuffer = this.createWavBuffer(combinedBuffer)

      let text = ''
      const apiKeyTrimmed = (this.config.apiKey || '').trim()
      const isGroq = apiKeyTrimmed.startsWith('gsk_')
      const isOpenAI = apiKeyTrimmed.startsWith('sk-')

      if (isGroq || isOpenAI) {
        if (!this.client) {
          throw new Error('STT client not initialized')
        }

        const tempFile = path.join(os.tmpdir(), `whisper_${Date.now()}.wav`)
        fs.writeFileSync(tempFile, wavBuffer)

        // Use whisper-large-v3 (32 layers, highest Hindi/multilingual accuracy)
        // Set language: 'hi' so Whisper doesn't misidentify Hindi and hallucinate Chinese/Korean
        // Hindi mode handles English words and technical terms (Hinglish) naturally
        const sttModel = isGroq ? 'whisper-large-v3' : (this.config.model || 'whisper-1')
        const language = this.config.language || 'hi'
        console.log(
          `===> Sending ${(durationMs / 1000).toFixed(2)}s of audio to ${isGroq ? 'Groq' : 'OpenAI'} Whisper (${sttModel}) [lang: ${language}]...`
        )

        const transcription = await this.client.audio.transcriptions.create({
          file: fs.createReadStream(tempFile),
          model: sttModel,
          language: language,
          temperature: 0.0,
          prompt:
            'Hindi and English interview conversation, bilingual transcription in Devanagari and English. हिंदी और अंग्रेजी साक्षात्कार वार्तालाप। Hello, namaste, technical discussion.',
          response_format: 'json'
        })

        if (fs.existsSync(tempFile)) {
          fs.unlinkSync(tempFile)
        }

        text = transcription.text?.trim() || ''
      } else {
        console.log(`===> Sending ${(durationMs / 1000).toFixed(2)}s of audio to Gemini Audio API...`)
        const ai = new GoogleGenAI({ apiKey: apiKeyTrimmed })
        const parts = [
          {
            inlineData: {
              mimeType: 'audio/wav',
              data: wavBuffer.toString('base64')
            }
          },
          {
            text: 'Transcribe this spoken audio verbatim in Hindi or English (Hinglish). If Hindi is spoken, write in Hindi or clear Devanagari/Hinglish. If English, write in English. Do not translate. Output ONLY the transcribed text. If there is only silence, background noise, or no clear speech, output nothing.'
          }
        ]

        let response
        try {
          response = await ai.models.generateContent({
            model: 'gemini-2.5-flash-lite',
            contents: [{ role: 'user', parts }],
            config: { temperature: 0.0 }
          })
        } catch {
          response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: [{ role: 'user', parts }],
            config: { temperature: 0.0 }
          })
        }

        text = response.text?.trim() || ''
      }

      if (text && text.length > 0) {
        // Filter out common noise transcriptions and hallucinations
        if (this.isNoise(text)) {
          console.log(`Filtered noise / hallucination: "${text}"`)
        } else {
          console.log(`Transcription: "${text}"`)

          const event: TranscriptEvent = {
            text: text,
            isFinal: true,
            confidence: 1.0
          }

          this.emit('transcript', event)
          this.emit('utteranceEnd')
        }
      }
    } catch (error) {
      console.error('Whisper transcription error:', error)
      this.emit('error', error instanceof Error ? error : new Error('Transcription failed'))
    } finally {
      this.isProcessing = false
    }
  }

  // Filter out common noise and Whisper hallucinations
  private isNoise(text: string): boolean {
    const trimmed = text.trim()

    // Filter out empty or single character artifacts
    if (!trimmed || trimmed.length <= 1) {
      return true
    }

    // Filter out Chinese, Japanese, Korean, Cyrillic hallucinations when speaking Hindi/English
    // Chinese/Kanji: \u4e00-\u9fff, Japanese: \u3040-\u30ff, Korean: \uac00-\ud7af, \u1100-\u11ff, Cyrillic: \u0400-\u04ff
    if (/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af\u1100-\u11ff\u0400-\u04ff]/.test(trimmed)) {
      return true
    }

    // Filter out repetition loops (e.g. repeating characters like "加加加加加" or "aaaaa")
    if (/(.)\1{3,}/u.test(trimmed)) {
      return true
    }
    // Filter out repeated words (e.g. "word word word word")
    if (/(\b\p{L}+\b)(?:\s+\1){3,}/iu.test(trimmed)) {
      return true
    }

    const noisePatterns = [
      /^you+\.?$/i,
      /^\.+$/,
      /^[,.\s]+$/,
      /^(um+|uh+|ah+|oh+|hmm+)\.?$/i,
      /^(bye|hi|hello|hey)\.?$/i,
      /^thank(s| you)\.?$/i,
      /^okay\.?$/i,
      /^(yes|no|yeah|yep|nope)\.?$/i,
      /^good\.?$/i,
      /^right\.?$/i,
      /^(subs|subtitles) by/i,
      /^www\./i,
      /^\[.*\]$/, // [Music], [Applause], etc.
      /^♪.*♪$/
    ]

    for (const pattern of noisePatterns) {
      if (pattern.test(trimmed)) {
        return true
      }
    }

    return false
  }

  private createWavBuffer(pcmData: Buffer): Buffer {
    // WAV header for 16-bit mono PCM at 16kHz
    const numChannels = 1
    const sampleRate = this.SAMPLE_RATE
    const bitsPerSample = 16
    const byteRate = sampleRate * numChannels * (bitsPerSample / 8)
    const blockAlign = numChannels * (bitsPerSample / 8)
    const dataSize = pcmData.length
    const headerSize = 44

    const header = Buffer.alloc(headerSize)

    // RIFF header
    header.write('RIFF', 0)
    header.writeUInt32LE(dataSize + headerSize - 8, 4)
    header.write('WAVE', 8)

    // fmt chunk
    header.write('fmt ', 12)
    header.writeUInt32LE(16, 16) // Subchunk1Size for PCM
    header.writeUInt16LE(1, 20) // AudioFormat (1 = PCM)
    header.writeUInt16LE(numChannels, 22)
    header.writeUInt32LE(sampleRate, 24)
    header.writeUInt32LE(byteRate, 28)
    header.writeUInt16LE(blockAlign, 32)
    header.writeUInt16LE(bitsPerSample, 34)

    // data chunk
    header.write('data', 36)
    header.writeUInt32LE(dataSize, 40)

    return Buffer.concat([header, pcmData])
  }

  // Force-process current buffer immediately without waiting for silence
  forceProcess(): void {
    if (this.audioBuffer.length > 0 && !this.isProcessing) {
      console.log('Force processing audio buffer immediately...')
      this.processAudioBuffer()
    }
  }

  getIsRunning(): boolean {
    return this.isRunning
  }
}
