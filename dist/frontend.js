// src/util.ts
function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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
  "UPCOMING PREWRITTEN SCENE — DIRECTION AND TIMING REFERENCE ONLY:",
  "{{scene_excerpt}}",
  "</shape_scene_direction>"
].join(`
`);
var DEFAULT_STORYLINE_TEMPLATE = [
  "<storyline_overview>",
  "This roleplay follows a planned narrative journey for {{character_name}} through a sequence of prewritten scenes. Use this overview to keep long-term continuity, foreshadowing, character development, and pacing consistent with where the story is headed.",
  "- The overview covers the entire journey from start to finish, but the story may currently be anywhere along it. Use the story progress below to tell what has already happened and what is still ahead; never assume the story is at the beginning.",
  "- Treat it as private background guidance. Never reveal, quote, or summarize it to the user.",
  "- Do not skip ahead: story beats planned for later prewritten scenes must not happen early. Let the story earn each step.",
  "",
  "{{storyline_overview}}",
  "",
  "{{storyline_position}}",
  "</storyline_overview>"
].join(`
`);
var DEFAULT_STORYLINE_GENERATOR_TEMPLATE = [
  "You are a narrative designer preparing private guidance for a storyteller AI that runs a long-form interactive roleplay between {{character_name}} and {{user_name}}.",
  "",
  "The roleplay will pass through the {{waypoint_count}} prewritten scenes below, in this order. Each prewritten scene is inserted verbatim when the story reaches it. Between prewritten scenes, the storyteller improvises with {{user_name}} and must steer the story so the next prewritten scene can begin naturally.",
  "",
  "Write a narrative overview of the entire journey that gives the storyteller the long-range context a single upcoming scene cannot:",
  "1. Premise and arc: the central situation, the relationships, the themes and tone, and how the story escalates or transforms from the first prewritten scene to the last.",
  "2. Scene by scene, as a numbered list matching the prewritten scene numbers: where and when it takes place, who is present, the emotional state, and what has to happen between the previous prewritten scene and this one for it to begin naturally (the bridge).",
  "3. Continuity: facts that must stay consistent across the story, such as names, relationships, injuries, possessions, locations, time of day, and season.",
  "4. Threads to foreshadow early and pay off later.",
  "",
  `Rules: summarize in your own words and never quote or reproduce the scenes' prose. Refer to them only as prewritten scenes or story beats. Call everyone by name: write {{user_name}}, never "the user" or "you". Write in present tense as instructions to the storyteller. Use short headings and plain text without markdown tables. Keep it under about 800 words. Output only the overview.`,
  "",
  "{{story_context}}",
  "",
  "Author guidance: {{author_notes}}",
  "",
  "Prewritten scenes in story order:",
  "",
  "{{waypoints}}"
].join(`
`);
var LEGACY_STORYLINE_TEMPLATES = new Set([
  [
    "<storyline_overview>",
    "This roleplay follows a planned narrative journey for {{character_name}} through a sequence of prewritten waypoint scenes. Use this overview to keep long-term continuity, foreshadowing, character development, and pacing consistent with where the story is headed.",
    "- Treat it as private background guidance. Never reveal, quote, or summarize it to the user.",
    "- Do not skip ahead: events planned for later waypoints must not happen early. Let the story earn each step.",
    "",
    "{{storyline_overview}}",
    "",
    "{{storyline_position}}",
    "</storyline_overview>"
  ].join(`
`),
  [
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
`)
]);
var LEGACY_STORYLINE_GENERATOR_TEMPLATES = new Set([[
  "You are a narrative designer preparing private guidance for a storyteller AI that runs a long-form interactive roleplay with {{character_name}}.",
  "",
  "The roleplay will pass through the {{waypoint_count}} prewritten scenes below, in this order. Each prewritten scene is inserted verbatim when the story reaches it. Between prewritten scenes, the storyteller improvises with the user and must steer the story so the next prewritten scene can begin naturally.",
  "",
  "Write a narrative overview of the entire journey that gives the storyteller the long-range context a single upcoming scene cannot:",
  "1. Premise and arc: the central situation, the relationships, the themes and tone, and how the story escalates or transforms from the first prewritten scene to the last.",
  "2. Scene by scene, as a numbered list matching the prewritten scene numbers: where and when it takes place, who is present, the emotional state, and what has to happen between the previous prewritten scene and this one for it to begin naturally (the bridge).",
  "3. Continuity: facts that must stay consistent across the story, such as names, relationships, injuries, possessions, locations, time of day, and season.",
  "4. Threads to foreshadow early and pay off later.",
  "",
  "Rules: summarize in your own words and never quote or reproduce the scenes' prose. Refer to them only as prewritten scenes or story beats. Write in present tense as instructions to the storyteller. Use short headings and plain text without markdown tables. Keep it under about 800 words. Output only the overview.",
  "",
  "Character: {{character_name}}",
  "Description: {{character_description}}",
  "Personality: {{character_personality}}",
  "Scenario: {{character_scenario}}",
  "",
  "Author guidance: {{author_notes}}",
  "",
  "Prewritten scenes in story order:",
  "",
  "{{waypoints}}"
].join(`
`), [
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
`)]);
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
  newChatsEnabled: true,
  reminderToast: true,
  reminderShowOn: "enabled",
  reminderClickToggle: true,
  reminderNeverAgain: true,
  reminderDurationSeconds: 5,
  reminderFadeOut: true,
  reminderFadeSeconds: 5,
  reminderDelay: true,
  reminderDelaySeconds: 1,
  actionBarButton: true,
  actionBarStatusColor: true,
  characterCardSwitch: false,
  extrasActions: true,
  storylineTemplate: DEFAULT_STORYLINE_TEMPLATE,
  storylineGeneratorTemplate: DEFAULT_STORYLINE_GENERATOR_TEMPLATE,
  storylineInsertionDepth: 0,
  storylineWaypointCharLimit: 4000,
  storylineConnectionId: "",
  storylineModel: ""
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
function readSeconds(input, field, fallback, min, max, issues) {
  const value = input[field];
  if (value === undefined)
    return fallback;
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    issues.push({
      field,
      message: String(field) + " must be a number of seconds from " + String(min) + " to " + String(max) + "."
    });
    return fallback;
  }
  return Math.round(value * 10) / 10;
}
var REMINDER_SHOW_ON = new Set(["enabled", "disabled", "all"]);
function readReminderShowOn(input, issues) {
  const value = input.reminderShowOn;
  if (value === undefined)
    return DEFAULT_SETTINGS.reminderShowOn;
  if (typeof value === "string" && REMINDER_SHOW_ON.has(value))
    return value;
  issues.push({ field: "reminderShowOn", message: "Show the reminder on must be enabled chats, disabled chats, or all chats." });
  return DEFAULT_SETTINGS.reminderShowOn;
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
    newChatsEnabled: readBoolean(source, "newChatsEnabled", DEFAULT_SETTINGS.newChatsEnabled, issues),
    reminderToast: readBoolean(source, "reminderToast", DEFAULT_SETTINGS.reminderToast, issues),
    reminderShowOn: readReminderShowOn(source, issues),
    reminderClickToggle: readBoolean(source, "reminderClickToggle", DEFAULT_SETTINGS.reminderClickToggle, issues),
    reminderNeverAgain: readBoolean(source, "reminderNeverAgain", DEFAULT_SETTINGS.reminderNeverAgain, issues),
    reminderDurationSeconds: readSeconds(source, "reminderDurationSeconds", DEFAULT_SETTINGS.reminderDurationSeconds, 0.5, 300, issues),
    reminderFadeOut: readBoolean(source, "reminderFadeOut", DEFAULT_SETTINGS.reminderFadeOut, issues),
    reminderFadeSeconds: readSeconds(source, "reminderFadeSeconds", DEFAULT_SETTINGS.reminderFadeSeconds, 0, 60, issues),
    reminderDelay: readBoolean(source, "reminderDelay", DEFAULT_SETTINGS.reminderDelay, issues),
    reminderDelaySeconds: readSeconds(source, "reminderDelaySeconds", DEFAULT_SETTINGS.reminderDelaySeconds, 0, 60, issues),
    actionBarButton: readBoolean(source, "actionBarButton", DEFAULT_SETTINGS.actionBarButton, issues),
    actionBarStatusColor: readBoolean(source, "actionBarStatusColor", DEFAULT_SETTINGS.actionBarStatusColor, issues),
    characterCardSwitch: readBoolean(source, "characterCardSwitch", DEFAULT_SETTINGS.characterCardSwitch, issues),
    extrasActions: readBoolean(source, "extrasActions", DEFAULT_SETTINGS.extrasActions, issues),
    storylineTemplate: readString(source, "storylineTemplate", DEFAULT_SETTINGS.storylineTemplate, 16000, issues),
    storylineGeneratorTemplate: readString(source, "storylineGeneratorTemplate", DEFAULT_SETTINGS.storylineGeneratorTemplate, 16000, issues),
    storylineInsertionDepth: readInteger(source, "storylineInsertionDepth", DEFAULT_SETTINGS.storylineInsertionDepth, 0, 9999, issues),
    storylineWaypointCharLimit: readInteger(source, "storylineWaypointCharLimit", DEFAULT_SETTINGS.storylineWaypointCharLimit, 100, 1e5, issues),
    storylineConnectionId: readString(source, "storylineConnectionId", DEFAULT_SETTINGS.storylineConnectionId, 256, issues).trim(),
    storylineModel: readString(source, "storylineModel", DEFAULT_SETTINGS.storylineModel, 256, issues).trim()
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

// src/prompt.ts
function handoffTag(settings) {
  return "<" + settings.handoffTagName + " />";
}
function overrideTag(settings) {
  return "--" + settings.overrideTagName + "--";
}

// src/storyline.ts
function characterGreetings(greetings, characterId) {
  return greetings.filter((greeting) => greeting.characterId === characterId);
}
function cardOrder(greetings, characterId) {
  return characterGreetings(greetings, characterId).map((greeting) => greeting.greetingIndex);
}
function sameRoute(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
function sceneSpan(from, to, single, plural) {
  if (from > to)
    return "";
  return from === to ? "Prewritten scene " + String(from) + " " + single : "Prewritten scenes " + String(from) + (to === from + 1 ? " and " : " to ") + String(to) + " " + plural;
}
function describePosition(position) {
  if (!position || position.total === 0)
    return "";
  const { waypoint, next, total, hasUpcoming } = position;
  const of = (value) => String(value) + " of " + String(total);
  const parts = [];
  if (waypoint !== null) {
    parts.push("Story progress: the story is currently in prewritten scene " + of(waypoint) + ".");
    const past = sceneSpan(1, waypoint - 1, "has already happened.", "have already happened.");
    if (past)
      parts.push(past);
  } else {
    parts.push("Story progress: the story is currently between planned prewritten scenes.");
  }
  if (next !== null) {
    parts.push("The next prewritten scene is " + of(next) + "; steer toward it gradually.");
    const ahead = sceneSpan(next + 1, total, "is an upcoming story beat after that.", "are upcoming story beats after that.");
    if (ahead)
      parts.push(ahead);
  } else if (hasUpcoming) {
    parts.push("Another prewritten scene comes next; steer toward it gradually.");
  } else if (waypoint !== null && waypoint === total) {
    parts.push("This is the final prewritten scene. Continue the story freely while keeping continuity with the overview.");
  } else {
    parts.push("No further prewritten scene is planned.");
  }
  return parts.join(" ");
}

// src/state.ts
function greetingForSelection(greetings, selection) {
  if (!selection)
    return null;
  return greetings.find((greeting) => greeting.characterId === selection.characterId && greeting.greetingIndex === selection.greetingIndex) ?? null;
}
function routeCandidates(route, selection) {
  const position = route.indexOf(selection.greetingIndex);
  return (position >= 0 ? route.slice(position + 1) : [...route]).filter((index) => index !== selection.greetingIndex);
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

// src/frontend-model.ts
function approximatePromptTokenCount(characterCount) {
  return Math.max(0, Math.ceil(Math.max(0, characterCount) / 4));
}
function formatPromptCount(tokenCount, characterCount, approximate) {
  return (approximate ? "~" : "") + String(Math.max(0, Math.round(tokenCount))) + " Tokens / " + String(Math.max(0, characterCount)) + " Characters";
}
function cloneSettingsDraft(settings) {
  return structuredClone(settings);
}
var PROMPT_SETTING_KEYS = [
  "promptTemplate",
  "prewrittenSceneCharLimit",
  "promptExcludeRegex",
  "insertionDepth",
  "promptRole",
  "autoPrompt",
  "storylineTemplate",
  "storylineGeneratorTemplate",
  "storylineInsertionDepth",
  "storylineWaypointCharLimit"
];
var STORYLINE_TAB_SETTING_KEYS = ["storylineConnectionId", "storylineModel"];
var GENERAL_SETTING_KEYS = Object.keys(DEFAULT_SETTINGS).filter((key) => !PROMPT_SETTING_KEYS.includes(key) && !STORYLINE_TAB_SETTING_KEYS.includes(key));
function resetDraftFields(settings, keys) {
  const next = structuredClone(settings);
  const defaults = structuredClone(DEFAULT_SETTINGS);
  for (const key of keys)
    next[key] = defaults[key];
  return next;
}
function shouldShowReminder(view) {
  const settings = view.settings;
  if (!view.chatId || !settings.reminderToast || !view.grantedPermissions.includes("ui_panels"))
    return false;
  if (view.greetings.length < 2)
    return false;
  if (settings.reminderNeverAgain && view.reminderHidden)
    return false;
  if (settings.reminderShowOn === "enabled")
    return view.chatEnabled;
  if (settings.reminderShowOn === "disabled")
    return !view.chatEnabled;
  return true;
}
function reminderTimeline(settings, now, withDelay = true) {
  const showAt = now + (withDelay && settings.reminderDelay ? settings.reminderDelaySeconds * 1000 : 0);
  const hideAt = showAt + settings.reminderDurationSeconds * 1000;
  return { showAt, hideAt, goneAt: hideAt + (settings.reminderFadeOut ? settings.reminderFadeSeconds * 1000 : 0) };
}
function reminderPhase(timeline, now) {
  if (now < timeline.showAt)
    return { phase: "waiting" };
  if (now < timeline.hideAt)
    return { phase: "showing", remaining: (timeline.hideAt - now) / (timeline.hideAt - timeline.showAt) };
  if (now < timeline.goneAt)
    return { phase: "fading", opacity: (timeline.goneAt - now) / (timeline.goneAt - timeline.hideAt) };
  return { phase: "gone" };
}
function draftValidation(settings) {
  try {
    const result = validateSettings(settings);
    return { valid: true, messages: result.warnings };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { valid: false, messages: [message] };
  }
}
function canShowHud(floatingControls, grantedPermissions) {
  return floatingControls && grantedPermissions.includes("ui_panels");
}
function greetingPickerOptions(kind, view) {
  if (kind === "current")
    return view.greetings;
  return nextGreetingChoices(view.greetings, view.active, view.isGroupChat, view.routes);
}
function shouldRefreshDrawer(eventName) {
  return eventName === "CHAT_SWITCHED" || eventName === "CHAT_CHANGED" || eventName === "waypoints:changed";
}
function savedKey(route, fields) {
  return JSON.stringify([route, fields.notes, fields.includePersona, fields.includeCharacter, fields.overview]);
}
function storylineDraftFromSaved(saved, greetings) {
  const own = cardOrder(greetings, saved.characterId);
  const route = saved.route.length ? saved.route.filter((index) => own.includes(index)) : own;
  return {
    characterId: saved.characterId,
    order: [...route, ...own.filter((index) => !route.includes(index))],
    excluded: own.filter((index) => !route.includes(index)),
    notes: saved.notes,
    includePersona: saved.includePersona,
    includeCharacter: saved.includeCharacter,
    overview: saved.overview,
    base: savedKey(saved.route, saved)
  };
}
function storylineDraftRoute(draft, greetings) {
  const route = draft.order.filter((index) => !draft.excluded.includes(index));
  return sameRoute(route, cardOrder(greetings, draft.characterId)) ? [] : route;
}
function storylineDraftStops(draft) {
  return draft.order.filter((index) => !draft.excluded.includes(index));
}
function draftKey(draft, greetings) {
  return savedKey(storylineDraftRoute(draft, greetings), draft);
}
function storylineDraftDirty(draft, saved, greetings) {
  return draftKey(draft, greetings) !== savedKey(saved.route, saved);
}
function reconcileStorylineDraft(draft, saved, greetings) {
  if (!draft || draftKey(draft, greetings) === draft.base)
    return storylineDraftFromSaved(saved, greetings);
  const own = cardOrder(greetings, saved.characterId);
  const order = draft.order.filter((index) => own.includes(index));
  const added = own.filter((index) => !order.includes(index));
  return {
    ...draft,
    order: [...order, ...added],
    excluded: [...draft.excluded.filter((index) => own.includes(index)), ...added]
  };
}
function moveStorylineStop(draft, index, offset) {
  const position = draft.order.indexOf(index);
  const target = position + offset;
  if (position < 0 || target < 0 || target >= draft.order.length)
    return draft;
  const order = [...draft.order];
  [order[position], order[target]] = [order[target], order[position]];
  return { ...draft, order };
}
function toggleStorylineStop(draft, index, included) {
  const excluded = draft.excluded.filter((entry) => entry !== index);
  if (!included)
    excluded.push(index);
  return { ...draft, excluded };
}
function resetStorylineOrder(draft, greetings) {
  return { ...draft, order: cardOrder(greetings, draft.characterId), excluded: [] };
}

// src/styles.ts
var waypointStyles = [
  ".wp-root{color:var(--lumiverse-text,#ececf1);font:13px/1.45 system-ui,sans-serif;padding:12px;max-width:760px;margin:auto}",
  ".wp-header{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:12px}",
  ".wp-header h2{font-size:18px;margin:0 0 3px}.wp-muted{color:var(--lumiverse-text-muted,#9da0a8);margin:0}",
  ".wp-tabs{display:flex;gap:6px;border-bottom:1px solid var(--lumiverse-border,#34363c);margin-bottom:14px}",
  ".wp-tab{appearance:none;border:0;border-bottom:2px solid transparent;background:transparent;color:inherit;padding:8px 12px;cursor:pointer;font:inherit}",
  ".wp-tab[aria-selected=true]{border-color:var(--lumiverse-primary,#8b7cff);color:var(--lumiverse-primary,#a99dff)}",
  ".wp-card,.wp-section{background:var(--lumiverse-bg-elevated,#202126);border:1px solid var(--lumiverse-border,#34363c);border-radius:9px;padding:12px;margin:0 0 12px}",
  ".wp-section h3{font-size:14px;margin:0 0 9px}.wp-section h4{font-size:13px;margin:14px 0 6px}",
  ".wp-alert{border-left:3px solid #e7ad42;background:color-mix(in srgb,#e7ad42 11%,transparent);padding:9px 10px;margin:0 0 12px;border-radius:4px}",
  ".wp-notice{border-left:3px solid var(--lumiverse-primary,#8b7cff);background:color-mix(in srgb,var(--lumiverse-primary,#8b7cff) 11%,transparent);padding:9px 10px;margin:0 0 12px;border-radius:4px}",
  ".wp-notice.error{border-color:#e66161;background:color-mix(in srgb,#e66161 11%,transparent)}",
  ".wp-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px}.wp-field{min-width:0;margin:0 0 12px}",
  ".wp-field>label,.wp-label{display:block;font-weight:600;margin-bottom:4px}.wp-help{font-size:12px;color:var(--lumiverse-text-muted,#9da0a8);margin:3px 0 6px}",
  ".wp-native{min-height:32px}.wp-prompt-count{display:inline-flex;align-items:center;margin:6px 0 2px;padding:4px 7px;border:1px solid var(--lumiverse-border,#34363c);border-radius:5px;color:var(--lumiverse-text-muted,#9da0a8);font:600 12px/1.25 ui-monospace,Consolas,monospace;font-variant-numeric:tabular-nums}.wp-preview{white-space:pre-wrap;max-height:180px;overflow:auto;background:var(--lumiverse-bg,#16171b);border:1px solid var(--lumiverse-border,#34363c);border-radius:6px;padding:9px;margin:6px 0 0;font:12px/1.35 ui-monospace,Consolas,monospace}",
  ".wp-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.wp-row.between{justify-content:space-between}.wp-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}",
  ".wp-button{appearance:none;border:1px solid var(--lumiverse-border,#4c4e56);border-radius:6px;background:var(--lumiverse-bg,#2a2b31);color:inherit;padding:6px 10px;cursor:pointer;font:inherit}",
  ".wp-button.primary{background:var(--lumiverse-primary,#796bdf);border-color:var(--lumiverse-primary,#796bdf);color:#fff}.wp-button.danger{border-color:#c75a5a}.wp-button:disabled{opacity:.48;cursor:not-allowed}",
  ".wp-character{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 0;border-top:1px solid var(--lumiverse-border,#34363c)}.wp-character:first-child{border-top:0}",
  ".wp-character-name{font-weight:600}.wp-kicker{font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:var(--lumiverse-text-muted,#9da0a8)}",
  ".wp-validation{font-size:12px;margin:4px 0 8px}.wp-validation.good{color:#77c68e}.wp-validation.bad{color:#ef8b8b}",
  ".wp-loom-help{margin-top:12px;padding:10px;border:1px solid var(--lumiverse-border,#34363c);border-radius:7px;background:color-mix(in srgb,var(--lumiverse-bg,#16171b) 65%,transparent)}.wp-loom-help .wp-preview{margin-bottom:0}",
  ".wp-code{font-family:ui-monospace,Consolas,monospace;background:var(--lumiverse-bg,#16171b);border-radius:4px;padding:2px 5px}",
  ".wp-diagnostics summary{cursor:pointer;font-weight:600}.wp-diagnostics pre{max-height:240px}.wp-divider{height:1px;background:var(--lumiverse-border,#34363c);margin:14px 0}",
  ".wp-action-bar-mount{display:contents}.wp-action-bar-button{appearance:none;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;flex:0 0 28px;padding:0;border:0;border-radius:4px;background:transparent;color:var(--lumiverse-text-muted,#9da0a8);cursor:pointer}.wp-action-bar-button:hover{background:var(--lumiverse-bg-hover,#34363c)}.wp-action-bar-button:focus-visible{outline:2px solid var(--lumiverse-primary,#8b7cff);outline-offset:-2px}.wp-action-bar-button:disabled{opacity:.45;cursor:not-allowed}.wp-action-bar-button svg{width:15px;height:15px}",
  ".wp-picker{height:min(78vh,900px);min-height:min(560px,calc(100vh - 170px));display:flex;min-width:0;flex-direction:column;overflow:hidden;color:var(--lumiverse-text,#ececf1);font:13px/1.45 system-ui,sans-serif}.wp-picker *{box-sizing:border-box}.wp-picker-main{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;gap:12px;padding:16px;overflow:hidden}.wp-picker-meta{color:var(--lumiverse-text-muted,#9da0a8);font-size:12px;line-height:1.35;overflow-wrap:anywhere}.wp-picker-field{display:grid;gap:6px;flex:0 0 auto}.wp-picker-label{color:var(--lumiverse-text-muted,#9da0a8);font-size:12px}.wp-picker-select{width:100%;min-height:54px;color:var(--lumiverse-text,#ececf1);background:var(--lumiverse-fill,rgba(255,255,255,.08));border:1px solid var(--lumiverse-border,#34363c);border-radius:7px;padding:13px 14px;font:600 16px/1.35 system-ui,sans-serif}.wp-picker-preview{flex:1 1 auto;min-height:0;overflow:auto;background:rgba(0,0,0,.22);border:1px solid var(--lumiverse-border,#34363c);border-radius:8px}.wp-picker-preview pre{margin:0;padding:14px;white-space:pre-wrap;word-break:break-word;overflow-wrap:anywhere;font:13px/1.45 ui-monospace,Consolas,monospace}.wp-picker-error{flex:0 0 auto;color:#ef8b8b;border-left:3px solid #e66161;background:color-mix(in srgb,#e66161 11%,transparent);padding:8px 10px;border-radius:4px}.wp-picker-footer{flex:0 0 auto;display:flex;align-items:center;justify-content:flex-end;gap:8px;padding:12px 16px 16px;border-top:1px solid var(--lumiverse-border,#34363c)}",
  ".wp-hud{display:flex;align-items:center;gap:5px;height:100%;box-sizing:border-box;background:var(--lumiverse-bg-elevated,#202126);border:1px solid var(--lumiverse-border,#34363c);border-radius:8px;padding:5px 7px;box-shadow:0 4px 16px #0006}.wp-hud-label{font-weight:700;font-size:12px;margin-right:2px}.wp-hud .wp-button{font-size:11px;padding:4px 6px}",
  ".wp-reminder{width:100%;height:100%;color:var(--lumiverse-text,#ececf1);font:13px/1.25 system-ui,sans-serif}.wp-reminder-card{--wp-reminder-accent:var(--lumiverse-primary,#8b7cff);position:relative;box-sizing:border-box;width:100%;height:100%;overflow:hidden;display:flex;align-items:center;gap:12px;border:1px solid color-mix(in srgb,var(--wp-reminder-accent) 70%,transparent);border-left:4px solid var(--wp-reminder-accent);border-radius:8px;background:var(--lumiverse-bg-elevated,#202126);box-shadow:0 6px 22px #0008;padding:0 12px 3px}.wp-reminder-card.on{--wp-reminder-accent:#3fb96a}.wp-reminder-card.off{--wp-reminder-accent:#e05555}.wp-reminder-card.clickable{cursor:pointer}.wp-reminder-card.clickable:hover{background:color-mix(in srgb,var(--wp-reminder-accent) 9%,var(--lumiverse-bg-elevated,#202126))}.wp-reminder-card:focus-visible{outline:2px solid var(--wp-reminder-accent);outline-offset:-2px}.wp-reminder-text{flex:1 1 auto;min-width:0}.wp-reminder-title{font-weight:700;font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.wp-reminder-state{color:var(--wp-reminder-accent);font-weight:800}.wp-reminder-hint{font-size:11px;color:var(--lumiverse-text-muted,#9da0a8);margin-top:1px}.wp-reminder-never{flex:0 0 auto;display:flex;align-items:center;gap:5px;font-size:11px;color:var(--lumiverse-text-muted,#9da0a8);cursor:pointer;white-space:nowrap}.wp-reminder-never input{margin:0;accent-color:var(--wp-reminder-accent)}.wp-reminder-track{position:absolute;left:0;right:0;bottom:0;height:3px;background:color-mix(in srgb,var(--wp-reminder-accent) 20%,transparent);overflow:hidden}.wp-reminder-progress{width:100%;height:100%;background:var(--wp-reminder-accent);transform-origin:left center;will-change:transform}",
  ".wp-suboptions{margin:2px 0 8px 12px;padding-left:12px;border-left:2px solid var(--lumiverse-border,#34363c)}.wp-suboptions[hidden]{display:none}.wp-action-bar-button.wp-status-on{color:#3fb96a}.wp-action-bar-button.wp-status-off{color:#e05555}",
  ".wp-story-list{list-style:none;margin:0 0 4px;padding:0;display:grid;gap:6px}.wp-story-row{display:grid;grid-template-columns:auto 26px minmax(0,1fr) auto;align-items:start;gap:8px;padding:8px;border:1px solid var(--lumiverse-border,#34363c);border-radius:7px;background:var(--lumiverse-bg,#16171b)}.wp-story-row.excluded{opacity:.55;border-style:dashed}.wp-story-check{margin:3px 0 0;width:16px;height:16px;accent-color:var(--lumiverse-primary,#8b7cff)}.wp-story-step{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:50%;background:color-mix(in srgb,var(--lumiverse-primary,#8b7cff) 22%,transparent);font:700 12px/1 ui-monospace,Consolas,monospace;font-variant-numeric:tabular-nums}.wp-story-row.excluded .wp-story-step{background:transparent;border:1px solid var(--lumiverse-border,#34363c)}.wp-story-body{min-width:0}.wp-story-title{display:flex;align-items:center;gap:6px;flex-wrap:wrap}.wp-story-snippet{color:var(--lumiverse-text-muted,#9da0a8);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.wp-story-preview summary{cursor:pointer;font-size:12px;color:var(--lumiverse-text-muted,#9da0a8);margin-top:2px}.wp-story-preview .wp-preview{max-height:240px}.wp-story-moves{display:flex;gap:4px}.wp-icon-button{width:28px;height:28px;padding:0;line-height:1}.wp-badge{font-size:10px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;padding:1px 6px;border-radius:999px;border:1px solid var(--lumiverse-primary,#8b7cff);color:var(--lumiverse-primary,#ad9dff)}.wp-badge.next{border-color:#77c68e;color:#77c68e}.wp-generating{align-self:center;color:var(--lumiverse-primary,#ad9dff);font-weight:600}",
  "@media (max-height:760px){.wp-picker{height:calc(100vh - 170px);min-height:0}}@media (max-width:430px){.wp-root{padding:8px}.wp-header{display:block}.wp-header .wp-button{margin-top:8px}.wp-grid{grid-template-columns:1fr}.wp-story-row{grid-template-columns:auto 24px minmax(0,1fr)}.wp-story-moves{grid-column:3}}"
].join(`
`);

// src/frontend.ts
function element(tag, className = "", text) {
  const node = document.createElement(tag);
  if (className)
    node.className = className;
  if (text !== undefined)
    node.textContent = text;
  return node;
}
function safeRecord(value) {
  return isRecord(value) ? value : {};
}
function asView(value) {
  if (!isRecord(value) || !isRecord(value.settings) || !Array.isArray(value.greetings))
    return null;
  return value;
}
function selectionValue(greeting) {
  return greeting ? JSON.stringify({ characterId: greeting.characterId, greetingIndex: greeting.greetingIndex }) : "";
}
function parseSelection(value) {
  if (!value)
    return null;
  try {
    const parsed = JSON.parse(value);
    if (!isRecord(parsed) || typeof parsed.characterId !== "string" || !Number.isInteger(parsed.greetingIndex))
      return null;
    return { characterId: parsed.characterId, greetingIndex: Number(parsed.greetingIndex) };
  } catch {
    return null;
  }
}
function greetingLabel(greeting) {
  const firstLine = greeting.text.replace(/\s+/g, " ").slice(0, 86);
  return greeting.characterName + " — greeting " + String(greeting.greetingIndex + 1) + (firstLine ? ": " + firstLine : "");
}
function asConnections(value) {
  if (!Array.isArray(value))
    return [];
  return value.flatMap((entry) => isRecord(entry) && typeof entry.id === "string" ? [{
    id: entry.id,
    name: typeof entry.name === "string" ? entry.name : entry.id,
    model: typeof entry.model === "string" ? entry.model : "",
    isDefault: entry.isDefault === true
  }] : []);
}
var GENERATOR_SAVE_DELAY_MS = 600;
var GENERATION_TIMEOUT_MS = 10 * 60000;
function compactPreview(value, limit = 580) {
  return value.length > limit ? value.slice(0, limit) + "…" : value;
}
var WAYPOINTS_FLAG_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M5 19V5m0 0 11 3-3 5 6 2-3 5-11-3"/><circle cx="5" cy="5" r="1.5"/></svg>';
var WAYPOINTS_COMPASS_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="m15.5 8.5-2.7 5-5 2.7 2.7-5 5-2.7Z"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/></svg>';
function setup(ctx) {
  const tab = ctx.ui.registerDrawerTab({
    id: "waypoints",
    title: "Waypoints",
    shortName: "Waypoints",
    headerTitle: "Waypoints",
    description: "Guide a chat through character greetings as story waypoints",
    keywords: ["greetings", "handoff", "scene", "prompt", "waypoints"],
    iconSvg: WAYPOINTS_FLAG_ICON
  });
  tab.root.classList.add("wp-mount");
  const root = element("div", "wp-root");
  tab.root.append(root);
  const removeStyle = ctx.dom.addStyle(waypointStyles);
  let actionBarMount = null;
  try {
    actionBarMount = ctx.ui.mount("chat_actions");
    actionBarMount.classList.add("wp-action-bar-mount");
  } catch (error) {
    console.warn("[Waypoints] action-bar mount unavailable", error);
  }
  const actionBarButton = actionBarMount ? element("button", "wp-action-bar-button") : null;
  if (actionBarButton && actionBarMount) {
    actionBarButton.type = "button";
    actionBarButton.innerHTML = WAYPOINTS_FLAG_ICON;
    actionBarButton.title = "Waypoints controls";
    actionBarButton.setAttribute("aria-label", "Waypoints controls");
    actionBarButton.hidden = true;
    actionBarMount.append(actionBarButton);
  }
  let page = "waypoints";
  let view = null;
  let draft = cloneSettingsDraft(DEFAULT_SETTINGS);
  let draftInitialized = false;
  let destroyed = false;
  let busy = false;
  let notice = "";
  let noticeError = false;
  let sequence = 0;
  let selection = ctx.getActiveChat();
  let selectionVersion = 0;
  let refreshFlight;
  let hud;
  let reminder;
  let pendingReminderChatId = null;
  let extrasActions = [];
  let pickerModal;
  let pickerOpen = false;
  const storyDrafts = new Map;
  const openStoryPreviews = new Set;
  let storyCharacterId = null;
  let generatingCharacterId = null;
  let connections;
  let connectionsLoading = false;
  let generatorPending = null;
  let generatorSaveTimer;
  let generatorSaving = Promise.resolve(true);
  const pending = new Map;
  let componentHandles = [];
  const disposers = [];
  function clearComponents() {
    for (const handle of componentHandles)
      handle.destroy();
    componentHandles = [];
  }
  function rpc(action, input = {}, timeoutMs = 30000) {
    if (destroyed)
      return Promise.reject(new Error("Waypoints is closed."));
    const requestId = "wp-" + String(++sequence) + "-" + Date.now().toString(36);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(requestId);
        reject(new Error("Waypoints did not respond in time."));
      }, timeoutMs);
      pending.set(requestId, { resolve: (value) => resolve(value), reject, timer });
      try {
        ctx.sendToBackend({ type: "waypoints:request", requestId, action, input });
      } catch (error) {
        pending.delete(requestId);
        clearTimeout(timer);
        reject(error);
      }
    });
  }
  function setNotice(message, error = false) {
    notice = message;
    noticeError = error;
  }
  function currentChatId() {
    return ctx.getActiveChat().chatId ?? undefined;
  }
  function requireCurrentChatId() {
    const chatId = currentChatId();
    if (!chatId || view?.chatId !== chatId)
      throw new Error("Wait for the active chat to load first.");
    return chatId;
  }
  function syncSelection() {
    if (destroyed)
      return false;
    const next = ctx.getActiveChat();
    if (next.chatId === selection.chatId && next.characterId === selection.characterId)
      return false;
    const chatChanged = next.chatId !== selection.chatId;
    if (chatChanged) {
      dismissReminder();
      pendingReminderChatId = next.chatId;
    }
    selection = next;
    selectionVersion += 1;
    refreshFlight = undefined;
    view = null;
    busy = false;
    setNotice("");
    promptCounter.refresh("");
    storylineCounter.refresh("");
    generatingCharacterId = null;
    pickerModal?.dismiss();
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(new Error("The active chat changed."));
    }
    pending.clear();
    render();
    syncActionControls();
    syncHud();
    return true;
  }
  function dismissReminder() {
    if (!reminder)
      return;
    clearInterval(reminder.interval);
    reminder.widget?.destroy();
    reminder = undefined;
  }
  function tickReminder() {
    const current = reminder;
    if (!current)
      return;
    if (destroyed || ctx.getActiveChat().chatId !== current.chatId) {
      dismissReminder();
      return;
    }
    const phase = reminderPhase(current.timeline, Date.now());
    if (phase.phase === "waiting")
      return;
    if (!current.widget && !openReminderWidget(current)) {
      dismissReminder();
      return;
    }
    if (phase.phase === "gone") {
      finishReminder(current);
      return;
    }
    if (current.progress)
      current.progress.style.transform = "scaleX(" + String(phase.phase === "showing" ? phase.remaining : 0) + ")";
    if (current.widget)
      current.widget.root.style.opacity = phase.phase === "fading" ? phase.opacity.toFixed(3) : "";
  }
  function finishReminder(current) {
    const hide = current.neverAgain && current.neverBox?.checked === true;
    const chatId = current.chatId;
    dismissReminder();
    if (!hide || destroyed)
      return;
    if (view?.chatId === chatId)
      view.reminderHidden = true;
    rpc("set-reminder-hidden", { chatId, hidden: true }).catch((error) => {
      console.warn("[Waypoints] could not hide the reminder for this chat", error);
    });
  }
  function paintReminder(current) {
    if (!current.card || !current.title || !current.hint)
      return;
    const state = current.enabled ? "ENABLED" : "DISABLED";
    current.card.classList.toggle("on", current.enabled);
    current.card.classList.toggle("off", !current.enabled);
    current.title.replaceChildren("Waypoints is ", element("strong", "wp-reminder-state", state), " for this chat!");
    current.hint.textContent = "click here to " + (current.enabled ? "DISABLE" : "ENABLE");
    current.hint.hidden = !current.clickToggle;
    current.card.setAttribute("aria-label", "Waypoints is " + state + " for this chat" + (current.clickToggle ? ". Click to " + (current.enabled ? "disable" : "enable") + "." : "."));
  }
  function openReminderWidget(current) {
    const viewportWidth = document.defaultView?.innerWidth ?? 1280;
    const width = Math.max(240, Math.min(current.neverAgain ? 540 : 340, viewportWidth - 24));
    const height = current.clickToggle ? 52 : 38;
    let widget;
    try {
      const options = {
        width,
        height,
        initialPosition: { x: Math.max(12, viewportWidth - width - 16), y: 68 },
        snapToEdge: true,
        chromeless: true,
        tooltip: "Waypoints chat reminder",
        persistGeometry: "chat-reminder-bar"
      };
      widget = ctx.ui.createFloatWidget(options);
    } catch (error) {
      console.warn("[Waypoints] reminder widget unavailable", error);
      return false;
    }
    const card = element("div", "wp-reminder-card");
    card.setAttribute("role", current.clickToggle ? "button" : "status");
    const text = element("div", "wp-reminder-text");
    const title = element("div", "wp-reminder-title");
    const hint = element("div", "wp-reminder-hint");
    text.append(title, hint);
    card.append(text);
    if (current.neverAgain) {
      const never = element("label", "wp-reminder-never");
      const box = element("input");
      box.type = "checkbox";
      never.append(box, element("span", "", "Never remind me for this chat"));
      never.addEventListener("click", (event) => event.stopPropagation());
      never.addEventListener("keydown", (event) => event.stopPropagation());
      card.append(never);
      current.neverBox = box;
    }
    const track = element("div", "wp-reminder-track");
    const progress = element("div", "wp-reminder-progress");
    track.append(progress);
    card.append(track);
    if (current.clickToggle) {
      card.tabIndex = 0;
      card.classList.add("clickable");
      card.addEventListener("click", () => toggleFromReminder(current));
      card.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ")
          return;
        event.preventDefault();
        toggleFromReminder(current);
      });
    }
    widget.root.className = "wp-reminder";
    widget.root.replaceChildren(card);
    Object.assign(current, { widget, card, title, hint, progress });
    paintReminder(current);
    return true;
  }
  function toggleFromReminder(current) {
    if (reminder !== current || current.toggling || busy)
      return;
    if (destroyed || ctx.getActiveChat().chatId !== current.chatId) {
      dismissReminder();
      return;
    }
    const enabled = !current.enabled;
    safely(async () => {
      current.toggling = true;
      try {
        await rpc("set-chat-enabled", { chatId: current.chatId, enabled });
        if (reminder === current) {
          current.enabled = enabled;
          current.timeline = reminderTimeline(view?.settings ?? DEFAULT_SETTINGS, Date.now(), false);
          paintReminder(current);
          tickReminder();
        }
      } finally {
        current.toggling = false;
      }
      await load();
    });
  }
  function maybeShowReminder() {
    if (!view || !pendingReminderChatId || pendingReminderChatId !== view.chatId)
      return;
    const chatId = pendingReminderChatId;
    pendingReminderChatId = null;
    if (!shouldShowReminder(view))
      return;
    const settings = view.settings;
    reminder = {
      chatId,
      enabled: view.chatEnabled,
      clickToggle: settings.reminderClickToggle,
      neverAgain: settings.reminderNeverAgain,
      timeline: reminderTimeline(settings, Date.now()),
      interval: setInterval(tickReminder, 50),
      toggling: false
    };
    tickReminder();
  }
  function isCurrentSelection(version) {
    if (destroyed)
      return false;
    if (syncSelection())
      refresh();
    return version === selectionVersion;
  }
  function refresh() {
    if (destroyed)
      return;
    const loading = load();
    const version = selectionVersion;
    loading.catch((error) => {
      if (!isCurrentSelection(version))
        return;
      setNotice(error instanceof Error ? error.message : String(error), true);
      render();
    });
  }
  function tokenCounter(pageName) {
    let counted = "";
    let display = null;
    let countSequence = 0;
    return {
      display(content) {
        return display ?? "Counting… / " + String(content.length) + " Characters";
      },
      refresh(content) {
        if (!content) {
          counted = "";
          display = null;
          countSequence += 1;
          return;
        }
        if (content === counted && display !== null)
          return;
        const sequenceAtStart = ++countSequence;
        const characterCount = content.length;
        counted = content;
        display = "Counting… / " + String(characterCount) + " Characters";
        (async () => {
          let tokenCount = approximatePromptTokenCount(characterCount);
          let approximate = true;
          try {
            const result = ctx.tokens ? await ctx.tokens.countText(content) : undefined;
            if (result && Number.isFinite(result.total_tokens)) {
              tokenCount = result.total_tokens;
              approximate = result.approximate || result.tokenizer_id === null;
            }
          } catch {}
          if (destroyed || sequenceAtStart !== countSequence || counted !== content)
            return;
          display = formatPromptCount(tokenCount, characterCount, approximate);
          if (page === pageName)
            render();
        })();
      }
    };
  }
  const promptCounter = tokenCounter("waypoints");
  const storylineCounter = tokenCounter("storyline");
  function updateDraftValidation(target) {
    const result = draftValidation(draft);
    target.className = "wp-validation " + (result.valid ? "good" : "bad");
    target.textContent = result.valid ? result.messages.length ? result.messages.join(" ") : "Draft is ready to save." : result.messages.join(" ");
  }
  function addField(parent, label, help, mount) {
    const wrap = element("div", "wp-field");
    wrap.append(element("label", "wp-label", label));
    if (typeof help !== "string") {
      help.classList.add("wp-help");
      wrap.append(help);
    } else if (help) {
      wrap.append(element("p", "wp-help", help));
    }
    const target = element("div", "wp-native");
    wrap.append(target);
    parent.append(wrap);
    componentHandles.push(mount(target));
  }
  async function load() {
    if (destroyed)
      return;
    syncSelection();
    if (refreshFlight) {
      refreshFlight.queued = true;
      return refreshFlight.promise;
    }
    const flight = { version: selectionVersion, queued: false, promise: Promise.resolve() };
    refreshFlight = flight;
    flight.promise = (async () => {
      do {
        flight.queued = false;
        const chatId = selection.chatId;
        const loaded = asView(await rpc("refresh", { chatId }));
        if (!isCurrentSelection(flight.version))
          throw new Error("The active chat changed.");
        if (!loaded || loaded.chatId !== null && loaded.chatId !== chatId) {
          throw new Error("Waypoints returned an invalid status.");
        }
        view = loaded;
        if (!draftInitialized) {
          draft = cloneSettingsDraft(loaded.settings);
          draftInitialized = true;
        }
        promptCounter.refresh(loaded.prompt.content);
        storylineCounter.refresh(loaded.storyline.prompt.content);
        syncStoryDrafts();
        render();
        syncActionControls();
        syncHud();
        if (reminder && !loaded.settings.reminderToast)
          dismissReminder();
        if (reminder && reminder.chatId === loaded.chatId && !reminder.toggling && reminder.enabled !== loaded.chatEnabled) {
          reminder.enabled = loaded.chatEnabled;
          paintReminder(reminder);
        }
        maybeShowReminder();
      } while (flight.queued);
    })().finally(() => {
      if (refreshFlight === flight)
        refreshFlight = undefined;
    });
    return flight.promise;
  }
  async function safely(action) {
    if (destroyed)
      return;
    if (syncSelection()) {
      refresh();
      return;
    }
    if (busy)
      return;
    const version = selectionVersion;
    busy = true;
    try {
      syncActionControls();
      syncHud();
      render();
      await action();
    } catch (error) {
      if (isCurrentSelection(version))
        setNotice(error instanceof Error ? error.message : String(error), true);
    } finally {
      if (isCurrentSelection(version)) {
        busy = false;
        render();
        syncActionControls();
        syncHud();
      }
    }
  }
  async function toggleChatEnabled() {
    if (!view)
      throw new Error("Open a chat first.");
    const chatId = requireCurrentChatId();
    await rpc("set-chat-enabled", { chatId, enabled: !view.chatEnabled });
    await load();
  }
  async function forceTransition() {
    const result = await rpc("force", { chatId: requireCurrentChatId() });
    const transition = isRecord(result) ? safeTransitionText(result.transition) : "";
    if (transition)
      setNotice(transition);
    await load();
  }
  async function undoTransition() {
    const result = await rpc("undo", { chatId: requireCurrentChatId() });
    const transition = isRecord(result) ? safeTransitionText(result.transition) : "";
    if (transition)
      setNotice(transition);
    await load();
  }
  function openPickerSafely(kind) {
    const version = selectionVersion;
    openGreetingPicker(kind).catch((error) => {
      if (!isCurrentSelection(version))
        return;
      setNotice(error instanceof Error ? error.message : String(error), true);
      render();
      syncActionControls();
    });
  }
  async function openGreetingPicker(kind) {
    if (!isCurrentSelection(selectionVersion))
      return;
    if (pickerOpen || busy || !view)
      return;
    const version = selectionVersion;
    const currentView = view;
    const options = greetingPickerOptions(kind, currentView);
    if (!options.length) {
      setNotice(kind === "current" ? "There are no greetings available for this chat." : "There is no later greeting available for this chat.", true);
      render();
      return;
    }
    const preferred = kind === "current" ? currentView.active : currentView.upcoming;
    let selected = options.find((greeting) => preferred && selectionValue(greeting) === selectionValue(preferred)) ?? options[0];
    const openedChatId = currentChatId();
    if (!openedChatId) {
      setNotice("Open a chat before choosing a greeting.", true);
      render();
      return;
    }
    let modal;
    try {
      modal = ctx.ui.showModal({
        title: kind === "current" ? "Choose Current Greeting" : "Choose Next Greeting",
        width: 1040,
        maxHeight: 1000,
        persistent: false
      });
    } catch (error) {
      throw new Error("Could not open the greeting picker: " + (error instanceof Error ? error.message : String(error)));
    }
    pickerModal = modal;
    pickerOpen = true;
    const picker = element("div", "wp-picker");
    const main = element("div", "wp-picker-main");
    const groupLabel = currentView.isGroupChat ? "Group chat: " + String(currentView.characters.length) + " characters" : "Character: " + (currentView.characters[0]?.name || "(unnamed)");
    main.append(element("div", "wp-picker-meta", groupLabel));
    const field = element("div", "wp-picker-field");
    const selectLabel = element("label", "wp-picker-label", kind === "current" ? "Current greeting" : "Next greeting");
    const select = element("select", "wp-picker-select");
    select.id = "wp-picker-select-" + kind;
    selectLabel.htmlFor = select.id;
    for (const greeting of options) {
      const option = element("option", "", greetingLabel(greeting));
      option.value = selectionValue(greeting);
      option.selected = selectionValue(greeting) === selectionValue(selected);
      select.append(option);
    }
    field.append(selectLabel, select);
    main.append(field);
    const selectedLabel = element("div", "wp-picker-meta");
    const hint = element("div", "wp-picker-meta", kind === "current" ? "The selected greeting becomes current. The next greeting is recalculated only when needed." : "The current greeting remains unchanged.");
    const preview = element("div", "wp-picker-preview");
    const previewText = element("pre", "", "");
    preview.append(previewText);
    const error = element("div", "wp-picker-error");
    error.hidden = true;
    main.append(selectedLabel, hint, preview, error);
    const footer = element("div", "wp-picker-footer");
    const cancel = element("button", "wp-button", "Cancel");
    cancel.type = "button";
    const confirm = element("button", "wp-button primary", kind === "current" ? "Use current greeting" : "Use next greeting");
    confirm.type = "button";
    footer.append(cancel, confirm);
    picker.append(main, footer);
    modal.root.replaceChildren(picker);
    const updateSelection = (greeting) => {
      selected = greeting;
      selectedLabel.textContent = "Selected: " + greetingLabel(greeting);
      previewText.textContent = greeting.text || "(empty)";
    };
    updateSelection(selected);
    select.onchange = () => {
      const next = options.find((greeting) => selectionValue(greeting) === select.value);
      if (next)
        updateSelection(next);
    };
    return new Promise((resolve) => {
      let settled = false;
      let committing = false;
      let unsubscribeDismiss;
      const finish = (dismiss = true) => {
        if (settled)
          return;
        settled = true;
        unsubscribeDismiss?.();
        if (pickerModal === modal)
          pickerModal = undefined;
        pickerOpen = false;
        if (dismiss)
          modal.dismiss();
        resolve();
      };
      const showError = (message) => {
        error.hidden = false;
        error.textContent = message;
        confirm.disabled = false;
        cancel.disabled = false;
        select.disabled = false;
      };
      const commit = async () => {
        const chosen = selected;
        if (settled || !isCurrentSelection(version) || !chosen || committing || busy)
          return;
        committing = true;
        busy = true;
        confirm.disabled = true;
        cancel.disabled = true;
        select.disabled = true;
        syncActionControls();
        try {
          if (currentChatId() !== openedChatId)
            throw new Error("The active chat changed; choose the greeting again.");
          await rpc(kind === "current" ? "set-active" : "set-upcoming", {
            chatId: openedChatId,
            selection: { characterId: chosen.characterId, greetingIndex: chosen.greetingIndex }
          });
          await load();
          setNotice(kind === "current" ? "Current greeting updated." : "Next greeting updated.");
          render();
          finish();
        } catch (errorValue) {
          if (isCurrentSelection(version))
            showError(errorValue instanceof Error ? errorValue.message : String(errorValue));
        } finally {
          committing = false;
          if (isCurrentSelection(version)) {
            busy = false;
            render();
            syncActionControls();
            syncHud();
          }
        }
      };
      unsubscribeDismiss = modal.onDismiss(() => finish(false));
      cancel.onclick = () => finish();
      confirm.onclick = () => {
        commit();
      };
    });
  }
  async function openActionBarMenu() {
    if (!isCurrentSelection(selectionVersion))
      return;
    if (!actionBarButton || busy || !view)
      return;
    const version = selectionVersion;
    const rect = actionBarButton.getBoundingClientRect();
    let result;
    try {
      result = await ctx.ui.showContextMenu({
        position: { x: rect.left, y: rect.bottom + 4 },
        items: [
          {
            key: "toggle",
            label: view.chatEnabled ? "Disable Waypoints for this chat" : "Enable Waypoints for this chat",
            active: view.chatEnabled,
            disabled: !view.chatId
          },
          { key: "choose-current", label: "Choose current greeting", disabled: greetingPickerOptions("current", view).length === 0 },
          { key: "choose-next", label: "Choose next greeting", disabled: greetingPickerOptions("next", view).length === 0 },
          { key: "force", label: "Force next greeting", disabled: !view.upcoming || busy },
          { key: "undo", label: "Undo last insertion", disabled: !view.canUndo || busy },
          {
            key: "story-overview",
            label: view.storyline.overviewEnabled ? "Turn narrative overview off for this chat" : "Turn narrative overview on for this chat",
            active: view.storyline.overviewEnabled,
            disabled: !view.chatId || !view.storyline.characters.some((entry) => entry.overview.trim())
          },
          { key: "divider", label: "", type: "divider" },
          { key: "open-storyline", label: "Open storyline designer" },
          { key: "open", label: "Open Waypoints drawer" }
        ]
      });
    } catch (error) {
      if (!isCurrentSelection(version))
        return;
      setNotice(error instanceof Error ? error.message : String(error), true);
      render();
      return;
    }
    if (!isCurrentSelection(version))
      return;
    if (result.selectedKey === "toggle")
      safely(toggleChatEnabled);
    else if (result.selectedKey === "choose-current")
      openPickerSafely("current");
    else if (result.selectedKey === "choose-next")
      openPickerSafely("next");
    else if (result.selectedKey === "force")
      safely(forceTransition);
    else if (result.selectedKey === "undo")
      safely(undoTransition);
    else if (result.selectedKey === "story-overview") {
      const enabled = !view.storyline.overviewEnabled;
      safely(() => setStoryToggle("set-story-overview", enabled));
    } else if (result.selectedKey === "open-storyline") {
      page = "storyline";
      render();
      tab.activate();
    } else if (result.selectedKey === "open")
      tab.activate();
  }
  function syncActionControls() {
    const settings = view?.settings;
    const actionBarVisible = settings?.actionBarButton === true;
    if (actionBarMount)
      actionBarMount.hidden = !actionBarVisible;
    if (actionBarButton) {
      actionBarButton.hidden = !actionBarVisible;
      actionBarButton.disabled = busy || !view;
      actionBarButton.title = view?.chatId ? "Waypoints controls — " + (view.chatEnabled ? "ON" : "OFF") : "Waypoints controls";
      const tinted = settings?.actionBarStatusColor === true && Boolean(view?.chatId);
      actionBarButton.classList.toggle("wp-status-on", tinted && view?.chatEnabled === true);
      actionBarButton.classList.toggle("wp-status-off", tinted && view?.chatEnabled !== true);
      actionBarButton.setAttribute("aria-label", actionBarButton.title);
    }
    const extrasVisible = settings?.extrasActions === true && !busy && Boolean(view?.chatId);
    for (const action of extrasActions)
      action.setEnabled(extrasVisible);
    if (extrasActions.length < 5)
      return;
    extrasActions[0].setLabel(view?.chatEnabled ? "Disable Waypoints for this chat" : "Enable Waypoints for this chat");
    extrasActions[0].setSubtitle("Changes only this chat");
    extrasActions[1].setLabel("Choose current greeting");
    extrasActions[1].setSubtitle("Select the greeting Waypoints treats as current");
    extrasActions[2].setLabel("Choose next greeting");
    extrasActions[2].setSubtitle("Select the upcoming greeting Waypoints will use");
    extrasActions[3].setLabel("Undo last Waypoints insertion");
    extrasActions[3].setSubtitle(view?.canUndo ? "Remove the latest Waypoints greeting" : "No Waypoints insertion available");
    extrasActions[4].setLabel("Force next Waypoints greeting");
    extrasActions[4].setSubtitle(view?.upcoming ? "Insert the selected upcoming greeting" : "Choose an upcoming greeting first");
  }
  function registerExtrasActions() {
    const registered = [];
    try {
      registered.push(ctx.ui.registerInputBarAction({
        id: "toggle-waypoints",
        label: "Toggle Waypoints",
        subtitle: "Enable or disable Waypoints for this chat",
        iconSvg: WAYPOINTS_COMPASS_ICON,
        enabled: false
      }));
      registered.push(ctx.ui.registerInputBarAction({
        id: "choose-current-waypoints",
        label: "Choose current greeting",
        subtitle: "Select the greeting Waypoints treats as current",
        iconSvg: WAYPOINTS_COMPASS_ICON,
        enabled: false
      }));
      registered.push(ctx.ui.registerInputBarAction({
        id: "choose-next-waypoints",
        label: "Choose next greeting",
        subtitle: "Select the upcoming greeting Waypoints will use",
        iconSvg: WAYPOINTS_COMPASS_ICON,
        enabled: false
      }));
      registered.push(ctx.ui.registerInputBarAction({
        id: "undo-waypoints",
        label: "Undo last Waypoints insertion",
        subtitle: "Remove the latest Waypoints greeting",
        iconSvg: WAYPOINTS_COMPASS_ICON,
        enabled: false
      }));
      registered.push(ctx.ui.registerInputBarAction({
        id: "force-waypoints",
        label: "Force next Waypoints greeting",
        subtitle: "Insert the selected upcoming greeting",
        iconSvg: WAYPOINTS_COMPASS_ICON,
        enabled: false
      }));
      extrasActions = registered;
      disposers.push(registered[0].onClick(() => {
        safely(toggleChatEnabled);
      }), registered[1].onClick(() => openPickerSafely("current")), registered[2].onClick(() => openPickerSafely("next")), registered[3].onClick(() => {
        safely(undoTransition);
      }), registered[4].onClick(() => {
        safely(forceTransition);
      }));
    } catch (error) {
      for (const action of registered)
        action.destroy();
      console.warn("[Waypoints] Extras actions unavailable", error);
    }
  }
  if (actionBarButton)
    actionBarButton.onclick = () => {
      openActionBarMenu();
    };
  registerExtrasActions();
  function button(label, action, className = "", disabled = false) {
    const node = element("button", "wp-button" + (className ? " " + className : ""), label);
    node.type = "button";
    node.disabled = disabled || busy;
    const version = selectionVersion;
    node.onclick = () => {
      if (isCurrentSelection(version))
        action();
    };
    return node;
  }
  function renderNotice(parent) {
    if (!notice)
      return;
    parent.append(element("div", "wp-notice" + (noticeError ? " error" : ""), notice));
  }
  function renderTabs(parent) {
    const tabs = element("div", "wp-tabs");
    tabs.setAttribute("role", "tablist");
    for (const descriptor of [
      ["waypoints", "Waypoints"],
      ["storyline", "Storyline"],
      ["prompts", "Prompts"],
      ["settings", "Settings"]
    ]) {
      const targetPage = descriptor[0];
      const node = element("button", "wp-tab", descriptor[1]);
      node.type = "button";
      node.setAttribute("role", "tab");
      node.setAttribute("aria-selected", String(page === targetPage));
      node.onclick = () => {
        page = targetPage;
        render();
      };
      tabs.append(node);
    }
    parent.append(tabs);
  }
  function renderPicker(parent, label, selectedGreeting, allowClear, changed) {
    const currentView = view;
    if (!currentView)
      return;
    const version = selectionVersion;
    addField(parent, label, currentView.isGroupChat ? "All group members' greetings are available here." : "", (target) => ctx.components.mountSelect(target, {
      value: selectionValue(selectedGreeting),
      clearable: allowClear,
      clearLabel: "No upcoming greeting",
      placeholder: "Choose a greeting",
      options: currentView.greetings.map((greeting) => ({
        value: selectionValue(greeting),
        label: greetingLabel(greeting),
        group: greeting.characterName
      })),
      onChange: (value) => {
        if (!isCurrentSelection(version))
          return;
        const selection = parseSelection(value);
        if (!selection && !allowClear)
          return;
        safely(async () => {
          const chatId = currentChatId();
          if (!chatId)
            throw new Error("Open a chat first.");
          await changed(selection);
          await load();
        });
      }
    }));
  }
  function renderDashboard(parent) {
    if (!view) {
      parent.append(element("div", "wp-card", "Loading Waypoints…"));
      return;
    }
    if (view.missingPermissions.length) {
      parent.append(element("div", "wp-alert", "Automatic handoffs are unavailable until these permissions are granted: " + view.missingPermissions.join(", ") + "."));
    }
    const status = element("section", "wp-card");
    const heading = element("div", "wp-row between");
    const headingText = element("div");
    headingText.append(element("div", "wp-kicker", view.isGroupChat ? "Group chat" : "Character chat"));
    headingText.append(element("h3", "", "Status"));
    heading.append(headingText);
    heading.append(button("Refresh", refresh));
    status.append(heading, element("p", "wp-muted", view.status));
    const storyPosition = view.storyline.prompt.position;
    const routed = Object.keys(view.routes).length > 0;
    if (view.chatId && storyPosition && storyPosition.total > 0 && (routed || view.storyline.prompt.ready)) {
      const storyLine = element("p", "wp-muted");
      storyLine.append((routed ? "Following the storyline route. " : "") + (describePosition(storyPosition) || "") + (view.storyline.prompt.ready ? " Narrative overview is on." : ""));
      status.append(storyLine);
    }
    if (view.chatId) {
      const chatRow = element("div", "wp-character");
      chatRow.append(element("div", "wp-character-name", "Use Waypoints in this chat"));
      const chatTarget = element("div", "wp-native");
      chatRow.append(chatTarget);
      status.append(chatRow);
      componentHandles.push(ctx.components.mountSwitch(chatTarget, {
        checked: view.chatEnabled,
        ariaLabel: "Use Waypoints in this chat",
        onChange: (checked) => {
          if (checked === view?.chatEnabled)
            return;
          safely(async () => {
            await rpc("set-chat-enabled", { chatId: requireCurrentChatId(), enabled: checked });
            await load();
          });
        }
      }));
    }
    parent.append(status);
    const selections = element("section", "wp-section");
    selections.append(element("h3", "", "Greeting path"));
    const grid = element("div", "wp-grid");
    selections.append(grid);
    renderPicker(grid, "Active greeting", view.active, false, async (selection) => {
      await rpc("set-active", { chatId: currentChatId(), selection });
    });
    renderPicker(grid, "Upcoming greeting", view.upcoming, true, async (selection) => {
      await rpc("set-upcoming", { chatId: currentChatId(), selection });
    });
    const previews = element("div", "wp-grid");
    const activePreview = element("div", "wp-field");
    activePreview.append(element("label", "wp-label", "Active preview"));
    activePreview.append(element("pre", "wp-preview", view.active ? compactPreview(view.active.text) : "No active greeting."));
    const upcomingPreview = element("div", "wp-field");
    upcomingPreview.append(element("label", "wp-label", "Upcoming preview"));
    upcomingPreview.append(element("pre", "wp-preview", view.upcoming ? compactPreview(view.upcoming.text) : "No upcoming greeting."));
    previews.append(activePreview, upcomingPreview);
    selections.append(previews);
    const actions = element("div", "wp-actions");
    actions.append(button("Force", () => safely(forceTransition), "primary", !view.upcoming), button("Undo", () => safely(undoTransition), "", !view.canUndo));
    selections.append(actions);
    parent.append(selections);
    const enabled = element("section", "wp-section");
    const cardSwitch = view.settings.characterCardSwitch;
    enabled.append(element("h3", "", view.isGroupChat ? "Group member switches" : "Character switch"));
    if (view.isGroupChat) {
      enabled.append(element("p", "wp-help", "Each group member has a per-chat override. New members default to ON."));
    } else if (cardSwitch) {
      enabled.append(element("p", "wp-alert", "This character's Waypoints switch is stored on the character card. Changing it writes Waypoints data to the card."));
    } else {
      enabled.append(element("p", "wp-help", "The per-character switch is off, so Waypoints never writes to character cards and ignores any switch saved on them. Turn it on in Settings to use it."));
    }
    for (const character of view.characters) {
      const version = selectionVersion;
      const row = element("div", "wp-character");
      const names = element("div");
      names.append(element("div", "wp-character-name", character.name || "Unnamed character"));
      const showSwitch = view.isGroupChat || cardSwitch;
      if (showSwitch)
        names.append(element("div", "wp-help", character.enabled ? "ON" : "OFF"));
      const controls = element("div", "wp-row");
      row.append(names, controls);
      enabled.append(row);
      const clear = button("Clear Waypoints data from character card", () => safely(async () => {
        await rpc("clear-character-data", { chatId: requireCurrentChatId(), characterId: character.id });
        setNotice("Cleared Waypoints data from " + (character.name || "the character") + "'s card.");
        await load();
      }), "", !character.cardData);
      clear.title = character.cardData ? "Remove everything Waypoints stored on this character card" : "This card has no Waypoints data";
      controls.append(clear);
      if (!showSwitch)
        continue;
      const mount = element("div", "wp-native");
      controls.append(mount);
      componentHandles.push(ctx.components.mountSwitch(mount, {
        checked: character.enabled,
        ariaLabel: "Enable Waypoints for " + character.name,
        onChange: (checked) => {
          if (!isCurrentSelection(version))
            return;
          if (checked === character.enabled)
            return;
          safely(async () => {
            await rpc("set-enabled", {
              chatId: currentChatId(),
              characterId: character.id,
              enabled: checked
            });
            await load();
          });
        }
      }));
    }
    parent.append(enabled);
    const prompt = element("section", "wp-section");
    prompt.append(element("h3", "", "Rendered prompt status"));
    const promptText = view.prompt.ready ? view.prompt.autoPrompt ? "Auto-prompt is ON." : "Auto-prompt is OFF; add {{waypoints_content}} to a Loom preset to inject it." : view.prompt.reason ?? "No prompt is available.";
    prompt.append(element("p", "wp-muted", promptText + " Role: " + view.prompt.role + ". Depth: " + String(view.prompt.insertionDepth) + "."));
    if (view.prompt.content) {
      prompt.append(element("div", "wp-prompt-count", promptCounter.display(view.prompt.content)));
      const details = element("details", "wp-diagnostics");
      details.append(element("summary", "", "Show rendered prompt"));
      details.append(element("pre", "wp-preview", view.prompt.content));
      prompt.append(details);
    }
    parent.append(prompt);
    const diagnostics = element("section", "wp-section");
    diagnostics.append(element("h3", "", "Diagnostics"));
    const diagActions = element("div", "wp-actions");
    diagActions.append(button("Copy diagnostics", () => safely(async () => {
      const text = view?.diagnostics.join(`
`) ?? "";
      if (!navigator.clipboard?.writeText)
        throw new Error("Clipboard access is unavailable in this Lumiverse window.");
      await navigator.clipboard.writeText(text);
      setNotice("Diagnostics copied.");
    })), button("Clear diagnostics", () => safely(async () => {
      await rpc("clear-diagnostics", { chatId: currentChatId() });
      await load();
      setNotice("Diagnostics cleared.");
    })));
    diagnostics.append(diagActions);
    const details = element("details", "wp-diagnostics");
    details.append(element("summary", "", "Show " + String(view.diagnostics.length) + " recent lines"));
    details.append(element("pre", "wp-preview", view.diagnostics.join(`
`) || "No diagnostic lines yet."));
    diagnostics.append(details);
    parent.append(diagnostics);
    if (view.settings.floatingControls && !canShowHud(true, view.grantedPermissions)) {
      parent.append(element("div", "wp-alert", "Floating controls are enabled in Settings, but ui_panels permission is not granted. The drawer still works."));
    }
  }
  function syncStoryDrafts() {
    if (!view)
      return;
    for (const saved of view.storyline.characters) {
      storyDrafts.set(saved.characterId, reconcileStorylineDraft(storyDrafts.get(saved.characterId), saved, view.greetings));
    }
    const ids = view.storyline.characters.map((entry) => entry.characterId);
    if (!storyCharacterId || !ids.includes(storyCharacterId)) {
      storyCharacterId = view.storyline.prompt.characterId && ids.includes(view.storyline.prompt.characterId) ? view.storyline.prompt.characterId : ids[0] ?? null;
    }
  }
  function storySaved() {
    return view?.storyline.characters.find((entry) => entry.characterId === storyCharacterId) ?? null;
  }
  function storyDraft() {
    const saved = storySaved();
    if (!saved || !view)
      return null;
    let draft = storyDrafts.get(saved.characterId);
    if (!draft) {
      draft = storylineDraftFromSaved(saved, view.greetings);
      storyDrafts.set(saved.characterId, draft);
    }
    return draft;
  }
  function isStoryGenerating(saved) {
    return Boolean(saved && (generatingCharacterId === saved.characterId || saved.generating));
  }
  async function saveStoryline() {
    const saved = storySaved();
    const draft = storyDraft();
    if (!saved || !draft || !view)
      throw new Error("Open a chat first.");
    const route = storylineDraftRoute(draft, view.greetings);
    if (!storylineDraftStops(draft).length)
      throw new Error("Include at least one greeting in the storyline.");
    await rpc("save-storyline", {
      chatId: requireCurrentChatId(),
      characterId: saved.characterId,
      storyline: {
        route,
        notes: draft.notes,
        includePersona: draft.includePersona,
        includeCharacter: draft.includeCharacter,
        overview: draft.overview
      }
    });
    storyDrafts.delete(saved.characterId);
    await load();
    setNotice("Storyline saved for every chat with this character.");
  }
  async function deleteStoryline() {
    const saved = storySaved();
    if (!saved)
      throw new Error("Open a chat first.");
    await rpc("delete-storyline", { chatId: requireCurrentChatId(), characterId: saved.characterId });
    storyDrafts.delete(saved.characterId);
    await load();
    setNotice("Storyline deleted. Waypoints follows card order again.");
  }
  async function setStoryToggle(action, enabled) {
    await rpc(action, { chatId: requireCurrentChatId(), enabled });
    await load();
  }
  async function generateStoryline() {
    const saved = storySaved();
    const draft = storyDraft();
    if (!saved || !draft || !view || busy || isStoryGenerating(saved))
      return;
    if (!storylineDraftStops(draft).length) {
      setNotice("Include at least one greeting in the storyline.", true);
      render();
      return;
    }
    const version = selectionVersion;
    const characterId = saved.characterId;
    if (!await flushGeneratorSave())
      return;
    if (!isCurrentSelection(version) || busy || isStoryGenerating(saved))
      return;
    generatingCharacterId = characterId;
    setNotice("");
    render();
    try {
      const chatId = requireCurrentChatId();
      await rpc("generate-storyline", {
        chatId,
        characterId,
        storyline: {
          route: storylineDraftRoute(draft, view.greetings),
          notes: draft.notes,
          includePersona: draft.includePersona,
          includeCharacter: draft.includeCharacter
        }
      }, GENERATION_TIMEOUT_MS);
      if (!isCurrentSelection(version))
        return;
      storyDrafts.delete(characterId);
      if (generatingCharacterId === characterId)
        generatingCharacterId = null;
      await load();
      setNotice("Narrative overview generated and saved.");
    } catch (error) {
      if (isCurrentSelection(version))
        setNotice(error instanceof Error ? error.message : String(error), true);
    } finally {
      if (generatingCharacterId === characterId)
        generatingCharacterId = null;
      if (isCurrentSelection(version)) {
        render();
        syncHud();
      }
    }
  }
  function cancelStoryline(characterId) {
    rpc("cancel-storyline", { characterId }).catch(() => {
      return;
    });
  }
  function renderStoryRoute(parent, draft, generating) {
    if (!view)
      return;
    const currentView = view;
    const stops = storylineDraftStops(draft);
    const route = element("section", "wp-section");
    const heading = element("div", "wp-row between");
    heading.append(element("h3", "", "Route"));
    heading.append(element("span", "wp-kicker", String(stops.length) + " of " + String(draft.order.length) + " greetings"));
    route.append(heading);
    route.append(element("p", "wp-help", "Tick the greetings this storyline visits and arrange them in story order. Unticked greetings are skipped when Waypoints picks the next greeting."));
    const list = element("ol", "wp-story-list");
    const greetingsByIndex = new Map(currentView.greetings.filter((greeting) => greeting.characterId === draft.characterId).map((greeting) => [greeting.greetingIndex, greeting]));
    const update = (next) => {
      storyDrafts.set(draft.characterId, next);
      render();
    };
    draft.order.forEach((index, position) => {
      const greeting = greetingsByIndex.get(index);
      if (!greeting)
        return;
      const included = !draft.excluded.includes(index);
      const row = element("li", "wp-story-row" + (included ? "" : " excluded"));
      const toggle = element("input", "wp-story-check");
      toggle.type = "checkbox";
      toggle.checked = included;
      toggle.disabled = busy || generating;
      toggle.setAttribute("aria-label", "Include greeting " + String(index + 1) + " in the storyline");
      toggle.onchange = () => update(toggleStorylineStop(draft, index, toggle.checked));
      const step = element("span", "wp-story-step", included ? String(stops.indexOf(index) + 1) : "–");
      const body = element("div", "wp-story-body");
      const title = element("div", "wp-story-title");
      title.append(element("span", "wp-character-name", "Greeting " + String(index + 1)));
      if (currentView.active?.characterId === draft.characterId && currentView.active.greetingIndex === index) {
        title.append(element("span", "wp-badge", "Current"));
      }
      if (currentView.upcoming?.characterId === draft.characterId && currentView.upcoming.greetingIndex === index) {
        title.append(element("span", "wp-badge next", "Next"));
      }
      body.append(title);
      body.append(element("div", "wp-story-snippet", greeting.text.replace(/\s+/g, " ").slice(0, 140)));
      const previewKey = draft.characterId + ":" + String(index);
      const details = element("details", "wp-story-preview");
      details.open = openStoryPreviews.has(previewKey);
      details.ontoggle = () => {
        if (details.open)
          openStoryPreviews.add(previewKey);
        else
          openStoryPreviews.delete(previewKey);
      };
      details.append(element("summary", "", "Preview"), element("pre", "wp-preview", compactPreview(greeting.text, 2400)));
      body.append(details);
      const moves = element("div", "wp-story-moves");
      const up = element("button", "wp-button wp-icon-button", "↑");
      up.type = "button";
      up.title = "Move earlier";
      up.setAttribute("aria-label", "Move greeting " + String(index + 1) + " earlier");
      up.disabled = busy || generating || position === 0;
      up.onclick = () => update(moveStorylineStop(draft, index, -1));
      const down = element("button", "wp-button wp-icon-button", "↓");
      down.type = "button";
      down.title = "Move later";
      down.setAttribute("aria-label", "Move greeting " + String(index + 1) + " later");
      down.disabled = busy || generating || position === draft.order.length - 1;
      down.onclick = () => update(moveStorylineStop(draft, index, 1));
      moves.append(up, down);
      row.append(toggle, step, body, moves);
      list.append(row);
    });
    route.append(list);
    const actions = element("div", "wp-actions");
    actions.append(button("Include all", () => update({ ...draft, excluded: [] }), "", generating || !draft.excluded.length), button("Reset to card order", () => update(resetStorylineOrder(draft, currentView.greetings)), "", generating));
    route.append(actions);
    parent.append(route);
  }
  function renderStoryChat(parent, saved) {
    if (!view)
      return;
    const section = element("section", "wp-section");
    section.append(element("h3", "", "This chat"));
    section.append(element("p", "wp-help", "The storyline is shared by every chat with this character. These switches change only the open chat."));
    const switches = [
      ["Follow the storyline route", "Waypoints picks the next greeting from the route instead of card order.", view.storyline.routeEnabled, "set-story-route"],
      ["Add the narrative overview to prompts", saved.overview.trim() ? "Gives the model the whole journey, not just the next greeting." : "Generate or write an overview below first.", view.storyline.overviewEnabled, "set-story-overview"]
    ];
    for (const [label, help, checked, action] of switches) {
      const row = element("div", "wp-character");
      const names = element("div");
      names.append(element("div", "wp-character-name", label), element("div", "wp-help", help));
      const mount = element("div", "wp-native");
      row.append(names, mount);
      section.append(row);
      const version = selectionVersion;
      componentHandles.push(ctx.components.mountSwitch(mount, {
        checked,
        ariaLabel: label,
        onChange: (value) => {
          if (!isCurrentSelection(version))
            return;
          safely(() => setStoryToggle(action, value));
        }
      }));
    }
    const prompt = view.storyline.prompt;
    if (prompt.characterId === saved.characterId) {
      const position = describePosition(prompt.position);
      if (position)
        section.append(element("p", "wp-muted", position));
    }
    parent.append(section);
  }
  function renderStoryOverview(parent, saved, draft, generating) {
    if (!view)
      return;
    const currentView = view;
    const section = element("section", "wp-section");
    section.append(element("h3", "", "Narrative overview"));
    section.append(element("p", "wp-help", "A meta prompt that describes the whole journey, so the model can foreshadow and keep continuity instead of only seeing the next greeting. Generate it from the route, then edit it freely."));
    const dirtyLabel = element("div", "wp-validation");
    const saveButton = button("Save storyline", () => safely(saveStoryline), "primary", generating);
    const discardButton = button("Discard changes", () => {
      storyDrafts.set(saved.characterId, storylineDraftFromSaved(saved, currentView.greetings));
      render();
    }, "", generating);
    const updateDirty = () => {
      const dirty = storylineDraftDirty(draft, saved, currentView.greetings);
      dirtyLabel.className = "wp-validation " + (dirty ? "bad" : "good");
      dirtyLabel.textContent = dirty ? "Unsaved changes." : saved.updatedAt === null ? "Nothing saved yet for this character." : "Saved.";
      saveButton.disabled = busy || generating || !dirty;
      discardButton.disabled = busy || generating || !dirty;
    };
    addField(section, "Author guidance", "Optional notes for the generator, such as genre, themes, or how the arc should feel.", (target) => ctx.components.mountTextArea(target, {
      value: draft.notes,
      rows: 3,
      disabled: generating,
      placeholder: "Slow-burn romance; keep the mystery of the lighthouse unresolved until the end.",
      ariaLabel: "Author guidance",
      onChange: (value) => {
        draft.notes = value;
        updateDirty();
      }
    }));
    const contextOptions = [
      ["includeCharacter", "Include character description, personality, and scenario", "Gives the generator the character card's details."],
      ["includePersona", "Include the current user persona", "Gives the generator your persona's description. Your name is always used either way."]
    ];
    for (const [key, label, hint] of contextOptions) {
      const target = element("div", "wp-native");
      section.append(target);
      componentHandles.push(ctx.components.mountCheckbox(target, {
        checked: draft[key],
        label,
        hint,
        disabled: generating,
        onChange: (checked) => {
          draft[key] = checked;
          updateDirty();
        }
      }));
    }
    renderStoryGenerator(section, generating);
    const generateRow = element("div", "wp-actions");
    if (generating) {
      generateRow.append(element("span", "wp-generating", "Generating the narrative overview…"));
      const cancel = element("button", "wp-button danger", "Cancel");
      cancel.type = "button";
      cancel.onclick = () => cancelStoryline(saved.characterId);
      generateRow.append(cancel);
    } else {
      const canGenerate = currentView.grantedPermissions.includes("generation");
      generateRow.append(button(saved.overview.trim() ? "Regenerate overview" : "Generate overview", () => generateStoryline(), "primary", !canGenerate || !storylineDraftStops(draft).length));
      if (!canGenerate)
        generateRow.append(element("span", "wp-help", "Needs the generation permission."));
    }
    section.append(generateRow);
    const routeChanged = !sameRoute(storylineDraftRoute(draft, currentView.greetings), saved.route);
    if (saved.overview.trim() && (saved.stale || routeChanged)) {
      section.append(element("div", "wp-alert", routeChanged ? "The route has changed since this overview was written. Regenerate it so the journey matches." : "The route's greetings have changed on the character card since this overview was generated. Regenerate it to match."));
    }
    if (saved.generatedAt) {
      section.append(element("p", "wp-help", "Last generated " + new Date(saved.generatedAt).toLocaleString() + "."));
    }
    addField(section, "Overview", "Saved per character. Edits here are used as-is.", (target) => ctx.components.mountTextArea(target, {
      value: draft.overview,
      rows: 14,
      disabled: generating,
      placeholder: "Generate an overview, or write your own description of the journey.",
      ariaLabel: "Narrative overview",
      onChange: (value) => {
        draft.overview = value;
        updateDirty();
      }
    }));
    const prompt = currentView.storyline.prompt;
    if (prompt.characterId === saved.characterId) {
      section.append(element("p", "wp-muted", prompt.ready ? currentView.settings.autoPrompt ? "Auto-prompt is ON: the overview is added to every generation in this chat." : "Auto-prompt is OFF; add {{waypoints_storyline}} to a Loom preset to inject it." : prompt.reason ?? "The overview is not active."));
      if (prompt.content) {
        section.append(element("div", "wp-prompt-count", storylineCounter.display(prompt.content)));
        const details = element("details", "wp-diagnostics");
        details.append(element("summary", "", "Show rendered overview prompt"), element("pre", "wp-preview", prompt.content));
        section.append(details);
      }
    } else if (saved.overview.trim()) {
      section.append(element("p", "wp-muted", "In this group chat, the overview in prompts belongs to the character whose greeting is current."));
    }
    const footer = element("div", "wp-actions");
    footer.append(saveButton, discardButton);
    if (saved.updatedAt !== null) {
      footer.append(button("Delete storyline", () => safely(deleteStoryline), "danger", generating));
    }
    section.append(dirtyLabel, footer);
    updateDirty();
    parent.append(section);
  }
  function renderStoryline(parent) {
    if (!view) {
      parent.append(element("div", "wp-card", "Loading Waypoints…"));
      return;
    }
    const saved = storySaved();
    const draft = storyDraft();
    if (!view.chatId || !saved || !draft) {
      parent.append(element("div", "wp-card", view.chatId ? "This chat has no characters with greetings." : view.status));
      return;
    }
    const generating = isStoryGenerating(saved);
    const intro = element("section", "wp-card");
    intro.append(element("div", "wp-kicker", "Storyline designer"));
    const name = view.characters.find((character) => character.id === saved.characterId)?.name || "Unnamed character";
    intro.append(element("h3", "", name + "'s storyline"));
    intro.append(element("p", "wp-muted", "Choose which greetings the story visits and in what order, then generate a narrative overview of the whole journey. Saved per character for every chat with them."));
    if (view.isGroupChat && view.storyline.characters.length > 1) {
      const version = selectionVersion;
      addField(intro, "Character", "Each group member has their own storyline.", (target) => ctx.components.mountSelect(target, {
        value: saved.characterId,
        options: view.storyline.characters.map((entry) => ({
          value: entry.characterId,
          label: view.characters.find((character) => character.id === entry.characterId)?.name || "Unnamed character"
        })),
        onChange: (value) => {
          if (!isCurrentSelection(version))
            return;
          storyCharacterId = value;
          render();
        }
      }));
    }
    parent.append(intro);
    renderStoryRoute(parent, draft, generating);
    renderStoryChat(parent, saved);
    renderStoryOverview(parent, saved, draft, generating);
  }
  function generatorChoice() {
    return generatorPending ?? {
      connectionId: view?.settings.storylineConnectionId ?? "",
      model: view?.settings.storylineModel ?? ""
    };
  }
  function queueGeneratorSave(next, delay) {
    generatorPending = next;
    clearTimeout(generatorSaveTimer);
    generatorSaveTimer = setTimeout(() => void flushGeneratorSave(), delay);
  }
  function flushGeneratorSave() {
    clearTimeout(generatorSaveTimer);
    generatorSaveTimer = undefined;
    const next = generatorPending;
    if (!next)
      return generatorSaving;
    generatorSaving = generatorSaving.then(async () => {
      try {
        const result = safeRecord(await rpc("set-storyline-generator", { ...next }));
        const saved = isRecord(result.settings) ? result.settings : null;
        const connectionId = saved ? saved.storylineConnectionId : next.connectionId.trim();
        const model = saved ? saved.storylineModel : next.model.trim();
        if (view)
          view.settings = { ...view.settings, storylineConnectionId: connectionId, storylineModel: model };
        draft.storylineConnectionId = connectionId;
        draft.storylineModel = model;
        return true;
      } catch (error) {
        setNotice(error instanceof Error ? error.message : String(error), true);
        render();
        return false;
      } finally {
        if (generatorPending === next)
          generatorPending = null;
      }
    });
    return generatorSaving;
  }
  function renderStoryGenerator(parent, generating) {
    if (!connections)
      loadConnections();
    const choice = generatorChoice();
    const grid = element("div", "wp-grid");
    parent.append(grid);
    const connectionOptions = [{ value: "", label: "Default connection" }, ...(connections ?? []).map((connection) => ({
      value: connection.id,
      label: connection.name + (connection.model ? " — " + connection.model : "") + (connection.isDefault ? " (default)" : "")
    }))];
    if (choice.connectionId && !connectionOptions.some((option) => option.value === choice.connectionId)) {
      connectionOptions.push({ value: choice.connectionId, label: connections ? "Unavailable connection" : "Loading connections…" });
    }
    addField(grid, "Generator connection", "Any Lumiverse connection profile. Use a cheaper or stronger model for overviews than for chat.", (target) => ctx.components.mountSelect(target, {
      value: choice.connectionId,
      options: connectionOptions,
      disabled: generating,
      onChange: (value) => {
        queueGeneratorSave({ ...generatorChoice(), connectionId: value }, 0);
        syncModelField();
      }
    }));
    const effectiveConnection = () => {
      const current = generatorChoice();
      return current.connectionId ? connections?.find((entry) => entry.id === current.connectionId) : connections?.find((entry) => entry.isDefault);
    };
    const connectionRef = () => {
      const id = generatorChoice().connectionId || effectiveConnection()?.id;
      return id ? { kind: "llm", id } : { kind: "llm" };
    };
    const modelHint = element("p");
    let combobox;
    const syncModelField = () => {
      const model = effectiveConnection()?.model;
      modelHint.textContent = "Leave blank to use the connection's own model" + (model ? " (" + model + ")." : ".");
      combobox?.update({ connection: connectionRef() });
    };
    const onModelChange = (value) => queueGeneratorSave({ ...generatorChoice(), model: value }, GENERATOR_SAVE_DELAY_MS);
    addField(grid, "Model override", modelHint, (target) => {
      if (typeof ctx.components.mountModelCombobox !== "function") {
        return ctx.components.mountTextInput(target, {
          value: choice.model,
          placeholder: "Use connection default",
          disabled: generating,
          ariaLabel: "Generator model override",
          onChange: onModelChange
        });
      }
      combobox = ctx.components.mountModelCombobox(target, {
        value: choice.model,
        connection: connectionRef(),
        placeholder: "Use connection default",
        appearance: "standard",
        disabled: generating,
        onChange: onModelChange
      });
      return combobox;
    });
    syncModelField();
  }
  async function loadConnections() {
    if (connections || connectionsLoading)
      return;
    connectionsLoading = true;
    const version = selectionVersion;
    try {
      connections = asConnections(await rpc("list-connections"));
    } catch {
      connections = [];
    } finally {
      connectionsLoading = false;
      if (isCurrentSelection(version) && page === "storyline")
        render();
    }
  }
  function safeTransitionText(value) {
    if (!isRecord(value) || typeof value.reason !== "string")
      return "";
    return value.reason;
  }
  function draftSection(parent, title) {
    const section = element("section", "wp-section");
    section.append(element("h3", "", title));
    section.append(element("p", "wp-help", "Edits on the Prompts and Settings tabs share one draft until you select Save changes. Invalid drafts never change live behavior."));
    const validation = element("div", "wp-validation");
    updateDraftValidation(validation);
    section.append(validation);
    parent.append(section);
    return { section, validation };
  }
  function renderDraftActions(section, resetLabel, keys, resetNotice) {
    const actions = element("div", "wp-actions");
    actions.append(button("Save changes", () => safely(async () => {
      const validationResult = draftValidation(draft);
      if (!validationResult.valid)
        throw new Error(validationResult.messages.join(" "));
      const result = safeRecord(await rpc("save-settings", { settings: draft }));
      const saved = isRecord(result.settings) ? result.settings : null;
      if (saved) {
        draft = cloneSettingsDraft(saved);
        draftInitialized = true;
        const warnings = Array.isArray(result.warnings) ? result.warnings.filter((item) => typeof item === "string") : [];
        setNotice(warnings.length ? "Settings saved. " + warnings.join(" ") : "Settings saved.");
      }
      await load();
    }), "primary"), button("Discard draft", () => {
      if (view)
        draft = cloneSettingsDraft(view.settings);
      render();
    }), button(resetLabel, () => {
      draft = resetDraftFields(draft, keys);
      setNotice(resetNotice);
      render();
    }, "danger"));
    section.append(actions);
  }
  function renderPrompts(parent) {
    const { section, validation } = draftSection(parent, "Prompts");
    section.append(element("h4", "", "Scene prompt"));
    addField(section, "Scene-shaping template", "Required placeholders: {{scene_excerpt}} and {{handoff_tag}}. {{override_tag}} is optional but recommended.", (target) => ctx.components.mountTextArea(target, {
      value: draft.promptTemplate,
      rows: 16,
      ariaLabel: "Scene-shaping template",
      onChange: (value) => {
        draft.promptTemplate = value;
        updateDraftValidation(validation);
      }
    }));
    const promptGrid = element("div", "wp-grid");
    section.append(promptGrid);
    addField(promptGrid, "Prewritten-scene limit", "Characters retained after exclusion filtering.", (target) => ctx.components.mountNumericInput(target, {
      value: draft.prewrittenSceneCharLimit,
      integer: true,
      min: 1,
      max: 1e5,
      onChange: (value) => {
        if (value !== null)
          draft.prewrittenSceneCharLimit = value;
        updateDraftValidation(validation);
      }
    }));
    addField(promptGrid, "Exclusion regex", "Accepts /pattern/flags. The LumiScript-style x flag removes spaces and # comments outside character classes.", (target) => ctx.components.mountTextInput(target, {
      value: draft.promptExcludeRegex,
      placeholder: "/private block/gi",
      onChange: (value) => {
        draft.promptExcludeRegex = value;
        updateDraftValidation(validation);
      }
    }));
    addField(promptGrid, "Prompt insertion depth", "0 is the newest edge of the assembled prompt.", (target) => ctx.components.mountNumericInput(target, {
      value: draft.insertionDepth,
      integer: true,
      min: 0,
      max: 9999,
      onChange: (value) => {
        if (value !== null)
          draft.insertionDepth = value;
        updateDraftValidation(validation);
      }
    }));
    addField(promptGrid, "Prompt role", "Use system unless your connection requires another role.", (target) => ctx.components.mountSelect(target, {
      value: draft.promptRole,
      options: [
        { value: "system", label: "system" },
        { value: "user", label: "user" },
        { value: "assistant", label: "assistant" }
      ],
      onChange: (value) => {
        if (value === "system" || value === "user" || value === "assistant")
          draft.promptRole = value;
        updateDraftValidation(validation);
      }
    }));
    const autoTarget = element("div", "wp-native");
    section.append(autoTarget);
    componentHandles.push(ctx.components.mountCheckbox(autoTarget, {
      checked: draft.autoPrompt,
      label: "Automatically insert the rendered prompt before generation",
      hint: "Off by default. Keep it off when a Loom preset injects {{waypoints_content}}, so the prompt is not added twice.",
      onChange: (checked) => {
        draft.autoPrompt = checked;
        updateDraftValidation(validation);
      }
    }));
    const loomHelp = element("div", "wp-loom-help");
    loomHelp.append(element("div", "wp-label", "Loom preset macros"));
    loomHelp.append(element("p", "wp-help", "Use these extension macros in a Loom block. They are not local variables, so do not add a leading dot."));
    loomHelp.append(element("pre", "wp-preview", `{{if::{{waypoints_active}}}}
{{waypoints_content}}
{{/if}}`));
    loomHelp.append(element("p", "wp-help", "If you are using a preset with a COT, you can use this alternate version to add a small snippet into a variable, then use that variable in the COT."));
    loomHelp.append(element("pre", "wp-preview", `{{if::{{waypoints_active}}}}
{{waypoints_content}}
{{setvar::shape_scene_direction::Shape Scene Direction: Ensure strict adherence to the <shape_scene_direction> instructions by slowly shaping the narrative towards the doorstep of the next prewritten scene. Decide if allowing the narrative to progress naturally OR if shaping the narrative towards the upcoming scene. Then, list the decision result, justification, and if shaping, what items of influence are being included.}}
{{else}}
{{deletevar::shape_scene_direction}}
{{/if}}`));
    loomHelp.append(element("p", "wp-help", "Then simply call the variable using {{getvar::shape_scene_direction}} where ever it would be relevant in your COT prompt. The variable will clear itself out when waypoints is not active, so always leave the prompt enabled in your preset."));
    loomHelp.append(element("p", "wp-help", "Pre-run council tools can also use {{altMessage1}}, {{altMessage2}}, and so on for this character's alternate greetings. {{altMessages}} returns them as a JSON array; the standard {{firstMessage}} is separate. Higher altMessage indices are unregistered when switching to a character with fewer alternate greetings. {{nextMessages}} returns the choices offered by Waypoints' next-greeting picker (only later greetings in solo chats). {{currentMessage}} and {{nextMessage}} return the selected current and upcoming greetings."));
    loomHelp.append(element("p", "wp-help", "The narrative overview has its own pair: {{if::{{waypoints_storyline_active}}}}{{waypoints_storyline}}{{/if}}. It is active when the open chat has the overview switched on in the Storyline tab. To write your own wrapper, use {{waypoints_storyline_overview}} (raw overview text), {{waypoints_storyline_position}} (story progress sentence), and {{waypoints_current_waypoint}}, {{waypoints_next_waypoint}}, and {{waypoints_waypoint_count}} (scene numbers along the storyline)."));
    section.append(loomHelp);
    section.append(element("div", "wp-divider"));
    section.append(element("h4", "", "Storyline prompts"));
    addField(section, "Overview prompt template", "Wraps a character's narrative overview when it is added to prompts. Required: {{storyline_overview}}. Optional: {{storyline_position}} and {{character_name}}.", (target) => ctx.components.mountTextArea(target, {
      value: draft.storylineTemplate,
      rows: 9,
      ariaLabel: "Overview prompt template",
      onChange: (value) => {
        draft.storylineTemplate = value;
        updateDraftValidation(validation);
      }
    }));
    addField(section, "Overview generator instructions", "Sent to the model by Generate overview. Required: {{waypoints}}. Optional: {{story_context}} (character and persona details chosen in the Storyline tab), {{character_name}}, {{user_name}}, {{character_description}}, {{character_personality}}, {{character_scenario}}, {{user_persona}}, {{author_notes}}, and {{waypoint_count}}. Lumiverse macros such as {{user}} and {{char}} are expanded before sending.", (target) => ctx.components.mountTextArea(target, {
      value: draft.storylineGeneratorTemplate,
      rows: 12,
      ariaLabel: "Overview generator instructions",
      onChange: (value) => {
        draft.storylineGeneratorTemplate = value;
        updateDraftValidation(validation);
      }
    }));
    const storyGrid = element("div", "wp-grid");
    section.append(storyGrid);
    addField(storyGrid, "Overview insertion depth", "Uses the prompt role above. At the same depth as the scene prompt, the overview comes first.", (target) => ctx.components.mountNumericInput(target, {
      value: draft.storylineInsertionDepth,
      integer: true,
      min: 0,
      max: 9999,
      onChange: (value) => {
        if (value !== null)
          draft.storylineInsertionDepth = value;
        updateDraftValidation(validation);
      }
    }));
    addField(storyGrid, "Generator limit per greeting", "Characters of each greeting sent to the generator, after exclusion filtering.", (target) => ctx.components.mountNumericInput(target, {
      value: draft.storylineWaypointCharLimit,
      integer: true,
      min: 100,
      max: 1e5,
      onChange: (value) => {
        if (value !== null)
          draft.storylineWaypointCharLimit = value;
        updateDraftValidation(validation);
      }
    }));
    section.append(element("p", "wp-help", "The generator's connection and model are chosen in the Storyline tab, next to Generate overview."));
    renderDraftActions(section, "Reset prompts to defaults", PROMPT_SETTING_KEYS, "Prompt defaults restored in the draft. Select Save changes to apply them.");
  }
  function addCheckbox(parent, validation, label, hint, checked, changed) {
    const target = element("div", "wp-native");
    parent.append(target);
    componentHandles.push(ctx.components.mountCheckbox(target, {
      checked,
      label,
      hint,
      onChange: (value) => {
        changed(value);
        updateDraftValidation(validation);
      }
    }));
  }
  function childOptions(parent, visible) {
    const group = element("div", "wp-suboptions");
    group.hidden = !visible;
    parent.append(group);
    return group;
  }
  function addSecondsField(parent, validation, label, help, field, min, max) {
    addField(parent, label, help, (target) => ctx.components.mountNumericInput(target, {
      value: draft[field],
      min,
      max,
      step: 0.5,
      ariaLabel: label,
      onChange: (value) => {
        if (value !== null)
          draft[field] = value;
        updateDraftValidation(validation);
      }
    }));
  }
  function renderSettings(parent) {
    const { section, validation } = draftSection(parent, "Settings");
    section.append(element("h4", "", "New chats"));
    addField(section, "Starting state", "Applies only the first time a chat is opened. Chats you have opened before keep their own on or off state.", (target) => ctx.components.mountSelect(target, {
      value: draft.newChatsEnabled ? "on" : "off",
      options: [
        { value: "on", label: "Waypoints ON for new chats" },
        { value: "off", label: "Waypoints OFF for new chats" }
      ],
      onChange: (value) => {
        if (value === "on" || value === "off")
          draft.newChatsEnabled = value === "on";
        updateDraftValidation(validation);
      }
    }));
    section.append(element("div", "wp-divider"));
    section.append(element("h4", "", "Interface"));
    addCheckbox(section, validation, "Show floating ON / Undo / Force controls", "Enabled by default. Lumiverse owns its drag position and reset behavior.", draft.floatingControls, (checked) => {
      draft.floatingControls = checked;
    });
    let reminderOptions = null;
    addCheckbox(section, validation, "Show a reminder when a chat opens", "A thin floating bar that says whether Waypoints is enabled or disabled for the chat. Requires ui_panels permission.", draft.reminderToast, (checked) => {
      draft.reminderToast = checked;
      if (reminderOptions)
        reminderOptions.hidden = !checked;
    });
    reminderOptions = childOptions(section, draft.reminderToast);
    addField(reminderOptions, "Show the reminder on", "Chats without an alternate greeting never show it.", (target) => ctx.components.mountSelect(target, {
      value: draft.reminderShowOn,
      options: [
        { value: "enabled", label: "Chats where Waypoints is enabled" },
        { value: "disabled", label: "Chats where Waypoints is disabled" },
        { value: "all", label: "All chats" }
      ],
      onChange: (value) => {
        if (value === "enabled" || value === "disabled" || value === "all")
          draft.reminderShowOn = value;
        updateDraftValidation(validation);
      }
    }));
    addCheckbox(reminderOptions, validation, "Click the reminder to turn Waypoints on or off", 'Adds a "click here to DISABLE" (or ENABLE) line to the reminder.', draft.reminderClickToggle, (checked) => {
      draft.reminderClickToggle = checked;
    });
    addCheckbox(reminderOptions, validation, 'Offer "Never remind me for this chat"', "Hides the reminder for a chat when it times out with the box ticked. Turning this off shows the reminder in every chat again once saved.", draft.reminderNeverAgain, (checked) => {
      draft.reminderNeverAgain = checked;
    });
    addSecondsField(reminderOptions, validation, "Duration (seconds)", "How long the reminder stays before it goes away.", "reminderDurationSeconds", 0.5, 300);
    let fadeField = null;
    addCheckbox(reminderOptions, validation, "Fade out?", "Fade the reminder away instead of closing it at once.", draft.reminderFadeOut, (checked) => {
      draft.reminderFadeOut = checked;
      if (fadeField)
        fadeField.hidden = !checked;
    });
    fadeField = childOptions(reminderOptions, draft.reminderFadeOut);
    addSecondsField(fadeField, validation, "Fade-out duration (seconds)", "How long the reminder takes to fade away.", "reminderFadeSeconds", 0, 60);
    let delayField = null;
    addCheckbox(reminderOptions, validation, "Delay?", "Wait before showing the reminder after a chat opens.", draft.reminderDelay, (checked) => {
      draft.reminderDelay = checked;
      if (delayField)
        delayField.hidden = !checked;
    });
    delayField = childOptions(reminderOptions, draft.reminderDelay);
    addSecondsField(delayField, validation, "Delay (seconds)", "How long to wait before the reminder appears.", "reminderDelaySeconds", 0, 60);
    let actionBarOptions = null;
    addCheckbox(section, validation, "Show the compass button in the chat action bar", "Adds a compact Waypoints menu beside the buttons above the input box.", draft.actionBarButton, (checked) => {
      draft.actionBarButton = checked;
      if (actionBarOptions)
        actionBarOptions.hidden = !checked;
    });
    actionBarOptions = childOptions(section, draft.actionBarButton);
    addCheckbox(actionBarOptions, validation, "Color the button by chat state", "Green when Waypoints is enabled for the open chat, red when it is disabled.", draft.actionBarStatusColor, (checked) => {
      draft.actionBarStatusColor = checked;
    });
    addCheckbox(section, validation, "Per-character switch on the character card", "Off by default. Warning: when on, turning a character's switch on or off writes Waypoints data into that character card. When off, Waypoints never writes to cards and ignores switches saved on them. Each card can be cleaned with Clear Waypoints data from character card on the Waypoints tab.", draft.characterCardSwitch, (checked) => {
      draft.characterCardSwitch = checked;
    });
    addCheckbox(section, validation, "Show Waypoints actions in the Extras menu", "Adds Toggle, Choose current greeting, Choose next greeting, Undo, and Force entries under Lumiverse's native Extras popover.", draft.extrasActions, (checked) => {
      draft.extrasActions = checked;
    });
    section.append(element("div", "wp-divider"));
    section.append(element("h4", "", "Handoff"));
    const handoffGrid = element("div", "wp-grid");
    section.append(handoffGrid);
    let updateHandoffPreviews = () => {};
    addField(handoffGrid, "Handoff tag name", "Waypoints recognizes both self-closing and paired forms.", (target) => ctx.components.mountTextInput(target, {
      value: draft.handoffTagName,
      onChange: (value) => {
        draft.handoffTagName = value;
        updateDraftValidation(validation);
        updateHandoffPreviews();
      }
    }));
    addField(handoffGrid, "User override tag name", "A user can request the closest viable handoff with this marker.", (target) => ctx.components.mountTextInput(target, {
      value: draft.overrideTagName,
      onChange: (value) => {
        draft.overrideTagName = value;
        updateDraftValidation(validation);
        updateHandoffPreviews();
      }
    }));
    const previews = element("p", "wp-help");
    previews.append("Live previews: ");
    const handoffPreview = element("code", "wp-code", handoffTag(draft));
    const overridePreview = element("code", "wp-code", overrideTag(draft));
    previews.append(handoffPreview);
    previews.append(document.createTextNode(" and "));
    previews.append(overridePreview);
    section.append(previews);
    updateHandoffPreviews = () => {
      handoffPreview.textContent = handoffTag(draft);
      overridePreview.textContent = overrideTag(draft);
    };
    section.append(element("div", "wp-divider"));
    section.append(element("h4", "", "Advanced"));
    const advancedGrid = element("div", "wp-grid");
    section.append(advancedGrid);
    const numericFields = [
      ["interceptorPriority", "Interceptor priority", "Lower priorities run first.", 0, 1000],
      ["contentProcessorPriority", "Content-processor priority", "Lower priorities run first.", 0, 1000],
      ["activeChatRetryAttempts", "Active-chat retries", "Attempts while a chat switch settles.", 1, 25],
      ["activeChatRetryDelayMs", "Active-chat retry delay (ms)", "Delay between active-chat retries.", 0, 2000],
      ["handoffReadRetryAttempts", "Handoff-read retries", "Attempts while a handoff message settles.", 1, 25],
      ["handoffReadRetryDelayMs", "Handoff-read retry delay (ms)", "Delay between handoff-read retries.", 0, 2000],
      ["pendingHandoffLimit", "Pending-handoff limit", "Recent handoff observations retained in chat state.", 1, 500],
      ["recentTransitionLimit", "Recent-transition limit", "Dedupe keys retained in chat state.", 1, 500],
      ["diagnosticLineLimit", "Diagnostic line limit", "Runtime diagnostic lines retained in the drawer.", 10, 500]
    ];
    for (const descriptor of numericFields) {
      const field = descriptor[0];
      addField(advancedGrid, descriptor[1], descriptor[2], (target) => ctx.components.mountNumericInput(target, {
        value: draft[field],
        integer: true,
        min: descriptor[3],
        max: descriptor[4],
        onChange: (value) => {
          if (value !== null)
            draft[field] = value;
          updateDraftValidation(validation);
        }
      }));
    }
    const diagnosticsTarget = element("div", "wp-native");
    section.append(diagnosticsTarget);
    componentHandles.push(ctx.components.mountCheckbox(diagnosticsTarget, {
      checked: draft.diagnosticLogging,
      label: "Keep diagnostic logging",
      hint: "When off, new runtime diagnostic lines are not added.",
      onChange: (checked) => {
        draft.diagnosticLogging = checked;
        updateDraftValidation(validation);
      }
    }));
    renderDraftActions(section, "Reset settings to defaults", GENERAL_SETTING_KEYS, "Setting defaults restored in the draft. Prompts are unchanged. Select Save changes to apply them.");
  }
  function syncHud() {
    const visible = Boolean(view && canShowHud(view.settings.floatingControls, view.grantedPermissions));
    if (!visible) {
      hud?.destroy();
      hud = undefined;
      return;
    }
    if (!hud) {
      try {
        hud = ctx.ui.createFloatWidget({
          width: 245,
          height: 44,
          snapToEdge: true,
          tooltip: "Waypoints controls",
          chromeless: true
        });
      } catch {
        return;
      }
    }
    renderHud();
  }
  function renderHud() {
    if (!hud || !view)
      return;
    const root = hud.root;
    root.replaceChildren();
    root.className = "wp-hud";
    root.append(element("span", "wp-hud-label", "Waypoints"));
    root.append(button(view.chatEnabled ? "ON" : "OFF", () => safely(toggleChatEnabled), "", !view.chatId));
    root.append(button("Undo", () => safely(undoTransition), "", !view.canUndo));
    root.append(button("Force", () => safely(forceTransition), "primary", !view.upcoming));
  }
  function render() {
    if (destroyed)
      return;
    clearComponents();
    root.replaceChildren();
    const header = element("header", "wp-header");
    const intro = element("div");
    intro.append(element("h2", "", "Waypoints"));
    intro.append(element("p", "wp-muted", "Guide a chat through the next greeting without exposing its contents."));
    header.append(intro);
    header.append(button("Refresh", refresh));
    root.append(header);
    renderNotice(root);
    renderTabs(root);
    const pageRoot = element("div", "wp-page");
    pageRoot.setAttribute("role", "tabpanel");
    root.append(pageRoot);
    if (page === "waypoints")
      renderDashboard(pageRoot);
    else if (page === "storyline")
      renderStoryline(pageRoot);
    else if (page === "prompts")
      renderPrompts(pageRoot);
    else
      renderSettings(pageRoot);
  }
  disposers.push(ctx.onBackendMessage((payload) => {
    if (syncSelection())
      refresh();
    const message = safeRecord(payload);
    if (message.type === "waypoints:reply" && typeof message.requestId === "string") {
      const request = pending.get(message.requestId);
      if (!request)
        return;
      pending.delete(message.requestId);
      clearTimeout(request.timer);
      if (typeof message.error === "string" && message.error)
        request.reject(new Error(message.error));
      else
        request.resolve(message.result);
      return;
    }
    if (message.type === "waypoints:permission-denied" || typeof message.type === "string" && shouldRefreshDrawer(message.type)) {
      refresh();
    }
  }));
  disposers.push(tab.onActivate(refresh));
  disposers.push(ctx.events.on("CHAT_SWITCHED", refresh));
  disposers.push(ctx.events.on("CHAT_CHANGED", refresh));
  const selectionChanged = () => {
    if (syncSelection())
      refresh();
  };
  let subscribed = false;
  try {
    if (ctx.state) {
      disposers.push(ctx.state.subscribe("chat.active", selectionChanged));
      subscribed = true;
    }
  } catch {}
  if (!subscribed) {
    const selectionTimer = setInterval(selectionChanged, 500);
    disposers.push(() => clearInterval(selectionTimer));
  }
  render();
  syncActionControls();
  ctx.ready();
  refresh();
  return () => {
    destroyed = true;
    clearTimeout(generatorSaveTimer);
    clearComponents();
    for (const dispose of disposers)
      dispose();
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(new Error("Waypoints closed."));
    }
    pending.clear();
    dismissReminder();
    pickerModal?.dismiss();
    hud?.destroy();
    for (const action of extrasActions)
      action.destroy();
    actionBarMount?.replaceChildren();
    tab.destroy();
    removeStyle();
  };
}
export {
  setup
};
