import { compileExcludeRegex } from "./config";
import type { WaypointSettings } from "./types";

// Settings validation confines tag names to a deliberately narrow character
// set, so this remains a defensive helper rather than an input trust boundary.
function escapeRegex(value: string): string {
  return value.replace(/[.*+?^$()|[\]\\]/g, "\\$&");
}

export function normalizeHandoffContent(content: unknown): string {
  return String(content ?? "")
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "")
    .replace(/\r\n?/g, "\n");
}

export function handoffTag(settings: Pick<WaypointSettings, "handoffTagName">): string {
  return "<" + settings.handoffTagName + " />";
}

export function overrideTag(settings: Pick<WaypointSettings, "overrideTagName">): string {
  return "--" + settings.overrideTagName + "--";
}

export function handoffTagPattern(tagName: string): RegExp {
  const name = escapeRegex(tagName);
  const start = "<\\s*" + name + "(?=\\s|/|>)(?:[^>\"']|\"[^\"]*\"|'[^']*')*";
  const selfClosing = start + "/\\s*>";
  const paired = start + ">([\\s\\S]*?)<\\s*/\\s*" + name + "\\s*>";
  return new RegExp(selfClosing + "|" + paired, "gi");
}

export interface HandoffAnalysis {
  hasHandoff: boolean;
  tagCount: number;
  content: string;
}

export function stripHandoffTags(content: unknown, tagName: string): HandoffAnalysis {
  const normalized = normalizeHandoffContent(content);
  let tagCount = 0;
  const stripped = normalized.replace(handoffTagPattern(tagName), () => {
    tagCount += 1;
    return "";
  });
  return {
    hasHandoff: tagCount > 0,
    tagCount,
    content: stripped
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/[ \t]{2,}/g, " ")
      .trimEnd(),
  };
}

export function applyPromptExcludeRegex(scene: string, source: string): string {
  const regex = compileExcludeRegex(source);
  return regex ? scene.replace(regex, "") : scene;
}

function substitute(template: string, placeholder: string, value: string): string {
  return template.split(placeholder).join(value);
}

export interface RenderedPrompt {
  content: string;
  filteredScene: string;
  sceneExcerpt: string;
}

export function renderPrompt(settings: WaypointSettings, scene: string): RenderedPrompt {
  const filteredScene = applyPromptExcludeRegex(scene, settings.promptExcludeRegex);
  const sceneExcerpt = filteredScene.slice(0, settings.prewrittenSceneCharLimit);
  let content = settings.promptTemplate;
  content = substitute(content, "{{scene_excerpt}}", sceneExcerpt);
  content = substitute(content, "{{handoff_tag}}", handoffTag(settings));
  content = substitute(content, "{{override_tag}}", overrideTag(settings));
  return { content, filteredScene, sceneExcerpt };
}

/**
 * Lumiverse's depth 0 represents the newest edge of the assembled prompt.
 * Larger depths count backward from that edge without mutating the caller's
 * message array.
 */
export function insertAtDepth<T>(messages: readonly T[], value: T, depth: number): T[] {
  const insertionIndex = Math.max(0, messages.length - Math.max(0, depth));
  return [...messages.slice(0, insertionIndex), value, ...messages.slice(insertionIndex)];
}
