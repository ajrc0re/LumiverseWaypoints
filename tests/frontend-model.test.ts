import { describe, expect, test } from "bun:test";
import { DEFAULT_SETTINGS } from "../src/config";
import {
  canShowHud,
  cloneSettingsDraft,
  draftValidation,
  nextDrawerPage,
  resetSettingsDraft,
  shouldRefreshDrawer,
} from "../src/frontend-model";

describe("drawer model", () => {
  test("switches between Waypoints and Settings tabs", () => {
    expect(nextDrawerPage("waypoints", "next")).toBe("settings");
    expect(nextDrawerPage("settings", "previous")).toBe("waypoints");
  });

  test("keeps settings as a draft until it validates, and resets cleanly", () => {
    const draft = cloneSettingsDraft(DEFAULT_SETTINGS);
    draft.promptTemplate = "{{handoff_tag}}";
    expect(draftValidation(draft).valid).toBe(false);
    const reset = resetSettingsDraft();
    expect(reset).toEqual(DEFAULT_SETTINGS);
    expect(reset).not.toBe(DEFAULT_SETTINGS);
    expect(draftValidation(reset).valid).toBe(true);
  });

  test("refreshes drawer status on chat lifecycle changes", () => {
    expect(shouldRefreshDrawer("CHAT_SWITCHED")).toBe(true);
    expect(shouldRefreshDrawer("CHAT_CHANGED")).toBe(true);
    expect(shouldRefreshDrawer("waypoints:changed")).toBe(true);
    expect(shouldRefreshDrawer("MESSAGE_SENT")).toBe(false);
  });

  test("shows HUD only when both visibility and ui_panels permission allow it", () => {
    expect(canShowHud(true, ["ui_panels"])).toBe(true);
    expect(canShowHud(false, ["ui_panels"])).toBe(false);
    expect(canShowHud(true, ["characters"])).toBe(false);
  });
});
