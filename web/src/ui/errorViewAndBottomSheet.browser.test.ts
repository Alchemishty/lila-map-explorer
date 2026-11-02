import { afterEach, describe, expect, it } from "vitest";
import { createBottomSheet } from "./bottomSheet";
// The app's styles, so the side panel has its real padding and scrolls its content.
import "./theme.css";
import "./layout.css";
import { errorViewHeading, errorViewInstruction, renderErrorView } from "./errorView";

// Runs in headless Chromium (vitest.workspace.ts "browser" project): these build real DOM.

const mountedRoots: HTMLElement[] = [];

function mountRoot(): HTMLElement {
  const root = document.createElement("div");
  document.body.appendChild(root);
  mountedRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of mountedRoots.splice(0)) {
    root.remove();
  }
});

function requireElement<Found extends Element>(root: HTMLElement, selector: string): Found {
  const element = root.querySelector<Found>(selector);
  if (element === null) {
    throw new Error(`Nothing in the test root matches "${selector}"`);
  }
  return element;
}

describe("renderErrorView", () => {
  it("shows the heading, the message as plain text and the instruction", () => {
    const root = mountRoot();
    renderErrorView(root, "manifest.json: <b>bad</b> schemaVersion");
    expect(requireElement(root, "h1").textContent).toBe(errorViewHeading);
    expect(requireElement(root, ".error-view-message").textContent).toBe(
      "manifest.json: <b>bad</b> schemaVersion",
    );
    expect(root.querySelector("b")).toBeNull();
    expect(root.textContent).toContain(errorViewInstruction);
    expect(requireElement(root, "[role=alert]")).toBeTruthy();
  });
});

describe("createBottomSheet", () => {
  it("toggles aria-expanded and the label from the handle button", () => {
    const root = mountRoot();
    const bottomSheet = createBottomSheet();
    root.append(bottomSheet.element);
    const handleButton = requireElement<HTMLButtonElement>(root, ".bottom-sheet-handle");
    expect(handleButton.getAttribute("aria-expanded")).toBe("false");
    expect(handleButton.textContent).toBe("Show panels");
    handleButton.click();
    expect(handleButton.getAttribute("aria-expanded")).toBe("true");
    expect(handleButton.textContent).toBe("Hide panels");
    expect(bottomSheet.element.dataset.expanded).toBe("true");
  });

  it("closes on collapse and opens on reveal, reporting each close of an open sheet", () => {
    const root = mountRoot();
    const bottomSheet = createBottomSheet();
    root.append(bottomSheet.element);
    const targetElement = document.createElement("p");
    bottomSheet.contentElement.append(targetElement);
    let collapseCount = 0;
    bottomSheet.onCollapse(() => {
      collapseCount += 1;
    });
    bottomSheet.collapse(); // already closed: nothing to report
    expect(collapseCount).toBe(0);
    bottomSheet.reveal(targetElement);
    expect(bottomSheet.element.dataset.expanded).toBe("true");
    expect(requireElement(root, ".bottom-sheet-handle").textContent).toBe("Hide panels");
    expect(collapseCount).toBe(0);
    bottomSheet.collapse();
    expect(bottomSheet.element.dataset.expanded).toBe("false");
    expect(collapseCount).toBe(1);
    bottomSheet.reveal(targetElement);
    requireElement<HTMLButtonElement>(root, ".bottom-sheet-handle").click(); // closed by hand
    expect(collapseCount).toBe(2);
  });

  it("scrolls its content so the revealed element's top is at the top of the panel area", () => {
    const root = mountRoot();
    root.style.height = "300px";
    root.style.display = "flex";
    const bottomSheet = createBottomSheet();
    root.append(bottomSheet.element);
    const fillerElement = document.createElement("div");
    fillerElement.style.height = "1000px";
    const targetElement = document.createElement("p");
    targetElement.style.margin = "0";
    // Room after the target too, so the content can scroll far enough to put it at the top.
    bottomSheet.contentElement.append(fillerElement, targetElement, fillerElement.cloneNode());
    bottomSheet.reveal(targetElement);
    const contentBox = bottomSheet.contentElement.getBoundingClientRect();
    const paddingTopPixels = Number.parseFloat(
      getComputedStyle(bottomSheet.contentElement).paddingTop,
    );
    expect(targetElement.getBoundingClientRect().top).toBeCloseTo(
      contentBox.top + paddingTopPixels,
      0,
    );
  });

  it("throws when asked to reveal an element that is not inside it", () => {
    const bottomSheet = createBottomSheet();
    expect(() => bottomSheet.reveal(document.createElement("p"))).toThrow("not inside it");
  });
});
