#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { createInterface } from "node:readline/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  buildPersonalizationPrompt,
  buildQuestionPrompt,
  buildResumeParsePrompt
} from "./prompts.mjs";

try {
  process.loadEnvFile();
} catch (error) {
  if (error?.code !== "ENOENT") {
    throw error;
  }
}

const execFileAsync = promisify(execFile);
const DEFAULT_MODELS = {
  openrouter: "anthropic/claude-3.5-sonnet",
  gemini: "gemini-2.5-flash"
};
const DEFAULT_OUT_DIR = ".briefly";

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help || !isSupportedCommand(args.command)) {
    printHelp();
    process.exit(args.help ? 0 : 1);
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  try {
    const resumePath = await resolveResumePath(args, rl);
    const provider = resolveProvider(args);
    const apiKey = await resolveApiKey(args, rl, provider);
    const model = args.model || getDefaultModel(provider);
    const outDir = path.resolve(args.out || DEFAULT_OUT_DIR);

    console.log(`\nLoading resume from ${resumePath}`);
    const resumeText = await readResumeText(resumePath);
    if (!resumeText.trim()) {
      throw new Error("Resume text is empty after extraction.");
    }

    console.log("Parsing resume into structured sections...");
    const parsedProfile = normalizeProfile(await callJsonModel({
      provider,
      apiKey,
      model,
      prompt: buildResumeParsePrompt(resumeText),
      maxTokens: 4000
    }));

    const profileMarkdown = renderProfileMarkdown(parsedProfile, resumePath);

    await fs.mkdir(outDir, { recursive: true });
    await fs.writeFile(path.join(outDir, "resume.txt"), resumeText, "utf8");
    await fs.writeFile(path.join(outDir, "profile.json"), JSON.stringify(parsedProfile, null, 2), "utf8");
    await fs.writeFile(path.join(outDir, "profile.md"), profileMarkdown, "utf8");

    console.log(`Saved parsed profile to ${path.join(outDir, "profile.md")}`);

    const firstRoundQuestions = await loadQuestions({
      provider,
      apiKey,
      model,
      profileMarkdown,
      previousAnswers: [],
      fallbackQuestions: defaultQuestionSet()
    });

    const firstRoundAnswers = await askQuestions(rl, firstRoundQuestions, "Round 1");

    const secondRoundQuestions = await loadQuestions({
      provider,
      apiKey,
      model,
      profileMarkdown,
      previousAnswers: firstRoundAnswers,
      fallbackQuestions: []
    });

    const secondRoundAnswers = secondRoundQuestions.length
      ? await askQuestions(rl, secondRoundQuestions, "Round 2")
      : [];

    const allAnswers = [...firstRoundAnswers, ...secondRoundAnswers];
    const interviewMarkdown = renderInterviewMarkdown(allAnswers);

    await fs.writeFile(path.join(outDir, "personalization-interview.md"), interviewMarkdown, "utf8");

    console.log("\nGenerating personalization.md...");
    const personalizationMarkdown = await callMarkdownModel({
      provider,
      apiKey,
      model,
      prompt: buildPersonalizationPrompt(profileMarkdown, interviewMarkdown),
      maxTokens: 1800
    });

    await fs.writeFile(path.join(outDir, "personalization.md"), personalizationMarkdown.trim() + "\n", "utf8");

    console.log("\nDone.");
    console.log(`- Profile: ${path.join(outDir, "profile.md")}`);
    console.log(`- Interview notes: ${path.join(outDir, "personalization-interview.md")}`);
    console.log(`- Personalization: ${path.join(outDir, "personalization.md")}`);
  } finally {
    rl.close();
  }
}

function parseArgs(argv) {
  const args = {
    command: "setup",
    help: false
  };

  let index = 0;
  if (argv[0] && !argv[0].startsWith("-")) {
    args.command = argv[0];
    index = 1;
  }

  while (index < argv.length) {
    const token = argv[index];
    switch (token) {
      case "--resume":
      case "-r":
        args.resume = argv[index + 1];
        index += 2;
        break;
      case "--out":
      case "-o":
        args.out = argv[index + 1];
        index += 2;
        break;
      case "--model":
      case "-m":
        args.model = argv[index + 1];
        index += 2;
        break;
      case "--provider":
      case "-p":
        args.provider = argv[index + 1];
        index += 2;
        break;
      case "--api-key":
        args.apiKey = argv[index + 1];
        index += 2;
        break;
      case "--openrouter-api-key":
        args.openRouterKey = argv[index + 1];
        index += 2;
        break;
      case "--gemini-api-key":
        args.geminiKey = argv[index + 1];
        index += 2;
        break;
      case "--help":
      case "-h":
        args.help = true;
        index += 1;
        break;
      default:
        throw new Error(`Unknown argument: ${token}`);
    }
  }

  return args;
}

function isSupportedCommand(command) {
  return command === "setup";
}

function printHelp() {
  console.log(`
Briefly CLI

Usage:
  npm run setup-profile -- --resume /absolute/path/to/resume.pdf
  node cli/briefly.mjs setup --resume /absolute/path/to/resume.txt

Options:
  --resume, -r   Path to a .pdf, .txt, or .md resume
  --out, -o      Output directory for generated files (default: ./.briefly)
  --provider, -p AI provider: openrouter or gemini (default: openrouter)
  --model, -m    Model id for the selected provider
  --api-key      API key for the selected provider
  --openrouter-api-key  Explicit OpenRouter API key
  --gemini-api-key      Explicit Gemini API key
  --help, -h     Show this help text

Outputs:
  profile.md
  profile.json
  resume.txt
  personalization-interview.md
  personalization.md

Notes:
  - PDF extraction uses 'pdftotext' when available and otherwise falls back to a built-in parser.
  - Run 'npm install' in the repo root before using PDF resumes.
  - The CLI auto-loads a local .env file when present.
  - Vertex AI mode is enabled when GOOGLE_GENAI_USE_VERTEXAI=true.
  - Vertex AI also requires Application Default Credentials, for example:
    gcloud auth application-default login
`);
}

async function resolveResumePath(args, rl) {
  const providedPath = args.resume || (await rl.question("Resume path (.pdf, .txt, .md): "));
  if (!providedPath.trim()) {
    throw new Error("A resume path is required.");
  }

  const absolutePath = path.resolve(providedPath.trim());
  await fs.access(absolutePath);
  return absolutePath;
}

function resolveProvider(args) {
  const provider = String(
    args.provider ||
    process.env.BRIEFLY_AI_PROVIDER ||
    (isVertexAIEnabled()
      ? "gemini"
      : null) ||
    (((args.geminiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.BRIEFLY_GEMINI_KEY) &&
      !(args.openRouterKey || process.env.OPENROUTER_API_KEY || process.env.BRIEFLY_OPENROUTER_KEY))
      ? "gemini"
      : "openrouter")
  ).trim().toLowerCase();

  if (provider !== "openrouter" && provider !== "gemini") {
    throw new Error(`Unsupported provider '${provider}'. Use 'openrouter' or 'gemini'.`);
  }

  return provider;
}

function getDefaultModel(provider) {
  return DEFAULT_MODELS[provider] || DEFAULT_MODELS.openrouter;
}

function getProviderLabel(provider) {
  return provider === "gemini" ? "Gemini" : "OpenRouter";
}

async function resolveApiKey(args, rl, provider) {
  if (provider === "gemini" && isVertexAIEnabled()) {
    ensureVertexConfiguration();
    return "";
  }

  const apiKey = provider === "gemini"
    ? (
      args.geminiKey ||
      args.apiKey ||
      process.env.GEMINI_API_KEY ||
      process.env.GOOGLE_API_KEY ||
      process.env.BRIEFLY_GEMINI_KEY ||
      (await rl.question("Gemini API key: "))
    )
    : (
      args.openRouterKey ||
      args.apiKey ||
      process.env.OPENROUTER_API_KEY ||
      process.env.BRIEFLY_OPENROUTER_KEY ||
      (await rl.question("OpenRouter API key: "))
    );

  if (!apiKey.trim()) {
    throw new Error(`A ${getProviderLabel(provider)} API key is required.`);
  }

  return apiKey.trim();
}

async function readResumeText(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".txt" || extension === ".md") {
    return cleanResumeText(await fs.readFile(filePath, "utf8"));
  }

  if (extension === ".pdf") {
    return cleanResumeText(await extractPdfText(filePath));
  }

  throw new Error(`Unsupported resume file type '${extension}'. Use .pdf, .txt, or .md.`);
}

async function extractPdfText(filePath) {
  try {
    const { stdout } = await execFileAsync("pdftotext", ["-layout", filePath, "-"], { maxBuffer: 10 * 1024 * 1024 });
    return stdout;
  } catch (error) {
    if (error.code !== "ENOENT") {
      const stderr = typeof error.stderr === "string" ? error.stderr.trim() : "";
      if (stderr) {
        console.warn(`pdftotext failed, falling back to the built-in PDF parser: ${stderr}`);
      }
    }

    return extractPdfTextWithPdfJs(filePath);
  }
}

async function extractPdfTextWithPdfJs(filePath) {
  let pdfjs;
  try {
    pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  } catch (_error) {
    throw new Error(
      "PDF parsing fallback requires the 'pdfjs-dist' package. Run 'npm install' in the repo root and try again."
    );
  }

  const buffer = await fs.readFile(filePath);
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    disableWorker: true,
    useSystemFonts: true,
  });
  const pdf = await loadingTask.promise;

  const pages = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const pageText = textContent.items
      .map(item => typeof item?.str === "string" ? item.str : "")
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    pages.push(pageText);
  }

  return pages.join("\n\n").trim();
}

function cleanResumeText(text) {
  return String(text || "")
    .replace(/\r/g, "")
    .replace(/\u0000/g, "")
    .split("\n")
    .map(line => line.replace(/\s+/g, " ").trimEnd())
    .join("\n")
    .trim();
}

async function loadQuestions({ provider, apiKey, model, profileMarkdown, previousAnswers, fallbackQuestions }) {
  try {
    const result = await callJsonModel({
      provider,
      apiKey,
      model,
      prompt: buildQuestionPrompt(profileMarkdown, previousAnswers),
      maxTokens: previousAnswers.length ? 700 : 1200
    });

    const questions = normalizeQuestions(result);
    if (questions.length > 0) {
      return questions;
    }
  } catch (error) {
    if (previousAnswers.length === 0) {
      console.warn(`Falling back to default interview questions: ${error.message}`);
    }
  }

  return fallbackQuestions;
}

async function askQuestions(rl, questions, roundLabel) {
  if (!questions.length) {
    return [];
  }

  console.log(`\n${roundLabel}:`);

  const answers = [];
  for (let index = 0; index < questions.length; index += 1) {
    const question = questions[index];
    console.log(`\n${index + 1}. ${question.question}`);
    if (question.intent) {
      console.log(`   Why this matters: ${question.intent}`);
    }

    const answer = await rl.question("> ");
    answers.push({
      id: question.id || `q${index + 1}`,
      question: question.question,
      intent: question.intent || "",
      answer: answer.trim() || "Skipped by user."
    });
  }

  return answers;
}

async function callJsonModel({ provider, apiKey, model, prompt, maxTokens }) {
  const raw = await callProvider({
    provider,
    apiKey,
    model,
    systemPrompt: prompt.system,
    userPrompt: prompt.user,
    maxTokens,
    structured: true
  });

  return parseJsonResponse(raw);
}

async function callMarkdownModel({ provider, apiKey, model, prompt, maxTokens }) {
  const raw = await callProvider({
    provider,
    apiKey,
    model,
    systemPrompt: prompt.system,
    userPrompt: prompt.user,
    maxTokens,
    structured: false
  });

  const cleaned = String(raw || "").trim();
  if (!cleaned) {
    throw new Error("OpenRouter returned empty markdown content.");
  }

  return cleaned;
}

async function callProvider({ provider, apiKey, model, systemPrompt, userPrompt, maxTokens, structured }) {
  if (provider === "gemini") {
    return callGemini({ apiKey, model, systemPrompt, userPrompt, maxTokens, structured });
  }

  return callOpenRouter({ apiKey, model, systemPrompt, userPrompt, maxTokens });
}

async function callOpenRouter({ apiKey, model, systemPrompt, userPrompt, maxTokens }) {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://briefly.local/cli",
      "X-Title": "Briefly CLI"
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ]
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenRouter ${response.status}: ${body}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  const normalized = normalizeContent(content);
  if (!normalized) {
    throw new Error("OpenRouter returned no message content.");
  }

  return normalized;
}

async function callGemini({ apiKey, model, systemPrompt, userPrompt, maxTokens, structured }) {
  const { GoogleGenAI } = await loadGoogleGenAI();
  const ai = isVertexAIEnabled()
    ? createVertexAIClient(GoogleGenAI)
    : new GoogleGenAI({ apiKey });

  const response = await ai.models.generateContent({
    model: normalizeGeminiModel(model),
    contents: userPrompt,
    config: {
      systemInstruction: systemPrompt,
      temperature: structured ? 0.15 : 0.3,
      maxOutputTokens: maxTokens,
      responseMimeType: structured ? "application/json" : "text/plain"
    }
  });

  const text =
    (typeof response?.text === "string" ? response.text : "") ||
    normalizeGeminiSdkResponse(response);
  if (!text) {
    const blockReason = response?.promptFeedback?.blockReason;
    if (blockReason) {
      throw new Error(`Gemini blocked the response: ${blockReason}`);
    }
    throw new Error("Gemini returned no message content.");
  }

  return text;
}

function normalizeContent(content) {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map(part => {
        if (typeof part === "string") {
          return part;
        }
        return typeof part?.text === "string" ? part.text : "";
      })
      .join("")
      .trim();
  }

  return "";
}

function normalizeGeminiSdkResponse(data) {
  const parts = data?.candidates?.[0]?.content?.parts || [];
  return parts
    .map(part => typeof part?.text === "string" ? part.text : "")
    .join("")
    .trim();
}

function normalizeGeminiModel(modelId) {
  const model = String(modelId || "").trim();
  return model.startsWith("models/") ? model.slice("models/".length) : model;
}

function isVertexAIEnabled() {
  return /^(1|true|yes)$/i.test(String(process.env.GOOGLE_GENAI_USE_VERTEXAI || "").trim());
}

function ensureVertexConfiguration() {
  if (!process.env.GOOGLE_CLOUD_PROJECT || !process.env.GOOGLE_CLOUD_LOCATION) {
    throw new Error(
      "Vertex AI mode requires GOOGLE_CLOUD_PROJECT and GOOGLE_CLOUD_LOCATION in your environment or .env file."
    );
  }
}

async function loadGoogleGenAI() {
  try {
    return await import("@google/genai");
  } catch (error) {
    throw new Error(
      "Gemini support requires the @google/genai package. Run 'npm install' in the repo root before using Gemini."
    );
  }
}

function createVertexAIClient(GoogleGenAI) {
  ensureVertexConfiguration();
  return new GoogleGenAI({
    vertexai: true,
    project: process.env.GOOGLE_CLOUD_PROJECT,
    location: process.env.GOOGLE_CLOUD_LOCATION,
  });
}

function parseJsonResponse(raw) {
  const cleaned = String(raw || "")
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/g, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch (error) {
    const snippet = cleaned.slice(0, 300);
    throw new Error(`Failed to parse model JSON response. Snippet: ${snippet}`);
  }
}

function normalizeProfile(profile) {
  return {
    personal: normalizePersonal(profile.personal),
    education: normalizeArray(profile.education, normalizeEducationItem),
    experience: normalizeArray(profile.experience, normalizeExperienceItem),
    projects: normalizeArray(profile.projects, normalizeProjectItem),
    skills: normalizeSkills(profile.skills),
    achievements: normalizeArray(profile.achievements, normalizeAchievementItem),
    certifications: normalizeArray(profile.certifications, normalizeCertificationItem),
    courses: normalizeArray(profile.courses, normalizeCourseItem)
  };
}

function normalizePersonal(personal = {}) {
  return {
    name: asText(personal.name),
    email: asText(personal.email),
    phone: asText(personal.phone),
    location: asText(personal.location),
    linkedin: asText(personal.linkedin),
    github: asText(personal.github),
    website: asText(personal.website),
    summary: asText(personal.summary)
  };
}

function normalizeEducationItem(item = {}) {
  return {
    institution: asText(item.institution),
    degree: asText(item.degree),
    field: asText(item.field),
    startDate: asText(item.startDate),
    endDate: asText(item.endDate),
    gpa: asText(item.gpa),
    bullets: asTextArray(item.bullets)
  };
}

function normalizeExperienceItem(item = {}) {
  return {
    company: asText(item.company),
    title: asText(item.title),
    location: asText(item.location),
    startDate: asText(item.startDate),
    endDate: asText(item.endDate),
    technologies: asTextArray(item.technologies),
    bullets: asTextArray(item.bullets)
  };
}

function normalizeProjectItem(item = {}) {
  return {
    name: asText(item.name),
    tech: asText(item.tech),
    url: asText(item.url),
    bullets: asTextArray(item.bullets)
  };
}

function normalizeAchievementItem(item = {}) {
  return {
    name: asText(item.name),
    date: asText(item.date),
    description: asText(item.description)
  };
}

function normalizeCertificationItem(item = {}) {
  return {
    name: asText(item.name),
    issuer: asText(item.issuer),
    date: asText(item.date)
  };
}

function normalizeCourseItem(item = {}) {
  return {
    name: asText(item.name),
    institution: asText(item.institution),
    date: asText(item.date),
    level: asText(item.level)
  };
}

function normalizeSkills(skills = {}) {
  return {
    languages: asTextArray(skills.languages),
    frameworks: asTextArray(skills.frameworks),
    tools: asTextArray(skills.tools),
    domains: asTextArray(skills.domains)
  };
}

function normalizeQuestions(value) {
  return normalizeArray(value, item => ({
    id: asText(item.id),
    question: asText(item.question),
    intent: asText(item.intent)
  })).filter(item => item.question);
}

function normalizeArray(value, mapper) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map(entry => mapper(entry)).filter(Boolean);
}

function asText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function asTextArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map(entry => asText(entry))
    .filter(Boolean);
}

function renderProfileMarkdown(profile, resumePath) {
  const lines = [
    "# Profile",
    "",
    `- Source Resume: ${path.basename(resumePath)}`,
    `- Generated At: ${new Date().toISOString()}`,
    ""
  ];

  appendSection(lines, "Personal", renderPersonalSection(profile.personal));
  appendSection(lines, "Education", renderEducationSection(profile.education));
  appendSection(lines, "Experience", renderExperienceSection(profile.experience));
  appendSection(lines, "Projects", renderProjectsSection(profile.projects));
  appendSection(lines, "Skills", renderSkillsSection(profile.skills));
  appendSection(lines, "Achievements", renderAchievementsSection(profile.achievements));
  appendSection(lines, "Certifications", renderCertificationsSection(profile.certifications));
  appendSection(lines, "Courses", renderCoursesSection(profile.courses));

  return lines.join("\n").trim() + "\n";
}

function appendSection(lines, title, sectionLines) {
  lines.push(`## ${title}`);
  if (sectionLines.length) {
    lines.push(...sectionLines);
  } else {
    lines.push("- Not found in the resume.");
  }
  lines.push("");
}

function renderPersonalSection(personal) {
  const lines = [];
  pushKeyValue(lines, "Name", personal.name);
  pushKeyValue(lines, "Email", personal.email);
  pushKeyValue(lines, "Phone", personal.phone);
  pushKeyValue(lines, "Location", personal.location);
  pushKeyValue(lines, "LinkedIn", personal.linkedin);
  pushKeyValue(lines, "GitHub", personal.github);
  pushKeyValue(lines, "Website", personal.website);
  pushKeyValue(lines, "Summary", personal.summary);
  return lines;
}

function renderEducationSection(items) {
  return renderTitledItems(items, item => {
    const heading = [item.degree, item.field].filter(Boolean).join(" in ");
    const title = heading || item.institution || "Education Entry";
    const lines = [`### ${title}`];
    pushKeyValue(lines, "Institution", item.institution);
    pushKeyValue(lines, "Dates", joinParts([item.startDate, item.endDate], " - "));
    pushKeyValue(lines, "GPA", item.gpa);
    pushBullets(lines, "Notes", item.bullets);
    return lines;
  });
}

function renderExperienceSection(items) {
  return renderTitledItems(items, item => {
    const title = [item.title, item.company].filter(Boolean).join(" at ") || "Experience Entry";
    const lines = [`### ${title}`];
    pushKeyValue(lines, "Location", item.location);
    pushKeyValue(lines, "Dates", joinParts([item.startDate, item.endDate], " - "));
    pushKeyValue(lines, "Technologies", item.technologies.join(", "));
    pushBullets(lines, "Highlights", item.bullets);
    return lines;
  });
}

function renderProjectsSection(items) {
  return renderTitledItems(items, item => {
    const lines = [`### ${item.name || "Project"}`];
    pushKeyValue(lines, "Tech", item.tech);
    pushKeyValue(lines, "URL", item.url);
    pushBullets(lines, "Highlights", item.bullets);
    return lines;
  });
}

function renderSkillsSection(skills) {
  const lines = [];
  pushKeyValue(lines, "Languages", skills.languages.join(", "));
  pushKeyValue(lines, "Frameworks", skills.frameworks.join(", "));
  pushKeyValue(lines, "Tools", skills.tools.join(", "));
  pushKeyValue(lines, "Domains", skills.domains.join(", "));
  return lines;
}

function renderAchievementsSection(items) {
  return renderTitledItems(items, item => {
    const lines = [`### ${item.name || "Achievement"}`];
    pushKeyValue(lines, "Date", item.date);
    pushKeyValue(lines, "Description", item.description);
    return lines;
  });
}

function renderCertificationsSection(items) {
  return renderTitledItems(items, item => {
    const lines = [`### ${item.name || "Certification"}`];
    pushKeyValue(lines, "Issuer", item.issuer);
    pushKeyValue(lines, "Date", item.date);
    return lines;
  });
}

function renderCoursesSection(items) {
  return renderTitledItems(items, item => {
    const lines = [`### ${item.name || "Course"}`];
    pushKeyValue(lines, "Institution", item.institution);
    pushKeyValue(lines, "Date", item.date);
    pushKeyValue(lines, "Level", item.level);
    return lines;
  });
}

function renderTitledItems(items, renderItem) {
  const lines = [];
  for (const item of items) {
    lines.push(...renderItem(item), "");
  }
  while (lines.length && lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines;
}

function pushKeyValue(lines, key, value) {
  if (value) {
    lines.push(`- ${key}: ${value}`);
  }
}

function pushBullets(lines, label, bullets) {
  if (!bullets.length) {
    return;
  }

  lines.push(`- ${label}:`);
  for (const bullet of bullets) {
    lines.push(`  - ${bullet}`);
  }
}

function joinParts(parts, separator) {
  return parts.filter(Boolean).join(separator);
}

function renderInterviewMarkdown(answers) {
  const lines = ["# Personalization Interview", ""];

  if (!answers.length) {
    lines.push("- No interview answers captured.");
    return lines.join("\n") + "\n";
  }

  answers.forEach((item, index) => {
    lines.push(`## Question ${index + 1}`);
    lines.push(`- Prompt: ${item.question}`);
    if (item.intent) {
      lines.push(`- Why: ${item.intent}`);
    }
    lines.push(`- Answer: ${item.answer}`);
    lines.push("");
  });

  return lines.join("\n").trim() + "\n";
}

function defaultQuestionSet() {
  return [
    {
      id: "target_roles",
      question: "What roles are you actively targeting right now, and what level do you want to be considered for?",
      intent: "This tells Briefly how to position your background for the jobs you actually want."
    },
    {
      id: "beyond_resume",
      question: "What meaningful work, impact, or responsibilities have you handled that are not clearly captured in your resume yet?",
      intent: "This uncovers evidence we can use in personalization without rewriting the original resume facts."
    },
    {
      id: "tech_depth",
      question: "Which technologies or systems have you used deeply, even if they are only lightly mentioned on the resume?",
      intent: "This helps tailor applications around concrete technical depth."
    },
    {
      id: "problem_space",
      question: "What kinds of problems or product areas do you most enjoy working on?",
      intent: "This helps align your story with domain and team fit."
    },
    {
      id: "proof_points",
      question: "What results, wins, leadership moments, or high-ownership examples do you want highlighted during applications?",
      intent: "This provides memorable proof points for cover letters and tailored resumes."
    },
    {
      id: "preferences",
      question: "Are there any preferences or constraints we should remember, such as remote vs onsite, industries, locations, visas, or role types?",
      intent: "This makes the personalization file practical for real applications."
    }
  ];
}

main().catch(error => {
  console.error(`\nError: ${error.message}`);
  process.exit(1);
});
