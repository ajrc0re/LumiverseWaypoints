import type {
  SpindleFloatWidgetHandle,
  SpindleFrontendContext,
  SpindleInputBarActionHandle,
  SpindleModalHandle,
  SpindleModelComboboxHandle,
} from "lumiverse-spindle-types";
import { DEFAULT_SETTINGS } from "./config";
import {
  canShowHud,
  cloneSettingsDraft,
  draftValidation,
  approximatePromptTokenCount,
  formatPromptCount,
  GENERAL_SETTING_KEYS,
  PROMPT_SETTING_KEYS,
  greetingPickerOptions,
  moveStorylineStop,
  reconcileStorylineDraft,
  reminderPhase,
  reminderTimeline,
  resetDraftFields,
  resetStorylineOrder,
  shouldRefreshDrawer,
  shouldShowReminder,
  storylineDraftDirty,
  storylineDraftFromSaved,
  storylineDraftRoute,
  storylineDraftStops,
  toggleStorylineStop,
  type DrawerPage,
  type GreetingPickerKind,
  type ReminderTimeline,
  type StorylineDraft,
} from "./frontend-model";
import { handoffTag, overrideTag } from "./prompt";
import { describePosition, sameRoute } from "./storyline";
import { waypointStyles } from "./styles";
import type {
  Greeting,
  GreetingSelection,
  StorylineCharacterView,
  WaypointSettings,
  WaypointsView,
} from "./types";
import { isRecord } from "./util";

type ComponentHandle = { destroy(): void };

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = "",
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}


function safeRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function asView(value: unknown): WaypointsView | null {
  if (!isRecord(value) || !isRecord(value.settings) || !Array.isArray(value.greetings)) return null;
  return value as unknown as WaypointsView;
}

function selectionValue(greeting: Greeting | null): string {
  return greeting
    ? JSON.stringify({ characterId: greeting.characterId, greetingIndex: greeting.greetingIndex })
    : "";
}

function parseSelection(value: string): GreetingSelection | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!isRecord(parsed) || typeof parsed.characterId !== "string" || !Number.isInteger(parsed.greetingIndex)) return null;
    return { characterId: parsed.characterId, greetingIndex: Number(parsed.greetingIndex) };
  } catch {
    return null;
  }
}

function greetingLabel(greeting: Greeting): string {
  const firstLine = greeting.text.replace(/\s+/g, " ").slice(0, 86);
  return greeting.characterName + " — greeting " + String(greeting.greetingIndex + 1) + (firstLine ? ": " + firstLine : "");
}

interface ConnectionOption {
  id: string;
  name: string;
  model: string;
  isDefault: boolean;
}

function asConnections(value: unknown): ConnectionOption[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => isRecord(entry) && typeof entry.id === "string"
    ? [{
      id: entry.id,
      name: typeof entry.name === "string" ? entry.name : entry.id,
      model: typeof entry.model === "string" ? entry.model : "",
      isDefault: entry.isDefault === true,
    }]
    : []);
}

interface GeneratorChoice {
  connectionId: string;
  model: string;
}

/** Typing in the model field saves once the user pauses, not on every keystroke. */
const GENERATOR_SAVE_DELAY_MS = 600;

/** Overview generation runs a full model call, so it gets far longer than ordinary requests. */
const GENERATION_TIMEOUT_MS = 10 * 60_000;

function compactPreview(value: string, limit = 580): string {
  return value.length > limit ? value.slice(0, limit) + "…" : value;
}

const WAYPOINTS_FLAG_ICON = "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" aria-hidden=\"true\"><path d=\"M5 19V5m0 0 11 3-3 5 6 2-3 5-11-3\"/><circle cx=\"5\" cy=\"5\" r=\"1.5\"/></svg>";
const WAYPOINTS_COMPASS_ICON = "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><circle cx=\"12\" cy=\"12\" r=\"8.5\"/><path d=\"m15.5 8.5-2.7 5-5 2.7 2.7-5 5-2.7Z\"/><circle cx=\"12\" cy=\"12\" r=\"1\" fill=\"currentColor\" stroke=\"none\"/></svg>";

export function setup(ctx: SpindleFrontendContext): () => void {
  const tab = ctx.ui.registerDrawerTab({
    id: "waypoints",
    title: "Waypoints",
    shortName: "Waypoints",
    headerTitle: "Waypoints",
    description: "Guide a chat through character greetings as story waypoints",
    keywords: ["greetings", "handoff", "scene", "prompt", "waypoints"],
    iconSvg: WAYPOINTS_FLAG_ICON,
  });
  tab.root.classList.add("wp-mount");
  const root = element("div", "wp-root");
  tab.root.append(root);
  const removeStyle = ctx.dom.addStyle(waypointStyles);
  let actionBarMount: HTMLElement | null = null;
  try {
    actionBarMount = ctx.ui.mount("chat_actions") as HTMLElement;
    actionBarMount.classList.add("wp-action-bar-mount");
  } catch (error) {
    console.warn("[Waypoints] action-bar mount unavailable", error);
  }
  const actionBarButton = actionBarMount ? element("button", "wp-action-bar-button") : null;
  if (actionBarButton && actionBarMount) {
    actionBarButton.type = "button";
    actionBarButton.innerHTML = WAYPOINTS_FLAG_ICON;
    actionBarButton.title = "Waypoints controls";
    actionBarButton.setAttribute("aria-label", "Waypoints controls");
    actionBarButton.hidden = true;
    actionBarMount.append(actionBarButton);
  }

  let page: DrawerPage = "waypoints";
  let view: WaypointsView | null = null;
  let draft = cloneSettingsDraft(DEFAULT_SETTINGS);
  let draftInitialized = false;
  let destroyed = false;
  let busy = false;
  let notice = "";
  let noticeError = false;
  let sequence = 0;
  let selection = ctx.getActiveChat();
  let selectionVersion = 0;
  let refreshFlight: { version: number; queued: boolean; promise: Promise<void> } | undefined;
  let hud: SpindleFloatWidgetHandle | undefined;
  let reminder: {
    chatId: string;
    version: number;
    /** Waypoints state the reminder announces. */
    enabled: boolean;
    clickToggle: boolean;
    neverAgain: boolean;
    timeline: ReminderTimeline;
    interval: ReturnType<typeof setInterval>;
    toggling: boolean;
    /** Created when the delay ends. */
    widget?: SpindleFloatWidgetHandle;
    card?: HTMLElement;
    title?: HTMLElement;
    hint?: HTMLElement;
    progress?: HTMLElement;
    neverBox?: HTMLInputElement;
  } | undefined;
  let pendingReminderChatId: string | null = null;
  let extrasActions: SpindleInputBarActionHandle[] = [];
  let pickerModal: SpindleModalHandle | undefined;
  let pickerOpen = false;
  const storyDrafts = new Map<string, StorylineDraft>();
  const openStoryPreviews = new Set<string>();
  let storyCharacterId: string | null = null;
  let generatingCharacterId: string | null = null;
  let connections: ConnectionOption[] | undefined;
  let connectionsLoading = false;
  /** Generator choice typed or picked in the Storyline tab and not yet confirmed saved. */
  let generatorPending: GeneratorChoice | null = null;
  let generatorSaveTimer: ReturnType<typeof setTimeout> | undefined;
  let generatorSaving: Promise<boolean> = Promise.resolve(true);
  const pending = new Map<string, {
    resolve: (value: unknown) => void;
    reject: (reason: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();
  let componentHandles: ComponentHandle[] = [];
  const disposers: Array<() => void> = [];

  function clearComponents(): void {
    for (const handle of componentHandles) handle.destroy();
    componentHandles = [];
  }

  function rpc<T = unknown>(action: string, input: unknown = {}, timeoutMs = 30_000): Promise<T> {
    if (destroyed) return Promise.reject(new Error("Waypoints is closed."));
    const requestId = "wp-" + String(++sequence) + "-" + Date.now().toString(36);
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(requestId);
        reject(new Error("Waypoints did not respond in time."));
      }, timeoutMs);
      pending.set(requestId, { resolve: (value) => resolve(value as T), reject, timer });
      try {
        ctx.sendToBackend({ type: "waypoints:request", requestId, action, input });
      } catch (error) {
        pending.delete(requestId);
        clearTimeout(timer);
        reject(error);
      }
    });
  }

  function setNotice(message: string, error = false): void {
    notice = message;
    noticeError = error;
  }

  function currentChatId(): string | undefined {
    return ctx.getActiveChat().chatId ?? undefined;
  }

  function requireCurrentChatId(): string {
    const chatId = currentChatId();
    if (!chatId || view?.chatId !== chatId) throw new Error("Wait for the active chat to load first.");
    return chatId;
  }

  function syncSelection(): boolean {
    if (destroyed) return false;
    const next = ctx.getActiveChat();
    if (next.chatId === selection.chatId && next.characterId === selection.characterId) return false;
    const chatChanged = next.chatId !== selection.chatId;
    if (chatChanged) {
      dismissReminder();
      pendingReminderChatId = next.chatId;
    }
    selection = next;
    selectionVersion += 1;
    refreshFlight = undefined;
    view = null;
    busy = false;
    setNotice("");
    promptCounter.refresh("");
    storylineCounter.refresh("");
    generatingCharacterId = null;
    pickerModal?.dismiss();
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(new Error("The active chat changed."));
    }
    pending.clear();
    render();
    syncActionControls();
    syncHud();
    return true;
  }

  function dismissReminder(): void {
    if (!reminder) return;
    clearInterval(reminder.interval);
    reminder.widget?.destroy();
    reminder = undefined;
  }

  function tickReminder(): void {
    const current = reminder;
    if (!current) return;
    if (destroyed || current.version !== selectionVersion) {
      dismissReminder();
      return;
    }
    const phase = reminderPhase(current.timeline, Date.now());
    if (phase.phase === "waiting") return;
    if (!current.widget && !openReminderWidget(current)) {
      dismissReminder();
      return;
    }
    if (phase.phase === "gone") {
      finishReminder(current);
      return;
    }
    if (current.progress) current.progress.style.transform = "scaleX(" + String(phase.phase === "showing" ? phase.remaining : 0) + ")";
    if (current.widget) current.widget.root.style.opacity = phase.phase === "fading" ? phase.opacity.toFixed(3) : "";
  }

  /** The reminder timed out: honor "Never remind me", then close it. */
  function finishReminder(current: NonNullable<typeof reminder>): void {
    const hide = current.neverAgain && current.neverBox?.checked === true;
    const chatId = current.chatId;
    dismissReminder();
    if (!hide || destroyed) return;
    if (view?.chatId === chatId) view.reminderHidden = true;
    void rpc("set-reminder-hidden", { chatId, hidden: true }).catch((error) => {
      console.warn("[Waypoints] could not hide the reminder for this chat", error);
    });
  }

  function paintReminder(current: NonNullable<typeof reminder>): void {
    if (!current.card || !current.title || !current.hint) return;
    const state = current.enabled ? "ENABLED" : "DISABLED";
    current.card.classList.toggle("on", current.enabled);
    current.card.classList.toggle("off", !current.enabled);
    current.title.replaceChildren("Waypoints is ", element("strong", "wp-reminder-state", state), " for this chat!");
    current.hint.textContent = "click here to " + (current.enabled ? "DISABLE" : "ENABLE");
    current.hint.hidden = !current.clickToggle;
    current.card.setAttribute("aria-label", "Waypoints is " + state + " for this chat" + (current.clickToggle ? ". Click to " + (current.enabled ? "disable" : "enable") + "." : "."));
  }

  function openReminderWidget(current: NonNullable<typeof reminder>): boolean {
    const viewportWidth = document.defaultView?.innerWidth ?? 1280;
    // A thin bar that may run wide; it still fits narrow screens, where the title truncates.
    const width = Math.max(240, Math.min(current.neverAgain ? 540 : 340, viewportWidth - 24));
    const height = current.clickToggle ? 52 : 38;
    let widget: SpindleFloatWidgetHandle;
    try {
      // Lumiverse restores geometry only when a stable persistGeometry key is provided.
      // Keep this separate from the always-visible controls widget; the key changed
      // when the reminder became a thin bar so an old, taller size is not restored.
      const options = {
        width,
        height,
        initialPosition: { x: Math.max(12, viewportWidth - width - 16), y: 68 },
        snapToEdge: true,
        chromeless: true,
        tooltip: "Waypoints chat reminder",
        persistGeometry: "chat-reminder-bar",
      };
      widget = ctx.ui.createFloatWidget(options);
    } catch (error) {
      console.warn("[Waypoints] reminder widget unavailable", error);
      return false;
    }
    const card = element("div", "wp-reminder-card");
    card.setAttribute("role", current.clickToggle ? "button" : "status");
    const text = element("div", "wp-reminder-text");
    const title = element("div", "wp-reminder-title");
    const hint = element("div", "wp-reminder-hint");
    text.append(title, hint);
    card.append(text);
    if (current.neverAgain) {
      const never = element("label", "wp-reminder-never");
      const box = element("input");
      box.type = "checkbox";
      never.append(box, element("span", "", "Never remind me for this chat"));
      // The checkbox must not count as a click on the reminder itself.
      never.addEventListener("click", (event) => event.stopPropagation());
      never.addEventListener("keydown", (event) => event.stopPropagation());
      card.append(never);
      current.neverBox = box;
    }
    const track = element("div", "wp-reminder-track");
    const progress = element("div", "wp-reminder-progress");
    track.append(progress);
    card.append(track);
    if (current.clickToggle) {
      card.tabIndex = 0;
      card.classList.add("clickable");
      card.addEventListener("click", () => toggleFromReminder(current));
      card.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        toggleFromReminder(current);
      });
    }
    widget.root.className = "wp-reminder";
    widget.root.replaceChildren(card);
    Object.assign(current, { widget, card, title, hint, progress });
    paintReminder(current);
    return true;
  }

  function toggleFromReminder(current: NonNullable<typeof reminder>): void {
    if (reminder !== current || current.toggling || busy) return;
    if (destroyed || current.version !== selectionVersion || ctx.getActiveChat().chatId !== current.chatId) {
      dismissReminder();
      return;
    }
    const enabled = !current.enabled;
    void safely(async () => {
      current.toggling = true;
      try {
        await rpc("set-chat-enabled", { chatId: current.chatId, enabled });
        if (reminder === current) {
          current.enabled = enabled;
          // Show the new state for a full duration before it goes away.
          current.timeline = reminderTimeline(view?.settings ?? DEFAULT_SETTINGS, Date.now(), false);
          paintReminder(current);
          tickReminder();
        }
      } finally {
        current.toggling = false;
      }
      await load();
    });
  }

  function maybeShowReminder(): void {
    if (!view || !pendingReminderChatId || pendingReminderChatId !== view.chatId) return;
    const chatId = pendingReminderChatId;
    pendingReminderChatId = null;
    if (!shouldShowReminder(view)) return;
    const settings = view.settings;
    reminder = {
      chatId,
      version: selectionVersion,
      enabled: view.chatEnabled,
      clickToggle: settings.reminderClickToggle,
      neverAgain: settings.reminderNeverAgain,
      timeline: reminderTimeline(settings, Date.now()),
      interval: setInterval(tickReminder, 50),
      toggling: false,
    };
    tickReminder();
  }

  function isCurrentSelection(version: number): boolean {
    if (destroyed) return false;
    if (syncSelection()) refresh();
    return version === selectionVersion;
  }

  function refresh(): void {
    if (destroyed) return;
    const loading = load();
    const version = selectionVersion;
    void loading.catch((error) => {
      if (!isCurrentSelection(version)) return;
      setNotice(error instanceof Error ? error.message : String(error), true);
      render();
    });
  }

  /** Counts tokens for one prompt shown on one drawer page, re-rendering only that page. */
  function tokenCounter(pageName: DrawerPage) {
    let counted = "";
    let display: string | null = null;
    let countSequence = 0;
    return {
      display(content: string): string {
        return display ?? ("Counting… / " + String(content.length) + " Characters");
      },
      refresh(content: string): void {
        if (!content) {
          counted = "";
          display = null;
          countSequence += 1;
          return;
        }
        if (content === counted && display !== null) return;
        const sequenceAtStart = ++countSequence;
        const characterCount = content.length;
        counted = content;
        display = "Counting… / " + String(characterCount) + " Characters";
        void (async () => {
          let tokenCount = approximatePromptTokenCount(characterCount);
          let approximate = true;
          try {
            const result = ctx.tokens ? await ctx.tokens.countText(content) : undefined;
            if (result && Number.isFinite(result.total_tokens)) {
              tokenCount = result.total_tokens;
              approximate = result.approximate || result.tokenizer_id === null;
            }
          } catch {
            // The local fallback remains visibly approximate when token counting is unavailable.
          }
          if (destroyed || sequenceAtStart !== countSequence || counted !== content) return;
          display = formatPromptCount(tokenCount, characterCount, approximate);
          if (page === pageName) render();
        })();
      },
    };
  }
  const promptCounter = tokenCounter("waypoints");
  const storylineCounter = tokenCounter("storyline");

  function updateDraftValidation(target: HTMLElement): void {
    const result = draftValidation(draft);
    target.className = "wp-validation " + (result.valid ? "good" : "bad");
    target.textContent = result.valid
      ? (result.messages.length ? result.messages.join(" ") : "Draft is ready to save.")
      : result.messages.join(" ");
  }

  function addField(
    parent: HTMLElement,
    label: string,
    help: string | HTMLElement,
    mount: (target: HTMLElement) => ComponentHandle,
  ): void {
    const wrap = element("div", "wp-field");
    wrap.append(element("label", "wp-label", label));
    if (typeof help !== "string") {
      help.classList.add("wp-help");
      wrap.append(help);
    } else if (help) {
      wrap.append(element("p", "wp-help", help));
    }
    const target = element("div", "wp-native");
    wrap.append(target);
    parent.append(wrap);
    componentHandles.push(mount(target));
  }

  async function load(): Promise<void> {
    if (destroyed) return;
    syncSelection();
    if (refreshFlight) {
      // Keep a trailing refresh when a lifecycle event arrives during a read.
      refreshFlight.queued = true;
      return refreshFlight.promise;
    }
    const flight = { version: selectionVersion, queued: false, promise: Promise.resolve() };
    refreshFlight = flight;
    flight.promise = (async () => {
      do {
        flight.queued = false;
        const chatId = selection.chatId;
        // Explicit null means no frontend chat, never the backend's previous chat.
        const loaded = asView(await rpc("refresh", { chatId }));
        if (!isCurrentSelection(flight.version)) throw new Error("The active chat changed.");
        if (!loaded || (loaded.chatId !== null && loaded.chatId !== chatId)) {
          throw new Error("Waypoints returned an invalid status.");
        }
        view = loaded;
        if (!draftInitialized) {
          draft = cloneSettingsDraft(loaded.settings);
          draftInitialized = true;
        }
        promptCounter.refresh(loaded.prompt.content);
        storylineCounter.refresh(loaded.storyline.prompt.content);
        syncStoryDrafts();
        render();
        syncActionControls();
        syncHud();
        if (reminder && !loaded.settings.reminderToast) dismissReminder();
        // Keep a showing reminder truthful when the chat is toggled elsewhere.
        if (reminder && reminder.chatId === loaded.chatId && !reminder.toggling && reminder.enabled !== loaded.chatEnabled) {
          reminder.enabled = loaded.chatEnabled;
          paintReminder(reminder);
        }
        maybeShowReminder();
      } while (flight.queued);
    })().finally(() => {
      if (refreshFlight === flight) refreshFlight = undefined;
    });
    return flight.promise;
  }

  async function safely(action: () => Promise<void>): Promise<void> {
    if (destroyed) return;
    if (syncSelection()) {
      refresh();
      return;
    }
    if (busy) return;
    const version = selectionVersion;
    busy = true;
    try {
      syncActionControls();
      syncHud();
      render();
      await action();
    } catch (error) {
      if (isCurrentSelection(version)) setNotice(error instanceof Error ? error.message : String(error), true);
    } finally {
      if (isCurrentSelection(version)) {
        busy = false;
        render();
        syncActionControls();
        syncHud();
      }
    }
  }

  async function toggleChatEnabled(): Promise<void> {
    if (!view) throw new Error("Open a chat first.");
    const chatId = requireCurrentChatId();
    await rpc("set-chat-enabled", { chatId, enabled: !view.chatEnabled });
    await load();
  }

  async function forceTransition(): Promise<void> {
    const result = await rpc("force", { chatId: requireCurrentChatId() });
    const transition = isRecord(result) ? safeTransitionText(result.transition) : "";
    if (transition) setNotice(transition);
    await load();
  }

  async function undoTransition(): Promise<void> {
    const result = await rpc("undo", { chatId: requireCurrentChatId() });
    const transition = isRecord(result) ? safeTransitionText(result.transition) : "";
    if (transition) setNotice(transition);
    await load();
  }

  function openPickerSafely(kind: GreetingPickerKind): void {
    const version = selectionVersion;
    void openGreetingPicker(kind).catch((error) => {
      if (!isCurrentSelection(version)) return;
      setNotice(error instanceof Error ? error.message : String(error), true);
      render();
      syncActionControls();
    });
  }

  async function openGreetingPicker(kind: GreetingPickerKind): Promise<void> {
    if (!isCurrentSelection(selectionVersion)) return;
    if (pickerOpen || busy || !view) return;
    const version = selectionVersion;
    const currentView = view;
    const options = greetingPickerOptions(kind, currentView);
    if (!options.length) {
      setNotice(
        kind === "current" ? "There are no greetings available for this chat." : "There is no later greeting available for this chat.",
        true,
      );
      render();
      return;
    }

    const preferred = kind === "current" ? currentView.active : currentView.upcoming;
    let selected = options.find((greeting) => preferred && selectionValue(greeting) === selectionValue(preferred)) ?? options[0];
    const openedChatId = currentChatId();
    if (!openedChatId) {
      setNotice("Open a chat before choosing a greeting.", true);
      render();
      return;
    }

    let modal: SpindleModalHandle;
    try {
      modal = ctx.ui.showModal({
        title: kind === "current" ? "Choose Current Greeting" : "Choose Next Greeting",
        width: 1040,
        maxHeight: 1000,
        persistent: false,
      });
    } catch (error) {
      throw new Error("Could not open the greeting picker: " + (error instanceof Error ? error.message : String(error)));
    }

    pickerModal = modal;
    pickerOpen = true;

    const picker = element("div", "wp-picker");
    const main = element("div", "wp-picker-main");
    const groupLabel = currentView.isGroupChat
      ? "Group chat: " + String(currentView.characters.length) + " characters"
      : "Character: " + (currentView.characters[0]?.name || "(unnamed)");
    main.append(element("div", "wp-picker-meta", groupLabel));

    const field = element("div", "wp-picker-field");
    const selectLabel = element("label", "wp-picker-label", kind === "current" ? "Current greeting" : "Next greeting");
    const select = element("select", "wp-picker-select");
    select.id = "wp-picker-select-" + kind;
    selectLabel.htmlFor = select.id;
    for (const greeting of options) {
      const option = element("option", "", greetingLabel(greeting));
      option.value = selectionValue(greeting);
      option.selected = selectionValue(greeting) === selectionValue(selected);
      select.append(option);
    }
    field.append(selectLabel, select);
    main.append(field);

    const selectedLabel = element("div", "wp-picker-meta");
    const hint = element("div", "wp-picker-meta", kind === "current"
      ? "The selected greeting becomes current. The next greeting is recalculated only when needed."
      : "The current greeting remains unchanged.");
    const preview = element("div", "wp-picker-preview");
    const previewText = element("pre", "", "");
    preview.append(previewText);
    const error = element("div", "wp-picker-error");
    error.hidden = true;
    main.append(selectedLabel, hint, preview, error);

    const footer = element("div", "wp-picker-footer");
    const cancel = element("button", "wp-button", "Cancel");
    cancel.type = "button";
    const confirm = element("button", "wp-button primary", kind === "current" ? "Use current greeting" : "Use next greeting");
    confirm.type = "button";
    footer.append(cancel, confirm);
    picker.append(main, footer);
    modal.root.replaceChildren(picker);

    const updateSelection = (greeting: Greeting): void => {
      selected = greeting;
      selectedLabel.textContent = "Selected: " + greetingLabel(greeting);
      previewText.textContent = greeting.text || "(empty)";
    };
    updateSelection(selected);
    select.onchange = () => {
      const next = options.find((greeting) => selectionValue(greeting) === select.value);
      if (next) updateSelection(next);
    };

    return new Promise<void>((resolve) => {
      let settled = false;
      let committing = false;
      let unsubscribeDismiss: (() => void) | undefined;

      const finish = (dismiss = true): void => {
        if (settled) return;
        settled = true;
        unsubscribeDismiss?.();
        if (pickerModal === modal) pickerModal = undefined;
        pickerOpen = false;
        if (dismiss) modal.dismiss();
        resolve();
      };

      const showError = (message: string): void => {
        error.hidden = false;
        error.textContent = message;
        confirm.disabled = false;
        cancel.disabled = false;
        select.disabled = false;
      };

      const commit = async (): Promise<void> => {
        const chosen = selected;
        if (settled || !isCurrentSelection(version) || !chosen || committing || busy) return;
        committing = true;
        busy = true;
        confirm.disabled = true;
        cancel.disabled = true;
        select.disabled = true;
        syncActionControls();
        try {
          if (currentChatId() !== openedChatId) throw new Error("The active chat changed; choose the greeting again.");
          await rpc(kind === "current" ? "set-active" : "set-upcoming", {
            chatId: openedChatId,
            selection: { characterId: chosen.characterId, greetingIndex: chosen.greetingIndex },
          });
          await load();
          setNotice(kind === "current" ? "Current greeting updated." : "Next greeting updated.");
          render();
          finish();
        } catch (errorValue) {
          if (isCurrentSelection(version)) showError(errorValue instanceof Error ? errorValue.message : String(errorValue));
        } finally {
          committing = false;
          if (isCurrentSelection(version)) {
            busy = false;
            render();
            syncActionControls();
            syncHud();
          }
        }
      };

      unsubscribeDismiss = modal.onDismiss(() => finish(false));
      cancel.onclick = () => finish();
      confirm.onclick = () => { void commit(); };
    });
  }

  async function openActionBarMenu(): Promise<void> {
    if (!isCurrentSelection(selectionVersion)) return;
    if (!actionBarButton || busy || !view) return;
    const version = selectionVersion;
    const rect = actionBarButton.getBoundingClientRect();
    let result: { selectedKey: string | null };
    try {
      result = await ctx.ui.showContextMenu({
        position: { x: rect.left, y: rect.bottom + 4 },
        items: [
          {
            key: "toggle",
            label: view.chatEnabled ? "Disable Waypoints for this chat" : "Enable Waypoints for this chat",
            active: view.chatEnabled,
            disabled: !view.chatId,
          },
          { key: "choose-current", label: "Choose current greeting", disabled: greetingPickerOptions("current", view).length === 0 },
          { key: "choose-next", label: "Choose next greeting", disabled: greetingPickerOptions("next", view).length === 0 },
          { key: "force", label: "Force next greeting", disabled: !view.upcoming || busy },
          { key: "undo", label: "Undo last insertion", disabled: !view.canUndo || busy },
          {
            key: "story-overview",
            label: view.storyline.overviewEnabled ? "Turn narrative overview off for this chat" : "Turn narrative overview on for this chat",
            active: view.storyline.overviewEnabled,
            disabled: !view.chatId || !view.storyline.characters.some((entry) => entry.overview.trim()),
          },
          { key: "divider", label: "", type: "divider" },
          { key: "open-storyline", label: "Open storyline designer" },
          { key: "open", label: "Open Waypoints drawer" },
        ],
      });
    } catch (error) {
      if (!isCurrentSelection(version)) return;
      setNotice(error instanceof Error ? error.message : String(error), true);
      render();
      return;
    }
    if (!isCurrentSelection(version)) return;
    if (result.selectedKey === "toggle") void safely(toggleChatEnabled);
    else if (result.selectedKey === "choose-current") openPickerSafely("current");
    else if (result.selectedKey === "choose-next") openPickerSafely("next");
    else if (result.selectedKey === "force") void safely(forceTransition);
    else if (result.selectedKey === "undo") void safely(undoTransition);
    else if (result.selectedKey === "story-overview") {
      const enabled = !view.storyline.overviewEnabled;
      void safely(() => setStoryToggle("set-story-overview", enabled));
    } else if (result.selectedKey === "open-storyline") {
      page = "storyline";
      render();
      tab.activate();
    } else if (result.selectedKey === "open") tab.activate();
  }

  function syncActionControls(): void {
    const settings = view?.settings;
    const actionBarVisible = settings?.actionBarButton === true;
    if (actionBarMount) actionBarMount.hidden = !actionBarVisible;
    if (actionBarButton) {
      actionBarButton.hidden = !actionBarVisible;
      actionBarButton.disabled = busy || !view;
      actionBarButton.title = view?.chatId ? "Waypoints controls — " + (view.chatEnabled ? "ON" : "OFF") : "Waypoints controls";
      const tinted = settings?.actionBarStatusColor === true && Boolean(view?.chatId);
      actionBarButton.classList.toggle("wp-status-on", tinted && view?.chatEnabled === true);
      actionBarButton.classList.toggle("wp-status-off", tinted && view?.chatEnabled !== true);
      actionBarButton.setAttribute("aria-label", actionBarButton.title);
    }
    const extrasVisible = settings?.extrasActions === true && !busy && Boolean(view?.chatId);
    for (const action of extrasActions) action.setEnabled(extrasVisible);
    if (extrasActions.length < 5) return;
    extrasActions[0].setLabel(view?.chatEnabled ? "Disable Waypoints for this chat" : "Enable Waypoints for this chat");
    extrasActions[0].setSubtitle("Changes only this chat");
    extrasActions[1].setLabel("Choose current greeting");
    extrasActions[1].setSubtitle("Select the greeting Waypoints treats as current");
    extrasActions[2].setLabel("Choose next greeting");
    extrasActions[2].setSubtitle("Select the upcoming greeting Waypoints will use");
    extrasActions[3].setLabel("Undo last Waypoints insertion");
    extrasActions[3].setSubtitle(view?.canUndo ? "Remove the latest Waypoints greeting" : "No Waypoints insertion available");
    extrasActions[4].setLabel("Force next Waypoints greeting");
    extrasActions[4].setSubtitle(view?.upcoming ? "Insert the selected upcoming greeting" : "Choose an upcoming greeting first");
  }

  function registerExtrasActions(): void {
    const registered: SpindleInputBarActionHandle[] = [];
    try {
      registered.push(ctx.ui.registerInputBarAction({
        id: "toggle-waypoints",
        label: "Toggle Waypoints",
        subtitle: "Enable or disable Waypoints for this chat",
        iconSvg: WAYPOINTS_COMPASS_ICON,
        enabled: false,
      }));
      registered.push(ctx.ui.registerInputBarAction({
        id: "choose-current-waypoints",
        label: "Choose current greeting",
        subtitle: "Select the greeting Waypoints treats as current",
        iconSvg: WAYPOINTS_COMPASS_ICON,
        enabled: false,
      }));
      registered.push(ctx.ui.registerInputBarAction({
        id: "choose-next-waypoints",
        label: "Choose next greeting",
        subtitle: "Select the upcoming greeting Waypoints will use",
        iconSvg: WAYPOINTS_COMPASS_ICON,
        enabled: false,
      }));
      registered.push(ctx.ui.registerInputBarAction({
        id: "undo-waypoints",
        label: "Undo last Waypoints insertion",
        subtitle: "Remove the latest Waypoints greeting",
        iconSvg: WAYPOINTS_COMPASS_ICON,
        enabled: false,
      }));
      registered.push(ctx.ui.registerInputBarAction({
        id: "force-waypoints",
        label: "Force next Waypoints greeting",
        subtitle: "Insert the selected upcoming greeting",
        iconSvg: WAYPOINTS_COMPASS_ICON,
        enabled: false,
      }));
      extrasActions = registered;
      disposers.push(
        registered[0].onClick(() => { void safely(toggleChatEnabled); }),
        registered[1].onClick(() => openPickerSafely("current")),
        registered[2].onClick(() => openPickerSafely("next")),
        registered[3].onClick(() => { void safely(undoTransition); }),
        registered[4].onClick(() => { void safely(forceTransition); }),
      );
    } catch (error) {
      for (const action of registered) action.destroy();
      console.warn("[Waypoints] Extras actions unavailable", error);
    }
  }

  if (actionBarButton) actionBarButton.onclick = () => { void openActionBarMenu(); };
  registerExtrasActions();

  function button(
    label: string,
    action: () => Promise<void> | void,
    className = "",
    disabled = false,
  ): HTMLButtonElement {
    const node = element("button", "wp-button" + (className ? " " + className : ""), label);
    node.type = "button";
    node.disabled = disabled || busy;
    const version = selectionVersion;
    node.onclick = () => { if (isCurrentSelection(version)) void action(); };
    return node;
  }

  function renderNotice(parent: HTMLElement): void {
    if (!notice) return;
    parent.append(element("div", "wp-notice" + (noticeError ? " error" : ""), notice));
  }

  function renderTabs(parent: HTMLElement): void {
    const tabs = element("div", "wp-tabs");
    tabs.setAttribute("role", "tablist");
    for (const descriptor of [
      ["waypoints", "Waypoints"],
      ["storyline", "Storyline"],
      ["prompts", "Prompts"],
      ["settings", "Settings"],
    ] as const) {
      const targetPage = descriptor[0];
      const node = element("button", "wp-tab", descriptor[1]);
      node.type = "button";
      node.setAttribute("role", "tab");
      node.setAttribute("aria-selected", String(page === targetPage));
      node.onclick = () => {
        page = targetPage;
        render();
      };
      tabs.append(node);
    }
    parent.append(tabs);
  }

  function renderPicker(
    parent: HTMLElement,
    label: string,
    selectedGreeting: Greeting | null,
    allowClear: boolean,
    changed: (selection: GreetingSelection | null) => Promise<void>,
  ): void {
    const currentView = view;
    if (!currentView) return;
    const version = selectionVersion;
    addField(parent, label, currentView.isGroupChat ? "All group members' greetings are available here." : "", (target) =>
      ctx.components.mountSelect(target, {
        value: selectionValue(selectedGreeting),
        clearable: allowClear,
        clearLabel: "No upcoming greeting",
        placeholder: "Choose a greeting",
        options: currentView.greetings.map((greeting) => ({
          value: selectionValue(greeting),
          label: greetingLabel(greeting),
          group: greeting.characterName,
        })),
        onChange: (value) => {
          if (!isCurrentSelection(version)) return;
          const selection = parseSelection(value);
          if (!selection && !allowClear) return;
          void safely(async () => {
            const chatId = currentChatId();
            if (!chatId) throw new Error("Open a chat first.");
            await changed(selection);
            await load();
          });
        },
      }),
    );
  }

  function renderDashboard(parent: HTMLElement): void {
    if (!view) {
      parent.append(element("div", "wp-card", "Loading Waypoints…"));
      return;
    }
    if (view.missingPermissions.length) {
      parent.append(element(
        "div",
        "wp-alert",
        "Automatic handoffs are unavailable until these permissions are granted: " + view.missingPermissions.join(", ") + ".",
      ));
    }
    const status = element("section", "wp-card");
    const heading = element("div", "wp-row between");
    const headingText = element("div");
    headingText.append(element("div", "wp-kicker", view.isGroupChat ? "Group chat" : "Character chat"));
    headingText.append(element("h3", "", "Status"));
    heading.append(headingText);
    heading.append(button("Refresh", refresh));
    status.append(heading, element("p", "wp-muted", view.status));
    const storyPosition = view.storyline.prompt.position;
    const routed = Object.keys(view.routes).length > 0;
    if (view.chatId && storyPosition && storyPosition.total > 0 && (routed || view.storyline.prompt.ready)) {
      const storyLine = element("p", "wp-muted");
      storyLine.append(
        (routed ? "Following the storyline route. " : "")
        + (describePosition(storyPosition) || "")
        + (view.storyline.prompt.ready ? " Narrative overview is on." : ""),
      );
      status.append(storyLine);
    }
    if (view.chatId) {
      const chatRow = element("div", "wp-character");
      chatRow.append(element("div", "wp-character-name", "Use Waypoints in this chat"));
      const chatTarget = element("div", "wp-native");
      chatRow.append(chatTarget);
      status.append(chatRow);
      componentHandles.push(ctx.components.mountSwitch(chatTarget, {
        checked: view.chatEnabled,
        ariaLabel: "Use Waypoints in this chat",
        onChange: (checked) => {
          void safely(async () => {
            await rpc("set-chat-enabled", { chatId: requireCurrentChatId(), enabled: checked });
            await load();
          });
        },
      }));
    }
    parent.append(status);

    const selections = element("section", "wp-section");
    selections.append(element("h3", "", "Greeting path"));
    const grid = element("div", "wp-grid");
    selections.append(grid);
    renderPicker(grid, "Active greeting", view.active, false, async (selection) => {
      await rpc("set-active", { chatId: currentChatId(), selection });
    });
    renderPicker(grid, "Upcoming greeting", view.upcoming, true, async (selection) => {
      await rpc("set-upcoming", { chatId: currentChatId(), selection });
    });
    const previews = element("div", "wp-grid");
    const activePreview = element("div", "wp-field");
    activePreview.append(element("label", "wp-label", "Active preview"));
    activePreview.append(element("pre", "wp-preview", view.active ? compactPreview(view.active.text) : "No active greeting."));
    const upcomingPreview = element("div", "wp-field");
    upcomingPreview.append(element("label", "wp-label", "Upcoming preview"));
    upcomingPreview.append(element("pre", "wp-preview", view.upcoming ? compactPreview(view.upcoming.text) : "No upcoming greeting."));
    previews.append(activePreview, upcomingPreview);
    selections.append(previews);
    const actions = element("div", "wp-actions");
    actions.append(
      button("Force", () => safely(forceTransition), "primary", !view.upcoming),
      button("Undo", () => safely(undoTransition), "", !view.canUndo),
    );
    selections.append(actions);
    parent.append(selections);

    const enabled = element("section", "wp-section");
    enabled.append(element("h3", "", view.isGroupChat ? "Group member switches" : "Character switch"));
    enabled.append(element("p", "wp-help", view.isGroupChat
      ? "Each group member has a per-chat override. New members default to ON."
      : "This character's Waypoints switch is stored on the character card."));
    for (const character of view.characters) {
      const version = selectionVersion;
      const row = element("div", "wp-character");
      const names = element("div");
      names.append(element("div", "wp-character-name", character.name || "Unnamed character"));
      names.append(element("div", "wp-help", character.enabled ? "ON" : "OFF"));
      const mount = element("div", "wp-native");
      row.append(names, mount);
      enabled.append(row);
      componentHandles.push(ctx.components.mountSwitch(mount, {
        checked: character.enabled,
        ariaLabel: "Enable Waypoints for " + character.name,
        onChange: (checked) => {
          if (!isCurrentSelection(version)) return;
          void safely(async () => {
            await rpc("set-enabled", {
              chatId: currentChatId(),
              characterId: character.id,
              enabled: checked,
            });
            await load();
          });
        },
      }));
    }
    parent.append(enabled);

    const prompt = element("section", "wp-section");
    prompt.append(element("h3", "", "Rendered prompt status"));
    const promptText = view.prompt.ready
      ? (view.prompt.autoPrompt ? "Auto-prompt is ON." : "Auto-prompt is OFF; add {{waypoints_content}} to a Loom preset to inject it.")
      : (view.prompt.reason ?? "No prompt is available.");
    prompt.append(element(
      "p",
      "wp-muted",
      promptText + " Role: " + view.prompt.role + ". Depth: " + String(view.prompt.insertionDepth) + ".",
    ));
    if (view.prompt.content) {
      prompt.append(element("div", "wp-prompt-count", promptCounter.display(view.prompt.content)));
      const details = element("details", "wp-diagnostics");
      details.append(element("summary", "", "Show rendered prompt"));
      details.append(element("pre", "wp-preview", view.prompt.content));
      prompt.append(details);
    }
    parent.append(prompt);

    const diagnostics = element("section", "wp-section");
    diagnostics.append(element("h3", "", "Diagnostics"));
    const diagActions = element("div", "wp-actions");
    diagActions.append(
      button("Copy diagnostics", () => safely(async () => {
        const text = view?.diagnostics.join("\n") ?? "";
        if (!navigator.clipboard?.writeText) throw new Error("Clipboard access is unavailable in this Lumiverse window.");
        await navigator.clipboard.writeText(text);
        setNotice("Diagnostics copied.");
      })),
      button("Clear diagnostics", () => safely(async () => {
        await rpc("clear-diagnostics", { chatId: currentChatId() });
        await load();
        setNotice("Diagnostics cleared.");
      })),
    );
    diagnostics.append(diagActions);
    const details = element("details", "wp-diagnostics");
    details.append(element("summary", "", "Show " + String(view.diagnostics.length) + " recent lines"));
    details.append(element("pre", "wp-preview", view.diagnostics.join("\n") || "No diagnostic lines yet."));
    diagnostics.append(details);
    parent.append(diagnostics);

    if (view.settings.floatingControls && !canShowHud(true, view.grantedPermissions)) {
      parent.append(element("div", "wp-alert", "Floating controls are enabled in Settings, but ui_panels permission is not granted. The drawer still works."));
    }
  }

  /** Keep each character's draft in step with what was saved, without losing local edits. */
  function syncStoryDrafts(): void {
    if (!view) return;
    for (const saved of view.storyline.characters) {
      storyDrafts.set(saved.characterId, reconcileStorylineDraft(storyDrafts.get(saved.characterId), saved, view.greetings));
    }
    const ids = view.storyline.characters.map((entry) => entry.characterId);
    if (!storyCharacterId || !ids.includes(storyCharacterId)) {
      storyCharacterId = view.storyline.prompt.characterId && ids.includes(view.storyline.prompt.characterId)
        ? view.storyline.prompt.characterId
        : ids[0] ?? null;
    }
  }

  function storySaved(): StorylineCharacterView | null {
    return view?.storyline.characters.find((entry) => entry.characterId === storyCharacterId) ?? null;
  }

  function storyDraft(): StorylineDraft | null {
    const saved = storySaved();
    if (!saved || !view) return null;
    let draft = storyDrafts.get(saved.characterId);
    if (!draft) {
      draft = storylineDraftFromSaved(saved, view.greetings);
      storyDrafts.set(saved.characterId, draft);
    }
    return draft;
  }

  function isStoryGenerating(saved: StorylineCharacterView | null): boolean {
    return Boolean(saved && (generatingCharacterId === saved.characterId || saved.generating));
  }

  async function saveStoryline(): Promise<void> {
    const saved = storySaved();
    const draft = storyDraft();
    if (!saved || !draft || !view) throw new Error("Open a chat first.");
    const route = storylineDraftRoute(draft, view.greetings);
    if (!storylineDraftStops(draft).length) throw new Error("Include at least one greeting in the storyline.");
    await rpc("save-storyline", {
      chatId: requireCurrentChatId(),
      characterId: saved.characterId,
      storyline: {
        route,
        notes: draft.notes,
        includePersona: draft.includePersona,
        includeCharacter: draft.includeCharacter,
        overview: draft.overview,
      },
    });
    storyDrafts.delete(saved.characterId);
    await load();
    setNotice("Storyline saved for every chat with this character.");
  }

  async function deleteStoryline(): Promise<void> {
    const saved = storySaved();
    if (!saved) throw new Error("Open a chat first.");
    await rpc("delete-storyline", { chatId: requireCurrentChatId(), characterId: saved.characterId });
    storyDrafts.delete(saved.characterId);
    await load();
    setNotice("Storyline deleted. Waypoints follows card order again.");
  }

  async function setStoryToggle(action: "set-story-route" | "set-story-overview", enabled: boolean): Promise<void> {
    await rpc(action, { chatId: requireCurrentChatId(), enabled });
    await load();
  }

  async function generateStoryline(): Promise<void> {
    const saved = storySaved();
    const draft = storyDraft();
    if (!saved || !draft || !view || busy || isStoryGenerating(saved)) return;
    if (!storylineDraftStops(draft).length) {
      setNotice("Include at least one greeting in the storyline.", true);
      render();
      return;
    }
    const version = selectionVersion;
    const characterId = saved.characterId;
    // Generate with the connection and model the user sees, even mid-typing.
    if (!await flushGeneratorSave()) return;
    if (!isCurrentSelection(version) || busy || isStoryGenerating(saved)) return;
    generatingCharacterId = characterId;
    setNotice("");
    render();
    try {
      const chatId = requireCurrentChatId();
      await rpc("generate-storyline", {
        chatId,
        characterId,
        storyline: {
          route: storylineDraftRoute(draft, view.greetings),
          notes: draft.notes,
          includePersona: draft.includePersona,
          includeCharacter: draft.includeCharacter,
        },
      }, GENERATION_TIMEOUT_MS);
      if (!isCurrentSelection(version)) return;
      // The backend saved the route, guidance, and overview together.
      storyDrafts.delete(characterId);
      if (generatingCharacterId === characterId) generatingCharacterId = null;
      await load();
      setNotice("Narrative overview generated and saved.");
    } catch (error) {
      if (isCurrentSelection(version)) setNotice(error instanceof Error ? error.message : String(error), true);
    } finally {
      if (generatingCharacterId === characterId) generatingCharacterId = null;
      if (isCurrentSelection(version)) {
        render();
        syncHud();
      }
    }
  }

  function cancelStoryline(characterId: string): void {
    void rpc("cancel-storyline", { characterId }).catch(() => undefined);
  }

  function renderStoryRoute(parent: HTMLElement, draft: StorylineDraft, generating: boolean): void {
    if (!view) return;
    const currentView = view;
    const stops = storylineDraftStops(draft);
    const route = element("section", "wp-section");
    const heading = element("div", "wp-row between");
    heading.append(element("h3", "", "Route"));
    heading.append(element("span", "wp-kicker", String(stops.length) + " of " + String(draft.order.length) + " greetings"));
    route.append(heading);
    route.append(element("p", "wp-help", "Tick the greetings this storyline visits and arrange them in story order. Unticked greetings are skipped when Waypoints picks the next greeting."));
    const list = element("ol", "wp-story-list");
    const greetingsByIndex = new Map(currentView.greetings
      .filter((greeting) => greeting.characterId === draft.characterId)
      .map((greeting) => [greeting.greetingIndex, greeting]));
    const update = (next: StorylineDraft) => {
      storyDrafts.set(draft.characterId, next);
      render();
    };
    draft.order.forEach((index, position) => {
      const greeting = greetingsByIndex.get(index);
      if (!greeting) return;
      const included = !draft.excluded.includes(index);
      const row = element("li", "wp-story-row" + (included ? "" : " excluded"));
      const toggle = element("input", "wp-story-check");
      toggle.type = "checkbox";
      toggle.checked = included;
      toggle.disabled = busy || generating;
      toggle.setAttribute("aria-label", "Include greeting " + String(index + 1) + " in the storyline");
      toggle.onchange = () => update(toggleStorylineStop(draft, index, toggle.checked));
      const step = element("span", "wp-story-step", included ? String(stops.indexOf(index) + 1) : "–");
      const body = element("div", "wp-story-body");
      const title = element("div", "wp-story-title");
      title.append(element("span", "wp-character-name", "Greeting " + String(index + 1)));
      if (currentView.active?.characterId === draft.characterId && currentView.active.greetingIndex === index) {
        title.append(element("span", "wp-badge", "Current"));
      }
      if (currentView.upcoming?.characterId === draft.characterId && currentView.upcoming.greetingIndex === index) {
        title.append(element("span", "wp-badge next", "Next"));
      }
      body.append(title);
      body.append(element("div", "wp-story-snippet", greeting.text.replace(/\s+/g, " ").slice(0, 140)));
      const previewKey = draft.characterId + ":" + String(index);
      const details = element("details", "wp-story-preview");
      details.open = openStoryPreviews.has(previewKey);
      details.ontoggle = () => {
        if (details.open) openStoryPreviews.add(previewKey);
        else openStoryPreviews.delete(previewKey);
      };
      details.append(element("summary", "", "Preview"), element("pre", "wp-preview", compactPreview(greeting.text, 2400)));
      body.append(details);
      const moves = element("div", "wp-story-moves");
      const up = element("button", "wp-button wp-icon-button", "↑");
      up.type = "button";
      up.title = "Move earlier";
      up.setAttribute("aria-label", "Move greeting " + String(index + 1) + " earlier");
      up.disabled = busy || generating || position === 0;
      up.onclick = () => update(moveStorylineStop(draft, index, -1));
      const down = element("button", "wp-button wp-icon-button", "↓");
      down.type = "button";
      down.title = "Move later";
      down.setAttribute("aria-label", "Move greeting " + String(index + 1) + " later");
      down.disabled = busy || generating || position === draft.order.length - 1;
      down.onclick = () => update(moveStorylineStop(draft, index, 1));
      moves.append(up, down);
      row.append(toggle, step, body, moves);
      list.append(row);
    });
    route.append(list);
    const actions = element("div", "wp-actions");
    actions.append(
      button("Include all", () => update({ ...draft, excluded: [] }), "", generating || !draft.excluded.length),
      button("Reset to card order", () => update(resetStorylineOrder(draft, currentView.greetings)), "", generating),
    );
    route.append(actions);
    parent.append(route);
  }

  function renderStoryChat(parent: HTMLElement, saved: StorylineCharacterView): void {
    if (!view) return;
    const section = element("section", "wp-section");
    section.append(element("h3", "", "This chat"));
    section.append(element("p", "wp-help", "The storyline is shared by every chat with this character. These switches change only the open chat."));
    const switches: Array<[string, string, boolean, "set-story-route" | "set-story-overview"]> = [
      ["Follow the storyline route", "Waypoints picks the next greeting from the route instead of card order.", view.storyline.routeEnabled, "set-story-route"],
      ["Add the narrative overview to prompts", saved.overview.trim() ? "Gives the model the whole journey, not just the next greeting." : "Generate or write an overview below first.", view.storyline.overviewEnabled, "set-story-overview"],
    ];
    for (const [label, help, checked, action] of switches) {
      const row = element("div", "wp-character");
      const names = element("div");
      names.append(element("div", "wp-character-name", label), element("div", "wp-help", help));
      const mount = element("div", "wp-native");
      row.append(names, mount);
      section.append(row);
      const version = selectionVersion;
      componentHandles.push(ctx.components.mountSwitch(mount, {
        checked,
        ariaLabel: label,
        onChange: (value) => {
          if (!isCurrentSelection(version)) return;
          void safely(() => setStoryToggle(action, value));
        },
      }));
    }
    const prompt = view.storyline.prompt;
    if (prompt.characterId === saved.characterId) {
      const position = describePosition(prompt.position);
      if (position) section.append(element("p", "wp-muted", position));
    }
    parent.append(section);
  }

  function renderStoryOverview(parent: HTMLElement, saved: StorylineCharacterView, draft: StorylineDraft, generating: boolean): void {
    if (!view) return;
    const currentView = view;
    const section = element("section", "wp-section");
    section.append(element("h3", "", "Narrative overview"));
    section.append(element("p", "wp-help", "A meta prompt that describes the whole journey, so the model can foreshadow and keep continuity instead of only seeing the next greeting. Generate it from the route, then edit it freely."));
    const dirtyLabel = element("div", "wp-validation");
    const saveButton = button("Save storyline", () => safely(saveStoryline), "primary", generating);
    const discardButton = button("Discard changes", () => {
      storyDrafts.set(saved.characterId, storylineDraftFromSaved(saved, currentView.greetings));
      render();
    }, "", generating);
    const updateDirty = () => {
      const dirty = storylineDraftDirty(draft, saved, currentView.greetings);
      dirtyLabel.className = "wp-validation " + (dirty ? "bad" : "good");
      dirtyLabel.textContent = dirty ? "Unsaved changes." : saved.updatedAt === null ? "Nothing saved yet for this character." : "Saved.";
      saveButton.disabled = busy || generating || !dirty;
      discardButton.disabled = busy || generating || !dirty;
    };

    addField(section, "Author guidance", "Optional notes for the generator, such as genre, themes, or how the arc should feel.", (target) =>
      ctx.components.mountTextArea(target, {
        value: draft.notes,
        rows: 3,
        disabled: generating,
        placeholder: "Slow-burn romance; keep the mystery of the lighthouse unresolved until the end.",
        ariaLabel: "Author guidance",
        onChange: (value) => {
          draft.notes = value;
          updateDirty();
        },
      }),
    );

    const contextOptions: Array<[keyof Pick<StorylineDraft, "includeCharacter" | "includePersona">, string, string]> = [
      ["includeCharacter", "Include character description, personality, and scenario", "Gives the generator the character card's details."],
      ["includePersona", "Include the current user persona", "Gives the generator your persona's description. Your name is always used either way."],
    ];
    for (const [key, label, hint] of contextOptions) {
      const target = element("div", "wp-native");
      section.append(target);
      componentHandles.push(ctx.components.mountCheckbox(target, {
        checked: draft[key],
        label,
        hint,
        disabled: generating,
        onChange: (checked) => {
          draft[key] = checked;
          updateDirty();
        },
      }));
    }

    renderStoryGenerator(section, generating);

    const generateRow = element("div", "wp-actions");
    if (generating) {
      generateRow.append(element("span", "wp-generating", "Generating the narrative overview…"));
      const cancel = element("button", "wp-button danger", "Cancel");
      cancel.type = "button";
      cancel.onclick = () => cancelStoryline(saved.characterId);
      generateRow.append(cancel);
    } else {
      const canGenerate = currentView.grantedPermissions.includes("generation");
      generateRow.append(button(
        saved.overview.trim() ? "Regenerate overview" : "Generate overview",
        () => generateStoryline(),
        "primary",
        !canGenerate || !storylineDraftStops(draft).length,
      ));
      if (!canGenerate) generateRow.append(element("span", "wp-help", "Needs the generation permission."));
    }
    section.append(generateRow);

    const routeChanged = !sameRoute(storylineDraftRoute(draft, currentView.greetings), saved.route);
    if (saved.overview.trim() && (saved.stale || routeChanged)) {
      section.append(element("div", "wp-alert", routeChanged
        ? "The route has changed since this overview was written. Regenerate it so the journey matches."
        : "The route's greetings have changed on the character card since this overview was generated. Regenerate it to match."));
    }
    if (saved.generatedAt) {
      section.append(element("p", "wp-help", "Last generated " + new Date(saved.generatedAt).toLocaleString() + "."));
    }

    addField(section, "Overview", "Saved per character. Edits here are used as-is.", (target) =>
      ctx.components.mountTextArea(target, {
        value: draft.overview,
        rows: 14,
        disabled: generating,
        placeholder: "Generate an overview, or write your own description of the journey.",
        ariaLabel: "Narrative overview",
        onChange: (value) => {
          draft.overview = value;
          updateDirty();
        },
      }),
    );

    const prompt = currentView.storyline.prompt;
    if (prompt.characterId === saved.characterId) {
      section.append(element("p", "wp-muted", prompt.ready
        ? (currentView.settings.autoPrompt ? "Auto-prompt is ON: the overview is added to every generation in this chat." : "Auto-prompt is OFF; add {{waypoints_storyline}} to a Loom preset to inject it.")
        : (prompt.reason ?? "The overview is not active.")));
      if (prompt.content) {
        section.append(element("div", "wp-prompt-count", storylineCounter.display(prompt.content)));
        const details = element("details", "wp-diagnostics");
        details.append(element("summary", "", "Show rendered overview prompt"), element("pre", "wp-preview", prompt.content));
        section.append(details);
      }
    } else if (saved.overview.trim()) {
      section.append(element("p", "wp-muted", "In this group chat, the overview in prompts belongs to the character whose greeting is current."));
    }

    const footer = element("div", "wp-actions");
    footer.append(saveButton, discardButton);
    if (saved.updatedAt !== null) {
      footer.append(button("Delete storyline", () => safely(deleteStoryline), "danger", generating));
    }
    section.append(dirtyLabel, footer);
    updateDirty();
    parent.append(section);
  }

  function renderStoryline(parent: HTMLElement): void {
    if (!view) {
      parent.append(element("div", "wp-card", "Loading Waypoints…"));
      return;
    }
    const saved = storySaved();
    const draft = storyDraft();
    if (!view.chatId || !saved || !draft) {
      parent.append(element("div", "wp-card", view.chatId ? "This chat has no characters with greetings." : view.status));
      return;
    }
    const generating = isStoryGenerating(saved);
    const intro = element("section", "wp-card");
    intro.append(element("div", "wp-kicker", "Storyline designer"));
    const name = view.characters.find((character) => character.id === saved.characterId)?.name || "Unnamed character";
    intro.append(element("h3", "", name + "'s storyline"));
    intro.append(element("p", "wp-muted", "Choose which greetings the story visits and in what order, then generate a narrative overview of the whole journey. Saved per character for every chat with them."));
    if (view.isGroupChat && view.storyline.characters.length > 1) {
      const version = selectionVersion;
      addField(intro, "Character", "Each group member has their own storyline.", (target) =>
        ctx.components.mountSelect(target, {
          value: saved.characterId,
          options: view!.storyline.characters.map((entry) => ({
            value: entry.characterId,
            label: view!.characters.find((character) => character.id === entry.characterId)?.name || "Unnamed character",
          })),
          onChange: (value) => {
            if (!isCurrentSelection(version)) return;
            storyCharacterId = value;
            render();
          },
        }),
      );
    }
    parent.append(intro);
    renderStoryRoute(parent, draft, generating);
    renderStoryChat(parent, saved);
    renderStoryOverview(parent, saved, draft, generating);
  }

  function generatorChoice(): GeneratorChoice {
    return generatorPending ?? {
      connectionId: view?.settings.storylineConnectionId ?? "",
      model: view?.settings.storylineModel ?? "",
    };
  }

  function queueGeneratorSave(next: GeneratorChoice, delay: number): void {
    generatorPending = next;
    clearTimeout(generatorSaveTimer);
    generatorSaveTimer = setTimeout(() => void flushGeneratorSave(), delay);
  }

  /** Saves any pending generator choice; resolves false when the save failed. */
  function flushGeneratorSave(): Promise<boolean> {
    clearTimeout(generatorSaveTimer);
    generatorSaveTimer = undefined;
    const next = generatorPending;
    if (!next) return generatorSaving;
    generatorSaving = generatorSaving.then(async () => {
      try {
        const result = safeRecord(await rpc("set-storyline-generator", { ...next }));
        const saved = isRecord(result.settings) ? result.settings as unknown as WaypointSettings : null;
        const connectionId = saved ? saved.storylineConnectionId : next.connectionId.trim();
        const model = saved ? saved.storylineModel : next.model.trim();
        if (view) view.settings = { ...view.settings, storylineConnectionId: connectionId, storylineModel: model };
        // Keep the Settings draft in step so saving it later cannot undo this choice.
        draft.storylineConnectionId = connectionId;
        draft.storylineModel = model;
        return true;
      } catch (error) {
        setNotice(error instanceof Error ? error.message : String(error), true);
        render();
        return false;
      } finally {
        if (generatorPending === next) generatorPending = null;
      }
    });
    return generatorSaving;
  }

  function renderStoryGenerator(parent: HTMLElement, generating: boolean): void {
    if (!connections) void loadConnections();
    const choice = generatorChoice();
    const grid = element("div", "wp-grid");
    parent.append(grid);
    const connectionOptions = [{ value: "", label: "Default connection" }, ...(connections ?? []).map((connection) => ({
      value: connection.id,
      label: connection.name + (connection.model ? " — " + connection.model : "") + (connection.isDefault ? " (default)" : ""),
    }))];
    if (choice.connectionId && !connectionOptions.some((option) => option.value === choice.connectionId)) {
      connectionOptions.push({ value: choice.connectionId, label: connections ? "Unavailable connection" : "Loading connections…" });
    }
    addField(grid, "Generator connection", "Any Lumiverse connection profile. Use a cheaper or stronger model for overviews than for chat.", (target) =>
      ctx.components.mountSelect(target, {
        value: choice.connectionId,
        options: connectionOptions,
        disabled: generating,
        onChange: (value) => {
          queueGeneratorSave({ ...generatorChoice(), connectionId: value }, 0);
          syncModelField();
        },
      }),
    );

    // The connection the generator will really use: the chosen one, else the default.
    const effectiveConnection = () => {
      const current = generatorChoice();
      return current.connectionId
        ? connections?.find((entry) => entry.id === current.connectionId)
        : connections?.find((entry) => entry.isDefault);
    };
    const connectionRef = () => {
      const id = generatorChoice().connectionId || effectiveConnection()?.id;
      return id ? { kind: "llm" as const, id } : { kind: "llm" as const };
    };
    const modelHint = element("p");
    let combobox: SpindleModelComboboxHandle | undefined;
    const syncModelField = () => {
      const model = effectiveConnection()?.model;
      modelHint.textContent = "Leave blank to use the connection's own model" + (model ? " (" + model + ")." : ".");
      combobox?.update({ connection: connectionRef() });
    };
    const onModelChange = (value: string) => queueGeneratorSave({ ...generatorChoice(), model: value }, GENERATOR_SAVE_DELAY_MS);
    addField(grid, "Model override", modelHint, (target) => {
      // Older hosts lack the model picker; a plain text field still works there.
      if (typeof ctx.components.mountModelCombobox !== "function") {
        return ctx.components.mountTextInput(target, {
          value: choice.model,
          placeholder: "Use connection default",
          disabled: generating,
          ariaLabel: "Generator model override",
          onChange: onModelChange,
        });
      }
      combobox = ctx.components.mountModelCombobox(target, {
        value: choice.model,
        connection: connectionRef(),
        placeholder: "Use connection default",
        appearance: "standard",
        disabled: generating,
        onChange: onModelChange,
      });
      return combobox;
    });
    syncModelField();
  }

  async function loadConnections(): Promise<void> {
    if (connections || connectionsLoading) return;
    connectionsLoading = true;
    const version = selectionVersion;
    try {
      connections = asConnections(await rpc("list-connections"));
    } catch {
      connections = [];
    } finally {
      connectionsLoading = false;
      if (isCurrentSelection(version) && page === "storyline") render();
    }
  }

  function safeTransitionText(value: unknown): string {
    if (!isRecord(value) || typeof value.reason !== "string") return "";
    return value.reason;
  }

  /** Opens a Prompts or Settings section; both tabs edit and save one shared draft. */
  function draftSection(parent: HTMLElement, title: string): { section: HTMLElement; validation: HTMLElement } {
    const section = element("section", "wp-section");
    section.append(element("h3", "", title));
    section.append(element("p", "wp-help", "Edits on the Prompts and Settings tabs share one draft until you select Save changes. Invalid drafts never change live behavior."));
    const validation = element("div", "wp-validation");
    updateDraftValidation(validation);
    section.append(validation);
    parent.append(section);
    return { section, validation };
  }

  function renderDraftActions(section: HTMLElement, resetLabel: string, keys: readonly (keyof WaypointSettings)[], resetNotice: string): void {
    const actions = element("div", "wp-actions");
    actions.append(
      button("Save changes", () => safely(async () => {
        const validationResult = draftValidation(draft);
        if (!validationResult.valid) throw new Error(validationResult.messages.join(" "));
        const result = safeRecord(await rpc("save-settings", { settings: draft }));
        const saved = isRecord(result.settings) ? result.settings as unknown as WaypointSettings : null;
        if (saved) {
          draft = cloneSettingsDraft(saved);
          draftInitialized = true;
          const warnings = Array.isArray(result.warnings) ? result.warnings.filter((item: unknown): item is string => typeof item === "string") : [];
          setNotice(warnings.length ? "Settings saved. " + warnings.join(" ") : "Settings saved.");
        }
        await load();
      }), "primary"),
      button("Discard draft", () => {
        if (view) draft = cloneSettingsDraft(view.settings);
        render();
      }),
      // Resets only this tab's fields, and only in the draft, so it can still be discarded.
      button(resetLabel, () => {
        draft = resetDraftFields(draft, keys);
        setNotice(resetNotice);
        render();
      }, "danger"),
    );
    section.append(actions);
  }

  function renderPrompts(parent: HTMLElement): void {
    const { section, validation } = draftSection(parent, "Prompts");
    section.append(element("h4", "", "Scene prompt"));
    addField(section, "Scene-shaping template", "Required placeholders: {{scene_excerpt}} and {{handoff_tag}}. {{override_tag}} is optional but recommended.", (target) =>
      ctx.components.mountTextArea(target, {
        value: draft.promptTemplate,
        rows: 16,
        ariaLabel: "Scene-shaping template",
        onChange: (value) => {
          draft.promptTemplate = value;
          updateDraftValidation(validation);
        },
      }),
    );
    const promptGrid = element("div", "wp-grid");
    section.append(promptGrid);
    addField(promptGrid, "Prewritten-scene limit", "Characters retained after exclusion filtering.", (target) =>
      ctx.components.mountNumericInput(target, {
        value: draft.prewrittenSceneCharLimit,
        integer: true,
        min: 1,
        max: 100000,
        onChange: (value) => {
          if (value !== null) draft.prewrittenSceneCharLimit = value;
          updateDraftValidation(validation);
        },
      }),
    );
    addField(promptGrid, "Exclusion regex", "Accepts /pattern/flags. The LumiScript-style x flag removes spaces and # comments outside character classes.", (target) =>
      ctx.components.mountTextInput(target, {
        value: draft.promptExcludeRegex,
        placeholder: "/private block/gi",
        onChange: (value) => {
          draft.promptExcludeRegex = value;
          updateDraftValidation(validation);
        },
      }),
    );
    addField(promptGrid, "Prompt insertion depth", "0 is the newest edge of the assembled prompt.", (target) =>
      ctx.components.mountNumericInput(target, {
        value: draft.insertionDepth,
        integer: true,
        min: 0,
        max: 9999,
        onChange: (value) => {
          if (value !== null) draft.insertionDepth = value;
          updateDraftValidation(validation);
        },
      }),
    );
    addField(promptGrid, "Prompt role", "Use system unless your connection requires another role.", (target) =>
      ctx.components.mountSelect(target, {
        value: draft.promptRole,
        options: [
          { value: "system", label: "system" },
          { value: "user", label: "user" },
          { value: "assistant", label: "assistant" },
        ],
        onChange: (value) => {
          if (value === "system" || value === "user" || value === "assistant") draft.promptRole = value;
          updateDraftValidation(validation);
        },
      }),
    );
    const autoTarget = element("div", "wp-native");
    section.append(autoTarget);
    componentHandles.push(ctx.components.mountCheckbox(autoTarget, {
      checked: draft.autoPrompt,
      label: "Automatically insert the rendered prompt before generation",
      hint: "Off by default. Keep it off when a Loom preset injects {{waypoints_content}}, so the prompt is not added twice.",
      onChange: (checked) => {
        draft.autoPrompt = checked;
        updateDraftValidation(validation);
      },
    }));

    const loomHelp = element("div", "wp-loom-help");
    loomHelp.append(element("div", "wp-label", "Loom preset macros"));
    loomHelp.append(element(
      "p",
      "wp-help",
      "Use these extension macros in a Loom block. They are not local variables, so do not add a leading dot.",
    ));
    loomHelp.append(element(
      "pre",
      "wp-preview",
      "{{if::{{waypoints_active}}}}\n{{waypoints_content}}\n{{/if}}",
    ));
    loomHelp.append(element(
      "p",
      "wp-help",
      "If you are using a preset with a COT, you can use this alternate version to add a small snippet into a variable, then use that variable in the COT."
    ));
    loomHelp.append(element(
      "pre",
      "wp-preview",
      "{{if::{{waypoints_active}}}}\n{{waypoints_content}}\n{{setvar::shape_scene_direction::Shape Scene Direction: Ensure strict adherence to the <shape_scene_direction> instructions by slowly shaping the narrative towards the doorstep of the next prewritten scene. Decide if allowing the narrative to progress naturally OR if shaping the narrative towards the upcoming scene. Then, list the decision result, justification, and if shaping, what items of influence are being included.}}\n{{else}}\n{{deletevar::shape_scene_direction}}\n{{/if}}"
    ));
    loomHelp.append(element(
      "p",
      "wp-help",
      "Then simply call the variable using {{getvar::shape_scene_direction}} where ever it would be relevant in your COT prompt. The variable will clear itself out when waypoints is not active, so always leave the prompt enabled in your preset."
    ));
    loomHelp.append(element(
      "p",
      "wp-help",
      "Pre-run council tools can also use {{altMessage1}}, {{altMessage2}}, and so on for this character's alternate greetings. {{altMessages}} returns them as a JSON array; the standard {{firstMessage}} is separate. Higher altMessage indices are unregistered when switching to a character with fewer alternate greetings. {{nextMessages}} returns the choices offered by Waypoints' next-greeting picker (only later greetings in solo chats). {{currentMessage}} and {{nextMessage}} return the selected current and upcoming greetings.",
    ));
    loomHelp.append(element(
      "p",
      "wp-help",
      "The narrative overview has its own pair: {{if::{{waypoints_storyline_active}}}}{{waypoints_storyline}}{{/if}}. It is active when the open chat has the overview switched on in the Storyline tab. To write your own wrapper, use {{waypoints_storyline_overview}} (raw overview text), {{waypoints_storyline_position}} (story progress sentence), and {{waypoints_current_waypoint}}, {{waypoints_next_waypoint}}, and {{waypoints_waypoint_count}} (scene numbers along the storyline).",
    ));
    section.append(loomHelp);

    section.append(element("div", "wp-divider"));
    section.append(element("h4", "", "Storyline prompts"));
    addField(section, "Overview prompt template", "Wraps a character's narrative overview when it is added to prompts. Required: {{storyline_overview}}. Optional: {{storyline_position}} and {{character_name}}.", (target) =>
      ctx.components.mountTextArea(target, {
        value: draft.storylineTemplate,
        rows: 9,
        ariaLabel: "Overview prompt template",
        onChange: (value) => {
          draft.storylineTemplate = value;
          updateDraftValidation(validation);
        },
      }),
    );
    addField(section, "Overview generator instructions", "Sent to the model by Generate overview. Required: {{waypoints}}. Optional: {{story_context}} (character and persona details chosen in the Storyline tab), {{character_name}}, {{user_name}}, {{character_description}}, {{character_personality}}, {{character_scenario}}, {{user_persona}}, {{author_notes}}, and {{waypoint_count}}. Lumiverse macros such as {{user}} and {{char}} are expanded before sending.", (target) =>
      ctx.components.mountTextArea(target, {
        value: draft.storylineGeneratorTemplate,
        rows: 12,
        ariaLabel: "Overview generator instructions",
        onChange: (value) => {
          draft.storylineGeneratorTemplate = value;
          updateDraftValidation(validation);
        },
      }),
    );
    const storyGrid = element("div", "wp-grid");
    section.append(storyGrid);
    addField(storyGrid, "Overview insertion depth", "Uses the prompt role above. At the same depth as the scene prompt, the overview comes first.", (target) =>
      ctx.components.mountNumericInput(target, {
        value: draft.storylineInsertionDepth,
        integer: true,
        min: 0,
        max: 9999,
        onChange: (value) => {
          if (value !== null) draft.storylineInsertionDepth = value;
          updateDraftValidation(validation);
        },
      }),
    );
    addField(storyGrid, "Generator limit per greeting", "Characters of each greeting sent to the generator, after exclusion filtering.", (target) =>
      ctx.components.mountNumericInput(target, {
        value: draft.storylineWaypointCharLimit,
        integer: true,
        min: 100,
        max: 100000,
        onChange: (value) => {
          if (value !== null) draft.storylineWaypointCharLimit = value;
          updateDraftValidation(validation);
        },
      }),
    );
    section.append(element("p", "wp-help", "The generator's connection and model are chosen in the Storyline tab, next to Generate overview."));

    renderDraftActions(section, "Reset prompts to defaults", PROMPT_SETTING_KEYS, "Prompt defaults restored in the draft. Select Save changes to apply them.");
  }

  /** A checkbox from the host's component kit, appended to parent. */
  function addCheckbox(
    parent: HTMLElement,
    validation: HTMLElement,
    label: string,
    hint: string,
    checked: boolean,
    changed: (checked: boolean) => void,
  ): void {
    const target = element("div", "wp-native");
    parent.append(target);
    componentHandles.push(ctx.components.mountCheckbox(target, {
      checked,
      label,
      hint,
      onChange: (value) => {
        changed(value);
        updateDraftValidation(validation);
      },
    }));
  }

  /** Indented options that only show while their parent option is on. */
  function childOptions(parent: HTMLElement, visible: boolean): HTMLElement {
    const group = element("div", "wp-suboptions");
    group.hidden = !visible;
    parent.append(group);
    return group;
  }

  function addSecondsField(
    parent: HTMLElement,
    validation: HTMLElement,
    label: string,
    help: string,
    field: "reminderDurationSeconds" | "reminderFadeSeconds" | "reminderDelaySeconds",
    min: number,
    max: number,
  ): void {
    addField(parent, label, help, (target) =>
      ctx.components.mountNumericInput(target, {
        value: draft[field],
        min,
        max,
        step: 0.5,
        ariaLabel: label,
        onChange: (value) => {
          if (value !== null) draft[field] = value;
          updateDraftValidation(validation);
        },
      }),
    );
  }

  function renderSettings(parent: HTMLElement): void {
    const { section, validation } = draftSection(parent, "Settings");

    section.append(element("h4", "", "New chats"));
    addField(section, "Starting state", "Applies only the first time a chat is opened. Chats you have opened before keep their own on or off state.", (target) =>
      ctx.components.mountSelect(target, {
        value: draft.newChatsEnabled ? "on" : "off",
        options: [
          { value: "on", label: "Waypoints ON for new chats" },
          { value: "off", label: "Waypoints OFF for new chats" },
        ],
        onChange: (value) => {
          if (value === "on" || value === "off") draft.newChatsEnabled = value === "on";
          updateDraftValidation(validation);
        },
      }),
    );

    section.append(element("div", "wp-divider"));
    section.append(element("h4", "", "Interface"));
    addCheckbox(section, validation, "Show floating ON / Undo / Force controls", "Enabled by default. Lumiverse owns its drag position and reset behavior.", draft.floatingControls, (checked) => {
      draft.floatingControls = checked;
    });

    let reminderOptions: HTMLElement | null = null;
    addCheckbox(section, validation, "Show a reminder when a chat opens", "A thin floating bar that says whether Waypoints is enabled or disabled for the chat. Requires ui_panels permission.", draft.reminderToast, (checked) => {
      draft.reminderToast = checked;
      if (reminderOptions) reminderOptions.hidden = !checked;
    });
    reminderOptions = childOptions(section, draft.reminderToast);
    addField(reminderOptions, "Show the reminder on", "Chats without an alternate greeting never show it.", (target) =>
      ctx.components.mountSelect(target, {
        value: draft.reminderShowOn,
        options: [
          { value: "enabled", label: "Chats where Waypoints is enabled" },
          { value: "disabled", label: "Chats where Waypoints is disabled" },
          { value: "all", label: "All chats" },
        ],
        onChange: (value) => {
          if (value === "enabled" || value === "disabled" || value === "all") draft.reminderShowOn = value;
          updateDraftValidation(validation);
        },
      }),
    );
    addCheckbox(reminderOptions, validation, "Click the reminder to turn Waypoints on or off", "Adds a \"click here to DISABLE\" (or ENABLE) line to the reminder.", draft.reminderClickToggle, (checked) => {
      draft.reminderClickToggle = checked;
    });
    addCheckbox(reminderOptions, validation, "Offer \"Never remind me for this chat\"", "Hides the reminder for a chat when it times out with the box ticked. Turning this off shows the reminder in every chat again once saved.", draft.reminderNeverAgain, (checked) => {
      draft.reminderNeverAgain = checked;
    });
    addSecondsField(reminderOptions, validation, "Duration (seconds)", "How long the reminder stays before it goes away.", "reminderDurationSeconds", 0.5, 300);
    let fadeField: HTMLElement | null = null;
    addCheckbox(reminderOptions, validation, "Fade out?", "Fade the reminder away instead of closing it at once.", draft.reminderFadeOut, (checked) => {
      draft.reminderFadeOut = checked;
      if (fadeField) fadeField.hidden = !checked;
    });
    fadeField = childOptions(reminderOptions, draft.reminderFadeOut);
    addSecondsField(fadeField, validation, "Fade-out duration (seconds)", "How long the reminder takes to fade away.", "reminderFadeSeconds", 0, 60);
    let delayField: HTMLElement | null = null;
    addCheckbox(reminderOptions, validation, "Delay?", "Wait before showing the reminder after a chat opens.", draft.reminderDelay, (checked) => {
      draft.reminderDelay = checked;
      if (delayField) delayField.hidden = !checked;
    });
    delayField = childOptions(reminderOptions, draft.reminderDelay);
    addSecondsField(delayField, validation, "Delay (seconds)", "How long to wait before the reminder appears.", "reminderDelaySeconds", 0, 60);

    let actionBarOptions: HTMLElement | null = null;
    addCheckbox(section, validation, "Show the compass button in the chat action bar", "Adds a compact Waypoints menu beside the buttons above the input box.", draft.actionBarButton, (checked) => {
      draft.actionBarButton = checked;
      if (actionBarOptions) actionBarOptions.hidden = !checked;
    });
    actionBarOptions = childOptions(section, draft.actionBarButton);
    addCheckbox(actionBarOptions, validation, "Color the button by chat state", "Green when Waypoints is enabled for the open chat, red when it is disabled.", draft.actionBarStatusColor, (checked) => {
      draft.actionBarStatusColor = checked;
    });
    addCheckbox(section, validation, "Show Waypoints actions in the Extras menu", "Adds Toggle, Choose current greeting, Choose next greeting, Undo, and Force entries under Lumiverse's native Extras popover.", draft.extrasActions, (checked) => {
      draft.extrasActions = checked;
    });

    section.append(element("div", "wp-divider"));
    section.append(element("h4", "", "Handoff"));
    const handoffGrid = element("div", "wp-grid");
    section.append(handoffGrid);
    let updateHandoffPreviews = () => {};
    addField(handoffGrid, "Handoff tag name", "Waypoints recognizes both self-closing and paired forms.", (target) =>
      ctx.components.mountTextInput(target, {
        value: draft.handoffTagName,
        onChange: (value) => {
          draft.handoffTagName = value;
          updateDraftValidation(validation);
          updateHandoffPreviews();
        },
      }),
    );
    addField(handoffGrid, "User override tag name", "A user can request the closest viable handoff with this marker.", (target) =>
      ctx.components.mountTextInput(target, {
        value: draft.overrideTagName,
        onChange: (value) => {
          draft.overrideTagName = value;
          updateDraftValidation(validation);
          updateHandoffPreviews();
        },
      }),
    );
    const previews = element("p", "wp-help");
    previews.append("Live previews: ");
    const handoffPreview = element("code", "wp-code", handoffTag(draft));
    const overridePreview = element("code", "wp-code", overrideTag(draft));
    previews.append(handoffPreview);
    previews.append(document.createTextNode(" and "));
    previews.append(overridePreview);
    section.append(previews);
    updateHandoffPreviews = () => {
      handoffPreview.textContent = handoffTag(draft);
      overridePreview.textContent = overrideTag(draft);
    };

    section.append(element("div", "wp-divider"));
    section.append(element("h4", "", "Advanced"));
    const advancedGrid = element("div", "wp-grid");
    section.append(advancedGrid);
    const numericFields: Array<[keyof WaypointSettings, string, string, number, number]> = [
      ["interceptorPriority", "Interceptor priority", "Lower priorities run first.", 0, 1000],
      ["contentProcessorPriority", "Content-processor priority", "Lower priorities run first.", 0, 1000],
      ["activeChatRetryAttempts", "Active-chat retries", "Attempts while a chat switch settles.", 1, 25],
      ["activeChatRetryDelayMs", "Active-chat retry delay (ms)", "Delay between active-chat retries.", 0, 2000],
      ["handoffReadRetryAttempts", "Handoff-read retries", "Attempts while a handoff message settles.", 1, 25],
      ["handoffReadRetryDelayMs", "Handoff-read retry delay (ms)", "Delay between handoff-read retries.", 0, 2000],
      ["pendingHandoffLimit", "Pending-handoff limit", "Recent handoff observations retained in chat state.", 1, 500],
      ["recentTransitionLimit", "Recent-transition limit", "Dedupe keys retained in chat state.", 1, 500],
      ["diagnosticLineLimit", "Diagnostic line limit", "Runtime diagnostic lines retained in the drawer.", 10, 500],
    ];
    for (const descriptor of numericFields) {
      const field = descriptor[0];
      addField(advancedGrid, descriptor[1], descriptor[2], (target) =>
        ctx.components.mountNumericInput(target, {
          value: draft[field] as number,
          integer: true,
          min: descriptor[3],
          max: descriptor[4],
          onChange: (value) => {
            if (value !== null) (draft[field] as number) = value;
            updateDraftValidation(validation);
          },
        }),
      );
    }
    const diagnosticsTarget = element("div", "wp-native");
    section.append(diagnosticsTarget);
    componentHandles.push(ctx.components.mountCheckbox(diagnosticsTarget, {
      checked: draft.diagnosticLogging,
      label: "Keep diagnostic logging",
      hint: "When off, new runtime diagnostic lines are not added.",
      onChange: (checked) => {
        draft.diagnosticLogging = checked;
        updateDraftValidation(validation);
      },
    }));

    renderDraftActions(section, "Reset settings to defaults", GENERAL_SETTING_KEYS, "Setting defaults restored in the draft. Prompts are unchanged. Select Save changes to apply them.");
  }

  function syncHud(): void {
    const visible = Boolean(view && canShowHud(view.settings.floatingControls, view.grantedPermissions));
    if (!visible) {
      hud?.destroy();
      hud = undefined;
      return;
    }
    if (!hud) {
      try {
        hud = ctx.ui.createFloatWidget({
          width: 245,
          height: 44,
          snapToEdge: true,
          tooltip: "Waypoints controls",
          chromeless: true,
        });
      } catch {
        return;
      }
    }
    renderHud();
  }

  function renderHud(): void {
    if (!hud || !view) return;
    const root = hud.root;
    root.replaceChildren();
    root.className = "wp-hud";
    root.append(element("span", "wp-hud-label", "Waypoints"));
    root.append(button(view.chatEnabled ? "ON" : "OFF", () => safely(toggleChatEnabled), "", !view.chatId));
    root.append(button("Undo", () => safely(undoTransition), "", !view.canUndo));
    root.append(button("Force", () => safely(forceTransition), "primary", !view.upcoming));
  }

  function render(): void {
    if (destroyed) return;
    clearComponents();
    root.replaceChildren();
    const header = element("header", "wp-header");
    const intro = element("div");
    intro.append(element("h2", "", "Waypoints"));
    intro.append(element("p", "wp-muted", "Guide a chat through the next greeting without exposing its contents."));
    header.append(intro);
    header.append(button("Refresh", refresh));
    root.append(header);
    renderNotice(root);
    renderTabs(root);
    const pageRoot = element("div", "wp-page");
    pageRoot.setAttribute("role", "tabpanel");
    root.append(pageRoot);
    if (page === "waypoints") renderDashboard(pageRoot);
    else if (page === "storyline") renderStoryline(pageRoot);
    else if (page === "prompts") renderPrompts(pageRoot);
    else renderSettings(pageRoot);
  }

  disposers.push(ctx.onBackendMessage((payload) => {
    if (syncSelection()) refresh();
    const message = safeRecord(payload);
    if (message.type === "waypoints:reply" && typeof message.requestId === "string") {
      const request = pending.get(message.requestId);
      if (!request) return;
      pending.delete(message.requestId);
      clearTimeout(request.timer);
      if (typeof message.error === "string" && message.error) request.reject(new Error(message.error));
      else request.resolve(message.result);
      return;
    }
    if (message.type === "waypoints:permission-denied" || (typeof message.type === "string" && shouldRefreshDrawer(message.type))) {
      refresh();
    }
  }));
  disposers.push(tab.onActivate(refresh));
  disposers.push(ctx.events.on("CHAT_SWITCHED", refresh));
  disposers.push(ctx.events.on("CHAT_CHANGED", refresh));
  const selectionChanged = () => { if (syncSelection()) refresh(); };
  let subscribed = false;
  try {
    if (ctx.state) {
      disposers.push(ctx.state.subscribe("chat.active", selectionChanged));
      subscribed = true;
    }
  } catch {
    // Older hosts may not expose the selector yet.
  }
  if (!subscribed) {
    const selectionTimer = setInterval(selectionChanged, 500);
    disposers.push(() => clearInterval(selectionTimer));
  }

  render();
  syncActionControls();
  ctx.ready();
  refresh();

  return () => {
    destroyed = true;
    clearTimeout(generatorSaveTimer);
    clearComponents();
    for (const dispose of disposers) dispose();
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(new Error("Waypoints closed."));
    }
    pending.clear();
    dismissReminder();
    pickerModal?.dismiss();
    hud?.destroy();
    for (const action of extrasActions) action.destroy();
    actionBarMount?.replaceChildren();
    tab.destroy();
    removeStyle();
  };
}
