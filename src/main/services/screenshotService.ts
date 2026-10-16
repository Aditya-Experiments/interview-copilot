import { BrowserWindow, desktopCapturer, screen } from 'electron'
import { compressNativeImage } from './imageCompressor'

export interface ScreenshotResult {
  success: boolean
  imageData?: string // base64 data URL
  error?: string
}

/**
 * Service to capture screenshots of the active screen or window
 */
export class ScreenshotService {
  private appWindow?: BrowserWindow
  private appWindowTitle?: string

  constructor(appWindow?: BrowserWindow) {
    this.appWindow = appWindow
    if (appWindow) {
      this.appWindowTitle = appWindow.getTitle()
    }
  }

  public setWindow(appWindow: BrowserWindow): void {
    this.appWindow = appWindow
    this.appWindowTitle = appWindow.getTitle()
  }

  /**
   * Captures the screen currently viewed by the user.
   * Temporarily fades out the Copilot window so it does not obstruct interview questions underneath.
   * @returns Base64 encoded image data URL
   */
  async captureActiveWindow(): Promise<ScreenshotResult> {
    const win = this.appWindow && !this.appWindow.isDestroyed() ? this.appWindow : null
    let prevOpacity = 1

    try {
      // 1. Temporarily make Copilot transparent so questions underneath are fully visible to vision AI
      if (win) {
        prevOpacity = win.getOpacity()
        win.setOpacity(0)
        // Wait 80ms for OS compositor (macOS WindowServer / DWM) to repaint background without Copilot
        await new Promise((resolve) => setTimeout(resolve, 80))
      }

      // 2. Identify the target display (the display containing the Copilot app or cursor)
      const targetDisplay = win
        ? screen.getDisplayMatching(win.getBounds())
        : screen.getDisplayNearestPoint(screen.getCursorScreenPoint()) || screen.getPrimaryDisplay()

      const scaleFactor = targetDisplay.scaleFactor || 2
      const captureWidth = Math.round(targetDisplay.bounds.width * scaleFactor)
      const captureHeight = Math.round(targetDisplay.bounds.height * scaleFactor)

      console.log(`[ScreenshotService] Capturing screen for display: ${targetDisplay.id} (${captureWidth}x${captureHeight})`)

      // 3. Capture screen sources directly - captures what is ACTUALLY in front of user's eyes
      const screenSources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: captureWidth, height: captureHeight },
        fetchWindowIcons: false
      })

      if (screenSources.length > 0) {
        // Find matching display or fall back to primary screen
        const matchingSource =
          screenSources.find((s) => s.display_id === targetDisplay.id.toString()) ||
          screenSources[0]

        if (matchingSource && matchingSource.thumbnail && !matchingSource.thumbnail.isEmpty()) {
          console.log(`[ScreenshotService] Successfully captured screen: ${matchingSource.name}`)
          const compressed = compressNativeImage(matchingSource.thumbnail, 1600, 82)
          return {
            success: true,
            imageData: compressed.dataUrl
          }
        }
      }

      // 4. Fallback if screen sources are empty: Query individual windows
      console.warn('[ScreenshotService] Screen sources empty, falling back to window capture...')
      const windowSources = await desktopCapturer.getSources({
        types: ['window'],
        thumbnailSize: { width: 1920, height: 1080 },
        fetchWindowIcons: false
      })

      // Exclude Copilot app and electron devtools
      const winTitle = this.appWindowTitle?.toLowerCase() || ''
      const filteredSources = windowSources.filter((s) => {
        const name = s.name.toLowerCase()
        return (
          !name.includes('interview copilot') &&
          !name.includes('interview-copilot') &&
          !name.includes('electron') &&
          (!winTitle || !name.includes(winTitle))
        )
      })

      // Exclude background chat and media apps (WhatsApp, Telegram, Discord, Slack, Spotify, etc.)
      const nonChatSources = filteredSources.filter((s) => {
        const name = s.name.toLowerCase()
        return (
          !name.includes('whatsapp') &&
          !name.includes('telegram') &&
          !name.includes('discord') &&
          !name.includes('slack') &&
          !name.includes('spotify')
        )
      })

      // Prioritize active browsers or test portals
      const browserKeywords = ['chrome', 'edge', 'firefox', 'safari', 'opera', 'brave', 'interview', 'test', 'practice']
      const bestCandidate =
        nonChatSources.find((s) => {
          const name = s.name.toLowerCase()
          return browserKeywords.some((k) => name.includes(k))
        }) ||
        nonChatSources[0] ||
        filteredSources[0]

      if (bestCandidate && bestCandidate.thumbnail && !bestCandidate.thumbnail.isEmpty()) {
        console.log(`[ScreenshotService] Captured fallback window: ${bestCandidate.name}`)
        const compressed = compressNativeImage(bestCandidate.thumbnail, 1600, 82)
        return {
          success: true,
          imageData: compressed.dataUrl
        }
      }

      return {
        success: false,
        error: 'No active display or window found to capture.'
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
      console.error('[ScreenshotService] Screenshot capture error:', errorMessage)
      return {
        success: false,
        error: errorMessage
      }
    } finally {
      // Always restore Copilot window opacity immediately
      if (win && !win.isDestroyed()) {
        win.setOpacity(prevOpacity)
      }
    }
  }

  /**
   * Captures a specific window by name
   */
  async captureWindowByName(windowName: string): Promise<ScreenshotResult> {
    try {
      const sources = await desktopCapturer.getSources({
        types: ['window'],
        thumbnailSize: { width: 1920, height: 1080 },
        fetchWindowIcons: false
      })

      const matchingSource = sources.find((source) =>
        source.name.toLowerCase().includes(windowName.toLowerCase())
      )

      if (!matchingSource || !matchingSource.thumbnail) {
        return {
          success: false,
          error: `Window "${windowName}" not found`
        }
      }

      const compressed = compressNativeImage(matchingSource.thumbnail, 1600, 82)
      return {
        success: true,
        imageData: compressed.dataUrl
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
      console.error('[ScreenshotService] Error capturing window by name:', errorMessage)
      return {
        success: false,
        error: errorMessage
      }
    }
  }
}

