import type { HeatmapKind } from "../domain/heatmap";
import { busiestZoneScaleBarStartPercent, heatRampCssGradient } from "../render/heatRamp";
import { createHeatmapScale, heatmapChoices, type HeatmapScale } from "./heatmapChoices";

// Overview's "Heatmap" radio group: one radio per choice, each with its description, and the
// colour scale under them. Only the chosen heatmap's description is on screen, which keeps the
// panel short; every radio keeps its description as its accessible description, hidden or not.

export interface HeatmapChoiceFieldset {
  readonly element: HTMLFieldSetElement;
  /** The colour scale under the choices; the panel sets it from each model. */
  readonly scale: HeatmapScale;
  /** Checks the chosen heatmap's radio and shows only its description. */
  showChoice(heatmapKind: HeatmapKind | null): void;
}

export function createHeatmapChoiceFieldset(
  onChoose: (heatmapKind: HeatmapKind | null) => void,
): HeatmapChoiceFieldset {
  const fieldsetElement = document.createElement("fieldset");
  fieldsetElement.className = "heatmap-choice";
  const legendElement = document.createElement("legend");
  legendElement.textContent = "Heatmap";
  fieldsetElement.append(legendElement);
  const choiceElements: {
    readonly heatmapKind: HeatmapKind | null;
    readonly input: HTMLInputElement;
    readonly description: HTMLParagraphElement | null;
  }[] = [];
  for (const choice of heatmapChoices) {
    const choiceLabel = document.createElement("label");
    choiceLabel.className = "checkbox-row";
    const choiceInput = document.createElement("input");
    choiceInput.type = "radio";
    choiceInput.name = "overview-heatmap";
    choiceInput.value = choice.heatmapKind === null ? "off" : choice.heatmapKind;
    choiceInput.addEventListener("change", () => onChoose(choice.heatmapKind));
    choiceLabel.append(choiceInput, document.createTextNode(choice.label));
    fieldsetElement.append(choiceLabel);
    let description: HTMLParagraphElement | null = null;
    if (choice.description !== "") {
      description = document.createElement("p");
      description.id = `heatmap-description-${choice.heatmapKind}`;
      description.className = "heatmap-description";
      description.textContent = choice.description;
      // aria-describedby still reads a description that is hidden from view.
      choiceInput.setAttribute("aria-describedby", description.id);
      fieldsetElement.append(description);
    }
    choiceElements.push({ heatmapKind: choice.heatmapKind, input: choiceInput, description });
  }
  const scale = createHeatmapScale(heatRampCssGradient(), busiestZoneScaleBarStartPercent());
  fieldsetElement.append(scale.element);
  return {
    element: fieldsetElement,
    scale,
    showChoice: (chosenHeatmapKind) => {
      for (const { heatmapKind, input, description } of choiceElements) {
        const isChosen = heatmapKind === chosenHeatmapKind;
        input.checked = isChosen;
        if (description !== null) {
          description.hidden = !isChosen;
        }
      }
    },
  };
}
