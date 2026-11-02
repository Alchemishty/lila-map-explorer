import { expect, test, type Page } from "@playwright/test";

// The built app at desktop (a mouse) and phone (WebKit, a touch screen with no hover) sizes: the
// shorter side panel keeps every control reachable and described.

async function openPanels(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.locator(".map-container img.leaflet-image-layer")).toBeVisible();
  const showPanelsButton = page.getByRole("button", { name: "Show panels" });
  if (await showPanelsButton.isVisible()) {
    await showPanelsButton.click();
  }
}

test("each heatmap radio keeps its description, though only the chosen one is shown", async ({
  page,
}) => {
  await openPanels(page);
  const descriptionsByLabel = {
    "Kill zones": "Where players stood when they made a kill",
    "Combat death zones": "Where players were killed by a player or a bot",
    "Storm death zones": "Where players died to the storm",
    Traffic: "Where players spent the most time",
  };
  for (const [label, description] of Object.entries(descriptionsByLabel)) {
    await expect(page.getByRole("radio", { name: label, exact: true })).toHaveAccessibleDescription(
      description,
    );
  }
  await expect(page.getByText(descriptionsByLabel["Kill zones"])).toBeVisible();
  await expect(page.getByText(descriptionsByLabel["Combat death zones"])).toBeHidden();
});

test("Only buttons: with a mouse they show on row hover, on a touch screen always", async ({
  page,
  isMobile,
}) => {
  await openPanels(page);
  const lootRow = page.locator('.overview-panel .legend-entry[data-marker-key="loot"]');
  const lootOnlyButton = lootRow.getByRole("button", { name: "Show only Player looted" });
  if (isMobile) {
    await expect(lootOnlyButton).toHaveCSS("opacity", "1");
    await lootOnlyButton.tap();
  } else {
    await expect(lootOnlyButton).toHaveCSS("opacity", "0");
    await lootRow.hover();
    await expect(lootOnlyButton).toHaveCSS("opacity", "1");
    await lootOnlyButton.click();
  }
  await expect(lootRow.getByRole("checkbox")).toBeChecked();
  await expect(
    page.locator('.overview-panel .legend-entry[data-marker-key="kill_bot"] input'),
  ).not.toBeChecked();
});
