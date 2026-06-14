# BossGreet

An intelligent Chrome extension that generates personalized outreach messages for BOSS Zhipin — China's leading recruitment platform. Instead of sending generic greetings, BossGreet reads each opportunity's specific requirements and crafts a tailored message that highlights the most relevant aspects of your background and quantified achievements.

## What It Does

**Traditional approach:** One generic greeting sent to every recruiter.

**BossGreet approach:** Each opportunity gets a unique greeting that:
- Reads the full job description (responsibilities, tech stack, experience requirements)
- Matches your resume against those specific requirements
- Highlights quantified achievements (e.g., "reduced API latency by 60%", "led a team of 8")
- Maintains a professional, authentic tone within 80–120 words

## How It Works

```
Upload Resume (PDF / Image / Text)
        ↓
Configure AI Provider (MiMo / Qwen / GPT / Claude)
        ↓
Set Search Filters (city, keywords, experience level)
        ↓
Collect Opportunities → Extract Job Descriptions
        ↓
AI generates a personalized greeting for EACH opportunity
        ↓
Review → Send greetings with resume images in batch
```

### Architecture

| Layer | Role |
|-------|------|
| **Side Panel UI** | Settings, opportunity list, greeting preview, results |
| **Service Worker** | Message routing, state management, AI orchestration |
| **Content Scripts** | DOM interaction on BOSS Zhipin pages |

### Three-Stage Send Pipeline

1. **Extract** — Click each opportunity card, extract recruiter name, company, and activity status
2. **Send** — 3 parallel worker windows send greetings + resume images concurrently
3. **Repair** — Single-connection verification pass that checks server history and resends anything that was lost

## Supported AI Providers

| Provider | Default Model | Endpoint |
|----------|--------------|----------|
| Xiaomi MiMo | `xiaomi/mimo-v2.5-pro` | DashScope |
| Alibaba Qwen | `qwen-plus` | DashScope |
| OpenAI | `gpt-4o-mini` | OpenAI API |
| Anthropic | `claude-sonnet-4-20250514` | Anthropic API |

MiMo and Qwen share the same [DashScope](https://dashscope.console.aliyun.com/) API key.

## Installation

1. Download or clone this repository
2. Open `chrome://extensions` in Chrome
3. Enable **Developer mode** (top right)
4. Click **Load unpacked** and select the `boss-greet/` directory
5. Click the extension icon to open the side panel

## Usage

### 1. Configure

- **Resume**: Upload a PDF, paste text, or upload images
- **AI**: Select provider, enter your API key, save
- **Filters**: Set city, search keywords, experience level, recruiter activity threshold

### 2. Collect

Enter search keywords and click **Start Collecting**. The extension scrolls through search results, collects all opportunities, and extracts the full job description from each card's detail panel.

### 3. Review & Send

Each opportunity shows its AI-generated greeting. You can:
- **Edit** any greeting manually
- **Regenerate** a specific greeting
- Click **Send All Greetings** to start batch outreach

### 4. Results

After completion, the Results page shows success/failure for each opportunity, with duration stats.

## Key Features

- **Per-opportunity personalization** — Not per-category; each JD gets its own greeting
- **PDF resume parsing** — Extracts text directly from uploaded PDF files
- **Multi-model support** — Switch between MiMo, Qwen, GPT, and Claude
- **Delivery confirmation** — Verifies server-side status (not optimistic UI)
- **Anti-double-send** — Content fingerprinting prevents sending the same greeting twice
- **CAPTCHA detection** — Automatically pauses when verification is triggered
- **Interrupt recovery** — State persists to `chrome.storage.local`; resume from where you left off
- **Recruiter activity filter** — Only outreach to recruiters active within N days

## Project Structure

```
boss-greet/
├── manifest.json
├── icons/
├── libs/
│   ├── pdf.min.mjs
│   └── pdf.worker.min.mjs
└── src/
    ├── shared/
    │   ├── constants.js          # Message types, config, storage keys
    │   └── ai-provider.js        # Multi-model API abstraction
    ├── background/
    │   └── service-worker.js     # Core orchestrator
    ├── content/
    │   ├── selectors.js          # DOM selectors
    │   ├── salary-decoder.js     # Salary font decryption
    │   ├── jd-extractor.js       # Job description extraction
    │   ├── job-collector.js      # Infinite scroll + card parsing
    │   ├── job-sender.js         # Chat message sending
    │   ├── chat-monitor.js       # Auto-reply on resume request
    │   └── content.js            # Content script entry point
    ├── popup/
    │   ├── popup.html/css/js     # Side panel UI
    │   ├── state.js              # State management
    │   ├── helpers.js            # Utilities
    │   ├── render-*.js           # Page renderers
    │   └── events-*.js           # Event handlers
    └── utils/
        └── pdf-extract.js        # PDF text extraction
```

## Privacy

- **No data collection** — All processing happens locally in your browser
- **No hardcoded keys** — You provide your own API key
- **Resume stays local** — Stored in `chrome.storage.local`, never sent to third parties except the AI provider you choose
- **No tracking** — No analytics, no telemetry

## License

MIT
