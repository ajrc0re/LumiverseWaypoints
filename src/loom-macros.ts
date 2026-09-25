import type { MacroDefinitionDTO, SpindleAPI } from "lumiverse-spindle-types";
import type { WaypointLoomValues } from "./types";

/** Use these in Loom presets, for example {{if::{{waypoints_active}}}}. */
export const WAYPOINTS_ACTIVE_MACRO = "waypoints_active";
export const WAYPOINTS_CONTENT_MACRO = "waypoints_content";
export const WAYPOINTS_ALT_MESSAGES_MACRO = "altMessages";
export const WAYPOINTS_NEXT_MESSAGES_MACRO = "nextMessages";
export const WAYPOINTS_CURRENT_MESSAGE_MACRO = "currentMessage";
export const WAYPOINTS_NEXT_MESSAGE_MACRO = "nextMessage";

export interface WaypointMacroIdentity {
  chatId?: string;
  userId?: string;
}

export type WaypointMacroResolver = (identity: WaypointMacroIdentity) => Promise<WaypointLoomValues>;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

/**
 * The public type intentionally guarantees only `chatId`, but the worker also
 * forwards the host-owned user ID in `env.extra`. Read both defensively so a
 * private extension never serves one user's settings to another user.
 */
export function macroIdentity(context: unknown): WaypointMacroIdentity {
  const value = record(context);
  const env = record(value.env);
  const chat = record(env.chat);
  const extra = record(env.extra);
  return {
    chatId: nonEmptyString(value.chatId) ?? nonEmptyString(chat.id),
    userId: nonEmptyString(value.userId) ?? nonEmptyString(extra.userId),
  };
}

function register(
  api: SpindleAPI,
  name: string,
  description: string,
  returnType: "boolean" | "string",
  resolver: WaypointMacroResolver,
  select: (values: WaypointLoomValues) => string,
  fallback?: string,
): void {
  const definition = {
    name,
    category: "Waypoints",
    description,
    returnType,
    // The selection is chat- and setting-dependent. Never let a display or
    // prompt cache reuse it after a handoff, picker change, or character switch.
    volatile: true,
    handler: async (context: unknown) => {
      try {
        return select(await resolver(macroIdentity(context)));
      } catch {
        return fallback ?? (returnType === "boolean" ? "false" : "");
      }
    },
  };

  // The currently published declaration models handlers as serialized strings,
  // while the Spindle worker intentionally accepts a real function here.
  api.registerMacro(definition as unknown as MacroDefinitionDTO);
}

export function registerWaypointsLoomMacros(
  api: SpindleAPI,
  resolver: WaypointMacroResolver,
): (alternateGreetingCount: number) => void {
  register(
    api,
    WAYPOINTS_ACTIVE_MACRO,
    "Returns true when the selected Waypoints path is enabled and has a rendered upcoming-scene prompt.",
    "boolean",
    resolver,
    (values) => values.active ? "true" : "false",
  );
  register(
    api,
    WAYPOINTS_CONTENT_MACRO,
    "Returns the current Waypoints rendered upcoming-scene prompt for use in a Loom preset.",
    "string",
    resolver,
    (values) => values.active ? values.content : "",
  );

  register(
    api,
    WAYPOINTS_ALT_MESSAGES_MACRO,
    "Returns the active character's alternate greetings as a JSON array. The standard firstMessage greeting is not included.",
    "string",
    resolver,
    (values) => JSON.stringify(values.altMessages),
    "[]",
  );
  register(
    api,
    WAYPOINTS_NEXT_MESSAGES_MACRO,
    "Returns the greetings offered by the Waypoints next-greeting picker as a JSON array. In solo chats, only greetings after the current greeting are included.",
    "string",
    resolver,
    (values) => JSON.stringify(values.nextMessages),
    "[]",
  );
  register(
    api,
    WAYPOINTS_CURRENT_MESSAGE_MACRO,
    "Returns the currently selected Waypoints greeting.",
    "string",
    resolver,
    (values) => values.currentMessage,
  );
  register(
    api,
    WAYPOINTS_NEXT_MESSAGE_MACRO,
    "Returns the currently selected upcoming Waypoints greeting.",
    "string",
    resolver,
    (values) => values.nextMessage,
  );

  let registeredAlternateGreetingCount = 0;
  return (alternateGreetingCount) => {
    const count = Number.isFinite(alternateGreetingCount)
      ? Math.max(0, Math.floor(alternateGreetingCount))
      : 0;

    for (let index = registeredAlternateGreetingCount + 1; index <= count; index += 1) {
      register(
        api,
        `altMessage${index}`,
        `Returns alternate greeting ${index} for the active chat's character, or an empty string when it is not present.`,
        "string",
        resolver,
        (values) => values.altMessages[index - 1] ?? "",
      );
    }
    for (let index = registeredAlternateGreetingCount; index > count; index -= 1) {
      api.unregisterMacro(`altMessage${index}`);
    }
    registeredAlternateGreetingCount = count;
  };
}
