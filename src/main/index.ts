import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { app, BrowserWindow, globalShortcut, nativeImage, safeStorage, screen, session, shell } from 'electron'
import fs from 'fs'
import path, { join } from 'path'
import icon from '../../resources/icon.png?asset'
import { cleanupIpcHandlers, initializeIpcHandlers } from './ipc/handlers'

let mainWindow: BrowserWindow | null = null

function setupGlobalStealthShortcuts(win: BrowserWindow): void {
  // 1. Instant Screenshot & Solve (Cmd/Ctrl + Shift + S)
  globalShortcut.register('CommandOrControl+Shift+S', () => {
    console.log('[StealthHotkey] Triggered Screenshot & Solve (Cmd/Ctrl+Shift+S)')
    win.webContents.send('trigger-screenshot-solve')
  })

  // 2. Instant Stealth Clear (Cmd/Ctrl + Shift + C) - wipes active answers & transcript
  globalShortcut.register('CommandOrControl+Shift+C', () => {
    console.log('[StealthHotkey] Triggered Stealth Clear (Cmd/Ctrl+Shift+C)')
    win.webContents.send('trigger-stealth-clear')
  })

  // 3. Stealth Panic Toggle (Cmd/Ctrl + Shift + H) - toggle window visibility
  globalShortcut.register('CommandOrControl+Shift+H', () => {
    if (win.isVisible()) {
      console.log('[StealthHotkey] Window hidden (Cmd/Ctrl+Shift+H)')
      win.hide()
    } else {
      console.log('[StealthHotkey] Window shown (Cmd/Ctrl+Shift+H)')
      win.show()
      win.focus()
    }
  })

  // 4. Fine-tune opacity up (Cmd/Ctrl + Shift + Up)
  globalShortcut.register('CommandOrControl+Shift+Up', () => {
    const current = win.getOpacity()
    const next = Math.min(1, Math.round((current + 0.15) * 100) / 100)
    win.setOpacity(next)
    console.log(`[StealthHotkey] Window opacity: ${next}`)
  })

  // 5. Fine-tune opacity down (Cmd/Ctrl + Shift + Down)
  globalShortcut.register('CommandOrControl+Shift+Down', () => {
    const current = win.getOpacity()
    const next = Math.max(0.15, Math.round((current - 0.15) * 100) / 100)
    win.setOpacity(next)
    console.log(`[StealthHotkey] Window opacity: ${next}`)
  })
}

function createWindow(): void {
  const appIcon = nativeImage.createFromPath(icon)

  // Calculate dynamic initial height based on laptop screen work area (approx 75% height)
  const primaryDisplay = screen.getPrimaryDisplay()
  const { height: workAreaHeight } = primaryDisplay.workAreaSize
  const initialHeight = Math.max(550, Math.min(700, Math.floor(workAreaHeight * 0.95)))

  // Create the browser window with screen share protection
  mainWindow = new BrowserWindow({
    width: 620,
    height: initialHeight,
    minWidth: 380,
    minHeight: 500,
    show: false,
    autoHideMenuBar: true,
    frame: false, // Frameless for custom title bar
    transparent: false,
    alwaysOnTop: false, // Set explicitly below with proper level
    skipTaskbar: false,
    resizable: true,
    icon: appIcon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  // ─── PROFESSIONAL OVERLAY PANEL PATTERN ───
  // Same approach used by Parakeet AI, Loom, Discord overlays, etc.
  // Uses OS-level compositor layering instead of basic floating.
  if (process.platform === 'darwin') {
    // macOS: screen-saver level stays above EVERYTHING including fullscreen apps
    mainWindow.setAlwaysOnTop(true, 'screen-saver')
    // Visible on ALL macOS Spaces/Desktops, including fullscreen spaces
    mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    // Prevent macOS from treating this as a fullscreen-capable window
    mainWindow.setFullScreenable(false)
  } else {
    // Windows: screen-saver level sets HWND_TOPMOST at the highest tier
    mainWindow.setAlwaysOnTop(true, 'screen-saver')
  }

  // Enable screen share protection - hides window from screen capture (Zoom, Teams, Meet)
  mainWindow.setContentProtection(true)

  mainWindow.on('ready-to-show', () => {
    if (process.platform === 'win32' && !appIcon.isEmpty()) {
      mainWindow?.setIcon(appIcon)
    }
    mainWindow?.show()
    mainWindow?.focus()
    // Re-verify content protection whenever window is shown
    mainWindow?.setContentProtection(true)
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // Initialize IPC handlers
  initializeIpcHandlers(mainWindow)

  // Setup stealth global shortcuts
  setupGlobalStealthShortcuts(mainWindow)

  // Run immediate background test of configured Groq key to verify API connectivity
  setTimeout(async () => {
    try {
      const settingsPath = path.join(app.getPath('userData'), 'settings.json')
      if (!fs.existsSync(settingsPath)) return
      const s = JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
      const encKey = s.groqApiKeysEncrypted?.[0]
      if (!encKey || !safeStorage.isEncryptionAvailable()) {
        fs.appendFileSync('/tmp/groq_test.log', `[${new Date().toISOString()}] No Groq key found in settings\n`)
        return
      }
      const decKey = safeStorage.decryptString(Buffer.from(encKey, 'base64')).trim()
      fs.appendFileSync(
        '/tmp/groq_test.log',
        `[${new Date().toISOString()}] Startup: Testing Groq key ${decKey.slice(0, 8)}... (model: ${s.groqModel || 'llama-3.3-70b-versatile'})\n`
      )

      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${decKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: s.groqModel || 'llama-3.3-70b-versatile',
          messages: [{ role: 'user', content: 'Say OK' }],
          max_completion_tokens: 5
        })
      })
      const text = await res.text()
      fs.appendFileSync(
        '/tmp/groq_test.log',
        `[${new Date().toISOString()}] Startup Groq test status: ${res.status}, response: ${text}\n`
      )
    } catch (e: any) {
      fs.appendFileSync(
        '/tmp/groq_test.log',
        `[${new Date().toISOString()}] Startup Groq test exception: ${e?.message}\n`
      )
    }
  }, 500)

  // Grant microphone permissions
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    const allowedPermissions = ['media', 'mediaKeySystem', 'audioCapture']
    if (allowedPermissions.includes(permission)) {
      callback(true)
    } else {
      callback(false)
    }
  })

  // HMR for renderer base on electron-vite cli.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// This method will be called when Electron has finished initialization
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.interview-copilot')

  // Default open or close DevTools by F12 in development
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed (including macOS — fully exit on close)
app.on('window-all-closed', () => {
  globalShortcut.unregisterAll()
  cleanupIpcHandlers()
  app.quit()
})

// Cleanup on quit
app.on('before-quit', () => {
  globalShortcut.unregisterAll()
  cleanupIpcHandlers()
})
