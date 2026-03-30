'use strict';
// sidepanel.js — Briefly v2.1.1

// ─── Constants ────────────────────────────────────────────────────────────────
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

// ─── Profile Schema ───────────────────────────────────────────────────────────
const DEFAULT_PROFILE = {
  personal: { name:'', email:'', phone:'', location:'', linkedin:'', github:'', website:'' },
  modules: {
    education:      [],
    workExperience: [],
    projects:       [],
    achievements:   [],
    skills:         { languages: [], frameworks: [], tools: [] },
    courses:        [],
  }
};

const SKILL_GROUPS = [
  { key: 'languages',  label: 'Languages' },
  { key: 'frameworks', label: 'Frameworks & Libraries' },
  { key: 'tools',      label: 'Tools & Platforms' },
];

const MODULE_CONFIG = [
  {
    key: 'education', label: 'Education', icon: '🎓',
    fields: [
      { key:'institution', placeholder:'Institution' },
      { key:'degree',      placeholder:'Degree' },
      { key:'field',       placeholder:'Major' },
      { key:'startDate',   placeholder:'Start Date', half:true },
      { key:'endDate',     placeholder:'End Date', half:true },
      { key:'gpa',         placeholder:'GPA', half:true },
    ],
    bullets: true,
  },
  {
    key: 'workExperience', label: 'Work Experience', icon: '💼',
    fields: [
      { key:'company',   placeholder:'Company' },
      { key:'title',     placeholder:'Title' },
      { key:'location',  placeholder:'Location', half:true },
      { key:'startDate', placeholder:'Start Date', half:true },
      { key:'endDate',   placeholder:'End Date',  half:true },
    ],
    bullets: true,
  },
  {
    key: 'projects', label: 'Projects', icon: '🚀',
    fields: [
      { key:'name', placeholder:'Project Name' },
      { key:'tech', placeholder:'Tech Stack' },
      { key:'url',  placeholder:'Link' },
    ],
    bullets: true,
  },
  {
    key: 'achievements', label: 'Achievements', icon: '🏆',
    fields: [
      { key:'name',        placeholder:"Achievement" },
      { key:'date',        placeholder:'Date', half:true },
      { key:'description', placeholder:'Brief details…' },
    ],
    bullets: false,
  },
  {
    key: 'courses', label: 'Courses & Training', icon: '📚',
    fields: [
      { key:'name',        placeholder:'Name' },
      { key:'institution', placeholder:'Institution', half:true },
      { key:'date',        placeholder:'Date',             half:true },
      { key:'level',       placeholder:'Level',   half:true },
    ],
    bullets: false,
  },
];

// ─── State ────────────────────────────────────────────────────────────────────
const state = {
  profile:          structuredClone(DEFAULT_PROFILE),
  settings:         {},
  jd:               null,
  chatHistory:      [],
  detailedMode:     false,
  parsedResumeText: null,
};

// ─── Boot ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  await loadStorage();
  renderProfileModules();
  populateProfileForm();
  populateSettingsForm();
  refreshJDStatus();
  bindTabNav();
  bindApplicationTab();
  bindProfileTab();
  bindSettingsTab();
  bindStorageTab();
});

async function loadStorage() {
  const data = await chrome.storage.local.get(['profile', 'settings', 'jd']);
  if (data.profile)  state.profile  = data.profile;
  if (data.settings) state.settings = data.settings;
  if (data.jd)       state.jd       = data.jd;
}

function resolveProviderFromSettings(settings = {}) {
  const provider = String(settings.provider || '').trim().toLowerCase();
  if (provider === 'gemini' || provider === 'openrouter') return provider;
  if ((settings.geminiKey || '').trim() && !(settings.openRouterKey || '').trim()) return 'gemini';
  return 'openrouter';
}

function getProviderLabel(provider) {
  return provider === 'gemini' ? 'Gemini' : 'OpenRouter';
}

function getProviderDefaults(provider) {
  return DEFAULT_MODELS[provider] || DEFAULT_MODELS.openrouter;
}

function getSelectedProviderKey(settings = state.settings) {
  const provider = resolveProviderFromSettings(settings);
  return provider === 'gemini'
    ? (settings.geminiKey || '').trim()
    : (settings.openRouterKey || '').trim();
}

function getMissingProviderMessage() {
  const provider = resolveProviderFromSettings(state.settings);
  return `Add a ${getProviderLabel(provider)} API key in Settings.`;
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────
function bindTabNav() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
      btn.classList.add('active');
      el(`tab-${btn.dataset.tab}`).classList.add('active');
      if (btn.dataset.tab === 'storage') refreshStorageExplorer();
    });
  });
}

// ─── APPLICATION TAB ──────────────────────────────────────────────────────────
function bindApplicationTab() {
  el('btn-rescan').addEventListener('click', handleRescan);
  el('btn-clear-jd').addEventListener('click', async () => {
    await sendMsg({ type: 'CLEAR_JD' });
    state.jd = null;
    refreshJDStatus();
    clearAnalysisPanel();
  });

  el('btn-gen-resume').addEventListener('click', () => generateDoc('resume'));
  el('btn-gen-cover').addEventListener('click',  () => generateDoc('cover'));
  el('btn-dl-resume').addEventListener('click',  () => compileAndDownload('resume'));
  el('btn-dl-cover').addEventListener('click',   () => compileAndDownload('cover'));

  el('btn-send').addEventListener('click', sendChat);
  el('chat-input').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
  });
  el('detailed-toggle').addEventListener('change', e => { state.detailedMode = e.target.checked; });

  el('btn-log').addEventListener('click', logApplication);

  // Delegated copy buttons
  document.addEventListener('click', e => {
    const btn = e.target.closest('.btn-copy');
    if (!btn) return;
    const text = el(btn.dataset.target)?.textContent || '';
    navigator.clipboard.writeText(text).then(() => {
      const orig = btn.textContent;
      btn.textContent = '✓ Copied'; btn.classList.add('copied');
      setTimeout(() => { btn.textContent = orig; btn.classList.remove('copied'); }, 1500);
    });
  });
}

// ── Re-scan ────────────────────────────────────────────────────────────────────
async function handleRescan() {
  const btn = el('btn-rescan');
  setBtnLoading(btn, true, '⏳ Scanning…');
  clearAnalysisPanel();

  try {
    const scrapeRes = await sendMsg({ type: 'SCRAPE_JD' });
    if (!scrapeRes.success) { showToast(scrapeRes.error, 'error'); return; }
    state.jd = scrapeRes.jd;
    refreshJDStatus();

    if (!getSelectedProviderKey()) {
      showToast(`${getMissingProviderMessage()} Enable JD analysis after saving it.`, 'error');
      return;
    }

    setBtnLoading(btn, true, '⏳ Analysing…');
    const metaRes = await sendMsg({
      type:    'EXTRACT_JD_META',
      jd:      state.jd.text,
      profile: state.profile,
    });

    if (!metaRes.success) { showToast(metaRes.error, 'error'); return; }

    if (metaRes.company) el('apply-company').value = metaRes.company;
    if (metaRes.role)    el('apply-role').value    = metaRes.role;

    renderAnalysisPanel(metaRes);

  } catch (e) { showToast(e.message, 'error'); }

  setBtnLoading(btn, false, '↻ Re-scan');
}

// ── JD Analysis Panel ──────────────────────────────────────────────────────────
function renderAnalysisPanel(meta) {
  const exactContainer = el('skills-exact');
  exactContainer.innerHTML = '';
  (meta.skillsExactMatch || []).forEach(skill => {
    const pill = document.createElement('span');
    pill.className = 'pill pill-green';
    pill.textContent = skill;
    exactContainer.appendChild(pill);
  });

  const closeContainer = el('skills-close');
  closeContainer.innerHTML = '';
  (meta.skillsCloseMatch || []).forEach(skill => {
    const span = document.createElement('span');
    span.className = 'pill pill-amber';
    span.textContent = skill;
    closeContainer.appendChild(span);
  });

  const roleContainer = el('role-descriptions');
  roleContainer.innerHTML = '';
  const descriptions = meta.workExRoleDescriptions || {};
  const entries = Object.entries(descriptions);
  el('role-desc-section').classList.toggle('hidden', entries.length === 0);
  entries.forEach(([roleKey, desc]) => {
    const card = document.createElement('div');
    card.className = 'role-desc-card';
    card.innerHTML = `
      <div class="role-desc-card-title">${escHtml(roleKey)}</div>
      <div class="role-desc-card-body">${escHtml(desc)}</div>`;
    roleContainer.appendChild(card);
  });

  el('jd-analysis').classList.remove('hidden');
}

function clearAnalysisPanel() {
  el('jd-analysis').classList.add('hidden');
  el('skills-exact').innerHTML      = '';
  el('skills-close').innerHTML      = '';
  el('role-descriptions').innerHTML = '';
}

// ── Document Generation ────────────────────────────────────────────────────────
async function generateDoc(type) {
  if (!state.jd) return showToast('Please scan a JD first.');
  const isResume = type === 'resume';
  const btnId    = isResume ? 'btn-gen-resume' : 'btn-gen-cover';
  const outId    = isResume ? 'resume-output'  : 'cover-output';
  const codeId   = isResume ? 'resume-code'    : 'cover-code';
  const msgType  = isResume ? 'GENERATE_RESUME' : 'GENERATE_COVER';
  const label    = isResume ? '⬡ Resume'        : '✉ Cover Letter';
  const tplKey   = isResume ? 'resumeTemplate'  : 'coverTemplate';

  const btn = el(btnId);
  setBtnLoading(btn, true, '⏳ Generating…');
  try {
    const res = await sendMsg({
      type: msgType,
      profile:       state.profile,
      jd:            state.jd.text,
      latexTemplate: state.settings[tplKey] || '',
    });
    if (res.success) {
      el(codeId).textContent = res.latex;
      el(outId).classList.remove('hidden');
    } else {
      showToast(res.error, 'error');
    }
  } catch (e) { showToast(e.message, 'error'); }
  setBtnLoading(btn, false, label);
}

// ── Compile & Download ─────────────────────────────────────────────────────────
async function compileAndDownload(type) {
  const codeId = type === 'resume' ? 'resume-code' : 'cover-code';
  const btnId  = type === 'resume' ? 'btn-dl-resume' : 'btn-dl-cover';
  const latex  = el(codeId)?.textContent?.trim();
  if (!latex) return showToast('Generate a document first.');

  const btn = el(btnId);
  setBtnLoading(btn, true, '⏳ Compiling…');
  try {
    const name    = (state.profile.personal.name || 'Resume').replace(/\s+/g, '_');
    const company = (el('apply-company')?.value || 'Company').trim().replace(/\s+/g, '_');
    const role    = (el('apply-role')?.value    || 'Role').trim().replace(/\s+/g, '_');
    const docType = type === 'resume' ? 'Resume' : 'CoverLetter';
    const res = await sendMsg({ type: 'COMPILE_AND_SAVE', latex, filename: `${name}_${docType}_${company}_${role}` });
    if (res.success) showToast(`✓ Saved ${res.filename}.pdf`, 'success');
    else showToast(res.error, 'error');
  } catch (e) { showToast(e.message, 'error'); }
  setBtnLoading(btn, false, '⬇ PDF');
}

// ── Chat ────────────────────────────────────────────────────────────────────────
// Message type updated from ASK_GEMINI → ASK_AI
async function sendChat() {
  const input = el('chat-input');
  const q = input.value.trim();
  if (!q) return;
  input.value = '';
  appendBubble('user', q);
  const typingId = appendBubble('ai', '…');

  try {
    const res = await sendMsg({
      type: 'ASK_AI',
      question: q,
      jd: state.jd?.text || '',
      profile: state.profile,
      detailedMode: state.detailedMode,
      history: state.chatHistory,
    });
    removeBubble(typingId);
    const answer = res.success ? res.answer : '⚠ ' + res.error;
    if (res.success) {
      state.chatHistory.push({ role: 'user', content: q }, { role: 'assistant', content: answer });
      if (state.chatHistory.length > 20) state.chatHistory = state.chatHistory.slice(-20);
    }
    appendBubble('ai', answer, true);
  } catch (e) { removeBubble(typingId); appendBubble('ai', '⚠ ' + e.message); }
}

function appendBubble(role, text, withCopy = false) {
  const container = el('chat-messages');
  const id  = `bubble-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const div = document.createElement('div');
  div.className = `chat-msg chat-msg-${role}`;
  div.id = id;
  const copyRow = (withCopy && role === 'ai')
    ? `<div class="msg-actions"><button class="btn-copy" data-target="${id}-text">⧉ Copy</button></div>` : '';
  div.innerHTML = `<div class="bubble" id="${id}-text">${escHtml(text)}</div>${copyRow}`;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
  return id;
}
function removeBubble(id) { el(id)?.remove(); }

// ── Log Application ────────────────────────────────────────────────────────────
async function logApplication() {
  const company = el('apply-company').value.trim();
  const role    = el('apply-role').value.trim();
  const status  = el('apply-status').value;
  const notes   = el('apply-notes').value.trim();
  const fb      = el('apply-feedback');
  if (!company || !role) return showFeedback(fb, 'Enter company and role.', 'error');
  if (!state.settings.sheetsUrl) return showFeedback(fb, 'Add Google Script URL in Settings.', 'error');

  const btn = el('btn-log');
  setBtnLoading(btn, true, '⏳ Logging…');
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    const res = await sendMsg({ type: 'LOG_APPLICATION', company, role, status, notes, url: tab?.url || '' });
    if (res.success) showFeedback(fb, `✓ Logged "${role}" at ${company}`, 'success');
    else showFeedback(fb, res.error, 'error');
  } catch (e) { showFeedback(fb, e.message, 'error'); }
  setBtnLoading(btn, false, '✓ Log Application');
}

// ─── JD Status ────────────────────────────────────────────────────────────────
function refreshJDStatus() {
  const statusEl  = el('jd-status');
  const statusTxt = el('jd-status-text');
  const preview   = el('jd-preview');
  if (state.jd) {
    statusEl.className = 'jd-status loaded';
    statusTxt.textContent = state.jd.title || state.jd.domain || 'JD loaded';
    preview.textContent = state.jd.text.slice(0, 300) + '…';
    preview.classList.remove('hidden');
  } else {
    statusEl.className = 'jd-status empty';
    statusTxt.textContent = 'No JD loaded — open a job posting and Re-scan';
    preview.classList.add('hidden');
  }
}

// ─── PROFILE TAB ─────────────────────────────────────────────────────────────
function bindProfileTab() {
  const uploadInput = el('resume-upload');
  const parseBtn    = el('btn-parse-resume');
  const fb          = el('parse-feedback');

  uploadInput.addEventListener('change', () => {
    const file = uploadInput.files[0];
    if (!file) return;

    // 1. Show loading text and KEEP BUTTON DISABLED while processing
    el('resume-upload-name').textContent = 'Extracting text... ⏳';
    parseBtn.disabled = true;
    state.parsedResumeText = null;

    const reader = new FileReader();

    if (file.type === 'application/pdf') {
      reader.readAsArrayBuffer(file);
      reader.onload = async () => {
        try {
          // Tell PDF.js where its worker is
          pdfjsLib.GlobalWorkerOptions.workerSrc = 'pdf.worker.min.js';
          
          const loadingTask = pdfjsLib.getDocument({ data: reader.result });
          const pdf = await loadingTask.promise;
          let fullText = '';
          
          // Loop through every page and extract actual text
          for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            const pageText = textContent.items.map(item => item.str).join(' ');
            fullText += pageText + '\n\n';
          }
          
          state.parsedResumeText = fullText.slice(0, 12000);
          
          // 2. ENABLE BUTTON and show file name ONLY when done
          el('resume-upload-name').textContent = file.name;
          parseBtn.disabled = false;

        } catch (error) {
          console.error("PDF Parsing Error:", error);
          el('resume-upload-name').textContent = 'Error reading PDF';
          showFeedback(fb, 'Failed to extract text. Check Inspect > Console.', 'error');
        }
      };
    } else {
      // Handle standard .txt files
      reader.readAsText(file);
      reader.onload = () => {
        state.parsedResumeText = reader.result.slice(0, 12000);
        el('resume-upload-name').textContent = file.name;
        parseBtn.disabled = false;
      };
    }
  });

  parseBtn.addEventListener('click', async () => {
    if (!state.parsedResumeText) return showFeedback(fb, 'File still loading, try again.', 'error');
    if (!getSelectedProviderKey()) return showFeedback(fb, getMissingProviderMessage(), 'error');
    setBtnLoading(parseBtn, true, '⏳ Parsing…');
    try {
      const res = await sendMsg({ type: 'PARSE_RESUME', text: state.parsedResumeText });
      if (res.success) {
        state.profile = deepMergeProfile(res.profile);
        await chrome.storage.local.set({ profile: state.profile });
        renderProfileModules();
        populateProfileForm();
        showFeedback(fb, '✓ Profile auto-filled! Review and save.', 'success');
      } else {
        showFeedback(fb, res.error, 'error');
      }
    } catch (e) { showFeedback(fb, e.message, 'error'); }
    setBtnLoading(parseBtn, false, '⬡ Parse & Auto-fill Profile');
  });

  el('btn-save-profile').addEventListener('click', saveProfile);
}

function deepMergeProfile(parsed) {
  const base = structuredClone(DEFAULT_PROFILE);
  if (parsed.personal) Object.assign(base.personal, parsed.personal);
  if (parsed.modules) {
    ['education', 'workExperience', 'projects', 'achievements', 'courses'].forEach(key => {
      if (Array.isArray(parsed.modules[key]) && parsed.modules[key].length)
        base.modules[key] = parsed.modules[key];
    });
    if (parsed.modules.skills) {
      SKILL_GROUPS.forEach(g => {
        if (Array.isArray(parsed.modules.skills[g.key]) && parsed.modules.skills[g.key].length)
          base.modules.skills[g.key] = parsed.modules.skills[g.key];
      });
    }
  }
  return base;
}

// ─── Profile Module Rendering ─────────────────────────────────────────────────
function renderProfileModules() {
  const container = el('profile-modules');
  container.innerHTML = '';

  // Personal
  const personalPanel = document.createElement('div');
  personalPanel.className = 'module-panel';
  personalPanel.innerHTML = `
    <div class="module-header" data-module="personal">
      <div class="module-title"><span class="module-icon">👤</span> Personal Info</div>
      <span class="module-chevron">▾</span>
    </div>
    <div class="module-body" id="module-body-personal">
      <div class="entry-row">
        <input class="input" placeholder="Full Name"  data-field="personal.name" />
        <input class="input" placeholder="Email"      data-field="personal.email" />
      </div>
      <div class="entry-row">
        <input class="input" placeholder="Phone"      data-field="personal.phone" />
        <input class="input" placeholder="Location"   data-field="personal.location" />
      </div>
      <div class="entry-row">
        <input class="input" placeholder="LinkedIn"   data-field="personal.linkedin" />
        <input class="input" placeholder="GitHub"     data-field="personal.github" />
      </div>
      <input class="input" placeholder="Portfolio / Website" data-field="personal.website" />
    </div>`;
  container.appendChild(personalPanel);

  container.appendChild(buildSkillsPanel());
  MODULE_CONFIG.forEach(mod => container.appendChild(buildModulePanel(mod)));

  container.querySelectorAll('.module-header').forEach(header => {
    header.addEventListener('click', () => {
      const body = el(`module-body-${header.dataset.module}`);
      if (!body) return;
      const open = body.classList.contains('open');
      body.classList.toggle('open', !open);
      header.classList.toggle('open', !open);
    });
  });
}

function buildSkillsPanel() {
  const panel = document.createElement('div');
  panel.className = 'module-panel';
  panel.innerHTML = `
    <div class="module-header" data-module="skills">
      <div class="module-title"><span class="module-icon">⚡</span> Skills</div>
      <span class="module-chevron">▾</span>
    </div>
    <div class="module-body" id="module-body-skills">
      <div class="skills-grid" id="skills-grid"></div>
    </div>`;

  const grid = panel.querySelector('#skills-grid');
  SKILL_GROUPS.forEach(group => {
    const section = document.createElement('div');
    section.className = 'skill-group';
    section.dataset.group = group.key;
    section.innerHTML = `
      <div class="skill-group-label">${group.label}</div>
      <div class="skill-tags-row" id="skill-tags-${group.key}"></div>
      <div class="skill-add-row">
        <input class="input" id="skill-input-${group.key}" placeholder="Add ${group.label.split(' ')[0].toLowerCase()}…" />
        <button class="btn-add-skill" data-group="${group.key}">+</button>
      </div>`;
    grid.appendChild(section);

    section.querySelector('.btn-add-skill').addEventListener('click', () => {
      const input = el(`skill-input-${group.key}`);
      addSkillTag(group.key, input.value.trim());
      input.value = '';
    });
    section.querySelector(`#skill-input-${group.key}`).addEventListener('keydown', e => {
      if (e.key === 'Enter') { addSkillTag(group.key, e.target.value.trim()); e.target.value = ''; e.preventDefault(); }
    });
  });

  return panel;
}

function addSkillTag(groupKey, value) {
  if (!value) return;
  const container = el(`skill-tags-${groupKey}`);
  const tag = document.createElement('div');
  tag.className = 'skill-tag';
  tag.innerHTML = `<span>${escHtml(value)}</span><button class="skill-tag-remove">✕</button>`;
  tag.querySelector('.skill-tag-remove').addEventListener('click', () => tag.remove());
  container.appendChild(tag);
}

function populateSkillTags() {
  SKILL_GROUPS.forEach(group => {
    const container = el(`skill-tags-${group.key}`);
    if (!container) return;
    container.innerHTML = '';
    (state.profile.modules?.skills?.[group.key] || []).forEach(s => addSkillTag(group.key, s));
  });
}

function collectSkillsFromUI() {
  const skills = {};
  SKILL_GROUPS.forEach(group => {
    const container = el(`skill-tags-${group.key}`);
    skills[group.key] = container
      ? Array.from(container.querySelectorAll('.skill-tag span')).map(s => s.textContent.trim()).filter(Boolean)
      : [];
  });
  return skills;
}

function buildModulePanel(mod) {
  const panel = document.createElement('div');
  panel.className = 'module-panel';
  panel.innerHTML = `
    <div class="module-header" data-module="${mod.key}">
      <div class="module-title"><span class="module-icon">${mod.icon}</span> ${mod.label}</div>
      <span class="module-chevron">▾</span>
    </div>
    <div class="module-body" id="module-body-${mod.key}">
      <div id="entries-${mod.key}"></div>
      <button class="btn-add-entry">+ Add ${mod.label.replace(/s$/, '')}</button>
    </div>`;
  panel.querySelector('.btn-add-entry').addEventListener('click', () => {
    addModuleEntry(mod, el(`entries-${mod.key}`));
  });
  return panel;
}

function addModuleEntry(mod, container, data = {}) {
  const entryEl = document.createElement('div');
  entryEl.className = 'module-entry';

  const fullFields = mod.fields.filter(f => !f.half);
  const halfFields = mod.fields.filter(f =>  f.half);

  let html = '';
  fullFields.forEach(f => {
    html += `<input class="input" placeholder="${f.placeholder}" data-key="${f.key}" value="${escAttr(data[f.key] || '')}" />`;
  });
  for (let i = 0; i < halfFields.length; i += 2) {
    const a = halfFields[i], b = halfFields[i + 1];
    html += `<div class="entry-row">
      <input class="input" placeholder="${a.placeholder}" data-key="${a.key}" value="${escAttr(data[a.key] || '')}" />
      ${b ? `<input class="input" placeholder="${b.placeholder}" data-key="${b.key}" value="${escAttr(data[b.key] || '')}" />` : ''}
    </div>`;
  }

  if (mod.bullets) {
    const bullets = data.bullets?.length ? data.bullets : [''];
    html += `
      <div class="bullets-label">Bullet Points</div>
      <div class="bullets-container">${bullets.map(bulletRowHtml).join('')}</div>
      <button class="btn-add-bullet" type="button">+</button>`;
  }

  entryEl.innerHTML = `<button class="btn-remove-entry">✕</button>${html}`;
  entryEl.querySelector('.btn-remove-entry').addEventListener('click', () => entryEl.remove());

  if (mod.bullets) {
    entryEl.querySelector('.btn-add-bullet').addEventListener('click', () => {
      const bc  = entryEl.querySelector('.bullets-container');
      const div = document.createElement('div');
      div.innerHTML = bulletRowHtml('');
      const row = div.firstElementChild;
      row.querySelector('.btn-remove-bullet').addEventListener('click', () => row.remove());
      bc.appendChild(row);
    });
    entryEl.querySelectorAll('.btn-remove-bullet').forEach(b =>
      b.addEventListener('click', () => b.closest('.bullet-input-row').remove())
    );
  }

  container.appendChild(entryEl);
}

function bulletRowHtml(value) {
  return `<div class="bullet-input-row">
    <input class="input" placeholder="Bullet point…" value="${escAttr(value)}" />
    <button class="btn-remove-bullet" type="button">✕</button>
  </div>`;
}

function populateProfileForm() {
  Object.entries(state.profile.personal || {}).forEach(([key, val]) => {
    const input = document.querySelector(`[data-field="personal.${key}"]`);
    if (input) input.value = val;
  });
  populateSkillTags();
  MODULE_CONFIG.forEach(mod => {
    const entries   = state.profile.modules[mod.key] || [];
    const container = el(`entries-${mod.key}`);
    if (!container) return;
    container.innerHTML = '';
    entries.forEach(entry => addModuleEntry(mod, container, entry));
  });
}

async function saveProfile() {
  const personal = {};
  document.querySelectorAll('[data-field^="personal."]').forEach(input => {
    personal[input.dataset.field.replace('personal.', '')] = input.value.trim();
  });
  const modules = { skills: collectSkillsFromUI() };
  MODULE_CONFIG.forEach(mod => {
    const container = el(`entries-${mod.key}`);
    if (!container) return;
    modules[mod.key] = Array.from(container.querySelectorAll('.module-entry')).map(entry => {
      const obj = {};
      entry.querySelectorAll('[data-key]').forEach(i => { obj[i.dataset.key] = i.value.trim(); });
      if (mod.bullets) obj.bullets = Array.from(entry.querySelectorAll('.bullet-input-row input'))
        .map(i => i.value.trim()).filter(Boolean);
      return obj;
    });
  });

  state.profile = { personal, modules };
  await chrome.storage.local.set({ profile: state.profile });
  const btn = el('btn-save-profile');
  const orig = btn.textContent;
  btn.textContent = '✓ Saved!';
  setTimeout(() => btn.textContent = orig, 1500);
}

// ─── SETTINGS TAB ─────────────────────────────────────────────────────────────
function bindSettingsTab() {
  bindTemplateUpload('resume-tpl-upload', 'resume-tpl-name', 'resume-tpl-preview', 'resume-tpl-loaded', 'resumeTemplate');
  bindTemplateUpload('cover-tpl-upload',  'cover-tpl-name',  'cover-tpl-preview',  'cover-tpl-loaded',  'coverTemplate');

  document.querySelectorAll('.btn-clear-tpl').forEach(btn => {
    btn.addEventListener('click', async () => {
      const key    = btn.dataset.tpl;
      const prefix = key === 'resumeTemplate' ? 'resume-tpl' : 'cover-tpl';
      delete state.settings[key];
      await chrome.storage.local.set({ settings: state.settings });
      el(`${prefix}-name`).textContent = 'Upload .tex file…';
      el(`${prefix}-preview`).classList.add('hidden');
    });
  });

  // Live model resolution preview — updates as the user types
  el('s-provider').addEventListener('change', updateProviderUI);
  el('s-text-model').addEventListener('input', updateModelPreview);
  el('s-latex-model').addEventListener('input', updateModelPreview);

  el('btn-save-settings').addEventListener('click', saveSettings);
}

function bindTemplateUpload(inputId, nameId, previewId, loadedId, storageKey) {
  el(inputId).addEventListener('change', async () => {
    const file = el(inputId).files[0];
    if (!file) return;
    state.settings[storageKey] = await file.text();
    el(nameId).textContent = 'Upload .tex file…';
    el(loadedId).textContent = `✓ ${file.name}`;
    el(previewId).classList.remove('hidden');
  });
}

/**
 * Mirror of resolveModel() from background.js, kept in sync.
 * Used purely for the live Settings preview — does NOT make API calls.
 */
function resolveModelPreview(provider, taskType, textModel, latexModel) {
  const defaults = getProviderDefaults(provider);
  const text  = textModel.trim();
  const latex = latexModel.trim();
  if (taskType === 'text') {
    if (text)  return text;
    if (latex) return latex;
    return defaults.text;
  }
  if (latex) return latex;
  if (text)  return text;
  return defaults.latex;
}

function updateProviderUI() {
  const provider = el('s-provider').value || 'openrouter';
  const defaults = getProviderDefaults(provider);
  const providerLabel = getProviderLabel(provider);

  el('provider-key-hint').textContent = provider === 'gemini'
    ? 'Gemini requests use your Gemini API key and Gemini model ids like gemini-2.5-flash.'
    : 'OpenRouter requests use your OpenRouter key and OpenRouter model ids like anthropic/claude-3.5-sonnet.';
  el('model-config-hint').textContent = provider === 'gemini'
    ? 'Gemini will use Gemini model ids. You can use one model for everything or split text and LaTeX tasks. If only one field is filled, it is used for both automatically.'
    : 'OpenRouter will use OpenRouter model ids. You can use one model for everything or split text and LaTeX tasks. If only one field is filled, it is used for both automatically.';

  el('s-text-model').placeholder = defaults.text;
  el('s-latex-model').placeholder = defaults.latex;
  el('resolved-provider').textContent = providerLabel;

  updateModelPreview();
}

function updateModelPreview() {
  const provider   = el('s-provider').value || 'openrouter';
  const textModel  = el('s-text-model').value;
  const latexModel = el('s-latex-model').value;
  el('resolved-provider').textContent    = getProviderLabel(provider);
  el('resolved-text-model').textContent  = resolveModelPreview(provider, 'text',  textModel, latexModel);
  el('resolved-latex-model').textContent = resolveModelPreview(provider, 'latex', textModel, latexModel);
}

function populateSettingsForm() {
  const s = state.settings;
  setVal('s-provider',   resolveProviderFromSettings(s));
  setVal('s-or-key',     s.openRouterKey);
  setVal('s-gemini-key', s.geminiKey);
  setVal('s-text-model', s.textModel);
  setVal('s-latex-model',s.latexModel);
  setVal('s-sheets',     s.sheetsUrl);

  if (s.resumeTemplate) { el('resume-tpl-loaded').textContent = '✓ resume.tex (cached)'; el('resume-tpl-preview').classList.remove('hidden'); }
  if (s.coverTemplate)  { el('cover-tpl-loaded').textContent  = '✓ cover.tex (cached)';  el('cover-tpl-preview').classList.remove('hidden'); }

  updateProviderUI();
}

async function saveSettings() {
  state.settings = {
    ...state.settings,         // preserve cached templates
    provider:      el('s-provider').value,
    openRouterKey: el('s-or-key').value.trim(),
    geminiKey:     el('s-gemini-key').value.trim(),
    textModel:     el('s-text-model').value.trim(),
    latexModel:    el('s-latex-model').value.trim(),
    sheetsUrl:     el('s-sheets').value.trim(),
  };
  await chrome.storage.local.set({ settings: state.settings });
  showFeedback(el('settings-feedback'), '✓ Settings saved', 'success');
}

// ─── STORAGE TAB ─────────────────────────────────────────────────────────────
function bindStorageTab() {
  el('btn-refresh-storage').addEventListener('click', refreshStorageExplorer);
  el('btn-clear-all-storage').addEventListener('click', async () => {
    if (!confirm('Clear ALL storage? This deletes your profile, settings, and JD.')) return;
    await sendMsg({ type: 'CLEAR_ALL_STORAGE' });
    state.profile  = structuredClone(DEFAULT_PROFILE);
    state.settings = {};
    state.jd       = null;
    refreshStorageExplorer();
    refreshJDStatus();
    clearAnalysisPanel();
  });
}

async function refreshStorageExplorer() {
  const res  = await sendMsg({ type: 'GET_ALL_STORAGE' });
  const list = el('storage-list');
  list.innerHTML = '';
  const entries = Object.entries(res.data || {});
  if (!entries.length) {
    list.innerHTML = '<p class="hint-text" style="text-align:center;padding:10px 0">Storage is empty.</p>';
    return;
  }
  entries.forEach(([key, value]) => {
    const str  = JSON.stringify(value);
    const size = new Blob([str]).size;
    const row  = document.createElement('div');
    row.className = 'storage-row';
    row.innerHTML = `
      <div class="storage-row-header">
        <span class="storage-key">${escHtml(key)}</span>
        <div class="row-gap">
          <span class="storage-size">${fmtBytes(size)}</span>
          <button class="btn-delete-key" data-key="${escAttr(key)}">Delete</button>
        </div>
      </div>
      <div class="storage-preview">${escHtml(str.slice(0, 120))}${str.length > 120 ? '…' : ''}</div>`;
    row.querySelector('.btn-delete-key').addEventListener('click', async e => {
      await sendMsg({ type: 'DELETE_STORAGE_KEY', key: e.target.dataset.key });
      row.remove();
    });
    list.appendChild(row);
  });
}

// ─── Utility ──────────────────────────────────────────────────────────────────
function el(id)  { return document.getElementById(id); }
function setVal(id, val) { const e = el(id); if (e && val != null) e.value = val; }

function sendMsg(msg) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(msg, res => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(res);
    });
  });
}

function setBtnLoading(btn, loading, label) {
  if (!btn) return;
  btn.disabled = loading;
  btn.textContent = label;
  btn.classList.toggle('loading', loading);
}

function showToast(msg, type = 'error') {
  const theme = type === 'success'
    ? { bg: '#f1fff6', border: '#c9efd9', color: '#2f8d64' }
    : { bg: '#fff0f3', border: '#f5c9d1', color: '#cf5266' };
  const t  = document.createElement('div');
  t.style.cssText = `position:fixed;bottom:18px;left:50%;transform:translateX(-50%);background:${theme.bg};border:1px solid ${theme.border};color:${theme.color};padding:12px 16px;border-radius:18px;font-size:12px;font-weight:700;z-index:9999;max-width:88%;text-align:center;box-shadow:0 18px 36px rgba(59,47,34,.12);backdrop-filter:blur(10px);`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 4000);
}

function showFeedback(feedbackEl, msg, type) {
  feedbackEl.textContent = msg;
  feedbackEl.className = `feedback ${type}`;
  feedbackEl.classList.remove('hidden');
  setTimeout(() => feedbackEl.classList.add('hidden'), 3500);
}

function fmtBytes(b) {
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1048576).toFixed(2)} MB`;
}

function escHtml(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function escAttr(s) { return String(s || '').replace(/"/g, '&quot;'); }
