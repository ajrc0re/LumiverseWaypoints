import { afterEach, describe, expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import type { SpindleFrontendContext } from "lumiverse-spindle-types";
import { DEFAULT_SETTINGS } from "../src/config";
import { setup } from "../src/frontend";
import type { WaypointsView } from "../src/types";

type Selection = ReturnType<SpindleFrontendContext["getActiveChat"]>;
type Request = { requestId: string; action: string; input: Record<string, unknown> };

function status(chatId: string | null): WaypointsView {
  const characterId = chatId?.replace("chat-", "") ?? "";
  const name = characterId === "a" ? "Ada" : "Bryn";
  const greetings = chatId ? [0, 1, 2].map((greetingIndex) => ({
    characterId, characterName: name, greetingIndex, text: name + " greeting " + greetingIndex,
  })) : [];
  return {
    chatId, isGroupChat: false, grantedPermissions: ["ui_panels"], missingPermissions: [],
    characters: chatId ? [{ id: characterId, name, enabled: true }] : [],
    greetings, active: greetings[0] ?? null, upcoming: greetings[1] ?? null, canUndo: Boolean(chatId),
    status: chatId ? "Ready: " + name : "Open a character or group chat to use Waypoints.",
    settings: structuredClone(DEFAULT_SETTINGS),
    prompt: { ready: Boolean(chatId), autoPrompt: false, role: "system", insertionDepth: 0, content: chatId ? name + " prompt" : "" },
    diagnostics: [],
  };
}

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
const originalDocument = globalThis.document;
let host: FrontendHost | undefined;

afterEach(() => {
  host?.destroy();
  host?.dom.window.close();
  host = undefined;
  globalThis.document = originalDocument;
});

class FrontendHost {
  readonly dom = new JSDOM("<!doctype html><body></body>");
  readonly drawer = this.dom.window.document.createElement("div");
  readonly actionBar = this.dom.window.document.createElement("div");
  readonly extras = new Map<string, HTMLButtonElement>();
  readonly events = new Map<string, () => void>();
  readonly requests: Request[] = [];
  readonly answered = new Set<string>();
  selection: Selection = { chatId: "chat-a", characterId: "a" };
  stateListener?: () => void;
  backendListener?: (payload: unknown) => void;
  activate?: () => void;
  menuChoice?: (result: { selectedKey: string | null }) => void;
  modal?: HTMLElement;
  hud?: HTMLElement;
  selectionReads = 0;
  teardown?: () => void;

  constructor(stateSubscription = true) {
    globalThis.document = this.dom.window.document;
    document.body.append(this.drawer, this.actionBar);
    const ctx = {
      getActiveChat: () => { this.selectionReads += 1; return { ...this.selection }; },
      sendToBackend: (request: Request) => this.requests.push(request),
      onBackendMessage: (handler: (payload: unknown) => void) => {
        this.backendListener = handler;
        return () => { this.backendListener = undefined; };
      },
      ready() {},
      dom: { addStyle: () => () => {} },
      events: { on: (event: string, handler: () => void) => {
        this.events.set(event, handler);
        return () => { this.events.delete(event); };
      } },
      state: stateSubscription ? { subscribe: (selector: string, handler: () => void) => {
        expect(selector).toBe("chat.active");
        this.stateListener = handler;
        return () => { this.stateListener = undefined; };
      } } : undefined,
      ui: {
        registerDrawerTab: () => ({
          root: this.drawer,
          destroy: () => this.drawer.remove(),
          activate: () => this.activate?.(),
          onActivate: (handler: () => void) => {
            this.activate = handler;
            return () => { this.activate = undefined; };
          },
        }),
        mount: () => this.actionBar,
        registerInputBarAction: (options: { id: string; label: string }) => {
          const button = document.createElement("button");
          button.textContent = options.label;
          this.extras.set(options.id, button);
          document.body.append(button);
          return {
            setEnabled: (enabled: boolean) => { button.disabled = !enabled; },
            setLabel: (label: string) => { button.textContent = label; },
            setSubtitle: (subtitle: string) => { button.title = subtitle; },
            onClick: (handler: () => void) => {
              button.onclick = handler;
              return () => { button.onclick = null; };
            },
            destroy: () => button.remove(),
          };
        },
        createFloatWidget: () => {
          const root = document.createElement("div");
          document.body.append(root);
          this.hud = root;
          return { root, destroy: () => { root.remove(); if (this.hud === root) this.hud = undefined; } };
        },
        showModal: () => {
          const root = document.createElement("div");
          document.body.append(root);
          this.modal = root;
          let onDismiss: (() => void) | undefined;
          return {
            root,
            onDismiss: (handler: () => void) => { onDismiss = handler; return () => { onDismiss = undefined; }; },
            dismiss: () => { root.remove(); if (this.modal === root) this.modal = undefined; onDismiss?.(); },
          };
        },
        showContextMenu: () => new Promise<{ selectedKey: string | null }>((resolve) => { this.menuChoice = resolve; }),
      },
      components: {
        mountSelect: (target: HTMLElement, options: {
          value: string; options: Array<{ value: string; label: string }>; onChange: (value: string) => void;
        }) => {
          const select = document.createElement("select");
          for (const option of options.options) {
            const node = document.createElement("option");
            node.value = option.value;
            node.textContent = option.label;
            select.append(node);
          }
          select.value = options.value;
          select.onchange = () => options.onChange(select.value);
          target.append(select);
          return { destroy: () => select.remove() };
        },
        mountSwitch: (target: HTMLElement, options: { checked: boolean; onChange: (checked: boolean) => void }) => {
          const input = document.createElement("input");
          input.type = "checkbox";
          input.checked = options.checked;
          input.onchange = () => options.onChange(input.checked);
          target.append(input);
          return { destroy: () => input.remove() };
        },
      },
    } as unknown as SpindleFrontendContext;
    this.teardown = setup(ctx);
  }

  destroy(): void { this.teardown?.(); this.teardown = undefined; }

  switchTo(chatId: string | null, characterId: string | null, notifyState = true): void {
    this.selection = { chatId, characterId };
    if (notifyState) this.stateListener?.();
  }

  request(action: string): Request {
    const request = [...this.requests].reverse().find((request) => request.action === action);
    if (!request) throw new Error("No request for " + action);
    return request;
  }

  reply(request: Request, result: unknown = status(request.input.chatId as string | null), error?: string): void {
    this.answered.add(request.requestId);
    this.backendListener?.({ type: "waypoints:reply", requestId: request.requestId, result, error });
  }

  async finishRefreshes(): Promise<void> {
    for (let iteration = 0; iteration < 10; iteration += 1) {
      await flush();
      const requests = this.requests.filter((request) => request.action === "refresh" && !this.answered.has(request.requestId));
      if (!requests.length) return;
      for (const request of requests) this.reply(request);
    }
    throw new Error("Refreshes did not settle.");
  }

  button(label: string, root: HTMLElement = this.drawer): HTMLButtonElement {
    const button = [...root.querySelectorAll("button")].find((node) => node.textContent === label);
    if (!button) throw new Error("Missing button: " + label);
    return button;
  }
}

describe("frontend character switching", () => {
  test("Undo refreshes both greeting pickers to the restored selections", async () => {
    host = new FrontendHost();
    const progressed = status("chat-a");
    progressed.active = progressed.greetings[1];
    progressed.upcoming = progressed.greetings[2];
    host.reply(host.request("refresh"), progressed);
    await flush();
    const pickerValues = () => [...host!.drawer.querySelectorAll("select")].map((node) => JSON.parse(node.value).greetingIndex);
    expect(pickerValues()).toEqual([1, 2]);
    host.button("Undo").click();
    host.reply(host.request("undo"), { transition: { advanced: true, reason: "Restored the previous greetings." }, view: status("chat-a") });
    await host.finishRefreshes();
    expect(pickerValues()).toEqual([0, 1]);
    expect(host.button("Force").disabled).toBe(false);
  });

  test("switches the drawer and routes drawer, HUD, Extras, and compass actions to the new chat", async () => {
    host = new FrontendHost();
    await host.finishRefreshes();
    expect(host.drawer.textContent).toContain("Ada");
    host.switchTo("chat-b", "b", false);
    host.events.get("CHAT_SWITCHED")?.();
    expect(host.request("refresh").input.chatId).toBe("chat-b");
    await host.finishRefreshes();
    expect(host.drawer.textContent).toContain("Bryn");
    expect(host.drawer.textContent).not.toContain("Ada");

    for (const [action, click] of [
      ["set-enabled", () => host!.button("ON", host!.hud!).click()],
      ["force", () => host!.button("Force").click()],
      ["undo", () => host!.extras.get("undo-waypoints")!.click()],
    ] as const) {
      click();
      const request = host.request(action);
      expect(request.input.chatId).toBe("chat-b");
      if (action === "set-enabled") expect(request.input.characterId).toBe("b");
      host.reply(request);
      await host.finishRefreshes();
      expect(host.button("Force").disabled).toBe(false);
    }

    host.actionBar.querySelector("button")!.click();
    host.menuChoice?.({ selectedKey: "force" });
    await flush();
    expect(host.request("force").input.chatId).toBe("chat-b");
    host.reply(host.request("force"));
    await host.finishRefreshes();
  });

  test("a switch during startup loads immediately and ignores a late reply from the previous chat", async () => {
    host = new FrontendHost();
    const initial = host.request("refresh");
    host.switchTo("chat-b", "b", false);
    host.events.get("CHAT_SWITCHED")?.();
    expect(host.request("refresh").input.chatId).toBe("chat-b");
    host.reply(host.request("refresh"));
    await flush();
    expect(host.drawer.textContent).toContain("Bryn");
    host.reply(initial, status("chat-a"));
    await flush();
    expect(host.drawer.textContent).not.toContain("Ada");
    expect(host.button("Force").disabled).toBe(false);
  });

  test("an old mutation cannot hold the new chat busy or release its in-flight action", async () => {
    host = new FrontendHost();
    await host.finishRefreshes();
    host.button("Force").click();
    const oldForce = host.request("force");
    host.switchTo("chat-b", "b");
    await host.finishRefreshes();
    expect(host.button("Force").disabled).toBe(false);
    host.button("Force").click();
    const newForce = host.request("force");
    expect(newForce.input.chatId).toBe("chat-b");
    host.reply(oldForce, undefined, "Old chat failed");
    await flush();
    expect(host.button("Force").disabled).toBe(true);
    expect(host.drawer.textContent).not.toContain("Old chat failed");
    host.reply(newForce);
    await host.finishRefreshes();
    expect(host.button("Force").disabled).toBe(false);
  });

  test("queues lifecycle refreshes received during an in-flight read", async () => {
    host = new FrontendHost();
    const initial = host.request("refresh");
    host.events.get("CHAT_CHANGED")?.();
    host.backendListener?.({ type: "waypoints:changed" });
    expect(host.requests).toHaveLength(1);
    host.reply(initial);
    await flush();
    expect(host.requests).toHaveLength(2);
    const updated = status("chat-a");
    updated.status = "Latest greeting state";
    host.reply(host.request("refresh"), updated);
    await flush();
    expect(host.drawer.textContent).toContain("Latest greeting state");
    expect(host.button("Force").disabled).toBe(false);
  });

  test("follows delayed store hydration through an empty selection after the switch event", async () => {
    host = new FrontendHost();
    await host.finishRefreshes();
    host.events.get("CHAT_SWITCHED")?.(); // Server event arrives before the frontend store changes.
    const oldRefresh = host.request("refresh");
    host.switchTo(null, null);
    expect(host.request("refresh").input.chatId).toBeNull();
    host.reply(host.request("refresh"));
    await flush();
    expect(host.drawer.textContent).toContain("Open a character or group chat");
    expect(host.button("Force").disabled).toBe(true);
    host.reply(oldRefresh);
    host.switchTo("chat-b", null);
    const unhydrated = host.request("refresh");
    host.switchTo("chat-b", "b");
    host.reply(unhydrated);
    host.reply(host.request("refresh"));
    await flush();
    expect(host.drawer.textContent).toContain("Bryn");
    expect(host.drawer.textContent).not.toContain("Ada");
    expect(host.button("Force").disabled).toBe(false);
  });

  test("closes old pickers, ignores old context menus, and keeps picker-confirmed controls responsive", async () => {
    host = new FrontendHost();
    await host.finishRefreshes();
    host.extras.get("choose-next-waypoints")!.click();
    const oldModal = host.modal!;
    const staleConfirm = host.button("Use next greeting", oldModal);
    host.actionBar.querySelector("button")!.click();
    host.switchTo("chat-b", "b");
    expect(oldModal.isConnected).toBe(false);
    await host.finishRefreshes();
    const requestCount = host.requests.length;
    staleConfirm.click();
    host.menuChoice?.({ selectedKey: "force" });
    await flush();
    expect(host.requests).toHaveLength(requestCount);

    host.extras.get("choose-next-waypoints")!.click();
    expect(host.modal!.textContent).toContain("Bryn");
    host.button("Use next greeting", host.modal!).click();
    expect(host.request("set-upcoming").input).toEqual({ chatId: "chat-b", selection: { characterId: "b", greetingIndex: 1 } });
    host.reply(host.request("set-upcoming"));
    await host.finishRefreshes();
    expect(host.modal).toBeUndefined();
    expect(host.button("Force").disabled).toBe(false);
    expect(host.button("Force", host.hud!).disabled).toBe(false);
  });

  test("checks the live selection before acting even when no lifecycle notification has arrived", async () => {
    host = new FrontendHost();
    await host.finishRefreshes();
    const staleForce = host.button("Force");
    host.switchTo("chat-b", "b", false);
    staleForce.click();
    expect(host.requests.some((request) => request.action === "force")).toBe(false);
    expect(host.request("refresh").input.chatId).toBe("chat-b");
    await host.finishRefreshes();
    staleForce.click();
    expect(host.requests.some((request) => request.action === "force")).toBe(false);
  });

  test("older hosts recover without another event and stop observing on teardown", async () => {
    host = new FrontendHost(false);
    await host.finishRefreshes();
    host.events.get("CHAT_SWITCHED")?.();
    await host.finishRefreshes();
    host.switchTo("chat-b", "b");
    await Bun.sleep(550);
    expect(host.request("refresh").input.chatId).toBe("chat-b");
    await host.finishRefreshes();
    expect(host.drawer.textContent).toContain("Bryn");
    host.events.get("CHAT_CHANGED")?.();
    const reply = host.backendListener!;
    const pending = host.request("refresh");
    host.destroy();
    const reads = host.selectionReads;
    const requests = host.requests.length;
    reply({ type: "waypoints:reply", requestId: pending.requestId, result: status("chat-b") });
    await Bun.sleep(550);
    expect(host.selectionReads).toBe(reads);
    expect(host.requests).toHaveLength(requests);
    expect(host.drawer.isConnected).toBe(false);
    expect(host.hud).toBeUndefined();
    expect(host.events.size).toBe(0);
  });
});
