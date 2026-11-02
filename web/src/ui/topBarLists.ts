// The top bar's dropdowns and their checkbox lists: the Dates list, and the matches list grouped
// under a heading for each UTC start day. Lists are updated in place when they are the same, so
// focus and scroll are kept.

export interface CheckboxItem {
  readonly value: string;
  readonly labelText: string;
  readonly isChecked: boolean;
}

/** A day heading and the checkboxes under it. */
export interface CheckboxGroup {
  readonly headingText: string;
  readonly items: readonly CheckboxItem[];
}

let nextHeadingNumber = 1;

function createCheckboxRow(item: CheckboxItem): HTMLLabelElement {
  const itemLabel = document.createElement("label");
  itemLabel.className = "checkbox-row";
  const itemInput = document.createElement("input");
  itemInput.type = "checkbox";
  itemInput.value = item.value;
  itemLabel.append(itemInput, document.createTextNode(item.labelText));
  return itemLabel;
}

function setCheckedStates(listElement: HTMLElement, items: readonly CheckboxItem[]): void {
  listElement.querySelectorAll<HTMLInputElement>("input").forEach((input, i) => {
    const item = items[i];
    if (item === undefined) {
      throw new Error(`The checkbox list has no item for checkbox ${i + 1}`);
    }
    input.checked = item.isChecked;
  });
}

function hasSameValues(listElement: HTMLElement, items: readonly CheckboxItem[]): boolean {
  const existingInputs = [...listElement.querySelectorAll<HTMLInputElement>("input")];
  return (
    existingInputs.length === items.length &&
    existingInputs.every((input, i) => input.value === items[i]?.value)
  );
}

export function syncCheckboxList(listElement: HTMLElement, items: readonly CheckboxItem[]): void {
  if (!hasSameValues(listElement, items)) {
    listElement.replaceChildren(...items.map(createCheckboxRow));
  }
  setCheckedStates(listElement, items);
}

/**
 * Each group is a role="group" named by its visible heading, so a screen reader hears the day as
 * it enters the group.
 */
export function syncGroupedCheckboxList(
  listElement: HTMLElement,
  groups: readonly CheckboxGroup[],
): void {
  const items = groups.flatMap((group) => group.items);
  const existingHeadingTexts = [...listElement.querySelectorAll(".list-day-heading")].map(
    (headingElement) => headingElement.textContent,
  );
  const isSameList =
    hasSameValues(listElement, items) &&
    existingHeadingTexts.length === groups.length &&
    existingHeadingTexts.every((headingText, i) => headingText === groups[i]?.headingText);
  if (!isSameList) {
    listElement.replaceChildren(
      ...groups.map((group) => {
        const groupElement = document.createElement("div");
        groupElement.className = "list-day-group";
        groupElement.setAttribute("role", "group");
        const headingElement = document.createElement("div");
        headingElement.className = "list-day-heading";
        headingElement.id = `list-day-heading-${nextHeadingNumber}`;
        nextHeadingNumber += 1;
        headingElement.textContent = group.headingText;
        groupElement.setAttribute("aria-labelledby", headingElement.id);
        groupElement.append(headingElement, ...group.items.map(createCheckboxRow));
        return groupElement;
      }),
    );
  }
  setCheckedStates(listElement, items);
}

export function createDropdown(className: string): {
  dropdown: HTMLDetailsElement;
  summary: HTMLElement;
  listElement: HTMLElement;
} {
  const dropdown = document.createElement("details");
  dropdown.className = `filter-dropdown ${className}`;
  const summary = document.createElement("summary");
  const listElement = document.createElement("div");
  listElement.className = "filter-dropdown-list";
  dropdown.append(summary, listElement);
  return { dropdown, summary, listElement };
}

/**
 * Makes the dropdowns close the way a designer expects: a press outside the open one closes it,
 * Escape closes it and gives focus back to its summary, and opening one closes the others.
 */
export function closeDropdownsLikeMenus(dropdowns: readonly HTMLDetailsElement[]): void {
  for (const dropdown of dropdowns) {
    dropdown.addEventListener("toggle", () => {
      if (!dropdown.open) {
        return; // valid path: only an opening closes the others
      }
      for (const otherDropdown of dropdowns) {
        if (otherDropdown !== dropdown) {
          otherDropdown.open = false;
        }
      }
    });
  }
  document.addEventListener("pointerdown", (event) => {
    const pressedNode = event.target;
    for (const dropdown of dropdowns) {
      if (dropdown.open && !(pressedNode instanceof Node && dropdown.contains(pressedNode))) {
        dropdown.open = false;
      }
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") {
      return; // valid path: other keys belong to the focused control
    }
    for (const dropdown of dropdowns) {
      if (dropdown.open) {
        dropdown.open = false;
        const summary = dropdown.querySelector("summary");
        if (summary === null) {
          throw new Error(`The dropdown "${dropdown.className}" has no summary to focus`);
        }
        summary.focus();
      }
    }
  });
}
