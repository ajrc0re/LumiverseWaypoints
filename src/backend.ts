import type {
  InterceptorDisposer,
  MessageContentProcessorCtxDTO,
  SpindleAPI,
} from "lumiverse-spindle-types";
import { DEFAULT_SETTINGS } from "./config";
import { hashText, WaypointEngine } from "./engine";
import type { GreetingSelection, WaypointSettings } from "./types";

declare const spindle: SpindleAPI;

const engines = new Map<string, WaypointEngine>();
let interceptorDisposer: InterceptorDisposer | undefined;
let configuredInterceptorPriority: number | undefined;
let configuredProcessorPriority: number | undefined;
let registrationQueue: Promise<void> = Promise.resolve();

function engine(userId?: string): WaypointEngine {
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

function safeRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length ? value : undefined;
}

function chatIdFrom(payload: unknown): string | undefined {
  const data = safeRecord(payload);
  return stringValue(data.chatId) || stringValue(safeRecord(data.chat).id);
}

function messageFrom(payload: unknown): Record<string, unknown> {
  return safeRecord(safeRecord(payload).message);
}

function contentFrom(payload: unknown): string {
  const data = safeRecord(payload);
  const message = messageFrom(payload);
  return typeof data.content === "string"
    ? data.content
    : typeof message.content === "string"
      ? message.content
      : "";
}

function sourceIdFrom(payload: unknown): string | undefined {
  const data = safeRecord(payload);
  const message = messageFrom(payload);
  return stringValue(data.generationId) || stringValue(data.messageId) || stringValue(message.id);
}

function messageIdFrom(payload: unknown): string | undefined {
  const data = safeRecord(payload);
  const message = messageFrom(payload);
  return stringValue(data.messageId) || stringValue(message.id);
}

function eventKey(kind: string, payload: unknown, chatId: string): string {
  const data = safeRecord(payload);
  const generationId = stringValue(data.generationId);
  if (generationId) return chatId + ":generation:" + generationId;
  const sourceId = sourceIdFrom(payload);
  if (sourceId) return chatId + ":message:" + sourceId + ":" + hashText(contentFrom(payload));
  return chatId + ":" + kind + ":" + hashText(contentFrom(payload));
}

function notifyChanged(userId: string | undefined, reason: string): void {
  spindle.sendToFrontend({ type: "waypoints:changed", reason }, userId);
}

async function registerHandlers(settings: WaypointSettings): Promise<void> {
  if (spindle.permissions.has("interceptor")) {
    if (configuredInterceptorPriority !== settings.interceptorPriority) {
      interceptorDisposer?.();
      interceptorDisposer = spindle.registerInterceptor(
        (messages, context) => engine(context.userId).intercept(messages, context.chatId),
        settings.interceptorPriority,
      );
      configuredInterceptorPriority = settings.interceptorPriority;
      spindle.log.info("[Waypoints] prompt interceptor registered at " + String(settings.interceptorPriority));
    }
  } else if (interceptorDisposer) {
    interceptorDisposer();
    interceptorDisposer = undefined;
    configuredInterceptorPriority = undefined;
  }

  if (spindle.permissions.has("chat_mutation") && configuredProcessorPriority !== settings.contentProcessorPriority) {
    spindle.registerMessageContentProcessor(
      (ctx: MessageContentProcessorCtxDTO) => engine(ctx.userId).processContent(ctx),
      settings.contentProcessorPriority,
    );
    configuredProcessorPriority = settings.contentProcessorPriority;
    spindle.log.info("[Waypoints] handoff processor registered at " + String(settings.contentProcessorPriority));
  } else if (!spindle.permissions.has("chat_mutation")) {
    configuredProcessorPriority = undefined;
  }
}

function configureHandlers(settings: WaypointSettings = DEFAULT_SETTINGS): Promise<void> {
  registrationQueue = registrationQueue.then(
    () => registerHandlers(settings),
    () => registerHandlers(settings),
  );
  return registrationQueue;
}

async function refreshConfiguration(): Promise<void> {
  const settings = await engine().settings();
  await configureHandlers(settings);
}

function parseSelection(value: unknown, required: boolean): GreetingSelection | null {
  if (value === null && !required) return null;
  const source = safeRecord(value);
  if (typeof source.characterId !== "string" || !Number.isInteger(source.greetingIndex)) {
    throw new Error("Select a valid character greeting.");
  }
  return { characterId: source.characterId, greetingIndex: Number(source.greetingIndex) };
}

async function handleRequest(raw: unknown, userId?: string): Promise<void> {
  const request = safeRecord(raw);
  if (request.type !== "waypoints:request" || typeof request.requestId !== "string" || typeof request.action !== "string") return;
  const reply = (result?: unknown, error?: string) => {
    spindle.sendToFrontend({
      type: "waypoints:reply",
      requestId: request.requestId,
      result,
      error,
    }, userId);
  };
  const input = safeRecord(request.input);
  const selectedChatId = stringValue(input.chatId);
  try {
    const current = engine(userId);
    let result: unknown;
    switch (request.action) {
      case "bootstrap":
      case "refresh":
        result = await current.view(selectedChatId);
        break;
      case "save-settings":
        result = await current.saveSettings(input.settings);
        break;
      case "reset-settings":
        result = await current.resetSettings();
        break;
      case "set-active":
        if (!selectedChatId) throw new Error("No active chat is available.");
        await current.setActive(selectedChatId, parseSelection(input.selection, true) as GreetingSelection);
        result = await current.view(selectedChatId);
        break;
      case "set-upcoming":
        if (!selectedChatId) throw new Error("No active chat is available.");
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
      case "force":
        result = {
          transition: await current.force(selectedChatId),
          view: await current.view(selectedChatId),
        };
        break;
      case "undo":
        result = {
          transition: await current.undo(selectedChatId),
          view: await current.view(selectedChatId),
        };
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

function observeHandoff(kind: string, payload: unknown, userId?: string): void {
  const chatId = chatIdFrom(payload);
  if (!chatId) return;
  const message = messageFrom(payload);
  const extra = Object.keys(safeRecord(message.extra)).length
    ? safeRecord(message.extra)
    : safeRecord(safeRecord(payload).extra);
  void engine(userId).handleHandoff({
    chatId,
    eventKey: eventKey(kind, payload, chatId),
    sourceMessageId: messageIdFrom(payload),
    content: contentFrom(payload),
    extra,
  }).then((result) => {
    if (result.advanced) notifyChanged(userId, "handoff");
  }).catch((error) => {
    spindle.log.warn("[Waypoints] handoff observer failed: " + (error instanceof Error ? error.message : String(error)));
  });
}

spindle.onFrontendMessage((payload, userId) => {
  void handleRequest(payload, userId);
});

spindle.permissions.onChanged(() => {
  void refreshConfiguration().catch((error) => {
    spindle.log.warn("[Waypoints] permission refresh failed: " + (error instanceof Error ? error.message : String(error)));
  });
  notifyChanged(undefined, "permissions");
});

spindle.permissions.onDenied((detail) => {
  spindle.log.warn("[Waypoints] " + detail.operation + " requires " + detail.permission);
  notifyChanged(undefined, "permission-denied");
});

spindle.on("GENERATION_ENDED", (payload, userId) => observeHandoff("generation-ended", payload, userId));
spindle.on("GENERATION_STOPPED", (payload, userId) => observeHandoff("generation-stopped", payload, userId));
spindle.on("MESSAGE_EDITED", (payload, userId) => observeHandoff("message-edited", payload, userId));
spindle.on("MESSAGE_SWIPED", (payload, userId) => observeHandoff("message-swiped", payload, userId));
spindle.on("SWIPE_EDITED", (payload, userId) => observeHandoff("swipe-edited", payload, userId));
spindle.on("CHARACTER_MESSAGE_RENDERED", (payload, userId) => observeHandoff("character-message-rendered", payload, userId));

for (const eventName of [
  "CHAT_SWITCHED",
  "CHAT_CHANGED",
  "CHARACTER_EDITED",
  "CHARACTER_DELETED",
  "GENERATION_STARTED",
]) {
  spindle.on(eventName, (_payload, userId) => notifyChanged(userId, eventName.toLowerCase()));
}

void refreshConfiguration().catch((error) => {
  spindle.log.warn("[Waypoints] initial registration failed: " + (error instanceof Error ? error.message : String(error)));
});
