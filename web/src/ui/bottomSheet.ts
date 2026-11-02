// The panel area. On desktop it is a side panel and the handle is hidden (layout.css). On a phone
// (≤ 720 px) it is a bottom sheet over the map, collapsed or expanded by the handle button.
// The sheet only opens or closes on the designer's own action: the handle, or a panel's collapse
// and reveal calls, which run on a press of Select area, the end of an area drag or a marker tap.

export interface BottomSheet {
  readonly element: HTMLElement;
  /** Where the active mode puts its panels (legend, layer switches, inspector). */
  readonly contentElement: HTMLElement;
  /** Closes the phone sheet, so the whole map is free. On desktop nothing visible changes. */
  collapse(): void;
  /**
   * Opens the phone sheet and scrolls its content, without animation, so targetElement's top is at
   * the top of the panel area. On desktop it only scrolls the side panel.
   */
  reveal(targetElement: HTMLElement): void;
  /** Called each time the open sheet closes, whether by the handle or by collapse. */
  onCollapse(callback: () => void): void;
}

const collapsedHandleLabel = "Show panels";
const expandedHandleLabel = "Hide panels";

export function createBottomSheet(): BottomSheet {
  const sheetElement = document.createElement("aside");
  sheetElement.className = "bottom-sheet";
  sheetElement.setAttribute("aria-label", "Map panels");

  const contentElement = document.createElement("div");
  contentElement.className = "bottom-sheet-content";
  contentElement.id = "bottom-sheet-content";

  const handleButton = document.createElement("button");
  handleButton.type = "button";
  handleButton.className = "bottom-sheet-handle";
  handleButton.setAttribute("aria-controls", contentElement.id);

  const collapseCallbacks: (() => void)[] = [];
  let isSheetExpanded = false;
  function showExpandedState(isExpanded: boolean): void {
    const isClosing = isSheetExpanded && !isExpanded;
    isSheetExpanded = isExpanded;
    handleButton.setAttribute("aria-expanded", String(isSheetExpanded));
    handleButton.textContent = isSheetExpanded ? expandedHandleLabel : collapsedHandleLabel;
    sheetElement.dataset.expanded = String(isSheetExpanded);
    if (isClosing) {
      for (const callback of collapseCallbacks) {
        callback();
      }
    }
  }
  handleButton.addEventListener("click", () => showExpandedState(!isSheetExpanded));
  showExpandedState(false);

  sheetElement.append(handleButton, contentElement);
  return {
    element: sheetElement,
    contentElement,
    collapse: () => showExpandedState(false),
    reveal: (targetElement) => {
      if (!contentElement.contains(targetElement)) {
        throw new Error("The bottom sheet was asked to reveal an element that is not inside it");
      }
      showExpandedState(true);
      // Measured after opening: a closed sheet's content has no layout to scroll.
      const contentPaddingTopPixels = Number.parseFloat(
        getComputedStyle(contentElement).paddingTop,
      );
      contentElement.scrollTop +=
        targetElement.getBoundingClientRect().top -
        contentElement.getBoundingClientRect().top -
        contentPaddingTopPixels;
    },
    onCollapse: (callback) => {
      collapseCallbacks.push(callback);
    },
  };
}
