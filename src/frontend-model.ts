import { DEFAULT_SETTINGS, validateSettings } from "./config";
import { nextGreetingChoices } from "./state";
import type { Greeting, WaypointSettings, WaypointsView } from "./types";

export type DrawerPage = "waypoints" | "settings";
export type GreetingPickerKind = "current" | "next";

export function approximatePromptTokenCount(characterCount: number): number {
  return Math.max(0, Math.ceil(Math.max(0, characterCount) / 4));
}

export function formatPromptCount(tokenCount: number, characterCount: number, approximate: boolean): string {
  return (approximate ? "~" : "") + String(Math.max(0, Math.round(tokenCount))) + " Tokens / " + String(Math.max(0, characterCount)) + " Characters";
}

export function nextDrawerPage(current: DrawerPage, direction: "previous" | "next"): DrawerPage {
  if (direction === "next") return current === "waypoints" ? "settings" : "waypoints";
  return current === "settings" ? "waypoints" : "settings";
}

export function cloneSettingsDraft(settings: WaypointSettings): WaypointSettings {
  return structuredClone(settings);
}

export function resetSettingsDraft(): WaypointSettings {
  return structuredClone(DEFAULT_SETTINGS);
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
  return nextGreetingChoices(view.greetings, view.active, view.isGroupChat);
}

export function shouldRefreshDrawer(eventName: string): boolean {
  return eventName === "CHAT_SWITCHED" || eventName === "CHAT_CHANGED" || eventName === "waypoints:changed";
}
