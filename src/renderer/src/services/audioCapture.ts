export interface AudioCaptureOptions {
  sampleRate?: number
  channelCount?: number
  echoCancellation?: boolean
  noiseSuppression?: boolean
  autoGainControl?: boolean
}

const DEFAULT_OPTIONS: AudioCaptureOptions = {
  sampleRate: 16000,
  channelCount: 1,
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true
}

export class AudioCaptureService {
  private audioContext: AudioContext | null = null
  private mediaStream: MediaStream | null = null
  private workletNode: AudioWorkletNode | null = null
  private sourceNode: MediaStreamAudioSourceNode | null = null
  private interviewerAnalyser: AnalyserNode | null = null
  private isCapturing = false
  private options: AudioCaptureOptions

  constructor(options: AudioCaptureOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options }
  }

  async startMicrophoneCapture(): Promise<void> {
    if (this.isCapturing) return

    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: this.options.sampleRate,
          channelCount: this.options.channelCount,
          echoCancellation: this.options.echoCancellation,
          noiseSuppression: this.options.noiseSuppression,
          autoGainControl: this.options.autoGainControl
        }
      })

      this.audioContext = new AudioContext({
        sampleRate: this.options.sampleRate
      })

      this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream)
      await this.audioContext.audioWorklet.addModule(this.createWorkletBlobUrl())
      this.workletNode = new AudioWorkletNode(this.audioContext, 'audio-processor')

      this.workletNode.port.onmessage = (event) => {
        if (event.data.audioData) {
          this.handleAudioData(event.data.audioData)
        }
      }

      this.sourceNode.connect(this.workletNode)
      this.isCapturing = true
    } catch (error) {
      console.error('Failed to start microphone capture:', error)
      throw error
    }
  }

  /**
   * Starts Dual-Channel Audio Capture:
   * 1. Interviewer Channel: Captured via desktopCapturer loopback (pure audio from Zoom/Teams/Meet).
   * 2. Candidate Channel: Captured via Microphone for Speaker Separation & Turn Reset.
   */
  async startSystemAudioCapture(sourceId: string): Promise<void> {
    if (this.isCapturing) return

    try {
      // 1. Interviewer Channel (System Audio Loopback)
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          // @ts-ignore - Electron specific constraint
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: sourceId
          }
        },
        video: {
          // @ts-ignore - Electron specific constraint
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: sourceId
          }
        }
      })

      // Remove video track, we only need audio
      this.mediaStream.getVideoTracks().forEach((track) => track.stop())

      this.audioContext = new AudioContext({
        sampleRate: this.options.sampleRate
      })

      this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream)

      // Connect Interviewer Channel to Analyser for real-time acoustic echo & bleed gating
      this.interviewerAnalyser = this.audioContext.createAnalyser()
      this.interviewerAnalyser.fftSize = 512
      this.interviewerAnalyser.smoothingTimeConstant = 0.2
      this.sourceNode.connect(this.interviewerAnalyser)

      await this.audioContext.audioWorklet.addModule(this.createWorkletBlobUrl())
      this.workletNode = new AudioWorkletNode(this.audioContext, 'audio-processor')

      this.workletNode.port.onmessage = (event) => {
        if (event.data.audioData) {
          this.handleAudioData(event.data.audioData)
        }
      }

      this.sourceNode.connect(this.workletNode)

      // Only capture system audio (interviewer channel). Candidate mic is not listened to.
      this.isCapturing = true
    } catch (error) {
      console.error('Failed to start system audio capture:', error)
      throw error
    }
  }

  private createWorkletBlobUrl(): string {
    const workletCode = `
      class AudioProcessor extends AudioWorkletProcessor {
        constructor() {
          super();
          this.bufferSize = 2048; // ~128ms at 16kHz for low latency
          this.buffer = new Float32Array(this.bufferSize);
          this.bufferIndex = 0;
        }

        process(inputs, outputs, parameters) {
          const input = inputs[0];
          if (input && input[0]) {
            const inputData = input[0];
            
            for (let i = 0; i < inputData.length; i++) {
              this.buffer[this.bufferIndex++] = inputData[i];
              
              if (this.bufferIndex >= this.bufferSize) {
                // Convert Float32 to Int16 PCM audio
                const int16Buffer = new Int16Array(this.bufferSize);
                for (let j = 0; j < this.bufferSize; j++) {
                  const s = Math.max(-1, Math.min(1, this.buffer[j]));
                  int16Buffer[j] = s < 0 ? s * 0x8000 : s * 0x7FFF;
                }
                
                this.port.postMessage({
                  audioData: int16Buffer.buffer
                }, [int16Buffer.buffer]);
                
                this.buffer = new Float32Array(this.bufferSize);
                this.bufferIndex = 0;
              }
            }
          }
          return true;
        }
      }

      registerProcessor('audio-processor', AudioProcessor);
    `

    const blob = new Blob([workletCode], { type: 'application/javascript' })
    return URL.createObjectURL(blob)
  }

  private handleAudioData(audioData: ArrayBuffer): void {
    if (window.api) {
      window.api.sendAudioData(audioData)
    }
  }

  async stop(): Promise<void> {
    if (this.interviewerAnalyser) {
      this.interviewerAnalyser.disconnect()
      this.interviewerAnalyser = null
    }

    if (this.workletNode) {
      this.workletNode.disconnect()
      this.workletNode = null
    }

    if (this.sourceNode) {
      this.sourceNode.disconnect()
      this.sourceNode = null
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop())
      this.mediaStream = null
    }

    if (this.audioContext) {
      await this.audioContext.close()
      this.audioContext = null
    }

    this.isCapturing = false
  }

  getIsCapturing(): boolean {
    return this.isCapturing
  }

  getIsCandidateSpeaking(): boolean {
    return false
  }
}
