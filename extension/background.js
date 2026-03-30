// background.js — Briefly v2.1.1 (OpenRouter + Gemini)
import { Prompts } from './prompts.js';

const COMPILER_URL = 'http://localhost:3000/compile';

// ─── Default model IDs ────────────────────────────────────────────────────────
const DEFAULT_MODELS = {
  openrouter: {
    text:  'anthropic/claude-3.5-sonnet',
    latex: 'anthropic/claude-3.5-sonnet',
  },
  gemini: {
    text:  'gemini-2.5-flash',
    latex: 'gemini-2.5-flash',
  },
};

// ─── Side Panel ────────────────────────────────────────────────────────────────
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);

// ─── Message Router ────────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const map = {
    SCRAPE_JD:          () => handleScrapeJD(sendResponse),
    GET_JD:             () => handleGetJD(sendResponse),
    CLEAR_JD:           () => handleClearJD(sendResponse),
    GENERATE_RESUME:    () => handleGenerateResume(msg, sendResponse),
    GENERATE_COVER:     () => handleGenerateCover(msg, sendResponse),
    COMPILE_AND_SAVE:   () => handleCompileAndSave(msg, sendResponse),
    ASK_AI:             () => handleChat(msg, sendResponse),
    PARSE_RESUME:       () => handleParseResume(msg, sendResponse),
    EXTRACT_JD_META:    () => handleExtractJDMeta(msg, sendResponse),
    LOG_APPLICATION:    () => handleLogApplication(msg, sendResponse),
    GET_ALL_STORAGE:    () => handleGetAllStorage(sendResponse),
    DELETE_STORAGE_KEY: () => handleDeleteStorageKey(msg, sendResponse),
    CLEAR_ALL_STORAGE:  () => handleClearAllStorage(sendResponse),
  };
  const fn = map[msg.type];
  if (fn) { fn(); return true; }
});

// ─── Model Resolution ─────────────────────────────────────────────────────────
/**
 * Resolves which model ID to use for a given task type.
 *
 * Fallback rules:
 *   - If the requested model slot is filled → use it.
 *   - If the requested slot is empty but the OTHER slot is filled → use the other one.
 *   - If BOTH slots are empty → use the hardcoded default for the task type.
 *
 * @param {'text'|'latex'} taskType
 * @param {{ provider?: string, geminiKey?: string, openRouterKey?: string, textModel?: string, latexModel?: string }} settings
 */
function resolveModel(taskType, settings) {
  const defaults = getProviderDefaults(resolveProvider(settings));
  const text  = (settings.textModel  || '').trim();
  const latex = (settings.latexModel || '').trim();

  if (taskType === 'text') {
    if (text)  return text;
    if (latex) return latex;          // fallback: use latex model for text tasks
    return defaults.text;
  }
  // taskType === 'latex'
  if (latex) return latex;
  if (text)  return text;             // fallback: use text model for latex tasks
  return defaults.latex;
}

function resolveProvider(settings = {}) {
  const provider = String(settings.provider || '').trim().toLowerCase();
  if (provider === 'gemini' || provider === 'openrouter') return provider;
  if ((settings.geminiKey || '').trim() && !(settings.openRouterKey || '').trim()) return 'gemini';
  return 'openrouter';
}

function getProviderDefaults(provider) {
  return DEFAULT_MODELS[provider] || DEFAULT_MODELS.openrouter;
}

function getProviderApiKey(settings) {
  const provider = resolveProvider(settings);
  return provider === 'gemini'
    ? (settings.geminiKey || '').trim()
    : (settings.openRouterKey || '').trim();
}

function ensureProviderApiKey(settings) {
  const provider = resolveProvider(settings);
  const apiKey   = getProviderApiKey(settings);
  if (!apiKey) throw new Error(`Missing ${provider === 'gemini' ? 'Gemini' : 'OpenRouter'} API key in Settings.`);
  return apiKey;
}

// ─── JD ───────────────────────────────────────────────────────────────────────
async function handleScrapeJD(sendResponse) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractPageText,
    });
    const text   = results[0]?.result || '';
    const domain = new URL(tab.url).hostname;
    const jdData = { text, domain, url: tab.url, title: tab.title, scrapedAt: Date.now() };
    await chrome.storage.local.set({ jd: jdData });
    sendResponse({ success: true, jd: jdData });
  } catch (e) {
    sendResponse({ success: false, error: e.message });
  }
}

function extractPageText() {
  const selectors = [
    '[data-automation="jobDescription"]', '.job-description', '#job-description',
    '[class*="jobDescription"]', '[class*="job-description"]', '.description__text',
    '[data-testid="job-description"]', '.jobs-description', '#jobDescriptionText',
    '.jobsearch-jobDescriptionText', '[class*="posting-description"]',
    '[class*="job-details"]', 'article', 'main',
  ];
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el && el.innerText.trim().length > 200) return el.innerText.trim().slice(0, 12000);
  }
  return document.body.innerText.trim().slice(0, 12000);
}

async function handleGetJD(sendResponse) {
  const d = await chrome.storage.local.get('jd');
  sendResponse({ jd: d.jd || null });
}

async function handleClearJD(sendResponse) {
  await chrome.storage.local.remove('jd');
  sendResponse({ success: true });
}

// ─── JD Meta Extraction ────────────────────────────────────────────────────────
async function handleExtractJDMeta(msg, sendResponse) {
  try {
    const settings = await getSettings();
    const prompt   = Prompts.extractJDMeta(msg.jd, msg.profile);
    const raw      = await callAI(settings, {
      systemPrompt: prompt.system,
      userPrompt:   prompt.user,
      taskType:     'text',
      structured:   true,
    });

    // JSON safety net — strip any markdown fences OpenRouter may wrap around output
    const cleanJson = raw.replace(/```json\n?|```/g, '').trim();
    const meta      = JSON.parse(cleanJson);

    sendResponse({
      success:                true,
      company:                meta.company                || '',
      role:                   meta.role                   || '',
      workExRoleDescriptions: meta.workExRoleDescriptions || {},
      skillsExactMatch:       meta.skillsExactMatch       || [],
      skillsCloseMatch:       meta.skillsCloseMatch       || [],
    });
  } catch (e) {
    sendResponse({ success: false, error: e.message });
  }
}

// ─── Resume Parser ─────────────────────────────────────────────────────────────
async function handleParseResume(msg, sendResponse) {
  try {
    const settings = await getSettings();
    const prompt   = Prompts.parseResume(msg.text);
    const raw       = await callAI(settings, {
      systemPrompt: prompt.system,
      userPrompt:   prompt.user,
      taskType:     'text',
      structured:   true,
    });

    // JSON safety net — strip any markdown fences
    const cleanJson = raw.replace(/```json\n?|```/g, '').trim();
    const profile   = JSON.parse(cleanJson);

    sendResponse({ success: true, profile });
  } catch (e) {
    sendResponse({ success: false, error: e.message });
  }
}

// ─── Document Generation ───────────────────────────────────────────────────────
async function handleGenerateResume(msg, sendResponse) {
  try {
    const settings = await getSettings();
    const prompt   = Prompts.generateResume(
      msg.profile,
      msg.jd,
      msg.latexTemplate || settings.resumeTemplate || '',
      msg.personalization || settings.personalizationNotes || ''
    );
    const latex    = await callAI(settings, {
      systemPrompt: prompt.system,
      userPrompt:   prompt.user,
      taskType:     'latex',
    });
    sendResponse({ success: true, latex });
  } catch (e) {
    sendResponse({ success: false, error: e.message });
  }
}

async function handleGenerateCover(msg, sendResponse) {
  try {
    const settings = await getSettings();
    const prompt   = Prompts.generateCoverLetter(
      msg.profile,
      msg.jd,
      msg.latexTemplate || settings.coverTemplate || '',
      msg.personalization || settings.personalizationNotes || ''
    );
    const latex    = await callAI(settings, {
      systemPrompt: prompt.system,
      userPrompt:   prompt.user,
      taskType:     'latex',
    });
    sendResponse({ success: true, latex });
  } catch (e) {
    sendResponse({ success: false, error: e.message });
  }
}

// ─── Chat (was handleGeminiChat) ──────────────────────────────────────────────
async function handleChat(msg, sendResponse) {
  try {
    const settings = await getSettings();
    const { question, jd, profile, detailedMode, history } = msg;
    const prompt   = Prompts.chat(profile, jd, detailedMode);
    const answer   = await callAI(settings, {
      systemPrompt: prompt.system,
      userPrompt:   question,
      history:      history || [],
      taskType:     'text',
    });
    sendResponse({ success: true, answer });
  } catch (e) {
    sendResponse({ success: false, error: e.message });
  }
}

// ─── Compile LaTeX → PDF → Download ───────────────────────────────────────────
async function handleCompileAndSave(msg, sendResponse) {
  try {
    const { latex, filename } = msg;
    const res = await fetch(COMPILER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ latex, filename }),
    });
    if (!res.ok) {
      let errMsg = `Compiler error ${res.status}`;
      try {
        const j = await res.json();
        errMsg  = j.error || errMsg;
        if (j.log) errMsg += `\n\nLaTeX Log:\n${j.log}`;
      } catch (_) {}
      return sendResponse({ success: false, error: errMsg });
    }
    const buffer  = await res.arrayBuffer();
    const base64  = arrayBufferToBase64(buffer);
    const dataUrl = `data:application/pdf;base64,${base64}`;
    await chrome.downloads.download({
      url:      dataUrl,
      filename: `${sanitizeFilename(filename || 'document')}.pdf`,
      saveAs:   false,
    });
    sendResponse({ success: true, filename: sanitizeFilename(filename) });
  } catch (e) {
    sendResponse({ success: false, error: e.message });
  }
}

// ─── Google Sheets Logging ─────────────────────────────────────────────────────
async function handleLogApplication(msg, sendResponse) {
  try {
    const settings = await getSettings();
    const payload  = {
      company: msg.company, role: msg.role, status: msg.status,
      date:    new Date().toISOString().split('T')[0],
      url:     msg.url || '', notes: msg.notes || '',
    };
    const res = await fetch(settings.sheetsUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'text/plain' },
      body:    JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`Sheets HTTP ${res.status}`);
    sendResponse({ success: true });
  } catch (e) {
    sendResponse({ success: false, error: e.message });
  }
}

// ─── Storage ───────────────────────────────────────────────────────────────────
async function handleGetAllStorage(sendResponse) {
  const all = await chrome.storage.local.get(null);
  sendResponse({ success: true, data: all });
}
async function handleDeleteStorageKey(msg, sendResponse) {
  await chrome.storage.local.remove(msg.key);
  sendResponse({ success: true });
}
async function handleClearAllStorage(sendResponse) {
  await chrome.storage.local.clear();
  sendResponse({ success: true });
}

// ─── AI Providers ──────────────────────────────────────────────────────────────
async function callAI(settings, { systemPrompt, userPrompt, history = [], taskType = 'text', structured = false }) {
  const provider = resolveProvider(settings);
  const apiKey   = ensureProviderApiKey(settings);
  const modelId  = resolveModel(taskType, settings);

  if (provider === 'gemini') {
    return callGemini(apiKey, systemPrompt, userPrompt, history, modelId, { structured });
  }

  return callOpenRouter(apiKey, systemPrompt, userPrompt, history, modelId);
}

async function callOpenRouter(apiKey, systemPrompt, userPrompt, history = [], modelId) {
  const messages = [
    { role: 'system', content: systemPrompt },
    ...history.map(h => ({ role: h.role === 'assistant' ? 'assistant' : 'user', content: h.content })),
    { role: 'user', content: userPrompt },
  ];

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type':  'application/json',
      'HTTP-Referer':  'chrome-extension://briefly',
      'X-Title':       'Briefly',
    },
    body: JSON.stringify({
      model:      modelId,
      messages,
      max_tokens: 4096,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenRouter ${res.status}: ${err}`);
  }
  const data = await res.json();
  return data.choices[0].message.content;
}

async function callGemini(apiKey, systemPrompt, userPrompt, history = [], modelId, { structured = false } = {}) {
  const contents = [
    ...history.map(h => ({
      role:  h.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: h.content }],
    })),
    { role: 'user', parts: [{ text: userPrompt }] },
  ];

  const generationConfig = {
    temperature:     structured ? 0.15 : 0.3,
    maxOutputTokens: 4096,
    responseMimeType: structured ? 'application/json' : 'text/plain',
  };

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${normalizeGeminiModel(modelId)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents,
        generationConfig,
      }),
    }
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini ${res.status}: ${err}`);
  }

  const data = await res.json();
  const text = extractGeminiText(data);
  if (!text) {
    const blockReason = data?.promptFeedback?.blockReason;
    if (blockReason) throw new Error(`Gemini blocked the response: ${blockReason}`);
    throw new Error('Gemini returned no text content.');
  }
  return text;
}

function extractGeminiText(data) {
  const parts = data?.candidates?.[0]?.content?.parts || [];
  return parts
    .map(part => typeof part?.text === 'string' ? part.text : '')
    .join('')
    .trim();
}

function normalizeGeminiModel(modelId) {
  const model = String(modelId || '').trim();
  return model.startsWith('models/') ? model.slice('models/'.length) : model;
}

// ─── Utility ───────────────────────────────────────────────────────────────────
async function getSettings() {
  const d = await chrome.storage.local.get('settings');
  return d.settings || {};
}

function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function sanitizeFilename(name) {
  return String(name || 'document').replace(/[^a-zA-Z0-9_\-\s]/g, '').trim().replace(/\s+/g, '_');
}
