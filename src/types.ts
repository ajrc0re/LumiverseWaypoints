export const EXTENSION_ID = "lumiverse_waypoints";
export const CHAT_STATE_KEY = "lumiverse_waypoints.state.v1";
export const SETTINGS_PATH = "settings.json";
export const HANDOFF_EXTRA_KEY = "lumiverse_waypoints.handoff";
export const INSERTED_GREETING_METADATA_KEY = "lumiverse_waypoints";

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
  extensions?: Record<string, unknown>;
}

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
  active: GreetingSelection | null;
  upcoming: GreetingSelection | null;
  groupEnabledByCharacter: Record<string, boolean>;
  pendingHandoffs: PendingHandoff[];
  recentTransitionKeys: string[];
  journal: TransitionJournal | null;
}

export interface InsertedGreetingMetadata {
  kind: "inserted-greeting";
  version: 1;
  journalId: string;
  eventKey: string;
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

export interface CharacterView {
  id: string;
  name: string;
  enabled: boolean;
}

export interface WaypointsView {
  chatId: string | null;
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
