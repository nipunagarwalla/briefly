export function buildResumeParsePrompt(resumeText) {
  return {
    system: [
      "You extract structured resume data.",
      "Return ONLY a minified single-line JSON object.",
      "Do not include markdown fences, prose, or comments.",
      "Preserve facts exactly as written when available.",
      "Use empty strings or empty arrays when information is missing.",
      "Do not invent achievements, technologies, dates, employers, or education details."
    ].join(" "),
    user: [
      "Convert the resume below into this exact JSON schema:",
      '{"personal":{"name":"","email":"","phone":"","location":"","linkedin":"","github":"","website":"","summary":""},"education":[{"institution":"","degree":"","field":"","startDate":"","endDate":"","gpa":"","bullets":[]}],"experience":[{"company":"","title":"","location":"","startDate":"","endDate":"","technologies":[],"bullets":[]}],"projects":[{"name":"","tech":"","url":"","bullets":[]}],"skills":{"languages":[],"frameworks":[],"tools":[],"domains":[]},"achievements":[{"name":"","date":"","description":""}],"certifications":[{"name":"","issuer":"","date":""}],"courses":[{"name":"","institution":"","date":"","level":""}]}',
      "RESUME TEXT:",
      resumeText
    ].join("\n")
  };
}

export function buildQuestionPrompt(profileMarkdown, previousAnswers = []) {
  const hasHistory = previousAnswers.length > 0;
  return {
    system: [
      "You are interviewing a candidate to build a personalization dossier for job applications.",
      "Ask only high-value questions that uncover details not already explicit in the resume/profile.",
      "Return ONLY a minified single-line JSON array of objects.",
      'Each object must have exactly these keys: {"id":"","question":"","intent":""}.',
      hasHistory
        ? "This is a second-pass follow-up round. Ask at most 3 non-overlapping questions. If there are no meaningful gaps left, return []."
        : "This is the first-pass interview round. Ask 5 to 6 concise but high-value questions.",
      "Focus on target roles, problems the candidate likes solving, impact beyond the resume, technology depth, domain preferences, and differentiators.",
      "Do not repeat questions that are already answered."
    ].join(" "),
    user: [
      "PROFILE MARKDOWN:",
      profileMarkdown,
      "",
      hasHistory ? "PREVIOUS ANSWERS:" : "PREVIOUS ANSWERS: None",
      hasHistory ? JSON.stringify(previousAnswers) : "[]"
    ].join("\n")
  };
}

export function buildPersonalizationPrompt(profileMarkdown, interviewMarkdown) {
  return {
    system: [
      "You create markdown dossiers used to personalize job applications.",
      "Use ONLY facts present in the profile markdown and interview answers.",
      "Do not invent details, metrics, technologies, or preferences.",
      "Write clear markdown beginning with '# Personalization'.",
      "Use these sections in order: '## Target Roles', '## Positioning Themes', '## Experience Beyond The Resume', '## Technology Depth', '## Preferred Domains And Problems', '## Constraints And Preferences', '## Proof Points To Emphasize', '## Tailoring Notes'.",
      "Use flat bullet lists under each section.",
      "If a section has little evidence, say '- Not provided yet.'"
    ].join(" "),
    user: [
      "PROFILE MARKDOWN:",
      profileMarkdown,
      "",
      "INTERVIEW ANSWERS:",
      interviewMarkdown
    ].join("\n")
  };
}
