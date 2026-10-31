// @bun
// src/util.ts
function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function hashText(value) {
  let hash = 2166136261;
  for (let index = 0;index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

// src/config.ts
var TAG_NAME = /^[A-Za-z][A-Za-z0-9._:-]{0,63}$/;
var OVERRIDE_NAME = /^[A-Za-z0-9_]{1,64}$/;
var ROLES = new Set(["system", "user", "assistant"]);
var DEFAULT_PROMPT_TEMPLATE = [
  "<shape_scene_direction>",
  "- DIRECTION TARGET: Treat the upcoming prewritten scene as a long-term destination. Gradually shape the narrative's setting, character positions, emotional state, and momentum so the scene can begin naturally and immediately afterward. Do not force a fade-out or make the guidance visible.",
  "- PACING AND HANDOFF: Reach the scene slowly over multiple turns. Continue the present narrative until its required conditions feel earned, rather than transitioning at the first plausible opportunity. Favor gradual progression toward the handoff point over immediate scene setup.",
  "- LATE HANDOFF POLICY: Continue the current narrative naturally until it reaches the doorstep of the upcoming prewritten scene. Move toward that point gradually across several turns without forcing a bridge or rushing the required setup. Trigger the handoff at the latest viable moment, ideally immediately before the scene begins. Do not hand off merely because of a calm pause, completed emotional beat, natural stopping point, fade-out, summary, chapter break, or other convenient ending.",
  "- VALID HANDOFF THRESHOLD: Hand off only when the narrative has reached the immediate starting point of the upcoming prewritten scene. The next assistant reply must be able to begin that scene without additional setup, explanation, bridging, or character repositioning. If the current narrative can still progress naturally toward that point, continue instead. When uncertain, delay the handoff and move closer at a normal pace. Never use a large time skip solely to reach the threshold faster.",
  "- USER INJECTION OVERRIDE TAG: If the user's latest reply contains {{override_tag}}, override the normal pacing rules and use the next response to make a best-effort transition toward the handoff threshold. Force the narrative into the closest viable starting position for the upcoming prewritten scene, using only as much bridging, repositioning, or time progression as necessary. The following assistant response must include {{handoff_tag}} exactly once, even if the threshold could not be reached perfectly.",
  "- PREWRITTEN CONTENT INJECTION TAG: Once the handoff threshold is fully reached, include {{handoff_tag}} exactly once on its own line. This hidden control tag exists only to trigger insertion of the upcoming prewritten content. Do not use it as a scene ending, chapter break, fade-out, or general transition marker. It may appear anywhere in the response and will be removed before the user sees it.",
  "- PREWRITTEN SCENE PRIVACY: Use the upcoming prewritten scene only as a private directional reference for pacing and steering the current narrative.",
  "- MANDATORY CONSTRAINT: Do not quote, summarize, paraphrase, adapt, preview, merge, or reproduce any part of the prewritten scene. Do not copy its wording, details, URLs, images, formatting, or headings. The scene will be inserted automatically after the handoff tag, so none of its content may appear beforehand.",
  "",
  "UPCOMING PREWRITTEN SCENE \u2014 DIRECTION AND TIMING REFERENCE ONLY:",
  "{{scene_excerpt}}",
  "</shape_scene_direction>"
].join(`
`);
var DEFAULT_STORYLINE_TEMPLATE = [
  "<storyline_overview>",
  "This roleplay follows a planned narrative journey for {{character_name}} through a sequence of prewritten waypoint scenes. Use this overview to keep long-term continuity, foreshadowing, character development, and pacing consistent with where the story is headed.",
  "- The overview covers the entire journey from start to finish, but the story may currently be anywhere along it. Use the journey position below to tell what has already happened and what is still ahead; never assume the story is at the beginning.",
  "- Treat it as private background guidance. Never reveal, quote, or summarize it to the user.",
  "- Do not skip ahead: events planned for later waypoints must not happen early. Let the story earn each step.",
  "",
  "{{storyline_overview}}",
  "",
  "{{storyline_position}}",
  "</storyline_overview>"
].join(`
`);
var DEFAULT_STORYLINE_GENERATOR_TEMPLATE = [
  "You are a narrative designer preparing private guidance for a storyteller AI that runs a long-form interactive roleplay with {{character_name}}.",
  "",
  "The roleplay will pass through the {{waypoint_count}} prewritten scenes below, in this order. Each scene is a waypoint that will be inserted verbatim when the story reaches it. Between waypoints, the storyteller improvises with the user and must steer the story so each next waypoint can begin naturally.",
  "",
  "Write a narrative overview of the entire journey that gives the storyteller the long-range context a single upcoming scene cannot:",
  "1. Premise and arc: the central situation, the relationships, the themes and tone, and how the story escalates or transforms from the first waypoint to the last.",
  "2. Waypoint by waypoint, as a numbered list: where and when it takes place, who is present, the emotional state, and what has to happen between the previous waypoint and this one for it to begin naturally (the bridge).",
  "3. Continuity: facts that must stay consistent across waypoints, such as names, relationships, injuries, possessions, locations, time of day, and season.",
  "4. Threads to foreshadow early and pay off later.",
  "",
  "Rules: summarize in your own words and never quote or reproduce the scenes' prose. Write in present tense as instructions to the storyteller. Use short headings and plain text without markdown tables. Keep it under about 800 words. Output only the overview.",
  "",
  "Character: {{character_name}}",
  "Description: {{character_description}}",
  "Personality: {{character_personality}}",
  "Scenario: {{character_scenario}}",
  "",
  "Author guidance: {{author_notes}}",
  "",
  "Waypoints in story order:",
  "",
  "{{waypoints}}"
].join(`
`);
var DEFAULT_SETTINGS = {
  promptTemplate: DEFAULT_PROMPT_TEMPLATE,
  prewrittenSceneCharLimit: 2000,
  promptExcludeRegex: "/[ \\t]*(?:\\r?\\n)?[ \\t]*(?:<\\/?(?:div|span|img)\\b[^>]*>|<!--[\\s\\S]*?-->)[ \\t]*/gi",
  autoPrompt: false,
  insertionDepth: 0,
  promptRole: "system",
  handoffTagName: "inject-prewritten-content",
  overrideTagName: "o",
  interceptorPriority: 100,
  contentProcessorPriority: 10,
  activeChatRetryAttempts: 10,
  activeChatRetryDelayMs: 100,
  handoffReadRetryAttempts: 10,
  handoffReadRetryDelayMs: 100,
  pendingHandoffLimit: 24,
  recentTransitionLimit: 40,
  diagnosticLogging: true,
  diagnosticLineLimit: 96,
  floatingControls: true,
  reminderToast: true,
  reminderTimeoutAction: "yes",
  actionBarButton: true,
  extrasActions: true,
  storylineTemplate: DEFAULT_STORYLINE_TEMPLATE,
  storylineGeneratorTemplate: DEFAULT_STORYLINE_GENERATOR_TEMPLATE,
  storylineInsertionDepth: 0,
  storylineWaypointCharLimit: 4000,
  storylineConnectionId: ""
};

class SettingsValidationError extends Error {
  issues;
  constructor(issues) {
    super(issues.map((issue) => issue.message).join(" "));
    this.name = "SettingsValidationError";
    this.issues = issues;
  }
}
function readString(input, field, fallback, maxLength, issues) {
  const value = input[field];
  if (value === undefined)
    return fallback;
  if (typeof value !== "string") {
    issues.push({ field, message: String(field) + " must be text." });
    return fallback;
  }
  if (value.length > maxLength) {
    issues.push({
      field,
      message: String(field) + " is too long (maximum " + String(maxLength) + " characters)."
    });
    return fallback;
  }
  return value;
}
function readBoolean(input, field, fallback, issues) {
  const value = input[field];
  if (value === undefined)
    return fallback;
  if (typeof value !== "boolean") {
    issues.push({ field, message: String(field) + " must be on or off." });
    return fallback;
  }
  return value;
}
function readInteger(input, field, fallback, min, max, issues) {
  const value = input[field];
  if (value === undefined)
    return fallback;
  if (!Number.isInteger(value) || Number(value) < min || Number(value) > max) {
    issues.push({
      field,
      message: String(field) + " must be a whole number from " + String(min) + " to " + String(max) + "."
    });
    return fallback;
  }
  return Number(value);
}
function readRole(input, issues) {
  const value = input.promptRole;
  if (value === undefined)
    return DEFAULT_SETTINGS.promptRole;
  if (typeof value !== "string" || !ROLES.has(value)) {
    issues.push({ field: "promptRole", message: "Prompt role must be system, user, or assistant." });
    return DEFAULT_SETTINGS.promptRole;
  }
  return value;
}
function readReminderTimeoutAction(input, issues) {
  const value = input.reminderTimeoutAction;
  if (value === undefined)
    return DEFAULT_SETTINGS.reminderTimeoutAction;
  if (value === "yes" || value === "no")
    return value;
  issues.push({ field: "reminderTimeoutAction", message: "Reminder timeout action must be Yes or No." });
  return DEFAULT_SETTINGS.reminderTimeoutAction;
}
function validateTagName(value) {
  return TAG_NAME.test(value);
}
function validateOverrideName(value) {
  return OVERRIDE_NAME.test(value);
}
function finalRegexDelimiter(value) {
  for (let index = value.length - 1;index > 0; index -= 1) {
    if (value[index] !== "/")
      continue;
    let backslashes = 0;
    for (let cursor = index - 1;cursor >= 0 && value[cursor] === "\\"; cursor -= 1)
      backslashes += 1;
    if (backslashes % 2 === 0)
      return index;
  }
  return -1;
}
function stripExtendedRegexWhitespace(pattern) {
  let output = "";
  let inClass = false;
  let escaped = false;
  let comment = false;
  for (let index = 0;index < pattern.length; index += 1) {
    const character = pattern[index];
    if (comment) {
      if (character === `
` || character === "\r")
        comment = false;
      continue;
    }
    if (escaped) {
      output += character;
      escaped = false;
      continue;
    }
    if (character === "\\") {
      output += character;
      escaped = true;
      continue;
    }
    if (character === "[" && !inClass) {
      inClass = true;
      output += character;
      continue;
    }
    if (character === "]" && inClass) {
      inClass = false;
      output += character;
      continue;
    }
    if (!inClass && character === "#") {
      comment = true;
      continue;
    }
    if (!inClass && /\s/.test(character))
      continue;
    output += character;
  }
  return output;
}
function compileExcludeRegex(value) {
  const trimmed = value.trim();
  if (!trimmed)
    return null;
  let pattern = trimmed;
  let flags = "";
  if (trimmed.startsWith("/")) {
    const delimiter = finalRegexDelimiter(trimmed);
    if (delimiter <= 0)
      throw new Error("Regex literal is missing its closing slash.");
    pattern = trimmed.slice(1, delimiter);
    flags = trimmed.slice(delimiter + 1);
    if (!/^[gimsuyx]*$/.test(flags)) {
      throw new Error("Regex flags may use g, i, m, s, u, y, and LumiScript's x flag.");
    }
    if (new Set(flags).size !== flags.length)
      throw new Error("Regex flags cannot be repeated.");
  }
  if (flags.includes("x")) {
    pattern = stripExtendedRegexWhitespace(pattern);
    flags = flags.replaceAll("x", "");
  }
  flags = flags.replaceAll("y", "");
  if (!flags.includes("g"))
    flags += "g";
  try {
    return new RegExp(pattern, flags);
  } catch (error) {
    throw new Error("Invalid exclusion regex: " + (error instanceof Error ? error.message : String(error)));
  }
}
function validateSettings(input) {
  const source = isRecord(input) ? input : {};
  const issues = [];
  const warnings = [];
  const promptTemplate = readString(source, "promptTemplate", DEFAULT_SETTINGS.promptTemplate, 32000, issues);
  const settings = {
    promptTemplate,
    prewrittenSceneCharLimit: readInteger(source, "prewrittenSceneCharLimit", DEFAULT_SETTINGS.prewrittenSceneCharLimit, 1, 1e5, issues),
    promptExcludeRegex: readString(source, "promptExcludeRegex", DEFAULT_SETTINGS.promptExcludeRegex, 4096, issues),
    autoPrompt: readBoolean(source, "autoPrompt", DEFAULT_SETTINGS.autoPrompt, issues),
    insertionDepth: readInteger(source, "insertionDepth", DEFAULT_SETTINGS.insertionDepth, 0, 9999, issues),
    promptRole: readRole(source, issues),
    handoffTagName: readString(source, "handoffTagName", DEFAULT_SETTINGS.handoffTagName, 64, issues),
    overrideTagName: readString(source, "overrideTagName", DEFAULT_SETTINGS.overrideTagName, 64, issues),
    interceptorPriority: readInteger(source, "interceptorPriority", DEFAULT_SETTINGS.interceptorPriority, 0, 1000, issues),
    contentProcessorPriority: readInteger(source, "contentProcessorPriority", DEFAULT_SETTINGS.contentProcessorPriority, 0, 1000, issues),
    activeChatRetryAttempts: readInteger(source, "activeChatRetryAttempts", DEFAULT_SETTINGS.activeChatRetryAttempts, 1, 25, issues),
    activeChatRetryDelayMs: readInteger(source, "activeChatRetryDelayMs", DEFAULT_SETTINGS.activeChatRetryDelayMs, 0, 2000, issues),
    handoffReadRetryAttempts: readInteger(source, "handoffReadRetryAttempts", DEFAULT_SETTINGS.handoffReadRetryAttempts, 1, 25, issues),
    handoffReadRetryDelayMs: readInteger(source, "handoffReadRetryDelayMs", DEFAULT_SETTINGS.handoffReadRetryDelayMs, 0, 2000, issues),
    pendingHandoffLimit: readInteger(source, "pendingHandoffLimit", DEFAULT_SETTINGS.pendingHandoffLimit, 1, 500, issues),
    recentTransitionLimit: readInteger(source, "recentTransitionLimit", DEFAULT_SETTINGS.recentTransitionLimit, 1, 500, issues),
    diagnosticLogging: readBoolean(source, "diagnosticLogging", DEFAULT_SETTINGS.diagnosticLogging, issues),
    diagnosticLineLimit: readInteger(source, "diagnosticLineLimit", DEFAULT_SETTINGS.diagnosticLineLimit, 10, 500, issues),
    floatingControls: readBoolean(source, "floatingControls", DEFAULT_SETTINGS.floatingControls, issues),
    reminderToast: readBoolean(source, "reminderToast", DEFAULT_SETTINGS.reminderToast, issues),
    reminderTimeoutAction: readReminderTimeoutAction(source, issues),
    actionBarButton: readBoolean(source, "actionBarButton", DEFAULT_SETTINGS.actionBarButton, issues),
    extrasActions: readBoolean(source, "extrasActions", DEFAULT_SETTINGS.extrasActions, issues),
    storylineTemplate: readString(source, "storylineTemplate", DEFAULT_SETTINGS.storylineTemplate, 16000, issues),
    storylineGeneratorTemplate: readString(source, "storylineGeneratorTemplate", DEFAULT_SETTINGS.storylineGeneratorTemplate, 16000, issues),
    storylineInsertionDepth: readInteger(source, "storylineInsertionDepth", DEFAULT_SETTINGS.storylineInsertionDepth, 0, 9999, issues),
    storylineWaypointCharLimit: readInteger(source, "storylineWaypointCharLimit", DEFAULT_SETTINGS.storylineWaypointCharLimit, 100, 1e5, issues),
    storylineConnectionId: readString(source, "storylineConnectionId", DEFAULT_SETTINGS.storylineConnectionId, 256, issues)
  };
  if (!settings.promptTemplate.includes("{{scene_excerpt}}")) {
    issues.push({ field: "template", message: "Prompt template must include {{scene_excerpt}}." });
  }
  if (!settings.promptTemplate.includes("{{handoff_tag}}")) {
    issues.push({ field: "template", message: "Prompt template must include {{handoff_tag}}." });
  }
  if (!settings.promptTemplate.includes("{{override_tag}}")) {
    warnings.push("The template omits {{override_tag}}; user override tags will not be explained to the model.");
  }
  if (!settings.storylineTemplate.includes("{{storyline_overview}}")) {
    issues.push({ field: "storylineTemplate", message: "Storyline template must include {{storyline_overview}}." });
  }
  if (!settings.storylineGeneratorTemplate.includes("{{waypoints}}")) {
    issues.push({ field: "storylineGeneratorTemplate", message: "Overview generator instructions must include {{waypoints}}." });
  }
  if (!validateTagName(settings.handoffTagName)) {
    issues.push({
      field: "handoffTagName",
      message: "Handoff tag names must start with a letter and may contain letters, numbers, dots, colons, underscores, or hyphens."
    });
  }
  if (!validateOverrideName(settings.overrideTagName)) {
    issues.push({
      field: "overrideTagName",
      message: "Override tag names may contain letters, numbers, and underscores."
    });
  }
  try {
    compileExcludeRegex(settings.promptExcludeRegex);
  } catch (error) {
    issues.push({
      field: "promptExcludeRegex",
      message: error instanceof Error ? error.message : String(error)
    });
  }
  if (issues.length)
    throw new SettingsValidationError(issues);
  return { settings, warnings };
}
function settingsFromStorage(input) {
  try {
    return validateSettings(input).settings;
  } catch (error) {
    if (error instanceof SettingsValidationError && isRecord(input)) {
      const repaired = { ...input };
      for (const issue of error.issues)
        delete repaired[issue.field === "template" ? "promptTemplate" : issue.field];
      try {
        return validateSettings(repaired).settings;
      } catch {}
    }
    return structuredClone(DEFAULT_SETTINGS);
  }
}

// src/prompt.ts
function escapeRegex(value) {
  return value.replace(/[.*+?^$()|[\]\\]/g, "\\$&");
}
function normalizeHandoffContent(content) {
  return String(content ?? "").replace(/[\u200B-\u200D\u2060\uFEFF]/g, "").replace(/\r\n?/g, `
`);
}
function handoffTag(settings) {
  return "<" + settings.handoffTagName + " />";
}
function overrideTag(settings) {
  return "--" + settings.overrideTagName + "--";
}
function handoffTagPattern(tagName) {
  const name = escapeRegex(tagName);
  const start = "<\\s*" + name + `(?=\\s|/|>)(?:[^>"']|"[^"]*"|'[^']*')*`;
  const selfClosing = start + "/\\s*>";
  const paired = start + ">([\\s\\S]*?)<\\s*/\\s*" + name + "\\s*>";
  return new RegExp(selfClosing + "|" + paired, "gi");
}
function stripHandoffTags(content, tagName) {
  const normalized = normalizeHandoffContent(content);
  let tagCount = 0;
  const stripped = normalized.replace(handoffTagPattern(tagName), () => {
    tagCount += 1;
    return "";
  });
  return {
    hasHandoff: tagCount > 0,
    tagCount,
    content: stripped.replace(/[ \t]+\n/g, `
`).replace(/\n{3,}/g, `

`).replace(/[ \t]{2,}/g, " ").trimEnd()
  };
}
function applyPromptExcludeRegex(scene, source) {
  const regex = compileExcludeRegex(source);
  return regex ? scene.replace(regex, "") : scene;
}
function substitute(template, placeholder, value) {
  return template.split(placeholder).join(value);
}
function renderPrompt(settings, scene) {
  const filteredScene = applyPromptExcludeRegex(scene, settings.promptExcludeRegex);
  const sceneExcerpt = filteredScene.slice(0, settings.prewrittenSceneCharLimit);
  let content = settings.promptTemplate;
  content = substitute(content, "{{scene_excerpt}}", sceneExcerpt);
  content = substitute(content, "{{handoff_tag}}", handoffTag(settings));
  content = substitute(content, "{{override_tag}}", overrideTag(settings));
  return { content, filteredScene, sceneExcerpt };
}
function insertAtDepths(messages, entries) {
  const at = (depth) => Math.max(0, messages.length - Math.max(0, depth));
  const result = [];
  for (let index = 0;index <= messages.length; index += 1) {
    for (const entry of entries)
      if (at(entry.depth) === index)
        result.push(entry.value);
    if (index < messages.length)
      result.push(messages[index]);
  }
  return result;
}

// src/types.ts
var EXTENSION_ID = "lumiverse_waypoints";
var CHAT_STATE_KEY = "lumiverse_waypoints.state.v1";
var SETTINGS_PATH = "settings.json";
var HANDOFF_EXTRA_KEY = "lumiverse_waypoints.handoff";
var INSERTED_GREETING_METADATA_KEY = "lumiverse_waypoints";
var STORYLINE_PATH_PREFIX = "storylines/";

// src/storyline.ts
var STORYLINE_NOTES_LIMIT = 8000;
var STORYLINE_OVERVIEW_LIMIT = 32000;
function storylinePath(characterId) {
  return STORYLINE_PATH_PREFIX + encodeURIComponent(characterId) + ".json";
}
function emptyStoryline(characterId) {
  return {
    version: 1,
    characterId,
    route: [],
    notes: "",
    overview: "",
    overviewSignature: "",
    generatedAt: null,
    updatedAt: 0
  };
}
function routeEntriesFrom(value) {
  if (!Array.isArray(value))
    return [];
  const seen = new Set;
  return value.flatMap((entry) => {
    if (!isRecord(entry) || !Number.isInteger(entry.greetingIndex) || Number(entry.greetingIndex) < 0)
      return [];
    const greetingIndex = Number(entry.greetingIndex);
    if (seen.has(greetingIndex))
      return [];
    seen.add(greetingIndex);
    return [{ greetingIndex, hash: typeof entry.hash === "string" ? entry.hash : "" }];
  });
}
function text(value, limit) {
  return typeof value === "string" ? value.slice(0, limit) : "";
}
function parseStoryline(value, characterId) {
  if (!isRecord(value) || value.version !== 1 || value.characterId !== characterId)
    return null;
  return {
    version: 1,
    characterId,
    route: routeEntriesFrom(value.route),
    notes: text(value.notes, STORYLINE_NOTES_LIMIT),
    overview: text(value.overview, STORYLINE_OVERVIEW_LIMIT),
    overviewSignature: typeof value.overviewSignature === "string" ? value.overviewSignature : "",
    generatedAt: Number.isFinite(value.generatedAt) ? Number(value.generatedAt) : null,
    updatedAt: Number.isFinite(value.updatedAt) ? Number(value.updatedAt) : 0
  };
}
function characterGreetings(greetings, characterId) {
  return greetings.filter((greeting) => greeting.characterId === characterId);
}
function resolveRoute(storyline, greetings) {
  if (!storyline?.route.length)
    return [];
  const own = characterGreetings(greetings, storyline.characterId);
  const byIndex = new Map(own.map((greeting) => [greeting.greetingIndex, greeting]));
  const hashes = new Map(own.map((greeting) => [greeting.greetingIndex, hashText(greeting.text)]));
  const claimed = new Set(storyline.route.filter((entry) => entry.hash && hashes.get(entry.greetingIndex) === entry.hash).map((entry) => entry.greetingIndex));
  const used = new Set;
  const resolved = [];
  for (const entry of storyline.route) {
    let index = entry.greetingIndex;
    if (!entry.hash || hashes.get(index) !== entry.hash) {
      const moved = own.find((greeting) => !used.has(greeting.greetingIndex) && !claimed.has(greeting.greetingIndex) && hashes.get(greeting.greetingIndex) === entry.hash);
      if (moved)
        index = moved.greetingIndex;
      else if (!byIndex.has(index))
        index = undefined;
    }
    if (index === undefined || used.has(index))
      continue;
    used.add(index);
    resolved.push(index);
  }
  return resolved;
}
function cardOrder(greetings, characterId) {
  return characterGreetings(greetings, characterId).map((greeting) => greeting.greetingIndex);
}
function effectiveRoute(storyline, greetings, characterId) {
  const custom = resolveRoute(storyline, greetings);
  return custom.length ? custom : cardOrder(greetings, characterId);
}
function sameRoute(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
function routeEntries(indices, greetings, characterId) {
  const own = new Map(characterGreetings(greetings, characterId).map((greeting) => [greeting.greetingIndex, greeting]));
  return indices.flatMap((greetingIndex) => {
    const greeting = own.get(greetingIndex);
    return greeting ? [{ greetingIndex, hash: hashText(greeting.text) }] : [];
  });
}
function routeSignature(indices, greetings, characterId) {
  const own = new Map(characterGreetings(greetings, characterId).map((greeting) => [greeting.greetingIndex, greeting]));
  return hashText(indices.map((index) => String(index) + "\x01" + (own.get(index)?.text ?? "")).join("\x00"));
}
function isOverviewStale(storyline, greetings) {
  if (!storyline?.overview.trim() || !storyline.overviewSignature)
    return false;
  const route = effectiveRoute(storyline, greetings, storyline.characterId);
  return routeSignature(route, greetings, storyline.characterId) !== storyline.overviewSignature;
}
function storylinePosition(route, activeIndex, upcomingIndex) {
  const at = (index) => {
    if (index === null || index === undefined)
      return null;
    const position = route.indexOf(index);
    return position >= 0 ? position + 1 : null;
  };
  return { waypoint: at(activeIndex), next: at(upcomingIndex), total: route.length };
}
function describePosition(position) {
  if (!position || position.total === 0)
    return "";
  const { waypoint, next, total } = position;
  const of = (value) => String(value) + " of " + String(total);
  if (waypoint !== null && next !== null) {
    return "Journey position: the story is at waypoint " + of(waypoint) + "; the next waypoint is " + of(next) + ".";
  }
  if (waypoint !== null && waypoint === total) {
    return "Journey position: the story has reached the final waypoint (" + of(waypoint) + "). Continue freely while keeping continuity with the overview.";
  }
  if (waypoint !== null)
    return "Journey position: the story is at waypoint " + of(waypoint) + ".";
  if (next !== null) {
    return "Journey position: the current scene is outside the planned route; the next planned waypoint is " + of(next) + ".";
  }
  return "Journey position: the current scene is outside the planned route of " + String(total) + " waypoints.";
}
function substitute2(template, values) {
  return template.replace(/\{\{([a-z_]+)\}\}/g, (match, name) => values[name] ?? match);
}
function renderStorylinePrompt(settings, overview, position, characterName) {
  return substitute2(settings.storylineTemplate, {
    storyline_overview: overview.trim(),
    storyline_position: describePosition(position),
    character_name: characterName
  }).replace(/\n{3,}/g, `

`).trim();
}
function clip(value, limit) {
  return value.length > limit ? value.slice(0, limit).trimEnd() + `
[\u2026truncated]` : value;
}
function renderGeneratorPrompt(settings, input) {
  const total = input.route.length;
  const waypoints = input.route.map((greeting, position) => {
    const filtered = applyPromptExcludeRegex(greeting.text, settings.promptExcludeRegex).trim();
    return "### Waypoint " + String(position + 1) + " of " + String(total) + " (greeting " + String(greeting.greetingIndex + 1) + `)
` + clip(filtered || greeting.text, settings.storylineWaypointCharLimit);
  }).join(`

`);
  const notes = input.notes.trim();
  return substitute2(settings.storylineGeneratorTemplate, {
    character_name: input.character.name || "the character",
    character_description: (input.character.description ?? "").trim() || "(none)",
    character_personality: (input.character.personality ?? "").trim() || "(none)",
    character_scenario: (input.character.scenario ?? "").trim() || "(none)",
    author_notes: notes || "(none)",
    waypoint_count: String(total),
    waypoints
  }).trim();
}
function generatedText(result) {
  const raw = typeof result === "string" ? result : isRecord(result) && typeof result.content === "string" ? result.content : isRecord(result) && isRecord(result.response) && typeof result.response.content === "string" ? result.response.content : "";
  return raw.replace(/<(think|thinking|reasoning)>[\s\S]*?<\/\1>/gi, "").replace(/\r\n?/g, `
`).trim().slice(0, STORYLINE_OVERVIEW_LIMIT);
}

// src/state.ts
function stringArray(value) {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === "string" && entry.length > 0) : [];
}
function selectionFrom(value) {
  if (!isRecord(value) || typeof value.characterId !== "string" || !Number.isInteger(value.greetingIndex))
    return null;
  return { characterId: value.characterId, greetingIndex: Number(value.greetingIndex) };
}
function journalFrom(value) {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.eventKey !== "string")
    return null;
  const target = selectionFrom(value.target);
  if (!target)
    return null;
  const phase = value.phase === "appended" ? "appended" : value.phase === "prepared" ? "prepared" : null;
  if (!phase)
    return null;
  return {
    id: value.id,
    eventKey: value.eventKey,
    handoffKey: typeof value.handoffKey === "string" ? value.handoffKey : undefined,
    sourceMessageId: typeof value.sourceMessageId === "string" ? value.sourceMessageId : undefined,
    target,
    previousActive: selectionFrom(value.previousActive),
    previousUpcoming: selectionFrom(value.previousUpcoming),
    createdAt: Number.isFinite(value.createdAt) ? Number(value.createdAt) : Date.now(),
    phase,
    insertedMessageId: typeof value.insertedMessageId === "string" ? value.insertedMessageId : undefined
  };
}
function pendingFrom(value) {
  if (!Array.isArray(value))
    return [];
  return value.flatMap((entry) => {
    if (!isRecord(entry) || typeof entry.eventKey !== "string" || typeof entry.contentHash !== "string")
      return [];
    return [{
      eventKey: entry.eventKey,
      contentHash: entry.contentHash,
      sourceMessageId: typeof entry.sourceMessageId === "string" ? entry.sourceMessageId : undefined,
      tagCount: Number.isInteger(entry.tagCount) ? Number(entry.tagCount) : 1,
      at: Number.isFinite(entry.at) ? Number(entry.at) : Date.now()
    }];
  });
}
function emptyChatState() {
  return {
    version: 1,
    chatEnabled: true,
    active: null,
    upcoming: null,
    groupEnabledByCharacter: {},
    storyRoute: true,
    storyOverview: true,
    pendingHandoffs: [],
    recentTransitionKeys: [],
    journal: null
  };
}
function parseChatState(value) {
  if (!value)
    return emptyChatState();
  try {
    const parsed = JSON.parse(value);
    if (!isRecord(parsed))
      return emptyChatState();
    const rawEnabled = isRecord(parsed.groupEnabledByCharacter) ? parsed.groupEnabledByCharacter : {};
    const groupEnabledByCharacter = {};
    for (const [characterId, enabled] of Object.entries(rawEnabled)) {
      if (typeof enabled === "boolean")
        groupEnabledByCharacter[characterId] = enabled;
    }
    return {
      version: 1,
      chatEnabled: parsed.chatEnabled !== false,
      active: selectionFrom(parsed.active),
      upcoming: selectionFrom(parsed.upcoming),
      groupEnabledByCharacter,
      storyRoute: parsed.storyRoute !== false,
      storyOverview: parsed.storyOverview !== false,
      pendingHandoffs: pendingFrom(parsed.pendingHandoffs),
      recentTransitionKeys: stringArray(parsed.recentTransitionKeys),
      journal: journalFrom(parsed.journal)
    };
  } catch {
    return emptyChatState();
  }
}
function serializeChatState(state) {
  return JSON.stringify(state);
}
function selectionKey(selection) {
  return selection ? selection.characterId + ":" + String(selection.greetingIndex) : "";
}
function sameSelection(left, right) {
  return selectionKey(left) === selectionKey(right);
}
function groupCharacterIds(chat) {
  const metadata = chat.metadata ?? {};
  const direct = stringArray(metadata.character_ids);
  const nested = isRecord(metadata.group) ? stringArray(metadata.group.character_ids) : [];
  const ids = direct.length ? direct : nested;
  const unique = [...new Set(ids)];
  return unique.length > 1 ? unique : [chat.character_id];
}
function buildGreetingContext(chat, characters) {
  const characterIds = groupCharacterIds(chat);
  const included = characters.filter((character) => characterIds.includes(character.id));
  const greetings = [];
  for (const character of included) {
    const all = [character.first_mes, ...character.alternate_greetings ?? []];
    for (let greetingIndex = 0;greetingIndex < all.length; greetingIndex += 1) {
      const text = typeof all[greetingIndex] === "string" ? all[greetingIndex].trim() : "";
      if (text) {
        greetings.push({
          characterId: character.id,
          characterName: character.name || "Unnamed character",
          greetingIndex,
          text
        });
      }
    }
  }
  return {
    chatId: chat.id,
    primaryCharacterId: chat.character_id,
    isGroupChat: characterIds.length > 1,
    characterIds,
    characters: included,
    greetings
  };
}
function greetingForSelection(greetings, selection) {
  if (!selection)
    return null;
  return greetings.find((greeting) => greeting.characterId === selection.characterId && greeting.greetingIndex === selection.greetingIndex) ?? null;
}
function firstGreetingForCharacter(greetings, characterId) {
  const greeting = greetings.find((entry) => entry.characterId === characterId);
  return greeting ? { characterId: greeting.characterId, greetingIndex: greeting.greetingIndex } : null;
}
function routeCandidates(route, selection) {
  const position = route.indexOf(selection.greetingIndex);
  return (position >= 0 ? route.slice(position + 1) : [...route]).filter((index) => index !== selection.greetingIndex);
}
function nextGreetingForSelection(greetings, selection, routes) {
  if (!selection)
    return null;
  const route = routes?.[selection.characterId];
  if (route?.length) {
    for (const greetingIndex of routeCandidates(route, selection)) {
      const candidate = { characterId: selection.characterId, greetingIndex };
      if (greetingForSelection(greetings, candidate))
        return candidate;
    }
    return null;
  }
  const following = greetings.find((entry) => entry.characterId === selection.characterId && entry.greetingIndex > selection.greetingIndex);
  return following ? { characterId: following.characterId, greetingIndex: following.greetingIndex } : null;
}
function nextGreetingChoices(greetings, active, isGroupChat, routes) {
  if (!active)
    return [...greetings];
  if (isGroupChat) {
    return greetings.filter((greeting) => greeting.characterId !== active.characterId || greeting.greetingIndex !== active.greetingIndex);
  }
  const route = routes?.[active.characterId];
  if (route?.length) {
    return routeCandidates(route, active).flatMap((greetingIndex) => {
      const greeting = greetingForSelection(greetings, { characterId: active.characterId, greetingIndex });
      return greeting ? [greeting] : [];
    });
  }
  return greetings.filter((greeting) => greeting.characterId === active.characterId && greeting.greetingIndex > active.greetingIndex);
}
function chatRoutes(context, state) {
  const routes = {};
  if (!state.storyRoute)
    return routes;
  for (const characterId of context.characterIds) {
    const route = resolveRoute(context.storylines?.[characterId], context.greetings);
    if (route.length)
      routes[characterId] = route;
  }
  return routes;
}
function defaultSelections(context, routes) {
  const active = firstGreetingForCharacter(context.greetings, context.primaryCharacterId) ?? (context.greetings[0] ? { characterId: context.greetings[0].characterId, greetingIndex: context.greetings[0].greetingIndex } : null);
  return { active, upcoming: nextGreetingForSelection(context.greetings, active, routes) };
}
function reconcileChatState(state, context) {
  const routes = chatRoutes(context, state);
  const defaults = defaultSelections(context, routes);
  const active = greetingForSelection(context.greetings, state.active) ? state.active : defaults.active;
  let upcoming = greetingForSelection(context.greetings, state.upcoming) ? state.upcoming : nextGreetingForSelection(context.greetings, active, routes);
  if (sameSelection(active, upcoming))
    upcoming = nextGreetingForSelection(context.greetings, active, routes);
  const allowedCharacters = new Set(context.characterIds);
  const enabled = {};
  for (const [characterId, value] of Object.entries(state.groupEnabledByCharacter)) {
    if (allowedCharacters.has(characterId))
      enabled[characterId] = value;
  }
  return {
    ...state,
    active,
    upcoming,
    groupEnabledByCharacter: enabled
  };
}
function addRecentTransition(state, eventKey, limit) {
  state.recentTransitionKeys = [
    ...state.recentTransitionKeys.filter((entry) => entry !== eventKey),
    eventKey
  ].slice(-limit);
}
function rememberPendingHandoff(state, pending, limit) {
  state.pendingHandoffs = [
    ...state.pendingHandoffs.filter((entry) => entry.eventKey !== pending.eventKey),
    pending
  ].slice(-limit);
}
function consumePendingHandoff(state, eventKey) {
  state.pendingHandoffs = state.pendingHandoffs.filter((entry) => entry.eventKey !== eventKey);
}

// src/engine.ts
var AUTOMATIC_PERMISSIONS = ["characters", "chats", "chat_mutation", "generation"];
var CONTEXT_PERMISSIONS = ["characters", "chats"];
var STORYLINE_GENERATION_PERMISSIONS = ["characters", "chats", "generation"];
function emptyLoomValues() {
  return {
    active: false,
    content: "",
    altMessages: [],
    nextMessages: [],
    currentMessage: "",
    nextMessage: "",
    storylineActive: false,
    storyline: "",
    storylineOverview: "",
    storylinePosition: "",
    currentWaypoint: "",
    nextWaypoint: "",
    waypointCount: "",
    currentGreetingNumber: "",
    nextGreetingNumber: ""
  };
}
function emptyStorylineView(reason) {
  return {
    routeEnabled: true,
    overviewEnabled: true,
    characters: [],
    prompt: { ready: false, content: "", characterId: null, position: null, reason }
  };
}
function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
function clone(value) {
  return structuredClone(value);
}
function journalId() {
  return "wp-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
}
function selected(selection) {
  return selection ? { characterId: selection.characterId, greetingIndex: selection.greetingIndex } : null;
}
function asInsertedMetadata(value) {
  if (!isRecord(value) || value.kind !== "inserted-greeting" || value.version !== 1)
    return null;
  if (typeof value.journalId !== "string" || typeof value.eventKey !== "string" || typeof value.contentHash !== "string")
    return null;
  if (!isRecord(value.target) || typeof value.target.characterId !== "string" || !Number.isInteger(value.target.greetingIndex))
    return null;
  const selection = (candidate) => {
    if (!isRecord(candidate) || typeof candidate.characterId !== "string" || !Number.isInteger(candidate.greetingIndex))
      return null;
    return { characterId: candidate.characterId, greetingIndex: Number(candidate.greetingIndex) };
  };
  return {
    kind: "inserted-greeting",
    version: 1,
    journalId: value.journalId,
    eventKey: value.eventKey,
    handoffKey: typeof value.handoffKey === "string" ? value.handoffKey : undefined,
    target: { characterId: value.target.characterId, greetingIndex: Number(value.target.greetingIndex) },
    previousActive: selection(value.previousActive),
    previousUpcoming: selection(value.previousUpcoming),
    sourceMessageId: typeof value.sourceMessageId === "string" ? value.sourceMessageId : undefined,
    contentHash: value.contentHash,
    insertedAt: Number.isFinite(value.insertedAt) ? Number(value.insertedAt) : 0
  };
}
function asHandoffExtra(value) {
  if (!isRecord(value) || value.version !== 1 || typeof value.tagName !== "string")
    return null;
  return {
    version: 1,
    tagName: value.tagName,
    tagCount: Number.isInteger(value.tagCount) ? Number(value.tagCount) : 1,
    origin: typeof value.origin === "string" ? value.origin : "",
    contentHash: typeof value.contentHash === "string" ? value.contentHash : "",
    at: Number.isFinite(value.at) ? Number(value.at) : 0
  };
}
function messageMetadata(message) {
  return asInsertedMetadata(message.metadata?.[INSERTED_GREETING_METADATA_KEY]);
}
function messageExtraHandoff(message) {
  return asHandoffExtra(message.extra?.[HANDOFF_EXTRA_KEY]);
}

class WaypointEngine {
  api;
  userId;
  settingsChanged;
  settingsCache = null;
  queues = new Map;
  diagnosticsLines = [];
  storylineCache = new Map;
  generations = new Map;
  constructor(api, userId, settingsChanged) {
    this.api = api;
    this.userId = userId;
    this.settingsChanged = settingsChanged;
  }
  note(message) {
    const settings = this.settingsCache;
    if (settings && !settings.diagnosticLogging)
      return;
    const line = new Date().toISOString() + " " + message;
    const limit = settings?.diagnosticLineLimit ?? DEFAULT_SETTINGS.diagnosticLineLimit;
    this.diagnosticsLines = [...this.diagnosticsLines, line].slice(-limit);
    this.api.log.info("[Waypoints] " + message);
  }
  warn(message) {
    this.note(message);
    this.api.log.warn("[Waypoints] " + message);
  }
  diagnostics() {
    return [...this.diagnosticsLines];
  }
  clearDiagnostics() {
    this.diagnosticsLines = [];
  }
  async settings() {
    if (!this.settingsCache) {
      const stored = await this.api.userStorage.getJson(SETTINGS_PATH, {
        fallback: {},
        userId: this.userId
      });
      this.settingsCache = settingsFromStorage(stored);
    }
    return clone(this.settingsCache);
  }
  async saveSettings(draft) {
    const validated = validateSettings(draft);
    await this.api.userStorage.setJson(SETTINGS_PATH, validated.settings, { userId: this.userId });
    this.settingsCache = clone(validated.settings);
    if (this.settingsChanged)
      await this.settingsChanged(clone(validated.settings), this.userId);
    this.note("settings saved");
    return { settings: clone(validated.settings), warnings: validated.warnings };
  }
  async resetSettings() {
    return this.saveSettings(clone(DEFAULT_SETTINGS));
  }
  missingPermissions(required) {
    return required.filter((permission) => !this.api.permissions.has(permission));
  }
  assertPermissions(required, action) {
    const missing = this.missingPermissions(required);
    if (missing.length) {
      throw new Error(action + " needs the " + missing.join(", ") + " permission" + (missing.length === 1 ? "" : "s") + ".");
    }
  }
  async serial(chatId, action) {
    const previous = this.queues.get(chatId) ?? Promise.resolve();
    const run = previous.catch(() => {
      return;
    }).then(action);
    this.queues.set(chatId, run.then(() => {
      return;
    }, () => {
      return;
    }));
    return run;
  }
  async getActiveChatId(settings) {
    this.assertPermissions(["chats"], "Finding the active chat");
    for (let attempt = 0;attempt < settings.activeChatRetryAttempts; attempt += 1) {
      const active = await this.api.chats.getActive(this.userId);
      if (active)
        return active.id;
      if (attempt + 1 < settings.activeChatRetryAttempts)
        await sleep(settings.activeChatRetryDelayMs);
    }
    return null;
  }
  async context(chatId) {
    this.assertPermissions(CONTEXT_PERMISSIONS, "Loading Waypoints");
    const chat = await this.api.chats.get(chatId, this.userId);
    if (!chat)
      throw new Error("The selected chat no longer exists.");
    const ids = groupCharacterIds(chat);
    const loaded = await Promise.all(ids.map((characterId) => this.api.characters.get(characterId, this.userId)));
    const characters = loaded.filter((character) => Boolean(character));
    const context = buildGreetingContext(chat, characters);
    const storylines = {};
    const stored = await Promise.all(context.characterIds.map((characterId) => this.storyline(characterId)));
    for (const storyline of stored)
      if (storyline)
        storylines[storyline.characterId] = storyline;
    return { ...context, storylines };
  }
  async storyline(characterId) {
    if (this.storylineCache.has(characterId))
      return clone(this.storylineCache.get(characterId) ?? null);
    let parsed = null;
    try {
      const stored = await this.api.userStorage.getJson(storylinePath(characterId), {
        fallback: null,
        userId: this.userId
      });
      parsed = parseStoryline(stored, characterId);
    } catch {
      parsed = null;
    }
    this.storylineCache.set(characterId, parsed);
    return clone(parsed);
  }
  async writeStoryline(storyline) {
    await this.api.userStorage.setJson(storylinePath(storyline.characterId), storyline, { userId: this.userId });
    this.storylineCache.set(storyline.characterId, clone(storyline));
  }
  alternateMessages(context) {
    const character = context.characters.find((entry) => entry.id === context.primaryCharacterId);
    return Array.isArray(character?.alternate_greetings) ? character.alternate_greetings.map((message) => typeof message === "string" ? message : "") : [];
  }
  async state(chatId) {
    try {
      return parseChatState(await this.api.variables.chat.get(chatId, CHAT_STATE_KEY));
    } catch {
      return parseChatState(null);
    }
  }
  async persistState(chatId, state) {
    await this.api.variables.chat.set(chatId, CHAT_STATE_KEY, serializeChatState(state));
  }
  isCharacterEnabled(context, state, characterId) {
    if (context.isGroupChat)
      return state.groupEnabledByCharacter[characterId] !== false;
    const character = context.characters.find((entry) => entry.id === characterId);
    const extensionData = character && isRecord(character.extensions?.[EXTENSION_ID]) ? character.extensions?.[EXTENSION_ID] : null;
    return !isRecord(extensionData) || extensionData.enabled !== false;
  }
  isSelectionEnabled(context, state, selection) {
    return state.chatEnabled && selection !== null && this.isCharacterEnabled(context, state, selection.characterId);
  }
  promptStatus(context, state, settings) {
    const upcoming = greetingForSelection(context.greetings, state.upcoming);
    if (!upcoming) {
      return {
        ready: false,
        autoPrompt: settings.autoPrompt,
        role: settings.promptRole,
        insertionDepth: settings.insertionDepth,
        content: "",
        reason: "Choose an upcoming greeting to shape the scene."
      };
    }
    if (!this.isSelectionEnabled(context, state, state.upcoming)) {
      return {
        ready: false,
        autoPrompt: settings.autoPrompt,
        role: settings.promptRole,
        insertionDepth: settings.insertionDepth,
        content: "",
        reason: state.chatEnabled ? "The upcoming greeting's character is turned off." : "Waypoints is off for this chat."
      };
    }
    const rendered = renderPrompt(settings, upcoming.text);
    return {
      ready: true,
      autoPrompt: settings.autoPrompt,
      role: settings.promptRole,
      insertionDepth: settings.insertionDepth,
      content: rendered.content
    };
  }
  async latestInsertedGreeting(chatId) {
    const messages = await this.api.chat.getMessages(chatId);
    for (let index = messages.length - 1;index >= 0; index -= 1) {
      const message = messages[index];
      const metadata = messageMetadata(message);
      if (metadata && message.role === "assistant")
        return { id: message.id, metadata, previousMessageId: messages[index - 1]?.id };
    }
    return null;
  }
  async journalMessage(chatId, journal) {
    const messages = await this.api.chat.getMessages(chatId);
    for (let index = messages.length - 1;index >= 0; index -= 1) {
      const message = messages[index];
      const metadata = messageMetadata(message);
      if (metadata && metadata.journalId === journal.id && message.role === "assistant") {
        return { id: message.id, metadata };
      }
    }
    return null;
  }
  async commitJournal(chatId, state, context, settings, journal, insertedMessageId) {
    const target = greetingForSelection(context.greetings, journal.target);
    if (!target) {
      state.journal = null;
      await this.persistState(chatId, state);
      this.warn("journal target disappeared; no Waypoints selection was advanced");
      return;
    }
    state.active = selected(journal.target);
    state.upcoming = nextGreetingForSelection(context.greetings, state.active, chatRoutes(context, state));
    addRecentTransition(state, journal.eventKey, settings.recentTransitionLimit);
    consumePendingHandoff(state, journal.eventKey);
    if (journal.handoffKey) {
      addRecentTransition(state, journal.handoffKey, settings.recentTransitionLimit);
      consumePendingHandoff(state, journal.handoffKey);
    }
    state.journal = null;
    await this.persistState(chatId, state);
    this.note("transition committed: " + journal.eventKey + " -> " + insertedMessageId);
  }
  async reconcileJournalLocked(chatId, state, context, settings) {
    if (!state.journal)
      return false;
    const journal = state.journal;
    const inserted = await this.journalMessage(chatId, journal);
    if (inserted) {
      await this.commitJournal(chatId, state, context, settings, journal, inserted.id);
      return true;
    }
    state.journal = null;
    await this.persistState(chatId, state);
    this.note("stale transition journal rolled back: " + journal.eventKey);
    return false;
  }
  makeMetadata(journal, target) {
    const metadata = {
      kind: "inserted-greeting",
      version: 1,
      journalId: journal.id,
      eventKey: journal.eventKey,
      handoffKey: journal.handoffKey,
      target: selected(journal.target),
      previousActive: selected(journal.previousActive),
      previousUpcoming: selected(journal.previousUpcoming),
      sourceMessageId: journal.sourceMessageId,
      contentHash: hashText(target.text),
      insertedAt: Date.now()
    };
    return { [INSERTED_GREETING_METADATA_KEY]: metadata };
  }
  async transitionLocked(chatId, state, context, settings, target, eventKey, sourceMessageId, handoffKey) {
    if (state.recentTransitionKeys.includes(eventKey)) {
      return { advanced: false, reason: "This handoff was already processed." };
    }
    const greeting = greetingForSelection(context.greetings, target);
    if (!greeting)
      return { advanced: false, reason: "The selected upcoming greeting no longer exists." };
    if (!this.isSelectionEnabled(context, state, target)) {
      return { advanced: false, reason: state.chatEnabled ? "The upcoming greeting's character is turned off." : "Waypoints is off for this chat." };
    }
    const journal = {
      id: journalId(),
      eventKey,
      sourceMessageId,
      handoffKey,
      target: selected(target),
      previousActive: selected(state.active),
      previousUpcoming: selected(state.upcoming),
      createdAt: Date.now(),
      phase: "prepared"
    };
    state.journal = journal;
    await this.persistState(chatId, state);
    this.note("transition journaled: " + eventKey);
    try {
      const appended = await this.api.chat.appendMessage(chatId, {
        role: "assistant",
        content: greeting.text,
        metadata: this.makeMetadata(journal, greeting)
      });
      journal.phase = "appended";
      journal.insertedMessageId = appended.id;
      state.journal = journal;
      await this.persistState(chatId, state);
      await this.commitJournal(chatId, state, context, settings, journal, appended.id);
      return { advanced: true, reason: "Inserted the upcoming greeting.", insertedMessageId: appended.id };
    } catch (error) {
      const inserted = await this.journalMessage(chatId, journal).catch(() => null);
      if (inserted) {
        await this.commitJournal(chatId, state, context, settings, journal, inserted.id);
        return { advanced: true, reason: "Recovered a completed greeting insertion.", insertedMessageId: inserted.id };
      }
      state.journal = null;
      await this.persistState(chatId, state);
      const reason = error instanceof Error ? error.message : String(error);
      this.warn("greeting insertion failed and was rolled back: " + reason);
      return { advanced: false, reason: "Greeting insertion failed: " + reason };
    }
  }
  async handoffMessage(chatId, settings, signal, attempts = settings.handoffReadRetryAttempts) {
    const direct = stripHandoffTags(signal.content ?? "", settings.handoffTagName);
    for (let attempt = 0;attempt < attempts; attempt += 1) {
      const messages = await this.api.chat.getMessages(chatId);
      const message = signal.sourceMessageId ? messages.find((entry) => entry.id === signal.sourceMessageId) : [...messages].reverse().find((entry) => !messageMetadata(entry));
      if (message) {
        if (message.role !== "assistant" || messageMetadata(message))
          return null;
        const stored = stripHandoffTags(message.content, settings.handoffTagName);
        if (signal.content && direct.content !== stored.content)
          return null;
        const contentHash = hashText(stored.content);
        const extra = messageExtraHandoff(message) ?? asHandoffExtra(signal.extra?.[HANDOFF_EXTRA_KEY]);
        const stamped = extra?.tagName === settings.handoffTagName && extra.contentHash === contentHash;
        if (!direct.hasHandoff && !stored.hasHandoff && !stamped)
          return null;
        const eventKey = chatId + ":handoff:" + message.id + ":" + String(message.swipe_id) + ":" + contentHash;
        return {
          id: message.id,
          eventKey,
          contentHash,
          tagCount: direct.tagCount || stored.tagCount || (stamped ? extra.tagCount : 0),
          alreadyInserted: messages.some((entry) => {
            const metadata = messageMetadata(entry);
            return metadata?.eventKey === eventKey || metadata?.handoffKey === eventKey || Boolean(metadata?.sourceMessageId === message.id && !metadata.handoffKey && !metadata.eventKey.includes(":handoff:"));
          })
        };
      }
      if (attempt + 1 < attempts)
        await sleep(settings.handoffReadRetryDelayMs);
    }
    return null;
  }
  async processContent(ctx) {
    if (ctx.isUser)
      return;
    const settings = await this.settings();
    const handoff = stripHandoffTags(ctx.content, settings.handoffTagName);
    if (!handoff.hasHandoff)
      return;
    const patch = {};
    if (handoff.content !== ctx.content)
      patch.content = handoff.content;
    if (ctx.origin !== "render" && ctx.origin !== "swipe_add" && ctx.origin !== "swipe_update") {
      const metadata = {
        version: 1,
        tagName: settings.handoffTagName,
        tagCount: handoff.tagCount,
        origin: ctx.origin,
        contentHash: hashText(handoff.content),
        at: Date.now()
      };
      patch.extra = { [HANDOFF_EXTRA_KEY]: metadata };
    }
    this.note("handoff tag stripped from " + ctx.origin);
    return Object.keys(patch).length ? patch : undefined;
  }
  async handleHandoff(signal) {
    const missing = this.missingPermissions(AUTOMATIC_PERMISSIONS);
    if (missing.length) {
      const reason = "Automatic handoff is waiting for: " + missing.join(", ") + ".";
      this.note(reason);
      return { advanced: false, reason };
    }
    return this.serial(signal.chatId, async () => {
      const settings = await this.settings();
      const context = await this.context(signal.chatId);
      const state = reconcileChatState(await this.state(signal.chatId), context);
      await this.reconcileJournalLocked(signal.chatId, state, context, settings);
      if (!state.chatEnabled)
        return { advanced: false, reason: "Waypoints is off for this chat." };
      if (state.recentTransitionKeys.includes(signal.eventKey)) {
        return { advanced: false, reason: "This handoff was already processed." };
      }
      const handoff = await this.handoffMessage(signal.chatId, settings, signal);
      if (!handoff)
        return { advanced: false, reason: "No handoff was found in the current assistant reply." };
      if (handoff.alreadyInserted || state.recentTransitionKeys.includes(handoff.eventKey)) {
        return { advanced: false, reason: "This handoff was already processed." };
      }
      rememberPendingHandoff(state, {
        eventKey: handoff.eventKey,
        sourceMessageId: handoff.id,
        contentHash: handoff.contentHash,
        tagCount: handoff.tagCount,
        at: Date.now()
      }, settings.pendingHandoffLimit);
      await this.persistState(signal.chatId, state);
      if (!state.upcoming) {
        consumePendingHandoff(state, handoff.eventKey);
        await this.persistState(signal.chatId, state);
        return { advanced: false, reason: "There is no upcoming greeting to insert." };
      }
      return this.transitionLocked(signal.chatId, state, context, settings, state.upcoming, handoff.eventKey, handoff.id);
    });
  }
  async force(chatId) {
    this.assertPermissions(["characters", "chats", "chat_mutation"], "Forcing a greeting");
    const settings = await this.settings();
    const resolvedChatId = chatId ?? await this.getActiveChatId(settings);
    if (!resolvedChatId)
      return { advanced: false, reason: "There is no active chat." };
    return this.serial(resolvedChatId, async () => {
      const context = await this.context(resolvedChatId);
      const state = reconcileChatState(await this.state(resolvedChatId), context);
      await this.reconcileJournalLocked(resolvedChatId, state, context, settings);
      if (!state.upcoming)
        return { advanced: false, reason: "There is no upcoming greeting to insert." };
      const handoff = await this.handoffMessage(resolvedChatId, settings, { chatId: resolvedChatId, eventKey: "" }, 1);
      return this.transitionLocked(resolvedChatId, state, context, settings, state.upcoming, "force:" + journalId(), handoff?.id, handoff?.eventKey);
    });
  }
  async undo(chatId) {
    this.assertPermissions(["characters", "chats", "chat_mutation"], "Undoing a Waypoints insertion");
    const settings = await this.settings();
    const resolvedChatId = chatId ?? await this.getActiveChatId(settings);
    if (!resolvedChatId)
      return { advanced: false, reason: "There is no active chat." };
    return this.serial(resolvedChatId, async () => {
      const context = await this.context(resolvedChatId);
      const state = reconcileChatState(await this.state(resolvedChatId), context);
      const inserted = await this.latestInsertedGreeting(resolvedChatId);
      if (!inserted)
        return { advanced: false, reason: "There is no Waypoints-stamped greeting to undo." };
      let handoffKey = inserted.metadata.handoffKey;
      const sourceMessageId = inserted.metadata.sourceMessageId ?? inserted.previousMessageId;
      if (!handoffKey && sourceMessageId) {
        handoffKey = (await this.handoffMessage(resolvedChatId, settings, {
          chatId: resolvedChatId,
          eventKey: inserted.metadata.eventKey,
          sourceMessageId
        }, 1))?.eventKey;
      }
      await this.api.chat.deleteMessage(resolvedChatId, inserted.id);
      state.active = selected(inserted.metadata.previousActive);
      state.upcoming = selected(inserted.metadata.previousUpcoming);
      addRecentTransition(state, inserted.metadata.eventKey, settings.recentTransitionLimit);
      consumePendingHandoff(state, inserted.metadata.eventKey);
      if (handoffKey) {
        addRecentTransition(state, handoffKey, settings.recentTransitionLimit);
        consumePendingHandoff(state, handoffKey);
      }
      state.journal = null;
      const reconciled = reconcileChatState(state, context);
      await this.persistState(resolvedChatId, reconciled);
      this.note("undid Waypoints message " + inserted.id);
      return { advanced: true, reason: "Removed the last Waypoints-inserted greeting and restored the previous current and next greetings.", insertedMessageId: inserted.id };
    });
  }
  validateSelection(context, selection) {
    if (!selection)
      return null;
    if (!greetingForSelection(context.greetings, selection)) {
      throw new Error("That greeting is not available in this chat.");
    }
    return selected(selection);
  }
  async setActive(chatId, selection) {
    this.assertPermissions(CONTEXT_PERMISSIONS, "Changing the active greeting");
    await this.serial(chatId, async () => {
      const context = await this.context(chatId);
      const state = reconcileChatState(await this.state(chatId), context);
      state.active = this.validateSelection(context, selection);
      if (state.active && (!state.upcoming || state.upcoming.characterId === state.active.characterId && state.upcoming.greetingIndex === state.active.greetingIndex)) {
        state.upcoming = nextGreetingForSelection(context.greetings, state.active, chatRoutes(context, state));
      }
      await this.persistState(chatId, state);
    });
  }
  async setUpcoming(chatId, selection) {
    this.assertPermissions(CONTEXT_PERMISSIONS, "Changing the upcoming greeting");
    await this.serial(chatId, async () => {
      const context = await this.context(chatId);
      const state = reconcileChatState(await this.state(chatId), context);
      const next = this.validateSelection(context, selection);
      if (next && state.active && next.characterId === state.active.characterId && next.greetingIndex === state.active.greetingIndex) {
        throw new Error("The upcoming greeting must be different from the active greeting.");
      }
      state.upcoming = next;
      await this.persistState(chatId, state);
    });
  }
  async setEnabled(chatId, characterId, enabled) {
    this.assertPermissions(["characters", "chats"], "Changing Waypoints state");
    await this.serial(chatId, async () => {
      const context = await this.context(chatId);
      if (!context.characterIds.includes(characterId))
        throw new Error("That character is not in this chat.");
      if (context.isGroupChat) {
        const state = reconcileChatState(await this.state(chatId), context);
        state.groupEnabledByCharacter[characterId] = enabled;
        await this.persistState(chatId, state);
      } else {
        const character = context.characters.find((entry) => entry.id === characterId);
        const existing = isRecord(character?.extensions?.[EXTENSION_ID]) ? character?.extensions?.[EXTENSION_ID] : {};
        await this.api.characters.update(characterId, {
          extensions: { [EXTENSION_ID]: { ...existing, enabled } }
        }, this.userId);
      }
      this.note("enabled state changed for " + characterId);
    });
  }
  async setChatEnabled(chatId, enabled) {
    this.assertPermissions(CONTEXT_PERMISSIONS, "Changing this chat's Waypoints state");
    await this.serial(chatId, async () => {
      const context = await this.context(chatId);
      if (enabled && context.greetings.length < 2) {
        throw new Error("This chat has no alternate greetings for Waypoints to cycle.");
      }
      const state = reconcileChatState(await this.state(chatId), context);
      state.chatEnabled = enabled;
      if (!enabled)
        state.pendingHandoffs = [];
      await this.persistState(chatId, state);
      this.note("chat " + chatId + " Waypoints " + (enabled ? "enabled" : "disabled"));
    });
  }
  async setStoryRoute(chatId, enabled) {
    this.assertPermissions(CONTEXT_PERMISSIONS, "Changing this chat's storyline route");
    await this.serial(chatId, async () => {
      const context = await this.context(chatId);
      const state = reconcileChatState(await this.state(chatId), context);
      state.storyRoute = enabled;
      state.upcoming = nextGreetingForSelection(context.greetings, state.active, chatRoutes(context, state));
      await this.persistState(chatId, state);
      this.note("chat " + chatId + " storyline route " + (enabled ? "on" : "off"));
    });
  }
  async setStoryOverview(chatId, enabled) {
    this.assertPermissions(CONTEXT_PERMISSIONS, "Changing this chat's narrative overview");
    await this.serial(chatId, async () => {
      const context = await this.context(chatId);
      const state = reconcileChatState(await this.state(chatId), context);
      state.storyOverview = enabled;
      await this.persistState(chatId, state);
      this.note("chat " + chatId + " narrative overview " + (enabled ? "on" : "off"));
    });
  }
  storylineCharacter(context, characterId) {
    const character = context.characters.find((entry) => entry.id === characterId);
    if (!character || !context.characterIds.includes(characterId))
      throw new Error("That character is not in this chat.");
    return character;
  }
  normalizeRoute(context, characterId, route) {
    const order = cardOrder(context.greetings, characterId);
    if (!Array.isArray(route) || !route.length)
      return [];
    const available = new Set(order);
    const seen = new Set;
    const indices = [];
    for (const value of route) {
      if (!Number.isInteger(value) || !available.has(Number(value)))
        throw new Error("A storyline stop is not one of this character's greetings.");
      if (seen.has(Number(value)))
        throw new Error("A greeting can appear only once in a storyline.");
      seen.add(Number(value));
      indices.push(Number(value));
    }
    return sameRoute(indices, order) ? [] : indices;
  }
  async replanChat(chatId, characterId) {
    await this.serial(chatId, async () => {
      const context = await this.context(chatId);
      const state = reconcileChatState(await this.state(chatId), context);
      if (!state.storyRoute || state.active?.characterId !== characterId)
        return;
      state.upcoming = nextGreetingForSelection(context.greetings, state.active, chatRoutes(context, state));
      await this.persistState(chatId, state);
    });
  }
  async saveStoryline(chatId, characterId, input) {
    this.assertPermissions(CONTEXT_PERMISSIONS, "Saving a storyline");
    const context = await this.serial(chatId, () => this.context(chatId));
    this.storylineCharacter(context, characterId);
    const indices = this.normalizeRoute(context, characterId, input.route);
    const notes = typeof input.notes === "string" ? input.notes : "";
    const overview = typeof input.overview === "string" ? input.overview : undefined;
    if (notes.length > STORYLINE_NOTES_LIMIT)
      throw new Error("Author guidance is too long (maximum " + String(STORYLINE_NOTES_LIMIT) + " characters).");
    if (overview !== undefined && overview.length > STORYLINE_OVERVIEW_LIMIT) {
      throw new Error("The narrative overview is too long (maximum " + String(STORYLINE_OVERVIEW_LIMIT) + " characters).");
    }
    const previous = await this.storyline(characterId) ?? emptyStoryline(characterId);
    const previousRoute = resolveRoute(previous, context.greetings);
    const next = {
      ...previous,
      route: routeEntries(indices, context.greetings, characterId),
      notes,
      updatedAt: Date.now()
    };
    if (overview !== undefined) {
      next.overview = overview;
      if (!overview.trim()) {
        next.overviewSignature = "";
        next.generatedAt = null;
      }
    }
    await this.writeStoryline(next);
    this.note("storyline saved for " + characterId);
    if (!sameRoute(previousRoute, indices))
      await this.replanChat(chatId, characterId);
  }
  async deleteStoryline(chatId, characterId) {
    this.assertPermissions(CONTEXT_PERMISSIONS, "Deleting a storyline");
    const context = await this.serial(chatId, () => this.context(chatId));
    this.storylineCharacter(context, characterId);
    await this.api.userStorage.delete(storylinePath(characterId), this.userId).catch(async () => {
      await this.api.userStorage.setJson(storylinePath(characterId), null, { userId: this.userId });
    });
    this.storylineCache.set(characterId, null);
    this.note("storyline deleted for " + characterId);
    await this.replanChat(chatId, characterId);
  }
  isGeneratingStoryline(characterId) {
    return this.generations.has(characterId);
  }
  cancelStorylineGeneration(characterId) {
    const controller = this.generations.get(characterId);
    if (!controller)
      return false;
    controller.abort();
    return true;
  }
  async generateStoryline(chatId, characterId, input) {
    this.assertPermissions(STORYLINE_GENERATION_PERMISSIONS, "Generating a narrative overview");
    if (this.generations.has(characterId))
      throw new Error("A narrative overview is already being generated for this character.");
    const settings = await this.settings();
    const context = await this.serial(chatId, () => this.context(chatId));
    const character = this.storylineCharacter(context, characterId);
    const indices = this.normalizeRoute(context, characterId, input.route);
    const notes = typeof input.notes === "string" ? input.notes.slice(0, STORYLINE_NOTES_LIMIT) : "";
    const route = indices.length ? indices : cardOrder(context.greetings, characterId);
    const greetings = route.flatMap((greetingIndex) => {
      const greeting = greetingForSelection(context.greetings, { characterId, greetingIndex });
      return greeting ? [greeting] : [];
    });
    if (!greetings.length)
      throw new Error("This character has no greetings to build a storyline from.");
    const prompt = renderGeneratorPrompt(settings, { character, route: greetings, notes });
    const controller = new AbortController;
    this.generations.set(characterId, controller);
    this.note("narrative overview generation started for " + characterId);
    let overview;
    try {
      const result = await this.api.generate.quiet({
        type: "quiet",
        messages: [{ role: "user", content: prompt }],
        ...settings.storylineConnectionId ? { connection_id: settings.storylineConnectionId } : {},
        ...this.userId ? { userId: this.userId } : {},
        signal: controller.signal
      });
      overview = generatedText(result);
    } catch (error) {
      if (controller.signal.aborted || error instanceof Error && error.name === "AbortError") {
        this.note("narrative overview generation cancelled for " + characterId);
        throw new Error("Narrative overview generation was cancelled.");
      }
      this.warn("narrative overview generation failed: " + (error instanceof Error ? error.message : String(error)));
      throw error;
    } finally {
      this.generations.delete(characterId);
    }
    if (!overview)
      throw new Error("The model returned an empty narrative overview. Try again or adjust the generator instructions.");
    const previous = await this.storyline(characterId) ?? emptyStoryline(characterId);
    const previousRoute = resolveRoute(previous, context.greetings);
    const now = Date.now();
    await this.writeStoryline({
      ...previous,
      route: routeEntries(indices, context.greetings, characterId),
      notes,
      overview,
      overviewSignature: routeSignature(route, context.greetings, characterId),
      generatedAt: now,
      updatedAt: now
    });
    this.note("narrative overview generated for " + characterId + " (" + String(overview.length) + " characters)");
    if (!sameRoute(previousRoute, indices))
      await this.replanChat(chatId, characterId);
  }
  async listConnections() {
    if (!this.api.permissions.has("generation"))
      return [];
    const connections = await this.api.connections.list(this.userId);
    return connections.map((connection) => ({
      id: connection.id,
      name: connection.name || connection.id,
      model: connection.model || "",
      isDefault: Boolean(connection.is_default)
    }));
  }
  storylinePrompt(context, state, settings) {
    const active = greetingForSelection(context.greetings, state.active);
    const upcoming = greetingForSelection(context.greetings, state.upcoming);
    const characterId = active?.characterId ?? upcoming?.characterId ?? (context.characterIds.includes(context.primaryCharacterId) ? context.primaryCharacterId : context.characterIds[0] ?? null);
    if (!characterId)
      return { ready: false, content: "", characterId: null, position: null, reason: "No character is loaded." };
    const storyline = context.storylines?.[characterId];
    const route = effectiveRoute(storyline, context.greetings, characterId);
    const position = storylinePosition(route, active?.characterId === characterId ? active.greetingIndex : null, upcoming?.characterId === characterId ? upcoming.greetingIndex : null);
    const blocked = (reason) => ({ ready: false, content: "", characterId, position, reason });
    if (!storyline?.overview.trim())
      return blocked("No narrative overview has been saved for this character.");
    if (context.greetings.length < 2)
      return blocked("This chat has no alternate greetings, so Waypoints stays off.");
    if (!state.chatEnabled)
      return blocked("Waypoints is off for this chat.");
    if (!state.storyOverview)
      return blocked("The narrative overview is off for this chat.");
    if (!this.isCharacterEnabled(context, state, characterId))
      return blocked("This character's Waypoints switch is off.");
    const name = context.characters.find((entry) => entry.id === characterId)?.name || "the character";
    return { ready: true, content: renderStorylinePrompt(settings, storyline.overview, position, name), characterId, position };
  }
  storylineView(context, state, settings) {
    const characters = context.characterIds.flatMap((characterId) => {
      if (!context.characters.some((entry) => entry.id === characterId))
        return [];
      const storyline = context.storylines?.[characterId];
      return [{
        characterId,
        route: resolveRoute(storyline, context.greetings),
        effectiveRoute: effectiveRoute(storyline, context.greetings, characterId),
        notes: storyline?.notes ?? "",
        overview: storyline?.overview ?? "",
        generatedAt: storyline?.generatedAt ?? null,
        stale: isOverviewStale(storyline, context.greetings),
        updatedAt: storyline ? storyline.updatedAt : null,
        generating: this.generations.has(characterId)
      }];
    });
    return {
      routeEnabled: state.storyRoute,
      overviewEnabled: state.storyOverview,
      characters,
      prompt: this.storylinePrompt(context, state, settings)
    };
  }
  async intercept(messages, chatId) {
    try {
      const settings = await this.settings();
      if (!settings.autoPrompt)
        return messages;
      if (this.missingPermissions(CONTEXT_PERMISSIONS).length)
        return messages;
      return await this.serial(chatId, async () => {
        const context = await this.context(chatId);
        const state = reconcileChatState(await this.state(chatId), context);
        await this.reconcileJournalLocked(chatId, state, context, settings);
        const scene = this.promptStatus(context, state, settings);
        const story = this.storylinePrompt(context, state, settings);
        const entries = [];
        if (story.ready && story.content) {
          entries.push({ value: { role: settings.promptRole, content: story.content }, depth: settings.storylineInsertionDepth, name: "Waypoints: storyline overview" });
        }
        if (scene.ready && scene.content) {
          entries.push({ value: { role: settings.promptRole, content: scene.content }, depth: settings.insertionDepth, name: "Waypoints: upcoming scene" });
        }
        if (!entries.length)
          return messages;
        const result = insertAtDepths(messages, entries);
        return {
          messages: result,
          breakdown: entries.map((entry) => ({ messageIndex: result.indexOf(entry.value), name: entry.name }))
        };
      });
    } catch (error) {
      this.warn("prompt interceptor skipped: " + (error instanceof Error ? error.message : String(error)));
      return messages;
    }
  }
  async loomValues(chatId) {
    if (!chatId || this.missingPermissions(CONTEXT_PERMISSIONS).length)
      return emptyLoomValues();
    try {
      return await this.serial(chatId, async () => {
        const settings = await this.settings();
        const context = await this.context(chatId);
        const state = reconcileChatState(await this.state(chatId), context);
        const active = greetingForSelection(context.greetings, state.active);
        const upcoming = greetingForSelection(context.greetings, state.upcoming);
        const altMessages = this.alternateMessages(context);
        const nextMessages = nextGreetingChoices(context.greetings, active, context.isGroupChat, chatRoutes(context, state)).map((greeting) => greeting.text);
        const prompt = this.promptStatus(context, state, settings);
        const ready = Boolean(active && this.isSelectionEnabled(context, state, state.active) && prompt.ready && prompt.content);
        const story = this.storylinePrompt(context, state, settings);
        return {
          active: ready,
          content: ready ? prompt.content : "",
          altMessages,
          nextMessages,
          currentMessage: active?.text ?? "",
          nextMessage: upcoming?.text ?? "",
          storylineActive: story.ready,
          storyline: story.ready ? story.content : "",
          storylineOverview: story.ready && story.characterId ? context.storylines?.[story.characterId]?.overview.trim() ?? "" : "",
          storylinePosition: describePosition(story.position),
          currentWaypoint: story.position?.waypoint ? String(story.position.waypoint) : "",
          nextWaypoint: story.position?.next ? String(story.position.next) : "",
          waypointCount: story.position?.total ? String(story.position.total) : "",
          currentGreetingNumber: active ? String(active.greetingIndex + 1) : "",
          nextGreetingNumber: upcoming ? String(upcoming.greetingIndex + 1) : ""
        };
      });
    } catch {
      return emptyLoomValues();
    }
  }
  async activeAlternateGreetingCount() {
    if (this.missingPermissions(CONTEXT_PERMISSIONS).length)
      return 0;
    try {
      const chatId = await this.getActiveChatId(await this.settings());
      if (!chatId)
        return 0;
      return await this.serial(chatId, async () => this.alternateMessages(await this.context(chatId)).length);
    } catch {
      return 0;
    }
  }
  emptyView(settings, grantedPermissions, missingPermissions, status, reason) {
    return {
      chatId: null,
      chatEnabled: true,
      isGroupChat: false,
      grantedPermissions,
      characters: [],
      greetings: [],
      active: null,
      upcoming: null,
      canUndo: false,
      missingPermissions,
      status,
      settings,
      prompt: {
        ready: false,
        autoPrompt: settings.autoPrompt,
        role: settings.promptRole,
        insertionDepth: settings.insertionDepth,
        content: "",
        reason
      },
      routes: {},
      storyline: emptyStorylineView(reason),
      diagnostics: this.diagnostics()
    };
  }
  async view(chatId) {
    const settings = await this.settings();
    const grantedPermissions = await this.api.permissions.getGranted().catch(() => []);
    const missingPermissions = this.missingPermissions(["characters", "chats", "chat_mutation", "generation", "interceptor"]);
    if (this.missingPermissions(CONTEXT_PERMISSIONS).length) {
      return this.emptyView(settings, grantedPermissions, missingPermissions, "Grant characters and chats to load Waypoints.", "Chat context permission is missing.");
    }
    const resolvedChatId = chatId === undefined ? await this.getActiveChatId(settings) : chatId;
    if (!resolvedChatId) {
      return this.emptyView(settings, grantedPermissions, missingPermissions, "Open a character or group chat to use Waypoints.", "No active chat.");
    }
    return this.serial(resolvedChatId, async () => {
      const context = await this.context(resolvedChatId);
      const state = reconcileChatState(await this.state(resolvedChatId), context);
      await this.reconcileJournalLocked(resolvedChatId, state, context, settings);
      const prompt = this.promptStatus(context, state, settings);
      const active = greetingForSelection(context.greetings, state.active);
      const upcoming = greetingForSelection(context.greetings, state.upcoming);
      const canUndo = this.api.permissions.has("chat_mutation") ? Boolean(await this.latestInsertedGreeting(resolvedChatId).catch(() => null)) : false;
      const hasGreetingChoices = context.greetings.length > 1;
      const status = !hasGreetingChoices ? "This chat has no alternate greetings, so Waypoints stays off." : !state.chatEnabled ? "Waypoints is off for this chat." : !state.upcoming ? "No upcoming greeting is selected." : !this.isSelectionEnabled(context, state, state.upcoming) ? "The selected upcoming character is turned off." : "Ready: " + upcoming?.characterName + " greeting " + String((upcoming?.greetingIndex ?? 0) + 1) + ".";
      return {
        chatId: resolvedChatId,
        chatEnabled: state.chatEnabled && hasGreetingChoices,
        isGroupChat: context.isGroupChat,
        grantedPermissions,
        characters: context.characters.map((character) => ({
          id: character.id,
          name: character.name,
          enabled: this.isCharacterEnabled(context, state, character.id)
        })),
        greetings: context.greetings,
        active,
        upcoming,
        canUndo,
        missingPermissions,
        status,
        settings,
        prompt,
        routes: chatRoutes(context, state),
        storyline: this.storylineView(context, state, settings),
        diagnostics: this.diagnostics()
      };
    });
  }
}

// src/handoff-events.ts
function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
function text2(value) {
  return typeof value === "string" && value.length ? value : undefined;
}
function handoffSignal(event, payload) {
  const data = record(payload);
  const message = record(data.message);
  const terminal = event === "GENERATION_ENDED" || event === "GENERATION_STOPPED";
  if (!terminal && event !== "MESSAGE_EDITED" && event !== "MESSAGE_SWIPED" && event !== "SWIPE_EDITED")
    return null;
  if (terminal && (data.error || data.impersonateDraft || data.generationType === "impersonate"))
    return null;
  if (message.is_user === true || message.role === "user" || message.role === "system")
    return null;
  if (event === "MESSAGE_SWIPED" && (data.action === "navigated" || data.action === "deleted"))
    return null;
  if (event === "MESSAGE_SWIPED" && typeof data.swipeId === "number" && data.swipeId !== message.swipe_id)
    return null;
  const chatId = text2(data.chatId) ?? text2(record(data.chat).id);
  const sourceMessageId = text2(data.messageId) ?? text2(message.id);
  const content = typeof data.content === "string" ? data.content : typeof message.content === "string" ? message.content : "";
  if (!chatId || !sourceMessageId && !content)
    return null;
  const generationId = text2(data.generationId);
  const eventKey = generationId ? chatId + ":generation:" + generationId : chatId + ":message:" + sourceMessageId + ":" + hashText(content);
  return { chatId, eventKey, sourceMessageId, content, extra: record(message.extra ?? data.extra) };
}

// src/loom-macros.ts
var WAYPOINTS_ACTIVE_MACRO = "waypoints_active";
var WAYPOINTS_CONTENT_MACRO = "waypoints_content";
var WAYPOINTS_ALT_MESSAGES_MACRO = "altMessages";
var WAYPOINTS_NEXT_MESSAGES_MACRO = "nextMessages";
var WAYPOINTS_CURRENT_MESSAGE_MACRO = "currentMessage";
var WAYPOINTS_NEXT_MESSAGE_MACRO = "nextMessage";
var WAYPOINTS_STORYLINE_ACTIVE_MACRO = "waypoints_storyline_active";
var WAYPOINTS_STORYLINE_MACRO = "waypoints_storyline";
var WAYPOINTS_STORYLINE_VALUE_MACROS = [
  ["waypoints_storyline_overview", "Returns the raw narrative overview text, without the overview template, when it is active for this chat.", (values) => values.storylineOverview],
  ["waypoints_storyline_position", "Returns a sentence describing where the story is on the storyline route.", (values) => values.storylinePosition],
  ["waypoints_current_waypoint", "Returns the current greeting's 1-based position on the storyline route, or nothing when it is off the route.", (values) => values.currentWaypoint],
  ["waypoints_next_waypoint", "Returns the upcoming greeting's 1-based position on the storyline route, or nothing when it is off the route.", (values) => values.nextWaypoint],
  ["waypoints_waypoint_count", "Returns the number of greetings on the storyline route.", (values) => values.waypointCount],
  ["waypoints_current_greeting", "Returns the current greeting's number on the character card (1 is the first message).", (values) => values.currentGreetingNumber],
  ["waypoints_next_greeting", "Returns the upcoming greeting's number on the character card (1 is the first message).", (values) => values.nextGreetingNumber]
];
function record2(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
function nonEmptyString(value) {
  return typeof value === "string" && value.trim() ? value : undefined;
}
function macroIdentity(context) {
  const value = record2(context);
  const env = record2(value.env);
  const chat = record2(env.chat);
  const extra = record2(env.extra);
  return {
    chatId: nonEmptyString(value.chatId) ?? nonEmptyString(chat.id),
    userId: nonEmptyString(value.userId) ?? nonEmptyString(extra.userId)
  };
}
function register(api, name, description, returnType, resolver, select, fallback) {
  const definition = {
    name,
    category: "Waypoints",
    description,
    returnType,
    volatile: true,
    handler: async (context) => {
      try {
        return select(await resolver(macroIdentity(context)));
      } catch {
        return fallback ?? (returnType === "boolean" ? "false" : "");
      }
    }
  };
  api.registerMacro(definition);
}
function registerWaypointsLoomMacros(api, resolver) {
  register(api, WAYPOINTS_ACTIVE_MACRO, "Returns true when the selected Waypoints path is enabled and has a rendered upcoming-scene prompt.", "boolean", resolver, (values) => values.active ? "true" : "false");
  register(api, WAYPOINTS_CONTENT_MACRO, "Returns the current Waypoints rendered upcoming-scene prompt for use in a Loom preset.", "string", resolver, (values) => values.active ? values.content : "");
  register(api, WAYPOINTS_ALT_MESSAGES_MACRO, "Returns the active character's alternate greetings as a JSON array. The standard firstMessage greeting is not included.", "string", resolver, (values) => JSON.stringify(values.altMessages), "[]");
  register(api, WAYPOINTS_NEXT_MESSAGES_MACRO, "Returns the greetings offered by the Waypoints next-greeting picker as a JSON array. In solo chats, only greetings after the current greeting are included.", "string", resolver, (values) => JSON.stringify(values.nextMessages), "[]");
  register(api, WAYPOINTS_CURRENT_MESSAGE_MACRO, "Returns the currently selected Waypoints greeting.", "string", resolver, (values) => values.currentMessage);
  register(api, WAYPOINTS_NEXT_MESSAGE_MACRO, "Returns the currently selected upcoming Waypoints greeting.", "string", resolver, (values) => values.nextMessage);
  register(api, WAYPOINTS_STORYLINE_ACTIVE_MACRO, "Returns true when this chat's narrative overview is enabled and has content.", "boolean", resolver, (values) => values.storylineActive ? "true" : "false");
  register(api, WAYPOINTS_STORYLINE_MACRO, "Returns the rendered Waypoints narrative overview (storyline) prompt for this chat.", "string", resolver, (values) => values.storylineActive ? values.storyline : "");
  for (const [name, description, select] of WAYPOINTS_STORYLINE_VALUE_MACROS) {
    register(api, name, description, "string", resolver, select);
  }
  let registeredAlternateGreetingCount = 0;
  return (alternateGreetingCount) => {
    const count = Number.isFinite(alternateGreetingCount) ? Math.max(0, Math.floor(alternateGreetingCount)) : 0;
    for (let index = registeredAlternateGreetingCount + 1;index <= count; index += 1) {
      register(api, `altMessage${index}`, `Returns alternate greeting ${index} for the active chat's character, or an empty string when it is not present.`, "string", resolver, (values) => values.altMessages[index - 1] ?? "");
    }
    for (let index = registeredAlternateGreetingCount;index > count; index -= 1) {
      api.unregisterMacro(`altMessage${index}`);
    }
    registeredAlternateGreetingCount = count;
  };
}

// src/backend.ts
var engines = new Map;
var interceptorDisposer;
var configuredInterceptorPriority;
var configuredProcessorPriority;
var registrationQueue = Promise.resolve();
function engine(userId) {
  const key = userId || "owner";
  let current = engines.get(key);
  if (!current) {
    current = new WaypointEngine(spindle, userId, async (settings, changedUserId) => {
      await configureHandlers(settings);
      spindle.sendToFrontend({ type: "waypoints:changed", reason: "settings" }, changedUserId);
    });
    engines.set(key, current);
  }
  return current;
}
var ensureAlternateGreetingMacros = registerWaypointsLoomMacros(spindle, ({ chatId, userId }) => engine(userId).loomValues(chatId));
async function refreshAlternateGreetingMacros(userId) {
  try {
    const count = await engine(userId).activeAlternateGreetingCount();
    ensureAlternateGreetingMacros(count);
  } catch (error) {
    spindle.log.warn("[Waypoints] alternate greeting macro registration failed: " + (error instanceof Error ? error.message : String(error)));
  }
}
function safeRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
function stringValue(value) {
  return typeof value === "string" && value.length ? value : undefined;
}
function notifyChanged(userId, reason) {
  spindle.sendToFrontend({ type: "waypoints:changed", reason }, userId);
}
async function registerHandlers(settings) {
  if (spindle.permissions.has("interceptor")) {
    if (configuredInterceptorPriority !== settings.interceptorPriority) {
      interceptorDisposer?.();
      interceptorDisposer = spindle.registerInterceptor((messages, context) => engine(context.userId).intercept(messages, context.chatId), settings.interceptorPriority);
      configuredInterceptorPriority = settings.interceptorPriority;
      spindle.log.info("[Waypoints] prompt interceptor registered at " + String(settings.interceptorPriority));
    }
  } else if (interceptorDisposer) {
    interceptorDisposer();
    interceptorDisposer = undefined;
    configuredInterceptorPriority = undefined;
  }
  if (spindle.permissions.has("chat_mutation") && configuredProcessorPriority !== settings.contentProcessorPriority) {
    spindle.registerMessageContentProcessor((ctx) => engine(ctx.userId).processContent(ctx), settings.contentProcessorPriority);
    configuredProcessorPriority = settings.contentProcessorPriority;
    spindle.log.info("[Waypoints] handoff processor registered at " + String(settings.contentProcessorPriority));
  } else if (!spindle.permissions.has("chat_mutation")) {
    configuredProcessorPriority = undefined;
  }
}
function configureHandlers(settings = DEFAULT_SETTINGS) {
  registrationQueue = registrationQueue.then(() => registerHandlers(settings), () => registerHandlers(settings));
  return registrationQueue;
}
async function refreshConfiguration() {
  const settings = await engine().settings();
  await configureHandlers(settings);
}
function parseSelection(value, required) {
  if (value === null && !required)
    return null;
  const source = safeRecord(value);
  if (typeof source.characterId !== "string" || !Number.isInteger(source.greetingIndex)) {
    throw new Error("Select a valid character greeting.");
  }
  return { characterId: source.characterId, greetingIndex: Number(source.greetingIndex) };
}
function parseStorylineDraft(value) {
  const source = safeRecord(value);
  if (source.route !== undefined && !Array.isArray(source.route))
    throw new Error("A storyline route must be a list of greetings.");
  return {
    route: Array.isArray(source.route) ? source.route : [],
    notes: typeof source.notes === "string" ? source.notes : "",
    overview: typeof source.overview === "string" ? source.overview : undefined
  };
}
function requireCharacterId(input) {
  const characterId = stringValue(input.characterId);
  if (!characterId)
    throw new Error("Choose a character.");
  return characterId;
}
async function handleRequest(raw, userId) {
  const request = safeRecord(raw);
  if (request.type !== "waypoints:request" || typeof request.requestId !== "string" || typeof request.action !== "string")
    return;
  const reply = (result, error) => {
    spindle.sendToFrontend({
      type: "waypoints:reply",
      requestId: request.requestId,
      result,
      error
    }, userId);
  };
  const input = safeRecord(request.input);
  const selectedChatId = stringValue(input.chatId);
  try {
    const current = engine(userId);
    let result;
    switch (request.action) {
      case "bootstrap":
      case "refresh":
        result = await current.view(input.chatId === null ? null : selectedChatId);
        break;
      case "save-settings":
        result = await current.saveSettings(input.settings);
        break;
      case "reset-settings":
        result = await current.resetSettings();
        break;
      case "set-active":
        if (!selectedChatId)
          throw new Error("No active chat is available.");
        await current.setActive(selectedChatId, parseSelection(input.selection, true));
        result = await current.view(selectedChatId);
        break;
      case "set-upcoming":
        if (!selectedChatId)
          throw new Error("No active chat is available.");
        await current.setUpcoming(selectedChatId, parseSelection(input.selection, false));
        result = await current.view(selectedChatId);
        break;
      case "set-enabled":
        if (!selectedChatId || typeof input.characterId !== "string" || typeof input.enabled !== "boolean") {
          throw new Error("Choose a character and an enabled state.");
        }
        await current.setEnabled(selectedChatId, input.characterId, input.enabled);
        result = await current.view(selectedChatId);
        break;
      case "set-chat-enabled":
        if (!selectedChatId || typeof input.enabled !== "boolean")
          throw new Error("Choose a chat and an enabled state.");
        await current.setChatEnabled(selectedChatId, input.enabled);
        result = await current.view(selectedChatId);
        break;
      case "force":
        result = {
          transition: await current.force(selectedChatId),
          view: await current.view(selectedChatId)
        };
        break;
      case "undo":
        result = {
          transition: await current.undo(selectedChatId),
          view: await current.view(selectedChatId)
        };
        break;
      case "set-story-route":
        if (!selectedChatId || typeof input.enabled !== "boolean")
          throw new Error("Choose a chat and an enabled state.");
        await current.setStoryRoute(selectedChatId, input.enabled);
        result = await current.view(selectedChatId);
        break;
      case "set-story-overview":
        if (!selectedChatId || typeof input.enabled !== "boolean")
          throw new Error("Choose a chat and an enabled state.");
        await current.setStoryOverview(selectedChatId, input.enabled);
        result = await current.view(selectedChatId);
        break;
      case "save-storyline":
        if (!selectedChatId)
          throw new Error("No active chat is available.");
        await current.saveStoryline(selectedChatId, requireCharacterId(input), parseStorylineDraft(input.storyline));
        result = await current.view(selectedChatId);
        break;
      case "delete-storyline":
        if (!selectedChatId)
          throw new Error("No active chat is available.");
        await current.deleteStoryline(selectedChatId, requireCharacterId(input));
        result = await current.view(selectedChatId);
        break;
      case "generate-storyline": {
        if (!selectedChatId)
          throw new Error("No active chat is available.");
        const characterId = requireCharacterId(input);
        const draft = parseStorylineDraft(input.storyline);
        notifyChanged(userId, "storyline");
        try {
          await current.generateStoryline(selectedChatId, characterId, { route: draft.route, notes: draft.notes });
        } finally {
          notifyChanged(userId, "storyline");
        }
        result = await current.view(selectedChatId);
        break;
      }
      case "cancel-storyline":
        result = { cancelled: current.cancelStorylineGeneration(requireCharacterId(input)) };
        break;
      case "list-connections":
        result = await current.listConnections();
        break;
      case "clear-diagnostics":
        current.clearDiagnostics();
        result = await current.view(selectedChatId);
        break;
      case "set-hud-visible": {
        const settings = await current.settings();
        result = await current.saveSettings({ ...settings, floatingControls: Boolean(input.visible) });
        break;
      }
      default:
        throw new Error("Unknown Waypoints action.");
    }
    reply(result);
  } catch (error) {
    reply(undefined, error instanceof Error ? error.message : String(error));
  }
}
function observeHandoff(kind, payload, userId) {
  const signal = handoffSignal(kind, payload);
  if (!signal)
    return;
  engine(userId).handleHandoff(signal).then((result) => {
    if (result.advanced)
      notifyChanged(userId, "handoff");
  }).catch((error) => {
    spindle.log.warn("[Waypoints] handoff observer failed: " + (error instanceof Error ? error.message : String(error)));
  });
}
spindle.onFrontendMessage((payload, userId) => {
  handleRequest(payload, userId);
});
spindle.permissions.onChanged(() => {
  refreshConfiguration().catch((error) => {
    spindle.log.warn("[Waypoints] permission refresh failed: " + (error instanceof Error ? error.message : String(error)));
  });
  refreshAlternateGreetingMacros();
  notifyChanged(undefined, "permissions");
});
spindle.permissions.onDenied((detail) => {
  spindle.log.warn("[Waypoints] " + detail.operation + " requires " + detail.permission);
  notifyChanged(undefined, "permission-denied");
});
for (const eventName of ["GENERATION_ENDED", "GENERATION_STOPPED", "MESSAGE_EDITED", "MESSAGE_SWIPED", "SWIPE_EDITED"]) {
  spindle.on(eventName, (payload, userId) => observeHandoff(eventName, payload, userId));
}
for (const eventName of [
  "CHAT_SWITCHED",
  "CHAT_CHANGED",
  "CHARACTER_EDITED",
  "CHARACTER_DELETED",
  "GENERATION_STARTED"
]) {
  spindle.on(eventName, (_payload, userId) => {
    notifyChanged(userId, eventName.toLowerCase());
    refreshAlternateGreetingMacros(userId);
  });
}
refreshAlternateGreetingMacros();
refreshConfiguration().catch((error) => {
  spindle.log.warn("[Waypoints] initial registration failed: " + (error instanceof Error ? error.message : String(error)));
});
