// Shown instead of the app when data fails to load (enforcement/data-contract.md). The message is
// set as text, never as HTML, so a file name or error text is shown exactly as written.

export const errorViewHeading = "The map data couldn't be loaded";
export const errorViewInstruction =
  "If you just added data, run the build again and check its report";

/** Replaces everything in root with the error heading, the plain message and what to do next. */
export function renderErrorView(root: HTMLElement, message: string): void {
  const errorSection = document.createElement("section");
  errorSection.className = "error-view";
  errorSection.setAttribute("role", "alert");

  const heading = document.createElement("h1");
  heading.textContent = errorViewHeading;
  const messageParagraph = document.createElement("p");
  messageParagraph.className = "error-view-message";
  messageParagraph.textContent = message;
  const instructionParagraph = document.createElement("p");
  instructionParagraph.textContent = errorViewInstruction;

  errorSection.append(heading, messageParagraph, instructionParagraph);
  root.replaceChildren(errorSection);
}
