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

  // Candidate channel (Microphone VAD for Dual-Channel Speaker Separation)
  private candidateStream: MediaStream | null = null
  private candidateSourceNode: MediaStreamAudioSourceNode | null = null
  private candidateAnalyser: AnalyserNode | null = null
  private vadInterval: ReturnType<typeof setInterval> | null = null
  private isCandidateSpeaking = false
  private candidateSpeechFrames = 0
  private candidateSilenceFrames = 0

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
  async startSystemAudioCapture(sourceId: string, enableSpeakerSeparation = false): Promise<void> {
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
      await this.audioContext.audioWorklet.addModule(this.createWorkletBlobUrl())
      this.workletNode = new AudioWorkletNode(this.audioContext, 'audio-processor')

      this.workletNode.port.onmessage = (event) => {
        if (event.data.audioData) {
          this.handleAudioData(event.data.audioData)
        }
      }

      this.sourceNode.connect(this.workletNode)

      // 2. Candidate Channel (Separate Microphone for Speaker Separation, only when explicitly enabled)
      if (enableSpeakerSeparation) {
        try {
          await this.startCandidateMicVad()
        } catch (micErr) {
          console.warn('Microphone not available for dual-channel separation, falling back to system audio only:', micErr)
        }
      }

      this.isCapturing = true
    } catch (error) {
      console.error('Failed to start system audio capture:', error)
      throw error
    }
  }

  /**
   * Initializes Voice Activity Detection (VAD) on the Candidate's microphone.
   * Tracks sustained candidate speech (>3s) to prevent echo bleed and reset turn boundary only upon real answer completion.
   */
  private async startCandidateMicVad(): Promise<void> {
    if (!this.audioContext) return

    this.candidateStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    })

    this.candidateSourceNode = this.audioContext.createMediaStreamSource(this.candidateStream)
    this.candidateAnalyser = this.audioContext.createAnalyser()
    this.candidateAnalyser.fftSize = 512
    this.candidateAnalyser.smoothingTimeConstant = 0.2

    // Connect mic to analyser ONLY (do NOT connect to audioContext.destination to avoid feedback)
    this.candidateSourceNode.connect(this.candidateAnalyser)

    const buffer = new Float32Array(this.candidateAnalyser.fftSize)
    let ambientNoiseFloor = 0.02
    let calibrationFrames = 0
    let speechStartTime = 0

    this.candidateSpeechFrames = 0
    this.candidateSilenceFrames = 0
    this.isCandidateSpeaking = false

    this.vadInterval = setInterval(() => {
      if (!this.candidateAnalyser) return

      this.candidateAnalyser.getFloatTimeDomainData(buffer)
      let sum = 0
      for (let i = 0; i < buffer.length; i++) {
        sum += buffer[i] * buffer[i]
      }
      const rms = Math.sqrt(sum / buffer.length)

      // First 20 frames (~1 sec): calibrate ambient noise
      if (calibrationFrames < 20) {
        calibrationFrames++
        ambientNoiseFloor = Math.max(ambientNoiseFloor, rms)
        return
      }

      // Threshold: at least 0.07, or 2.5x ambient noise floor to prevent speaker bleed
      const threshold = Math.max(0.07, ambientNoiseFloor * 2.5)

      if (rms > threshold) {
        this.candidateSpeechFrames++
        this.candidateSilenceFrames = 0

        // Candidate must speak continuously for >= 750ms (15 frames) to count as real speech
        if (this.candidateSpeechFrames >= 15 && !this.isCandidateSpeaking) {
          this.isCandidateSpeaking = true
          speechStartTime = Date.now()
          console.log('[AudioCapture] 🎙️ Candidate speaking detected (Microphone active)')
          if (window.api?.sendCandidateSpeakingState) {
            window.api.sendCandidateSpeakingState(true)
          }
        }
      } else {
        this.candidateSilenceFrames++
        this.candidateSpeechFrames = 0

        // If candidate silent for ~1250ms (25 frames of 50ms) after sustained speech
        if (this.candidateSilenceFrames >= 25 && this.isCandidateSpeaking) {
          const duration = Date.now() - speechStartTime
          const wasSubstantialAnswer = duration >= 3000 // Only count as completed answer if sustained >= 3s
          this.isCandidateSpeaking = false
          console.log(`[AudioCapture] 🤫 Candidate finished speaking (${duration}ms, answer: ${wasSubstantialAnswer})`)
          if (window.api?.sendCandidateSpeakingState) {
            window.api.sendCandidateSpeakingState(false, wasSubstantialAnswer)
          }
        }
      }
    }, 50)
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
    if (this.vadInterval) {
      clearInterval(this.vadInterval)
      this.vadInterval = null
    }

    if (this.candidateAnalyser) {
      this.candidateAnalyser.disconnect()
      this.candidateAnalyser = null
    }

    if (this.candidateSourceNode) {
      this.candidateSourceNode.disconnect()
      this.candidateSourceNode = null
    }

    if (this.candidateStream) {
      this.candidateStream.getTracks().forEach((track) => track.stop())
      this.candidateStream = null
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

    if (this.isCandidateSpeaking) {
      this.isCandidateSpeaking = false
      if (window.api?.sendCandidateSpeakingState) {
        window.api.sendCandidateSpeakingState(false)
      }
    }

    this.isCapturing = false
  }

  getIsCapturing(): boolean {
    return this.isCapturing
  }

  getIsCandidateSpeaking(): boolean {
    return this.isCandidateSpeaking
  }
}
