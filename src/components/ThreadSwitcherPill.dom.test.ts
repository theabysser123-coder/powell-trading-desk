// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Action, Bot, Task } from "@/state/store";

const dispatch = vi.hoisted(() => vi.fn());
const store = vi.hoisted(() => ({ state: {} as Record<string, unknown> }));
vi.mock("@/state/store-select", () => ({ useStoreDispatch: () => dispatch, useStoreSelector: (select: (state: unknown) => unknown) => select(store.state) }));
vi.mock("./Avatar", () => ({ BotAvatar: () => null }));

import { ChatHeadPill } from "./ChatHeadPill";
import { useThreadCycleKeys } from "./thread-cycle";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const task = (threadId: string, title: string, at: number, extra: Partial<Task> = {}): Task => ({ threadId, title, createdAt: at, lastThreadOrderAt: at, ...extra });
const pepper = (tasks: Task[], threadId: string): Bot => ({ id: "pepper", name: "Pepper", threadId, mainThreadId: "sales", tasks, messages: [] } as unknown as Bot);
const THREADS = [task("sales", "Weekly sales", 5, { busy: true }), task("launch", "Launch plan", 1, { pinned: true }), task("trip", "Berlin trip", 3)];

let root: Root | null = null;
const onToggle = vi.fn();
/** Simple mode's header pill, with the app's Ctrl+Tab keys listening as they do in the app. */
function Header({ bot }: { bot: Bot }) {
  useThreadCycleKeys();
  return createElement(ChatHeadPill, { bot, avatar: {} as never, privacy: null, onToggle, switcher: true });
}
const render = (bot: Bot) => {
  store.state = { settingsOpen: false, pendingQueued: {}, bots: [bot], selectedId: bot.id, activeView: "chat", shortcutsOpen: false, newChat: null };
  if (!root) root = createRoot(document.body.appendChild(document.createElement("div")));
  act(() => root!.render(createElement(Header, { bot })));
};
const q = <T extends Element = HTMLElement>(selector: string) => document.querySelector<T & HTMLElement>(selector);
const chips = () => [...document.querySelectorAll<HTMLElement>("[role=option]")];
const sent = () => dispatch.mock.calls.map(([action]) => action as Action);

beforeEach(() => { dispatch.mockClear(); onToggle.mockClear(); });
afterEach(() => { act(() => root?.unmount()); root = null; document.body.innerHTML = ""; });

describe("the pill's thread switcher", () => {
  it("names the open thread beside the bot, and the bot's name still opens its panel", () => {
    render(pepper(THREADS, "launch"));
    expect(q("[data-chathead-conversation]")?.textContent).toBe("Launch plan");
    act(() => q("[data-chathead-pill]")!.click());
    expect(onToggle).toHaveBeenCalledOnce();
    expect(q("[role=listbox]")).toBeNull();
  });

  it("opens directly on hover and folds back when leaving, with pinned threads first and the open one selected", () => {
    vi.useFakeTimers();
    try {
      render(pepper(THREADS, "launch"));
      act(() => { q("[data-chathead-switch]")!.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })); });
      expect(chips().map((chip) => chip.textContent)).toEqual(["Launch plan", "Weekly sales", "Berlin trip"]);
      expect(chips()[0].getAttribute("aria-selected")).toBe("true");
      expect(chips()[1].querySelector('[aria-label="Working"]')).not.toBeNull();
      expect(chips()[0].querySelector('[aria-label="Pinned"]')).not.toBeNull();
      act(() => { q("[data-chathead-switch]")!.dispatchEvent(new MouseEvent("mouseout", { bubbles: true })); });
      act(() => { vi.advanceTimersByTime(220); });
      expect(q("[role=listbox]")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("switches to a picked thread and folds back", () => {
    render(pepper(THREADS, "launch"));
    act(() => q("[data-chathead-threads]")!.click());
    act(() => chips()[2].click());
    expect(sent()).toEqual([{ type: "switchTask", botId: "pepper", threadId: "trip" }]);
    expect(q("[role=listbox]")).toBeNull();
  });

  it("moves between threads with the arrow keys, and folds back on Escape", () => {
    render(pepper(THREADS, "launch"));
    act(() => q("[data-chathead-threads]")!.click());
    act(() => chips()[0].focus());
    act(() => { chips()[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })); });
    expect(document.activeElement).toBe(chips()[1]);
    act(() => { chips()[1].dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(q("[role=listbox]")).toBeNull();
    expect(sent()).toEqual([]);
  });

  it("starts a new thread from its plus", () => {
    render(pepper(THREADS, "launch"));
    act(() => q("[data-chathead-threads]")!.click());
    act(() => q("[data-thread-chip-new]")!.click());
    expect(sent()).toEqual([{ type: "newTask", botId: "pepper" }]);
  });

  it("shows for a bot whose second open thread another bot opened, beside its main thread", () => {
    const lead = { botId: "lead", name: "Lead", at: 1 };
    render(pepper([task("sales", "Weekly sales", 5), task("brief", "Launch brief", 3, { openedBy: lead })], "sales"));
    act(() => q("[data-chathead-threads]")!.click());
    expect(chips().map((chip) => chip.textContent)).toEqual(["Weekly sales", "Launch brief"]);
  });

  it("Ctrl+Tab walks the threads in the order the pill lists them, wrapping", () => {
    const helper = task("brief", "Launch brief", 4, { openedBy: { botId: "lead", name: "Lead", at: 1 } });
    const threads = [...THREADS, helper];
    render(pepper(threads, "launch"));
    act(() => q("[data-chathead-threads]")!.click());
    const order = chips().map((chip) => chip.dataset.threadChip!);
    expect(order).toEqual(["launch", "sales", "brief", "trip"]);
    const visited: string[] = [];
    let open = order[0]!;
    for (let step = 0; step < order.length; step += 1) {
      act(() => { document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", ctrlKey: true, bubbles: true, cancelable: true })); });
      const action = sent().at(-1) as Extract<Action, { type: "switchTask" }>;
      open = action.threadId;
      visited.push(open);
      render(pepper(threads, open));
    }
    expect(visited).toEqual([...order.slice(1), order[0]]);
  });

  it("stays the plain pill for a bot with one thread", () => {
    render(pepper([task("sales", "Weekly sales", 5)], "sales"));
    expect(q("[data-chathead-threads]")).toBeNull();
    expect(q("[data-chathead-switch]")).toBeNull();
    expect(q("[data-chathead-pill]")).not.toBeNull();
  });

  it("deletes an idle chat with a 2-click inline confirm and hides delete on busy threads", () => {
    render(pepper(THREADS, "launch"));
    act(() => q("[data-chathead-threads]")!.click());
    expect(q("[data-thread-chip-delete='sales']"), "working thread cannot be deleted").toBeNull();
    const del = q("[data-thread-chip-delete='trip']")!;
    expect(del).not.toBeNull();
    act(() => del.click());
    expect(del.getAttribute("data-armed")).toBe("true");
    expect(sent()).toEqual([]);
    act(() => del.click());
    expect(sent()).toEqual([{ type: "deleteTask", botId: "pepper", threadId: "trip" }]);
  });
});
