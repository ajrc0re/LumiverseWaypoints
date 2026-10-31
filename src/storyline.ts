import { applyPromptExcludeRegex } from "./prompt";
import type {
  CharacterGreetingSource,
  CharacterStoryline,
  Greeting,
  StorylinePosition,
  StorylineRouteEntry,
  WaypointSettings,
} from "./types";
import { STORYLINE_PATH_PREFIX } from "./types";
import { hashText, isRecord } from "./util";

export const STORYLINE_NOTES_LIMIT = 8_000;
export const STORYLINE_OVERVIEW_LIMIT = 32_000;

/** Character IDs are host-generated, but never let one escape the storyline folder. */
export function storylinePath(characterId: string): string {
  return STORYLINE_PATH_PREFIX + encodeURIComponent(characterId) + ".json";
}

export function emptyStoryline(characterId: string): CharacterStoryline {
  return {
    version: 1,
    characterId,
    route: [],
    notes: "",
    overview: "",
    overviewSignature: "",
    generatedAt: null,
    updatedAt: 0,
  };
}

function routeEntriesFrom(value: unknown): StorylineRouteEntry[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<number>();
  return value.flatMap((entry) => {
    if (!isRecord(entry) || !Number.isInteger(entry.greetingIndex) || Number(entry.greetingIndex) < 0) return [];
    const greetingIndex = Number(entry.greetingIndex);
    if (seen.has(greetingIndex)) return [];
    seen.add(greetingIndex);
    return [{ greetingIndex, hash: typeof entry.hash === "string" ? entry.hash : "" }];
  });
}

function text(value: unknown, limit: number): string {
  return typeof value === "string" ? value.slice(0, limit) : "";
}

/** Stored data is defensive: anything malformed reads as "no storyline". */
export function parseStoryline(value: unknown, characterId: string): CharacterStoryline | null {
  if (!isRecord(value) || value.version !== 1 || value.characterId !== characterId) return null;
  return {
    version: 1,
    characterId,
    route: routeEntriesFrom(value.route),
    notes: text(value.notes, STORYLINE_NOTES_LIMIT),
    overview: text(value.overview, STORYLINE_OVERVIEW_LIMIT),
    overviewSignature: typeof value.overviewSignature === "string" ? value.overviewSignature : "",
    generatedAt: Number.isFinite(value.generatedAt) ? Number(value.generatedAt) : null,
    updatedAt: Number.isFinite(value.updatedAt) ? Number(value.updatedAt) : 0,
  };
}

export function characterGreetings(greetings: readonly Greeting[], characterId: string): Greeting[] {
  return greetings.filter((greeting) => greeting.characterId === characterId);
}

/**
 * Maps a saved route onto the card as it is now. A stop whose greeting moved
 * (an earlier greeting was removed or inserted) follows its text; a stop whose
 * text was edited in place keeps its index; a stop whose greeting is gone is dropped.
 */
export function resolveRoute(storyline: CharacterStoryline | null | undefined, greetings: readonly Greeting[]): number[] {
  if (!storyline?.route.length) return [];
  const own = characterGreetings(greetings, storyline.characterId);
  const byIndex = new Map(own.map((greeting) => [greeting.greetingIndex, greeting]));
  const hashes = new Map(own.map((greeting) => [greeting.greetingIndex, hashText(greeting.text)]));
  const claimed = new Set(storyline.route
    .filter((entry) => entry.hash && hashes.get(entry.greetingIndex) === entry.hash)
    .map((entry) => entry.greetingIndex));
  const used = new Set<number>();
  const resolved: number[] = [];
  for (const entry of storyline.route) {
    let index: number | undefined = entry.greetingIndex;
    if (!entry.hash || hashes.get(index) !== entry.hash) {
      const moved = own.find((greeting) =>
        !used.has(greeting.greetingIndex)
        && !claimed.has(greeting.greetingIndex)
        && hashes.get(greeting.greetingIndex) === entry.hash);
      if (moved) index = moved.greetingIndex;
      else if (!byIndex.has(index)) index = undefined;
    }
    if (index === undefined || used.has(index)) continue;
    used.add(index);
    resolved.push(index);
  }
  return resolved;
}

/** Card order: every greeting the character has, first message first. */
export function cardOrder(greetings: readonly Greeting[], characterId: string): number[] {
  return characterGreetings(greetings, characterId).map((greeting) => greeting.greetingIndex);
}

export function effectiveRoute(
  storyline: CharacterStoryline | null | undefined,
  greetings: readonly Greeting[],
  characterId: string,
): number[] {
  const custom = resolveRoute(storyline, greetings);
  return custom.length ? custom : cardOrder(greetings, characterId);
}

export function sameRoute(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function routeEntries(indices: readonly number[], greetings: readonly Greeting[], characterId: string): StorylineRouteEntry[] {
  const own = new Map(characterGreetings(greetings, characterId).map((greeting) => [greeting.greetingIndex, greeting]));
  return indices.flatMap((greetingIndex) => {
    const greeting = own.get(greetingIndex);
    return greeting ? [{ greetingIndex, hash: hashText(greeting.text) }] : [];
  });
}

/** Changes when the route order or any routed greeting's text changes. */
export function routeSignature(indices: readonly number[], greetings: readonly Greeting[], characterId: string): string {
  const own = new Map(characterGreetings(greetings, characterId).map((greeting) => [greeting.greetingIndex, greeting]));
  return hashText(indices.map((index) => String(index) + "\u0001" + (own.get(index)?.text ?? "")).join("\u0000"));
}

export function isOverviewStale(storyline: CharacterStoryline | null | undefined, greetings: readonly Greeting[]): boolean {
  if (!storyline?.overview.trim() || !storyline.overviewSignature) return false;
  const route = effectiveRoute(storyline, greetings, storyline.characterId);
  return routeSignature(route, greetings, storyline.characterId) !== storyline.overviewSignature;
}

export function storylinePosition(
  route: readonly number[],
  activeIndex: number | null | undefined,
  upcomingIndex: number | null | undefined,
): StorylinePosition {
  const at = (index: number | null | undefined) => {
    if (index === null || index === undefined) return null;
    const position = route.indexOf(index);
    return position >= 0 ? position + 1 : null;
  };
  return {
    waypoint: at(activeIndex),
    next: at(upcomingIndex),
    total: route.length,
    hasUpcoming: upcomingIndex !== null && upcomingIndex !== undefined,
  };
}

function sceneSpan(from: number, to: number, single: string, plural: string): string {
  if (from > to) return "";
  return from === to
    ? "Prewritten scene " + String(from) + " " + single
    : "Prewritten scenes " + String(from) + (to === from + 1 ? " and " : " to ") + String(to) + " " + plural;
}

/**
 * A self-contained progress statement, so a prompt reused for hundreds of
 * turns always tells the model where in the storyline the story is now. This
 * text reaches the roleplay model, so it speaks only of prewritten scenes and
 * story beats, never of greetings or the character card.
 */
export function describePosition(position: StorylinePosition | null): string {
  if (!position || position.total === 0) return "";
  const { waypoint, next, total, hasUpcoming } = position;
  const of = (value: number) => String(value) + " of " + String(total);
  const parts: string[] = [];
  if (waypoint !== null) {
    parts.push("Story progress: the story is currently in prewritten scene " + of(waypoint) + ".");
    const past = sceneSpan(1, waypoint - 1, "has already happened.", "have already happened.");
    if (past) parts.push(past);
  } else {
    parts.push("Story progress: the story is currently between planned prewritten scenes.");
  }
  if (next !== null) {
    parts.push("The next prewritten scene is " + of(next) + "; steer toward it gradually.");
    const ahead = sceneSpan(next + 1, total, "is an upcoming story beat after that.", "are upcoming story beats after that.");
    if (ahead) parts.push(ahead);
  } else if (hasUpcoming) {
    parts.push("Another prewritten scene comes next; steer toward it gradually.");
  } else if (waypoint !== null && waypoint === total) {
    parts.push("This is the final prewritten scene. Continue the story freely while keeping continuity with the overview.");
  } else {
    parts.push("No further prewritten scene is planned.");
  }
  return parts.join(" ");
}

function substitute(template: string, values: Record<string, string>): string {
  // One pass, so a value that happens to contain a placeholder is never expanded again.
  return template.replace(/\{\{([a-z_]+)\}\}/g, (match, name: string) => values[name] ?? match);
}

export function renderStorylinePrompt(
  settings: Pick<WaypointSettings, "storylineTemplate">,
  overview: string,
  position: StorylinePosition | null,
  characterName: string,
): string {
  return substitute(settings.storylineTemplate, {
    storyline_overview: overview.trim(),
    storyline_position: describePosition(position),
    character_name: characterName,
  }).replace(/\n{3,}/g, "\n\n").trim();
}

export interface GeneratorInput {
  character: Pick<CharacterGreetingSource, "name" | "description" | "personality" | "scenario">;
  route: readonly Greeting[];
  notes: string;
}

function clip(value: string, limit: number): string {
  return value.length > limit ? value.slice(0, limit).trimEnd() + "\n[…truncated]" : value;
}

export function renderGeneratorPrompt(
  settings: Pick<WaypointSettings, "storylineGeneratorTemplate" | "storylineWaypointCharLimit" | "promptExcludeRegex">,
  input: GeneratorInput,
): string {
  const total = input.route.length;
  const waypoints = input.route.map((greeting, position) => {
    const filtered = applyPromptExcludeRegex(greeting.text, settings.promptExcludeRegex).trim();
    return "### Prewritten scene " + String(position + 1) + " of " + String(total) + "\n"
      + clip(filtered || greeting.text, settings.storylineWaypointCharLimit);
  }).join("\n\n");
  const notes = input.notes.trim();
  return substitute(settings.storylineGeneratorTemplate, {
    character_name: input.character.name || "the character",
    character_description: (input.character.description ?? "").trim() || "(none)",
    character_personality: (input.character.personality ?? "").trim() || "(none)",
    character_scenario: (input.character.scenario ?? "").trim() || "(none)",
    author_notes: notes || "(none)",
    waypoint_count: String(total),
    waypoints,
  }).trim();
}

/** Generation results arrive as a response DTO, but be tolerant of plain strings. */
export function generatedText(result: unknown): string {
  const raw = typeof result === "string"
    ? result
    : isRecord(result) && typeof result.content === "string"
      ? result.content
      : isRecord(result) && isRecord(result.response) && typeof result.response.content === "string"
        ? result.response.content
        : "";
  return raw
    .replace(/<(think|thinking|reasoning)>[\s\S]*?<\/\1>/gi, "")
    .replace(/\r\n?/g, "\n")
    .trim()
    .slice(0, STORYLINE_OVERVIEW_LIMIT);
}
