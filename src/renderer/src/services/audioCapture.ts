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
  private lastInterviewerSpeechTime = 0

  // Candidate channel (Microphone VAD for Dual-Channel Speaker Separation)
  private candidateStream: MediaStream | null = null
  private candidateSourceNode: MediaStreamAudioSourceNode | null = null
  private candidateAnalyser: AnalyserNode | null = null
  private vadInterval: ReturnType<typeof setInterval> | null = null
  private isCandidateSpeaking = false
  private candidateSpeechFrames = 0
  private candidateSilenceFrames = 0
  private candidateSpeechStartTime = 0

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

      // 2. Candidate Channel (Separate Microphone for Speaker Separation)
      try {
        await this.startCandidateMicVad()
      } catch (micErr) {
        console.warn('Microphone not available for dual-channel separation, falling back to system audio only:', micErr)
      }

      this.isCapturing = true
    } catch (error) {
      console.error('Failed to start system audio capture:', error)
      throw error
    }
  }

  /**
   * Initializes Voice Activity Detection (VAD) on the Candidate's microphone.
   * Prevents candidate speech from triggering AI and resets turn boundary when candidate finishes.
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

    const candidateBuffer = new Float32Array(this.candidateAnalyser.fftSize)
    const interviewerBuffer = this.interviewerAnalyser ? new Float32Array(this.interviewerAnalyser.fftSize) : null

    let noiseFloor = 0.015
    this.candidateSpeechFrames = 0
    this.candidateSilenceFrames = 0
    this.candidateSpeechStartTime = 0
    this.isCandidateSpeaking = false

    this.vadInterval = setInterval(() => {
      if (!this.candidateAnalyser) return

      // 1. Measure Interviewer Channel Energy (System Audio Loopback)
      let interviewerRms = 0
      if (this.interviewerAnalyser && interviewerBuffer) {
        this.interviewerAnalyser.getFloatTimeDomainData(interviewerBuffer)
        let intSum = 0
        for (let i = 0; i < interviewerBuffer.length; i++) {
          intSum += interviewerBuffer[i] * interviewerBuffer[i]
        }
        interviewerRms = Math.sqrt(intSum / interviewerBuffer.length)
      }

      // Track if interviewer audio is currently playing through the computer speakers
      const isInterviewerSpeaking = interviewerRms > 0.008
      if (isInterviewerSpeaking) {
        this.lastInterviewerSpeechTime = Date.now()
      }

      // 2. Measure Candidate Microphone Energy
      this.candidateAnalyser.getFloatTimeDomainData(candidateBuffer)
      let micSum = 0
      for (let i = 0; i < candidateBuffer.length; i++) {
        micSum += candidateBuffer[i] * candidateBuffer[i]
      }
      const candidateRms = Math.sqrt(micSum / candidateBuffer.length)

      // 3. Parakeet AI Acoustic Gate / Bleed Suppression:
      // When the interviewer is speaking (or spoke within the last 800ms hangover window),
      // ANY sound picked up by the microphone is speaker acoustic bleed and MUST BE IGNORED.
      const timeSinceInterviewerAudio = Date.now() - this.lastInterviewerSpeechTime
      const isInterviewerActive = isInterviewerSpeaking || timeSinceInterviewerAudio < 800

      if (isInterviewerActive) {
        // Speaker bleed active - candidate cannot be speaking right now
        this.candidateSpeechFrames = 0
        if (this.isCandidateSpeaking) {
          this.isCandidateSpeaking = false
          console.log('[AudioCapture] 🛡️ Interviewer active ──> Suppressing candidate mic bleed')
          if (window.api?.sendCandidateSpeakingState) {
            window.api.sendCandidateSpeakingState(false, false)
          }
        }
        // Update noise floor baseline tracking
        noiseFloor = noiseFloor * 0.95 + candidateRms * 0.05
        return
      }

      // 4. Candidate VAD when interviewer is genuinely silent
      const dynamicThreshold = Math.max(0.038, noiseFloor * 2.8)

      if (candidateRms > dynamicThreshold) {
        this.candidateSpeechFrames++
        this.candidateSilenceFrames = 0

        // Require at least 5 sustained frames (250ms) of speech during interviewer silence
        if (this.candidateSpeechFrames >= 5 && !this.isCandidateSpeaking) {
          this.isCandidateSpeaking = true
          this.candidateSpeechStartTime = Date.now()
          console.log('[AudioCapture] 🎙️ Candidate speaking detected (Interviewer is silent)')
          if (window.api?.sendCandidateSpeakingState) {
            window.api.sendCandidateSpeakingState(true)
          }
        }
      } else {
        noiseFloor = noiseFloor * 0.95 + candidateRms * 0.05
        this.candidateSilenceFrames++
        this.candidateSpeechFrames = 0

        // Candidate finished answering (silent for 1000ms after speaking)
        if (this.candidateSilenceFrames >= 20 && this.isCandidateSpeaking) {
          this.isCandidateSpeaking = false
          const speechDurationMs = Date.now() - this.candidateSpeechStartTime
          const wasRealAnswer = speechDurationMs >= 2500 // At least 2.5s to be an actual answer

          console.log(
            `[AudioCapture] 🤫 Candidate stopped speaking (${speechDurationMs}ms, wasAnswer: ${wasRealAnswer})`
          )
          if (window.api?.sendCandidateSpeakingState) {
            window.api.sendCandidateSpeakingState(false, wasRealAnswer)
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

    if (this.interviewerAnalyser) {
      this.interviewerAnalyser.disconnect()
      this.interviewerAnalyser = null
    }
    this.lastInterviewerSpeechTime = 0

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
