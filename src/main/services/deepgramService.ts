import { DeepgramClient } from '@deepgram/sdk'
import { EventEmitter } from 'events'

export interface DeepgramTranscriptEvent {
  text: string
  isFinal: boolean
  confidence: number
}

export interface DeepgramConfig {
  apiKey: string
  model?: string
  language?: string
  endpointing?: number
  utteranceEndMs?: number
}

export class DeepgramService extends EventEmitter {
  private client: DeepgramClient | null = null
  private connection: any = null
  private config: DeepgramConfig
  private isRunning = false
  private keepAliveInterval: NodeJS.Timeout | null = null

  constructor(config: DeepgramConfig) {
    super()
    this.config = config
  }

  async start(): Promise<void> {
    if (this.isRunning) return

    const apiKey = this.config.apiKey?.trim()
    if (!apiKey) {
      throw new Error('Deepgram API key is missing')
    }

    try {
      this.client = new DeepgramClient({ apiKey })
      this.connection = await this.client.listen.v1.connect({
        model: (this.config.model || 'nova-2') as any,
        language: (this.config.language || 'multi') as any,
        encoding: 'linear16' as any,
        sample_rate: 16000 as any,
        channels: 1 as any,
        smart_format: 'true' as any,
        interim_results: 'true' as any,
        endpointing: (this.config.endpointing || 1500) as any,
        utterance_end_ms: (this.config.utteranceEndMs || 1500) as any,
        vad_events: 'true' as any,
        reconnectAttempts: 3
      } as any)

      this.connection.on('open', () => {
        console.log('===> Deepgram Nova-2 live WebSocket connected')
        this.emit('started')
      })

      this.connection.on('message', (data: any) => {
        if (!data) return

        if (data.type === 'SpeechStarted') {
          this.emit('speechStarted')
          return
        }

        if (data.type === 'UtteranceEnd') {
          this.emit('utteranceEnd')
          return
        }

        if (data.type === 'Results') {
          const alternative = data.channel?.alternatives?.[0]
          const transcript = alternative?.transcript?.trim()
          if (transcript) {
            const isFinal = Boolean(data.is_final || data.speech_final)
            const confidence = alternative?.confidence || 0.95
            this.emit('transcript', {
              text: transcript,
              isFinal,
              confidence
            })
          }
        }
      })

      this.connection.on('error', (err: any) => {
        console.error('Deepgram WebSocket error:', err)
        this.emit('error', err)
      })

      this.connection.on('close', () => {
        console.log('Deepgram WebSocket closed')
      })

      // In Deepgram SDK v5, connect() activates the start-closed socket
      if (typeof this.connection.connect === 'function') {
        this.connection.connect()
      }
      if (typeof this.connection.waitForOpen === 'function') {
        await this.connection.waitForOpen()
      }

      // Send keep-alive ping every 8 seconds if no audio is streamed
      this.keepAliveInterval = setInterval(() => {
        if (this.connection && this.isRunning && this.connection.socket?.readyState === 1) {
          try {
            this.connection.sendKeepAlive({ type: 'KeepAlive' } as any)
          } catch {
            // Ignore keepalive error
          }
        }
      }, 8000)

      this.isRunning = true
    } catch (err) {
      console.error('Failed to connect to Deepgram Nova-2:', err)
      this.stop()
      throw err
    }
  }

  stop(): void {
    this.isRunning = false

    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval)
      this.keepAliveInterval = null
    }

    if (this.connection) {
      try {
        if (this.connection.socket?.readyState === 1) {
          this.connection.sendCloseStream({ type: 'CloseStream' } as any)
        }
        this.connection.close()
      } catch {
        // Ignore close error
      }
      this.connection = null
    }

    this.emit('stopped')
  }

  addAudioData(audioData: Buffer | ArrayBuffer): void {
    if (!this.isRunning || !this.connection) return
    // Only send if socket is in OPEN state (1)
    if (this.connection.socket && this.connection.socket.readyState !== 1) return

    try {
      const buffer = audioData instanceof ArrayBuffer ? Buffer.from(audioData) : audioData
      this.connection.sendMedia(buffer)
    } catch (err) {
      console.error('Error sending audio chunk to Deepgram:', err)
    }
  }
}
