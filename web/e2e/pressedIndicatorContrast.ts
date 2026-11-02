import type { Locator } from "@playwright/test";

// WCAG 1.4.11 (non-text contrast) for pressed and selected controls, which axe does not test:
// the ring or border that marks the control must reach 3:1 against the surface around it.

export interface RgbColor {
  readonly red: number;
  readonly green: number;
  readonly blue: number;
}

export function parseCssRgbColor(cssColor: string, description: string): RgbColor {
  const channelMatch = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(cssColor);
  if (channelMatch === null) {
    throw new Error(`${description} is "${cssColor}", which is not an rgb() colour`);
  }
  const [, red, green, blue] = channelMatch;
  return { red: Number(red), green: Number(green), blue: Number(blue) };
}

function relativeLuminance(color: RgbColor): number {
  const linearChannel = (channel: number): number => {
    const fraction = channel / 255;
    return fraction <= 0.03928 ? fraction / 12.92 : ((fraction + 0.055) / 1.055) ** 2.4;
  };
  return (
    0.2126 * linearChannel(color.red) +
    0.7152 * linearChannel(color.green) +
    0.0722 * linearChannel(color.blue)
  );
}

export function contrastRatio(firstColor: RgbColor, secondColor: RgbColor): number {
  const firstLuminance = relativeLuminance(firstColor);
  const secondLuminance = relativeLuminance(secondColor);
  const lighter = Math.max(firstLuminance, secondLuminance);
  const darker = Math.min(firstLuminance, secondLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * The contrast between a control's pressed indicator (its box-shadow ring, or its border when it
 * has no ring) and the nearest opaque background behind the control.
 */
export async function pressedIndicatorContrastRatio(control: Locator): Promise<number> {
  const { indicatorCssColor, surroundingCssColor } = await control.evaluate((element) => {
    const controlStyle = getComputedStyle(element);
    const indicatorCssColor =
      controlStyle.boxShadow === "none" ? controlStyle.borderTopColor : controlStyle.boxShadow;
    let ancestor = element.parentElement;
    while (ancestor !== null) {
      const ancestorBackground = getComputedStyle(ancestor).backgroundColor;
      if (ancestorBackground !== "rgba(0, 0, 0, 0)" && ancestorBackground !== "transparent") {
        return { indicatorCssColor, surroundingCssColor: ancestorBackground };
      }
      ancestor = ancestor.parentElement;
    }
    throw new Error("No ancestor of the pressed control has an opaque background");
  });
  return contrastRatio(
    parseCssRgbColor(indicatorCssColor, "The pressed indicator colour"),
    parseCssRgbColor(surroundingCssColor, "The surrounding background colour"),
  );
}
