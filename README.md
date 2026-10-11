# Real-Time Interview Copilot

An AI-powered cross-platform desktop application (Windows, macOS, Linux) that acts as a real-time interview assistant. The app listens to live interview audio, transcribes speech, detects questions using smart linguistic heuristics, and generates concise, speakable answers using Google Gemini 3.1 Flash Lite (Free) or OpenAI.

[![Download Latest Release](https://img.shields.io/github/v/release/Aditya-Experiments/interview-copilot?label=Download%20Latest%20Release&color=blue)](https://github.com/Aditya-Experiments/interview-copilot/releases/latest)

---

## ⬇️ Download & Install

Download pre-built installers directly from the **[Latest Releases](https://github.com/Aditya-Experiments/interview-copilot/releases/latest)**:

| Platform | Download | Format |
|---|---|---|
| 🍎 **macOS (Apple Silicon)** | [Download .dmg](https://github.com/Aditya-Experiments/interview-copilot/releases/latest) | `.dmg` installer or `.zip` |
| 🪟 **Windows (x64)** | [Download .exe](https://github.com/Aditya-Experiments/interview-copilot/releases/latest) | Setup installer `.exe` |
| 🐧 **Linux (x64)** | [Download AppImage](https://github.com/Aditya-Experiments/interview-copilot/releases/latest) | `.AppImage` / `.deb` |

---

## 🌟 Features

- ⚡ **Google Gemini 3.1 Flash Lite** — 100% Free AI tier for real-time answers, speech transcription, and screenshot problem analysis.
- 🎤 **Real-Time Speech Recognition** — Captures microphone or system audio and transcribes in real-time.
- 📸 **Screenshot Analysis** — Captures active interview/coding windows and analyzes LeetCode/System Design problems.
- 🤖 **AI-Powered Answer Generation** — Generates concise, natural, human-like answers tailored for verbal responses.
- 🔒 **Screen Share Protection** — Automatically hidden from screen recording & video calls (Zoom, Microsoft Teams, Google Meet).
- ⚡ **Lightweight & Fast** — Optimized bundle size with minimal startup latency and low memory footprint.
- 📌 **Always on Top & Opacity Controls** — Stays visible above interview windows with customizable window transparency.
- 🌙 **Modern Dark Theme** — Sleek UI built with React 19 and Tailwind CSS.
- 🌐 **Cross-Platform Support** — Runs natively on Windows, macOS, and Linux.

---

## 🛠 Tech Stack

- **Framework**: [Electron](https://www.electronjs.org/) + [electron-vite](https://electron-vite.org/)
- **Frontend**: [React 19](https://react.dev/), [TypeScript](https://www.typescriptlang.org/), [Tailwind CSS](https://tailwindcss.com/)
- **State Management**: [Zustand](https://github.com/pmndrs/zustand)
- **Package Manager**: [pnpm](https://pnpm.io/)
- **AI Integrations**: Google GenAI SDK (`@google/genai`) & OpenAI Node SDK (`openai`)
- **Icons & Markdown**: Lucide React, React Markdown & Prism Light Syntax Highlighter

---

## 📋 Prerequisites

Before running from source, ensure you have:

1. **Node.js**: v18.0.0 or higher ([Download Node.js](https://nodejs.org/))
2. **pnpm**: Package manager (`npm install -g pnpm`)
3. **Google Gemini API Key** (Free from [Google AI Studio](https://aistudio.google.com/)) or OpenAI API Key

---

## 🚀 Getting Started

### 1. Clone & Install

```bash
# Clone the repository
git clone https://github.com/Aditya-Experiments/interview-copilot.git
cd interview-copilot

# Install dependencies
pnpm install
```

### 2. Development

Start the app in development mode with Hot Module Replacement (HMR):

```bash
npm run dev
```

---

## 📦 Building for Production

Build platform-specific packages for **Windows**, **macOS**, and **Linux**:

### 🪟 Windows

```bash
npm run build:win
```

_Generates an executable installer (`.exe`) in the `dist` directory._

### 🍎 macOS

```bash
npm run build:mac
```

_Generates macOS bundle (`.dmg` / `.app`) in the `dist` directory._

### 🐧 Linux

```bash
npm run build:linux
```

_Generates Linux packages (`.AppImage`, `.deb`, `.snap`) in the `dist` directory._

### ⚙️ General Build & Typecheck

```bash
# Run type checking
npm run typecheck

# Build bundle assets
npm run build
```

---

## 💡 How to Use

1. **Launch the App**: On first run, open **Settings** if your OpenAI API key is not yet set.
2. **Enter API Key**: Paste your OpenAI API key and choose your preferred model (e.g. `gpt-4o-mini` or `gpt-4o`).
3. **Set Up Context (Optional)**: Paste your resume or background description in Settings to get personalized responses.
4. **Start Interview Session**: Click **Start** to listen via Microphone or System Audio.
5. **Real-time Answers**: As questions are spoken, the app detects pauses and streams answer suggestions.
6. **Take Screenshot Solution**: Click **Screenshot** to capture an active problem statement or LeetCode question for step-by-step solutions.

---

## 📁 Project Structure

```
interview-copilot/
├── electron-builder.yml            # Electron Builder configuration
├── electron.vite.config.ts         # Vite build setup for Main, Preload & Renderer
├── package.json                    # Project scripts & dependencies
├── resources/                      # Application icons & branding assets
└── src/
    ├── main/                       # Electron Main Process (Node.js)
    │   ├── index.ts                # App entry point & window manager
    │   ├── ipc/
    │   │   └── handlers.ts         # IPC communication endpoints
    │   └── services/
    │       ├── historyManager.ts   # Local history persistence
    │       ├── openaiService.ts    # Answer & solution generation
    │       ├── questionDetector.ts # Linguistic question parser
    │       ├── screenshotService.ts# Window capture service
    │       ├── settingsManager.ts  # Encrypted settings storage
    │       ├── visionService.ts    # OpenAI Vision analysis
    │       └── whisperService.ts   # Speech-to-text audio transcription
    ├── preload/                    # Secure IPC bridge between Main & Renderer
    │   ├── index.ts
    │   └── index.d.ts
    └── renderer/                   # React Frontend (Vite)
        └── src/
            ├── App.tsx             # Main React application component
            ├── assets/             # Global CSS styles
            ├── components/         # Modular UI components
            │   ├── AnswerPanel.tsx
            │   ├── Header.tsx
            │   ├── HistoryPanel.tsx
            │   ├── MarkdownRenderer.tsx
            │   ├── SettingsModal.tsx
            │   ├── StatusBar.tsx
            │   └── TranscriptPanel.tsx
            ├── hooks/              # Custom React hooks
            ├── services/           # Web Audio API capture processing
            └── store/              # Zustand global state store
```

---

## ⚙️ Configuration Reference

| Option                 | Description                                                  | Default       |
| :--------------------- | :----------------------------------------------------------- | :------------ |
| **OpenAI API Key**     | API key used for Whisper transcription and GPT model calls   | _Required_    |
| **OpenAI Model**       | Model used for generating interview answers                  | `gpt-4o-mini` |
| **Resume Description** | Optional candidate profile text for personalized context     | _Empty_       |
| **Pause Threshold**    | Silence duration (ms) required to trigger question detection | `1500 ms`     |
| **Window Opacity**     | Adjusts window transparency (30% to 100%)                    | `100%`        |
| **Always on Top**      | Pins the application window above all other windows          | `Enabled`     |

---

## 💻 OS-Specific Platform Notes

### 🪟 Windows

- Screen protection (`setContentProtection`) hides the window from Zoom, Microsoft Teams, and Discord screen shares.
- Ensure microphone permissions are enabled in **Windows Settings > Privacy & Security > Microphone**.

### 🍎 macOS

- On macOS, grant **Screen Recording** and **Microphone** permissions under **System Settings > Privacy & Security**.
- System audio capture uses desktop audio streams supported on macOS 13+.

### 🐧 Linux

- PulseAudio / PipeWire manages microphone and desktop audio streams.
- Supported targets include `AppImage`, `deb`, and `snap`.

---

## 📄 License

MIT License — feel free to use and adapt for your preparation.
