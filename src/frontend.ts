import type {
  SpindleFloatWidgetHandle,
  SpindleFrontendContext,
  SpindleInputBarActionHandle,
  SpindleModalHandle,
} from "lumiverse-spindle-types";
import { DEFAULT_SETTINGS } from "./config";
import {
  canShowHud,
  cloneSettingsDraft,
  draftValidation,
  approximatePromptTokenCount,
  formatPromptCount,
  greetingPickerOptions,
  shouldRefreshDrawer,
  type GreetingPickerKind,
} from "./frontend-model";
import { handoffTag, overrideTag } from "./prompt";
import { waypointStyles } from "./styles";
import type { Greeting, GreetingSelection, WaypointSettings, WaypointsView } from "./types";

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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

function compactPreview(value: string, limit = 580): string {
  return value.length > limit ? value.slice(0, limit) + "…" : value;
}

const WAYPOINTS_COMPASS_ICON = "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><circle cx=\"12\" cy=\"12\" r=\"8.5\"/><path d=\"m15.5 8.5-2.7 5-5 2.7 2.7-5 5-2.7Z\"/><circle cx=\"12\" cy=\"12\" r=\"1\" fill=\"currentColor\" stroke=\"none\"/></svg>";

export function setup(ctx: SpindleFrontendContext): () => void {
  const tab = ctx.ui.registerDrawerTab({
    id: "waypoints",
    title: "Waypoints",
    shortName: "Waypoints",
    headerTitle: "Waypoints",
    description: "Guide a chat through character greetings as story waypoints",
    keywords: ["greetings", "handoff", "scene", "prompt", "waypoints"],
    iconSvg: "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\"><path d=\"M5 19V5m0 0 11 3-3 5 6 2-3 5-11-3\"/><circle cx=\"5\" cy=\"5\" r=\"1.5\"/></svg>",
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
    actionBarButton.innerHTML = WAYPOINTS_COMPASS_ICON;
    actionBarButton.title = "Waypoints controls";
    actionBarButton.setAttribute("aria-label", "Waypoints controls");
    actionBarButton.hidden = true;
    actionBarMount.append(actionBarButton);
  }

  let page: "waypoints" | "settings" = "waypoints";
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
  let extrasActions: SpindleInputBarActionHandle[] = [];
  let pickerModal: SpindleModalHandle | undefined;
  let pickerOpen = false;
  let promptCountContent = "";
  let promptCountDisplay: string | null = null;
  let promptCountSequence = 0;
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

  function rpc<T = unknown>(action: string, input: unknown = {}): Promise<T> {
    if (destroyed) return Promise.reject(new Error("Waypoints is closed."));
    const requestId = "wp-" + String(++sequence) + "-" + Date.now().toString(36);
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(requestId);
        reject(new Error("Waypoints did not respond in time."));
      }, 30_000);
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
    selection = next;
    selectionVersion += 1;
    refreshFlight = undefined;
    view = null;
    busy = false;
    setNotice("");
    refreshPromptCount("");
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

  function refreshPromptCount(content: string): void {
    if (!content) {
      promptCountContent = "";
      promptCountDisplay = null;
      promptCountSequence += 1;
      return;
    }
    if (content === promptCountContent && promptCountDisplay !== null) return;

    const sequenceAtStart = ++promptCountSequence;
    const characterCount = content.length;
    promptCountContent = content;
    promptCountDisplay = "Counting… / " + String(characterCount) + " Characters";

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
      if (destroyed || sequenceAtStart !== promptCountSequence || promptCountContent !== content) return;
      promptCountDisplay = formatPromptCount(tokenCount, characterCount, approximate);
      if (page === "waypoints") render();
    })();
  }

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
    help: string,
    mount: (target: HTMLElement) => ComponentHandle,
  ): void {
    const wrap = element("div", "wp-field");
    wrap.append(element("label", "wp-label", label));
    if (help) wrap.append(element("p", "wp-help", help));
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
        refreshPromptCount(loaded.prompt.content);
        render();
        syncActionControls();
        syncHud();
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

  function selectedControlCharacter() {
    if (!view) return undefined;
    const selectedGreeting = view.upcoming ?? view.active;
    return selectedGreeting
      ? view.characters.find((character) => character.id === selectedGreeting.characterId)
      : undefined;
  }

  async function toggleSelectedCharacter(): Promise<void> {
    const character = selectedControlCharacter();
    if (!character) throw new Error("Choose an active or upcoming greeting first.");
    const chatId = requireCurrentChatId();
    await rpc("set-enabled", {
      chatId,
      characterId: character.id,
      enabled: !character.enabled,
    });
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
    const character = selectedControlCharacter();
    const rect = actionBarButton.getBoundingClientRect();
    let result: { selectedKey: string | null };
    try {
      result = await ctx.ui.showContextMenu({
        position: { x: rect.left, y: rect.bottom + 4 },
        items: [
          {
            key: "toggle",
            label: character
              ? (character.enabled ? "Disable Waypoints" : "Enable Waypoints") + " — " + character.name
              : "Toggle Waypoints",
            active: character?.enabled,
            disabled: !character,
          },
          { key: "choose-current", label: "Choose current greeting", disabled: greetingPickerOptions("current", view).length === 0 },
          { key: "choose-next", label: "Choose next greeting", disabled: greetingPickerOptions("next", view).length === 0 },
          { key: "force", label: "Force next greeting", disabled: !view.upcoming || busy },
          { key: "undo", label: "Undo last insertion", disabled: !view.canUndo || busy },
          { key: "divider", label: "", type: "divider" },
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
    if (result.selectedKey === "toggle") void safely(toggleSelectedCharacter);
    else if (result.selectedKey === "choose-current") openPickerSafely("current");
    else if (result.selectedKey === "choose-next") openPickerSafely("next");
    else if (result.selectedKey === "force") void safely(forceTransition);
    else if (result.selectedKey === "undo") void safely(undoTransition);
    else if (result.selectedKey === "open") tab.activate();
  }

  function syncActionControls(): void {
    const character = selectedControlCharacter();
    const settings = view?.settings;
    const actionBarVisible = settings?.actionBarButton === true;
    if (actionBarMount) actionBarMount.hidden = !actionBarVisible;
    if (actionBarButton) {
      actionBarButton.hidden = !actionBarVisible;
      actionBarButton.disabled = busy || !view;
      actionBarButton.title = character
        ? "Waypoints controls — " + (character.enabled ? "ON" : "OFF")
        : "Waypoints controls";
      actionBarButton.setAttribute("aria-label", actionBarButton.title);
    }
    const extrasVisible = settings?.extrasActions === true && !busy && Boolean(view?.chatId);
    for (const action of extrasActions) action.setEnabled(extrasVisible);
    if (extrasActions.length < 5) return;
    extrasActions[0].setLabel(character
      ? (character.enabled ? "Disable Waypoints" : "Enable Waypoints")
      : "Toggle Waypoints");
    extrasActions[0].setSubtitle(character?.name ?? "Choose an active or upcoming greeting");
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
        subtitle: "Enable or disable the selected character",
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
        registered[0].onClick(() => { void safely(toggleSelectedCharacter); }),
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
      prompt.append(element("div", "wp-prompt-count", promptCountDisplay ?? ("Counting… / " + String(view.prompt.content.length) + " Characters")));
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

  function safeTransitionText(value: unknown): string {
    if (!isRecord(value) || typeof value.reason !== "string") return "";
    return value.reason;
  }

  function renderSettings(parent: HTMLElement): void {
    const settings = element("section", "wp-section");
    settings.append(element("h3", "", "Settings"));
    settings.append(element("p", "wp-help", "Edits stay in this draft until you select Save settings. Invalid drafts never change live behavior."));
    const validation = element("div", "wp-validation");
    updateDraftValidation(validation);
    settings.append(validation);

    settings.append(element("h4", "", "Prompt"));
    addField(settings, "Scene-shaping template", "Required placeholders: {{scene_excerpt}} and {{handoff_tag}}. {{override_tag}} is optional but recommended.", (target) =>
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
    settings.append(promptGrid);
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
    settings.append(autoTarget);
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
    settings.append(loomHelp);

    settings.append(element("div", "wp-divider"));
    settings.append(element("h4", "", "Handoff"));
    const handoffGrid = element("div", "wp-grid");
    settings.append(handoffGrid);
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
    settings.append(previews);
    updateHandoffPreviews = () => {
      handoffPreview.textContent = handoffTag(draft);
      overridePreview.textContent = overrideTag(draft);
    };

    settings.append(element("div", "wp-divider"));
    settings.append(element("h4", "", "Advanced"));
    const advancedGrid = element("div", "wp-grid");
    settings.append(advancedGrid);
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
    settings.append(diagnosticsTarget);
    componentHandles.push(ctx.components.mountCheckbox(diagnosticsTarget, {
      checked: draft.diagnosticLogging,
      label: "Keep diagnostic logging",
      hint: "When off, new runtime diagnostic lines are not added.",
      onChange: (checked) => {
        draft.diagnosticLogging = checked;
        updateDraftValidation(validation);
      },
    }));

    settings.append(element("div", "wp-divider"));
    settings.append(element("h4", "", "Interface"));
    const hudTarget = element("div", "wp-native");
    settings.append(hudTarget);
    componentHandles.push(ctx.components.mountCheckbox(hudTarget, {
      checked: draft.floatingControls,
      label: "Show floating ON / Undo / Force controls",
      hint: "Enabled by default. Lumiverse owns its drag position and reset behavior.",
      onChange: (checked) => {
        draft.floatingControls = checked;
        updateDraftValidation(validation);
      },
    }));
    const actionBarTarget = element("div", "wp-native");
    settings.append(actionBarTarget);
    componentHandles.push(ctx.components.mountCheckbox(actionBarTarget, {
      checked: draft.actionBarButton,
      label: "Show the compass button in the chat action bar",
      hint: "Adds a compact Waypoints menu beside the buttons above the input box.",
      onChange: (checked) => {
        draft.actionBarButton = checked;
        updateDraftValidation(validation);
      },
    }));
    const extrasTarget = element("div", "wp-native");
    settings.append(extrasTarget);
    componentHandles.push(ctx.components.mountCheckbox(extrasTarget, {
      checked: draft.extrasActions,
      label: "Show Waypoints actions in the Extras menu",
      hint: "Adds Toggle, Undo, and Force entries under Lumiverse's native Extras popover.",
      onChange: (checked) => {
        draft.extrasActions = checked;
        updateDraftValidation(validation);
      },
    }));

    const actions = element("div", "wp-actions");
    actions.append(
      button("Save settings", () => safely(async () => {
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
      button("Reset defaults", () => safely(async () => {
        const result = safeRecord(await rpc("reset-settings"));
        const saved = isRecord(result.settings) ? result.settings as unknown as WaypointSettings : null;
        if (saved) {
          draft = cloneSettingsDraft(saved);
          draftInitialized = true;
        }
        setNotice("Settings reset to defaults.");
        await load();
      }), "danger"),
    );
    settings.append(actions);
    parent.append(settings);
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
    const character = selectedControlCharacter();
    const enabled = character?.enabled ?? false;
    root.append(button(enabled ? "ON" : "OFF", () => safely(toggleSelectedCharacter), "", !character));
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
    clearComponents();
    for (const dispose of disposers) dispose();
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(new Error("Waypoints closed."));
    }
    pending.clear();
    pickerModal?.dismiss();
    hud?.destroy();
    for (const action of extrasActions) action.destroy();
    actionBarMount?.replaceChildren();
    tab.destroy();
    removeStyle();
  };
}
