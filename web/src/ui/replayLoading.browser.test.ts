import { afterEach, describe, expect, it, vi } from "vitest";
import type { DataLoader } from "../data/loader";
import type { DayFile } from "../domain/types";
import { startAppWithLoader } from "./app";
import { errorViewHeading } from "./errorView";
import { replayLoadingMessage } from "./replayPanel";
import { replayManifest, requireReplayDayFile } from "./replayTestFixtures";

// Runs in headless Chromium (vitest.workspace.ts "browser" project): how the Replay panel loads a
// match's day file. A load for a match the user has left is ignored; a failed load shows the
// error view.

interface PendingDayFile {
  readonly dayFile: string;
  resolve(): void;
  reject(error: Error): void;
}

/**
 * A loader whose day files load (or fail) only when the test says so. Like the real loader, every
 * call for one path shares one load (the Overview panel asks for the same files at startup).
 */
function createControlledLoader(): { loader: DataLoader; pendingDayFiles: PendingDayFile[] } {
  const pendingDayFiles: PendingDayFile[] = [];
  const loadingsByDayFile = new Map<string, Promise<DayFile>>();
  const loader: DataLoader = {
    loadManifest: () => Promise.resolve(replayManifest),
    loadDayFile: (dayFile) => {
      const existingLoading = loadingsByDayFile.get(dayFile);
      if (existingLoading !== undefined) {
        return existingLoading;
      }
      const loading = new Promise<DayFile>((resolve, reject) => {
        pendingDayFiles.push({
          dayFile,
          resolve: () => resolve(requireReplayDayFile(dayFile)),
          reject,
        });
      });
      loadingsByDayFile.set(dayFile, loading);
      return loading;
    },
  };
  return { loader, pendingDayFiles };
}

const mountedRoots: HTMLElement[] = [];

afterEach(() => {
  for (const root of mountedRoots.splice(0)) {
    root.remove();
  }
});

function requireElement<Found extends Element>(root: ParentNode, selector: string): Found {
  const element = root.querySelector<Found>(selector);
  if (element === null) {
    throw new Error(`Nothing in the app matches "${selector}"`);
  }
  return element;
}

/** Starts the app and enters Replay; the multiplayer match's day file is then loading. */
async function startReplayLoading(loader: DataLoader): Promise<HTMLElement> {
  const root = document.createElement("div");
  root.style.height = "700px";
  document.body.appendChild(root);
  mountedRoots.push(root);
  await startAppWithLoader(root, loader);
  requireElement<HTMLButtonElement>(root, ".mode-switch button:last-child").click();
  return root;
}

function requirePendingDayFile(
  pendingDayFiles: readonly PendingDayFile[],
  dayFile: string,
): PendingDayFile {
  const pendingDayFile = pendingDayFiles.find((pending) => pending.dayFile === dayFile);
  if (pendingDayFile === undefined) {
    throw new Error(`No load of "${dayFile}" was started`);
  }
  return pendingDayFile;
}

function actorKeysListed(root: HTMLElement): (string | undefined)[] {
  return [...root.querySelectorAll<HTMLElement>(".actor-button")].map(
    (actorButton) => actorButton.dataset.actorKey,
  );
}

/** Lets every settled promise's callbacks run. */
function flushPromiseCallbacks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("Replay day-file loading", () => {
  it("ignores the old match's day file when it lands after a switch to another day's match", async () => {
    const { loader, pendingDayFiles } = createControlledLoader();
    const root = await startReplayLoading(loader);
    expect(requireElement(root, ".replay-status").textContent).toBe(replayLoadingMessage);
    expect(requireElement<HTMLButtonElement>(root, ".timeline-play-button").disabled).toBe(true);

    const replaySelect = requireElement<HTMLSelectElement>(root, ".replay-match-field select");
    replaySelect.value = "next-day";
    replaySelect.dispatchEvent(new Event("change", { bubbles: true }));
    requirePendingDayFile(pendingDayFiles, "days/Lockdown/2026-02-13.json").resolve();
    await vi.waitFor(() => expect(actorKeysListed(root)).toEqual(["player-e"]));

    requirePendingDayFile(pendingDayFiles, "days/Lockdown/2026-02-12.json").resolve();
    await flushPromiseCallbacks();
    expect(actorKeysListed(root)).toEqual(["player-e"]);
    expect(requireElement(root, ".timeline-clock").textContent).toBe("0:00 / 1:00");
    expect(requireElement<HTMLElement>(root, ".replay-status").hidden).toBe(true);
  });

  it("shows the error view, with the loader's message, when Replay's own day-file load fails", async () => {
    // The Overview's startup call for each path never settles, so only Replay's own call (the
    // second for its path) can fail and show the error view.
    const callCountsByDayFile = new Map<string, number>();
    const loader: DataLoader = {
      loadManifest: () => Promise.resolve(replayManifest),
      loadDayFile: (dayFile) => {
        const previousCallCount = callCountsByDayFile.get(dayFile);
        // A path not asked for yet has had no calls.
        const callCount = previousCallCount === undefined ? 1 : previousCallCount + 1;
        callCountsByDayFile.set(dayFile, callCount);
        return callCount === 1
          ? new Promise<DayFile>(() => {})
          : Promise.reject(new Error(`Could not load data/${dayFile}: HTTP 404`));
      },
    };
    const root = await startReplayLoading(loader);
    await vi.waitFor(() => expect(requireElement(root, "h1").textContent).toBe(errorViewHeading));
    expect(root.textContent).toContain(
      "Could not load data/days/Lockdown/2026-02-12.json: HTTP 404",
    );
    expect(callCountsByDayFile.get("days/Lockdown/2026-02-12.json")).toBe(2);
  });
});
