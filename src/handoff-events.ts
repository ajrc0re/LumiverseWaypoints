import { hashText, type HandoffSignal } from "./engine";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.length ? value : undefined;
}

/** Only new or changed assistant content can request a transition. Rendering is read-only. */
export function handoffSignal(event: string, payload: unknown): HandoffSignal | null {
  const data = record(payload);
  const message = record(data.message);
  const terminal = event === "GENERATION_ENDED" || event === "GENERATION_STOPPED";
  if (!terminal && event !== "MESSAGE_EDITED" && event !== "MESSAGE_SWIPED" && event !== "SWIPE_EDITED") return null;
  if (terminal && (data.error || data.impersonateDraft || data.generationType === "impersonate")) return null;
  if (message.is_user === true || message.role === "user" || message.role === "system") return null;
  if (event === "MESSAGE_SWIPED" && (data.action === "navigated" || data.action === "deleted")) return null;
  if (event === "MESSAGE_SWIPED" && typeof data.swipeId === "number" && data.swipeId !== message.swipe_id) return null;
  const chatId = text(data.chatId) ?? text(record(data.chat).id);
  const sourceMessageId = text(data.messageId) ?? text(message.id);
  const content = typeof data.content === "string" ? data.content : typeof message.content === "string" ? message.content : "";
  if (!chatId || (!sourceMessageId && !content)) return null;
  const generationId = text(data.generationId);
  const eventKey = generationId ? chatId + ":generation:" + generationId
    : chatId + ":message:" + sourceMessageId + ":" + hashText(content);
  return { chatId, eventKey, sourceMessageId, content, extra: record(message.extra ?? data.extra) };
}
