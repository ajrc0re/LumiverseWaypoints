import { DEFAULT_SETTINGS, validateSettings } from "./config";
import type { WaypointSettings } from "./types";

export type DrawerPage = "waypoints" | "settings";

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

export function shouldRefreshDrawer(eventName: string): boolean {
  return eventName === "CHAT_SWITCHED" || eventName === "CHAT_CHANGED" || eventName === "waypoints:changed";
}
