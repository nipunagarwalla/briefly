# Briefly v2.1.1 — Multi-Provider AI Architecture

## Overview

Version 2.1.1 supports both **OpenRouter** and **Gemini** for AI tasks. Parsing, analysis, chat, and LaTeX generation can run through either provider, while the compiler service and Sheets logger remain unchanged.

---

## CLI-First Profile Workflow

There is now a CLI workflow for bootstrapping candidate context before applying.

### What It Does

1. Takes a resume file (`.pdf`, `.txt`, or `.md`)
2. Uses OpenRouter to parse the resume into structured sections
3. Writes those sections into `profile.md` with markdown headings such as `Personal`, `Education`, `Experience`, `Projects`, and `Skills`
4. Asks follow-up interview questions about target roles, unlisted work, tech depth, preferences, and other differentiators
5. Writes the answers to `personalization-interview.md`
6. Uses the parsed profile + interview answers to generate `personalization.md`

### Run It

From the repo root:

```bash
export OPENROUTER_API_KEY=your_key_here
npm run setup-profile -- --resume /absolute/path/to/resume.pdf
```

You can also run the script directly:

```bash
node cli/briefly.mjs setup --resume /absolute/path/to/resume.txt
```

Gemini example:

```bash
export GEMINI_API_KEY=your_key_here
npm run setup-profile -- --provider gemini --resume /absolute/path/to/resume.pdf
```

Vertex AI example using only `.env`:

```bash
GOOGLE_GENAI_USE_VERTEXAI=true
GOOGLE_CLOUD_PROJECT=your-project-id
GOOGLE_CLOUD_LOCATION=us-central1
```

Then run:

```bash
npm install
npm run setup-profile -- --provider gemini --resume /absolute/path/to/resume.pdf
```

Optional flags:

- `--out ./.briefly` to change the output folder
- `--provider gemini` to use Gemini instead of OpenRouter
- `--model anthropic/claude-3.5-sonnet` to change the OpenRouter model
- `--api-key ...` if you do not want to use an environment variable

For Gemini you can also pass `--model gemini-2.5-flash`.

If `GOOGLE_GENAI_USE_VERTEXAI=true`, the CLI uses the Google Gen AI Node SDK with Vertex AI settings from `.env`.
You do not need a Gemini API key in that mode.

### Output Files

By default the CLI writes to `.briefly/`:

- `resume.txt`
- `profile.json`
- `profile.md`
- `personalization-interview.md`
- `personalization.md`

### PDF Note

If your resume is a PDF, the CLI tries `pdftotext` first and automatically falls back to a built-in JavaScript parser. Make sure you run `npm install` in the repo root so the PDF fallback dependency is available.

### Vertex AI Note

The three environment variables are enough for configuration, but Vertex AI still needs Google authentication on the machine. For local development, the common setup is:

```bash
gcloud auth application-default login
```

---

## What Changed in v2.1.1

| Area | Change |
|---|---|
| `manifest.json` | Version bumped to `2.1.1` |
| `background.js` | Provider-aware AI routing added; OpenRouter and Gemini now share the same task handlers; provider-specific default models supported |
| `sidepanel.html` | Provider selector added; Gemini API key field added; live resolution preview now shows the active provider |
| `sidepanel.css` | Existing sidebar refresh styles retained for the updated settings layout |
| `sidepanel.js` | `saveSettings` / `loadSettings` now handle `provider`, `openRouterKey`, and `geminiKey`; live model preview is provider-aware |

---

## Settings: Dual-Model Configuration

Open the **Settings** tab. You will find:

```
┌─────────────────────────────────────────┐
│  API Key                                │
│  OpenRouter API Key   [sk-or-…        ] │
├─────────────────────────────────────────┤
│  Model Configuration                    │
│                                         │
│  Text Tasks Model                       │
│  (Parsing · JD Analysis · Chat)         │
│  [anthropic/claude-3.5-sonnet         ] │
│                                         │
│  ─────── or separate LaTeX model ────── │
│                                         │
│  LaTeX Tasks Model                      │
│  (Resume · Cover Letter)                │
│  [anthropic/claude-3.5-sonnet         ] │
│                                         │
│  ┌─ Live Preview ──────────────────────┐│
│  │ ● Text tasks will use:  <model>    ││
│  │ ● LaTeX tasks will use: <model>    ││
│  └────────────────────────────────────┘│
└─────────────────────────────────────────┘
```

The **Live Preview** box updates in real time as you type, showing exactly which model will be used for each task type based on the fallback rules below.

---

## Model Fallback Logic

The fallback rules are identical in both `background.js` (actual execution) and `sidepanel.js` (preview display), keeping them always in sync.

```
resolveModel(taskType, { textModel, latexModel })
```

| Text Model | LaTeX Model | Text tasks use     | LaTeX tasks use    |
|------------|-------------|--------------------|--------------------|
| filled     | filled      | textModel          | latexModel         |
| filled     | **empty**   | textModel          | **textModel**      |
| **empty**  | filled      | **latexModel**     | latexModel         |
| **empty**  | **empty**   | default (Sonnet)   | default (Sonnet)   |

**TL;DR — one model for everything:** Fill only the Text Tasks field. The fallback rule will automatically use it for LaTeX generation too. Leave both empty and the hardcoded defaults (`anthropic/claude-3.5-sonnet`) are used for all tasks.

**Recommended split:** If you want to save cost on bulk JSON tasks while using a more capable model for document generation:
- Text Tasks: `google/gemini-flash-1.5` (fast, cheap, good at structured output)
- LaTeX Tasks: `anthropic/claude-3.5-sonnet` (better at following format constraints)

---

## JSON Safety Net

Structured tasks still strip markdown fences before parsing so OpenRouter responses remain robust, while Gemini uses JSON mode when selected:

```js
const cleanJson = raw.replace(/```json\n?|```/g, '').trim();
const result    = JSON.parse(cleanJson);
```

This handles cases where a model wraps its JSON response in a code block.

---

## Architecture: All Requests

```
sidepanel.js  ──message──▶  background.js
                                │
                                ├─ resolveModel('text',  settings)
                                │       ↓
                                │  PARSE_RESUME     ─▶ OpenRouter
                                │  EXTRACT_JD_META  ─▶ OpenRouter
                                │  ASK_AI           ─▶ OpenRouter
                                │
                                └─ resolveModel('latex', settings)
                                        ↓
                                   GENERATE_RESUME  ─▶ OpenRouter
                                   GENERATE_COVER   ─▶ OpenRouter
```

---

## Files Changed in This Update

Replace these files in your extension folder. All other files (`prompts.js`, `content.js`, `sidepanel.css` structure, `icons/`) carry over from v3/v2 unchanged, except `sidepanel.css` which has new model-config styles merged in.

```
extension/
├── manifest.json      ← version 2.1.1
├── background.js      ← provider-aware AI routing for OpenRouter + Gemini
├── sidepanel.html     ← provider selector + Gemini API key field
├── sidepanel.css      ← refreshed sidebar styling
├── sidepanel.js       ← provider-aware settings, previews, and validation
└── README.md          ← this file
```

The Docker compiler service and Google Apps Script are **unchanged**.

---

## OpenRouter Model IDs

Any model available on OpenRouter works. Some useful options:

| Use case | Model ID |
|---|---|
| Default (balanced) | `anthropic/claude-3.5-sonnet` |
| Fast / cheap text | `google/gemini-flash-1.5` |
| DeepSeek (cost-effective) | `deepseek/deepseek-chat` |
| Powerful LaTeX | `anthropic/claude-opus-4-5` |
| Local-style privacy | `meta-llama/llama-3.1-70b-instruct` |

Browse the full list at [openrouter.ai/models](https://openrouter.ai/models).
