import { page } from "@vitest/browser/context";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DataLoader } from "../data/loader";
import { startAppWithLoader } from "./app";
import { replayManifest, requireReplayDayFile } from "./replayTestFixtures";

// Runs in headless Chromium: on a phone, a tap anywhere outside the open bottom sheet closes it
// (user decision 2026-11-03), as such panels usually do. A pan or drag is not a tap and leaves it
// open, and a tap inside it never closes it. On desktop the panel is beside the map and stays.

const replayLoader: DataLoader = {
  loadManifest: () => Promise.resolve(replayManifest),
  loadDayFile: (dayFile) => Promise.resolve(requireReplayDayFile(dayFile)),
};

const mountedRoots: HTMLElement[] = [];

afterEach(async () => {
  for (const root of mountedRoots.splice(0)) {
    root.remove();
  }
  await page.viewport(1280, 800);
});

function requireElement<Found extends Element>(root: ParentNode, selector: string): Found {
  const element = root.querySelector<Found>(selector);
  if (element === null) {
    throw new Error(`Nothing in the app matches "${selector}"`);
  }
  return element;
}

async function startAt(widthPixels: number, heightPixels: number): Promise<HTMLElement> {
  await page.viewport(widthPixels, heightPixels);
  const root = document.createElement("div");
  root.style.height = `${heightPixels}px`;
  document.body.appendChild(root);
  mountedRoots.push(root);
  await startAppWithLoader(root, replayLoader);
  await vi.waitFor(() =>
    expect(requireElement<HTMLElement>(root, ".overview-status").hidden).toBe(true),
  );
  return root;
}

function sheetHandle(root: HTMLElement): HTMLButtonElement {
  return requireElement<HTMLButtonElement>(root, ".bottom-sheet-handle");
}

async function startPhoneWithSheetOpen(): Promise<HTMLElement> {
  const root = await startAt(390, 844);
  sheetHandle(root).click();
  expect(sheetHandle(root).getAttribute("aria-expanded")).toBe("true");
  return root;
}

/** Presses on target and releases movedPixels to the right, as a touch. */
function pressAndRelease(target: Element, movedPixels: number): void {
  const box = target.getBoundingClientRect();
  const clientX = box.left + 10;
  const clientY = box.top + 10;
  const pointerInit = { bubbles: true, cancelable: true, pointerId: 11, isPrimary: true };
  const touchInit = { ...pointerInit, pointerType: "touch", clientY };
  target.dispatchEvent(new PointerEvent("pointerdown", { ...touchInit, clientX }));
  target.dispatchEvent(
    new PointerEvent("pointermove", { ...touchInit, clientX: clientX + movedPixels }),
  );
  target.dispatchEvent(
    new PointerEvent("pointerup", { ...touchInit, clientX: clientX + movedPixels }),
  );
}

describe("a tap outside the open phone sheet", () => {
  it("closes it from the map", async () => {
    const root = await startPhoneWithSheetOpen();
    pressAndRelease(requireElement(root, ".map-container"), 0);
    expect(sheetHandle(root).getAttribute("aria-expanded")).toBe("false");
  });

  it("closes it from the top bar", async () => {
    const root = await startPhoneWithSheetOpen();
    pressAndRelease(requireElement(root, ".top-bar-title"), 0);
    expect(sheetHandle(root).getAttribute("aria-expanded")).toBe("false");
  });

  it("does not close it when the press moves (a pan)", async () => {
    const root = await startPhoneWithSheetOpen();
    pressAndRelease(requireElement(root, ".map-container"), 40);
    expect(sheetHandle(root).getAttribute("aria-expanded")).toBe("true");
  });

  it("does not close it when the tap is inside the sheet", async () => {
    const root = await startPhoneWithSheetOpen();
    pressAndRelease(requireElement(root, ".bottom-sheet-content"), 0);
    expect(sheetHandle(root).getAttribute("aria-expanded")).toBe("true");
  });

  it("leaves the closed sheet closed", async () => {
    const root = await startAt(390, 844);
    pressAndRelease(requireElement(root, ".map-container"), 0);
    expect(sheetHandle(root).getAttribute("aria-expanded")).toBe("false");
  });

  it("changes nothing on desktop, where the panel is beside the map", async () => {
    const root = await startAt(1280, 800);
    const sheet = requireElement<HTMLElement>(root, ".bottom-sheet");
    sheetHandle(root).click(); // hidden on desktop, but it sets the open state a reveal would
    pressAndRelease(requireElement(root, ".map-container"), 0);
    expect(sheet.dataset.expanded).toBe("true");
  });
});
