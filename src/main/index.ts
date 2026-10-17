import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { app, BrowserWindow, globalShortcut, nativeImage, screen, session, shell } from 'electron'
import { join } from 'path'
import icon from '../../resources/icon.png?asset'
import { cleanupIpcHandlers, initializeIpcHandlers } from './ipc/handlers'

let mainWindow: BrowserWindow | null = null

function setupGlobalStealthShortcuts(win: BrowserWindow): void {
  let isStealthHidden = false
  let savedOpacity = 1

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

  // 3. Stealth Panic Toggle (Cmd/Ctrl + Shift + H) - Zero-Focus-Steal Hide/Unhide
  // Keeps the browser tab 100% focused and active at all times without triggering blur events
  globalShortcut.register('CommandOrControl+Shift+H', () => {
    if (win.isDestroyed()) return

    if (!isStealthHidden && win.isVisible() && win.getOpacity() > 0) {
      console.log('[StealthHotkey] Window stealth-hidden without focus change (Cmd/Ctrl+Shift+H)')
      isStealthHidden = true
      savedOpacity = win.getOpacity() > 0 ? win.getOpacity() : (savedOpacity || 1)
      if (win.isFocused()) {
        win.blur()
      }
      // Set opacity to 0 and forward mouse events so it's 100% invisible and clicks pass through to browser
      win.setOpacity(0)
      win.setIgnoreMouseEvents(true, { forward: true })
    } else {
      console.log('[StealthHotkey] Window stealth-shown without stealing focus (Cmd/Ctrl+Shift+H)')
      isStealthHidden = false
      if (!win.isVisible()) {
        win.showInactive()
      }
      if (process.platform === 'darwin') {
        win.setAlwaysOnTop(true, 'screen-saver')
        win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
      } else {
        win.setAlwaysOnTop(true, 'screen-saver')
      }
      win.setContentProtection(true)
      win.setIgnoreMouseEvents(false)
      win.setOpacity(savedOpacity > 0 ? savedOpacity : 1)
    }
  })

  // 4. Fine-tune opacity up (Cmd/Ctrl + Shift + Up)
  globalShortcut.register('CommandOrControl+Shift+Up', () => {
    if (win.isDestroyed()) return
    const current = win.getOpacity()
    const next = Math.min(1, Math.round((current + 0.15) * 100) / 100)
    win.setOpacity(next)
    savedOpacity = next
    isStealthHidden = false
    win.setIgnoreMouseEvents(false)
    console.log(`[StealthHotkey] Window opacity: ${next}`)
  })

  // 5. Fine-tune opacity down (Cmd/Ctrl + Shift + Down)
  globalShortcut.register('CommandOrControl+Shift+Down', () => {
    if (win.isDestroyed()) return
    const current = win.getOpacity()
    const next = Math.max(0.15, Math.round((current - 0.15) * 100) / 100)
    win.setOpacity(next)
    savedOpacity = next
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
    mainWindow?.showInactive()
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
