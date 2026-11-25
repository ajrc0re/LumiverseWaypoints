import { DEFAULT_SETTINGS, validateSettings } from "./config";
import { nextGreetingChoices } from "./state";
import { cardOrder, sameRoute } from "./storyline";
import type { Greeting, StorylineCharacterView, WaypointSettings, WaypointsView } from "./types";

export const DRAWER_PAGES = ["waypoints", "storyline", "prompts", "settings"] as const;
export type DrawerPage = typeof DRAWER_PAGES[number];
export type GreetingPickerKind = "current" | "next";

export function approximatePromptTokenCount(characterCount: number): number {
  return Math.max(0, Math.ceil(Math.max(0, characterCount) / 4));
}

export function formatPromptCount(tokenCount: number, characterCount: number, approximate: boolean): string {
  return (approximate ? "~" : "") + String(Math.max(0, Math.round(tokenCount))) + " Tokens / " + String(Math.max(0, characterCount)) + " Characters";
}

export function nextDrawerPage(current: DrawerPage, direction: "previous" | "next"): DrawerPage {
  const index = DRAWER_PAGES.indexOf(current);
  const step = direction === "next" ? 1 : DRAWER_PAGES.length - 1;
  return DRAWER_PAGES[(index + step) % DRAWER_PAGES.length];
}

export function cloneSettingsDraft(settings: WaypointSettings): WaypointSettings {
  return structuredClone(settings);
}

export function resetSettingsDraft(): WaypointSettings {
  return structuredClone(DEFAULT_SETTINGS);
}

/** Settings edited on the Prompts tab. */
export const PROMPT_SETTING_KEYS = [
  "promptTemplate",
  "prewrittenSceneCharLimit",
  "promptExcludeRegex",
  "insertionDepth",
  "promptRole",
  "autoPrompt",
  "storylineTemplate",
  "storylineGeneratorTemplate",
  "storylineInsertionDepth",
  "storylineWaypointCharLimit",
] as const satisfies readonly (keyof WaypointSettings)[];

/** Settings edited on the Storyline tab, which saves them on its own. */
const STORYLINE_TAB_SETTING_KEYS: readonly (keyof WaypointSettings)[] = ["storylineConnectionId", "storylineModel"];

/** Settings edited on the Settings tab: everything not on the Prompts or Storyline tab. */
export const GENERAL_SETTING_KEYS = (Object.keys(DEFAULT_SETTINGS) as (keyof WaypointSettings)[])
  .filter((key) => !(PROMPT_SETTING_KEYS as readonly string[]).includes(key) && !STORYLINE_TAB_SETTING_KEYS.includes(key));

/** Returns the draft with only the given fields put back to their defaults. */
export function resetDraftFields(settings: WaypointSettings, keys: readonly (keyof WaypointSettings)[]): WaypointSettings {
  const next = structuredClone(settings) as unknown as Record<string, unknown>;
  const defaults = structuredClone(DEFAULT_SETTINGS) as unknown as Record<string, unknown>;
  for (const key of keys) next[key] = defaults[key];
  return next as unknown as WaypointSettings;
}

type ReminderView = Pick<WaypointsView, "chatId" | "chatEnabled" | "greetings" | "grantedPermissions" | "settings" | "reminderHidden">;

/** Whether the chat-open reminder applies to this chat under the current settings. */
export function shouldShowReminder(view: ReminderView): boolean {
  const settings = view.settings;
  if (!view.chatId || !settings.reminderToast || !view.grantedPermissions.includes("ui_panels")) return false;
  // Without an alternate greeting Waypoints cannot run here, so there is nothing to remind about.
  if (view.greetings.length < 2) return false;
  if (settings.reminderNeverAgain && view.reminderHidden) return false;
  if (settings.reminderShowOn === "enabled") return view.chatEnabled;
  if (settings.reminderShowOn === "disabled") return !view.chatEnabled;
  return true;
}

export interface ReminderTimeline {
  /** When the reminder appears. */
  showAt: number;
  /** When it starts to fade (or disappears, without a fade). */
  hideAt: number;
  /** When it is gone. */
  goneAt: number;
}

export function reminderTimeline(
  settings: Pick<WaypointSettings, "reminderDurationSeconds" | "reminderFadeOut" | "reminderFadeSeconds" | "reminderDelay" | "reminderDelaySeconds">,
  now: number,
  withDelay = true,
): ReminderTimeline {
  const showAt = now + (withDelay && settings.reminderDelay ? settings.reminderDelaySeconds * 1000 : 0);
  const hideAt = showAt + settings.reminderDurationSeconds * 1000;
  return { showAt, hideAt, goneAt: hideAt + (settings.reminderFadeOut ? settings.reminderFadeSeconds * 1000 : 0) };
}

export type ReminderPhase =
  | { phase: "waiting" }
  | { phase: "showing"; remaining: number }
  | { phase: "fading"; opacity: number }
  | { phase: "gone" };

export function reminderPhase(timeline: ReminderTimeline, now: number): ReminderPhase {
  if (now < timeline.showAt) return { phase: "waiting" };
  if (now < timeline.hideAt) return { phase: "showing", remaining: (timeline.hideAt - now) / (timeline.hideAt - timeline.showAt) };
  if (now < timeline.goneAt) return { phase: "fading", opacity: (timeline.goneAt - now) / (timeline.goneAt - timeline.hideAt) };
  return { phase: "gone" };
}

export function draftValidation(settings: WaypointSettings): { valid: boolean; messages: string[] } {
  try {
    const result = validateSettings(settings);
    return { valid: true, messages: result.warnings };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { valid: false, messages: [message] };
  }
}

export function canShowHud(floatingControls: boolean, grantedPermissions: readonly string[]): boolean {
  return floatingControls && grantedPermissions.includes("ui_panels");
}

export function greetingPickerOptions(kind: GreetingPickerKind, view: WaypointsView): Greeting[] {
  if (kind === "current") return view.greetings;
  return nextGreetingChoices(view.greetings, view.active, view.isGroupChat, view.routes);
}

export function shouldRefreshDrawer(eventName: string): boolean {
  return eventName === "CHAT_SWITCHED" || eventName === "CHAT_CHANGED" || eventName === "waypoints:changed";
}

/**
 * An editable storyline. `order` holds every greeting of the character, with
 * the route's stops first; `excluded` lists greetings left out of the route.
 */
export interface StorylineDraft {
  characterId: string;
  order: number[];
  excluded: number[];
  notes: string;
  includePersona: boolean;
  includeCharacter: boolean;
  overview: string;
  /** Saved values this draft started from, to tell local edits from remote updates. */
  base: string;
}

type StorylineFields = Pick<StorylineCharacterView, "notes" | "includePersona" | "includeCharacter" | "overview">;

function savedKey(route: readonly number[], fields: StorylineFields): string {
  return JSON.stringify([route, fields.notes, fields.includePersona, fields.includeCharacter, fields.overview]);
}

export function storylineDraftFromSaved(saved: StorylineCharacterView, greetings: readonly Greeting[]): StorylineDraft {
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
    base: savedKey(saved.route, saved),
  };
}

/** Route stops in order. Every greeting in card order normalizes to the empty default. */
export function storylineDraftRoute(draft: StorylineDraft, greetings: readonly Greeting[]): number[] {
  const route = draft.order.filter((index) => !draft.excluded.includes(index));
  return sameRoute(route, cardOrder(greetings, draft.characterId)) ? [] : route;
}

/** The stops the route actually visits, with the default expanded to card order. */
export function storylineDraftStops(draft: StorylineDraft): number[] {
  return draft.order.filter((index) => !draft.excluded.includes(index));
}

function draftKey(draft: StorylineDraft, greetings: readonly Greeting[]): string {
  return savedKey(storylineDraftRoute(draft, greetings), draft);
}

export function storylineDraftDirty(draft: StorylineDraft, saved: StorylineCharacterView, greetings: readonly Greeting[]): boolean {
  return draftKey(draft, greetings) !== savedKey(saved.route, saved);
}

/**
 * Keeps local edits across refreshes. An untouched draft follows the saved
 * storyline; an edited one keeps its order but drops removed greetings and
 * appends new ones as excluded.
 */
export function reconcileStorylineDraft(
  draft: StorylineDraft | undefined,
  saved: StorylineCharacterView,
  greetings: readonly Greeting[],
): StorylineDraft {
  if (!draft || draftKey(draft, greetings) === draft.base) return storylineDraftFromSaved(saved, greetings);
  const own = cardOrder(greetings, saved.characterId);
  const order = draft.order.filter((index) => own.includes(index));
  const added = own.filter((index) => !order.includes(index));
  return {
    ...draft,
    order: [...order, ...added],
    excluded: [...draft.excluded.filter((index) => own.includes(index)), ...added],
  };
}

export function moveStorylineStop(draft: StorylineDraft, index: number, offset: -1 | 1): StorylineDraft {
  const position = draft.order.indexOf(index);
  const target = position + offset;
  if (position < 0 || target < 0 || target >= draft.order.length) return draft;
  const order = [...draft.order];
  [order[position], order[target]] = [order[target], order[position]];
  return { ...draft, order };
}

export function toggleStorylineStop(draft: StorylineDraft, index: number, included: boolean): StorylineDraft {
  const excluded = draft.excluded.filter((entry) => entry !== index);
  if (!included) excluded.push(index);
  return { ...draft, excluded };
}

export function resetStorylineOrder(draft: StorylineDraft, greetings: readonly Greeting[]): StorylineDraft {
  return { ...draft, order: cardOrder(greetings, draft.characterId), excluded: [] };
}
