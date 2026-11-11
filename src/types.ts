export const EXTENSION_ID = "lumiverse_waypoints";
export const CHAT_STATE_KEY = "lumiverse_waypoints.state.v1";
export const SETTINGS_PATH = "settings.json";
export const HANDOFF_EXTRA_KEY = "lumiverse_waypoints.handoff";
export const INSERTED_GREETING_METADATA_KEY = "lumiverse_waypoints";
/** Per-character storylines live in user storage, shared by every chat with that character. */
export const STORYLINE_PATH_PREFIX = "storylines/";

export type PromptRole = "system" | "user" | "assistant";

export interface WaypointSettings {
  promptTemplate: string;
  prewrittenSceneCharLimit: number;
  promptExcludeRegex: string;
  autoPrompt: boolean;
  insertionDepth: number;
  promptRole: PromptRole;
  handoffTagName: string;
  overrideTagName: string;
  interceptorPriority: number;
  contentProcessorPriority: number;
  activeChatRetryAttempts: number;
  activeChatRetryDelayMs: number;
  handoffReadRetryAttempts: number;
  handoffReadRetryDelayMs: number;
  pendingHandoffLimit: number;
  recentTransitionLimit: number;
  diagnosticLogging: boolean;
  diagnosticLineLimit: number;
  floatingControls: boolean;
  reminderToast: boolean;
  reminderTimeoutAction: "yes" | "no";
  actionBarButton: boolean;
  extrasActions: boolean;
  /** Prompt that wraps a character's narrative overview when it is injected. */
  storylineTemplate: string;
  /** Instructions sent to the model when generating a narrative overview. */
  storylineGeneratorTemplate: string;
  storylineInsertionDepth: number;
  /** Per-waypoint character cap applied to greetings sent to the overview generator. */
  storylineWaypointCharLimit: number;
  /** Connection profile used for overview generation; empty uses the default connection. */
  storylineConnectionId: string;
}

export interface GreetingSelection {
  characterId: string;
  greetingIndex: number;
}

export interface Greeting {
  characterId: string;
  characterName: string;
  greetingIndex: number;
  text: string;
}

export interface CharacterGreetingSource {
  id: string;
  name: string;
  first_mes: string;
  alternate_greetings: string[];
  description?: string;
  personality?: string;
  scenario?: string;
  extensions?: Record<string, unknown>;
}

/** One stop on a storyline route. The hash lets a route follow a greeting that moved on the card. */
export interface StorylineRouteEntry {
  greetingIndex: number;
  hash: string;
}

/** A character's designed narrative journey, stored once per character. */
export interface CharacterStoryline {
  version: 1;
  characterId: string;
  /** Chosen greetings in story order. Empty means every greeting in card order. */
  route: StorylineRouteEntry[];
  /** Author guidance passed to the overview generator. */
  notes: string;
  /** Give the generator the chat's user persona. */
  includePersona: boolean;
  /** Give the generator the character's description, personality, and scenario. */
  includeCharacter: boolean;
  /** Narrative overview ("meta prompt") describing the whole journey. */
  overview: string;
  /** Route signature when the overview was generated; empty for a hand-written overview. */
  overviewSignature: string;
  generatedAt: number | null;
  updatedAt: number;
}

/** Greeting indices per character that a chat follows instead of card order. */
export type GreetingRoutes = Readonly<Record<string, readonly number[]>>;

export interface ChatGreetingSource {
  id: string;
  character_id: string;
  metadata?: Record<string, unknown>;
}

export interface GreetingContext {
  chatId: string;
  primaryCharacterId: string;
  isGroupChat: boolean;
  characterIds: string[];
  characters: CharacterGreetingSource[];
  greetings: Greeting[];
  /** Saved storylines for the chat's characters, keyed by character ID. */
  storylines?: Record<string, CharacterStoryline>;
}

export interface PendingHandoff {
  eventKey: string;
  sourceMessageId?: string;
  contentHash: string;
  tagCount: number;
  at: number;
}

export interface TransitionJournal {
  id: string;
  eventKey: string;
  handoffKey?: string;
  sourceMessageId?: string;
  target: GreetingSelection;
  previousActive: GreetingSelection | null;
  previousUpcoming: GreetingSelection | null;
  createdAt: number;
  phase: "prepared" | "appended";
  insertedMessageId?: string;
}

export interface WaypointChatState {
  version: 1;
  chatEnabled: boolean;
  active: GreetingSelection | null;
  upcoming: GreetingSelection | null;
  groupEnabledByCharacter: Record<string, boolean>;
  /** Follow the character's storyline route instead of card order. */
  storyRoute: boolean;
  /** Inject the character's narrative overview into prompts. */
  storyOverview: boolean;
  pendingHandoffs: PendingHandoff[];
  recentTransitionKeys: string[];
  journal: TransitionJournal | null;
}

export interface InsertedGreetingMetadata {
  kind: "inserted-greeting";
  version: 1;
  journalId: string;
  eventKey: string;
  handoffKey?: string;
  target: GreetingSelection;
  previousActive: GreetingSelection | null;
  previousUpcoming: GreetingSelection | null;
  sourceMessageId?: string;
  contentHash: string;
  insertedAt: number;
}

export interface HandoffExtraMetadata {
  version: 1;
  tagName: string;
  tagCount: number;
  origin: string;
  contentHash: string;
  at: number;
}

export interface PromptStatus {
  ready: boolean;
  autoPrompt: boolean;
  role: PromptRole;
  insertionDepth: number;
  content: string;
  reason?: string;
}

/** Values exposed to Loom through the Waypoints extension macros. */
export interface WaypointLoomValues {
  active: boolean;
  content: string;
  /** Alternate greetings for the chat's primary character, in card order. */
  altMessages: string[];
  /** Greetings offered by Waypoints' next-greeting picker. */
  nextMessages: string[];
  /** Currently selected Waypoints greeting. */
  currentMessage: string;
  /** Currently selected Waypoints upcoming greeting. */
  nextMessage: string;
  /** True when the narrative overview prompt is enabled and renderable for this chat. */
  storylineActive: boolean;
  /** Rendered narrative overview prompt. */
  storyline: string;
  /** Raw overview text, without the template, when the overview is active. */
  storylineOverview: string;
  /** Journey position sentence, such as "the story is at waypoint 2 of 5". */
  storylinePosition: string;
  /** 1-based route position of the current greeting; empty when it is off the route. */
  currentWaypoint: string;
  /** 1-based route position of the upcoming greeting; empty when it is off the route. */
  nextWaypoint: string;
  /** Number of stops on the route. */
  waypointCount: string;
}

export interface CharacterView {
  id: string;
  name: string;
  enabled: boolean;
}

export interface StorylinePosition {
  /** 1-based route position of the current greeting, or null when it is off the route. */
  waypoint: number | null;
  /** 1-based route position of the upcoming greeting, or null when it is off the route. */
  next: number | null;
  total: number;
  /** An upcoming greeting is selected even if it is off the route. */
  hasUpcoming: boolean;
}

export interface StorylineCharacterView {
  characterId: string;
  /** Saved custom route as current greeting indices. Empty means card order. */
  route: number[];
  /** Route used for the overview and journey position: the custom route or card order. */
  effectiveRoute: number[];
  notes: string;
  includePersona: boolean;
  includeCharacter: boolean;
  overview: string;
  generatedAt: number | null;
  /** The overview was generated for a different route or different greeting text. */
  stale: boolean;
  /** Null when this character has no saved storyline. */
  updatedAt: number | null;
  generating: boolean;
}

export interface StorylinePromptStatus {
  ready: boolean;
  content: string;
  characterId: string | null;
  position: StorylinePosition | null;
  reason?: string;
}

export interface StorylineView {
  routeEnabled: boolean;
  overviewEnabled: boolean;
  characters: StorylineCharacterView[];
  prompt: StorylinePromptStatus;
}

export interface WaypointsView {
  chatId: string | null;
  chatEnabled: boolean;
  isGroupChat: boolean;
  grantedPermissions: string[];
  characters: CharacterView[];
  greetings: Greeting[];
  active: Greeting | null;
  upcoming: Greeting | null;
  canUndo: boolean;
  missingPermissions: string[];
  status: string;
  settings: WaypointSettings;
  prompt: PromptStatus;
  /** Routes this chat follows, keyed by character ID. Empty when no route applies. */
  routes: Record<string, number[]>;
  storyline: StorylineView;
  diagnostics: string[];
}

export interface TransitionResult {
  advanced: boolean;
  reason: string;
  insertedMessageId?: string;
}

export interface SettingsValidationIssue {
  field: keyof WaypointSettings | "template";
  message: string;
}

export interface SettingsValidationResult {
  settings: WaypointSettings;
  warnings: string[];
}
