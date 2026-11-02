import type { ActorTrailColor } from "../domain/actorColors";
import type { ActorTrack } from "../domain/types";

// Replay's actor list: every shown player and bot of the match, with its trail color,
// "Player" or "Bot" and a short key. Pressing one follows it; pressing the followed one again
// stops following.

export interface ActorListOptions {
  /** Called with the actor to follow, or null to stop following. */
  readonly onFollow: (actorKey: string | null) => void;
}

export interface ActorList {
  readonly element: HTMLElement;
  showState(
    tracks: readonly ActorTrack[],
    colors: ReadonlyMap<string, ActorTrailColor>,
    followedActorKey: string | null,
  ): void;
}

const shortActorKeyLength = 8;

/** The first 8 characters of an actor key (player keys are long UUIDs; bot keys are short). */
export function shortActorKey(actorKey: string): string {
  return actorKey.slice(0, shortActorKeyLength);
}

function requireTrailColor(
  colors: ReadonlyMap<string, ActorTrailColor>,
  actorKey: string,
): ActorTrailColor {
  const trailColor = colors.get(actorKey);
  if (trailColor === undefined) {
    throw new Error(`Actor "${actorKey}" has no trail color for the actor list`);
  }
  return trailColor;
}

export function createActorList(options: ActorListOptions): ActorList {
  const listElement = document.createElement("ul");
  listElement.className = "actor-list";
  listElement.setAttribute("aria-label", "Players and bots");
  let shownTracks: readonly ActorTrack[] | null = null;
  let followedKey: string | null = null;

  function createActorRow(track: ActorTrack, trailColor: ActorTrailColor): HTMLLIElement {
    const rowElement = document.createElement("li");
    const followButton = document.createElement("button");
    followButton.type = "button";
    followButton.className = "actor-button";
    followButton.dataset.actorKey = track.actorKey;
    followButton.title = track.actorKey;
    const swatch = document.createElement("span");
    swatch.className = `actor-swatch ${track.isPlayer ? "is-player" : "is-bot"}`;
    swatch.style.backgroundColor = trailColor.color;
    swatch.setAttribute("aria-hidden", "true");
    const kindElement = document.createElement("span");
    kindElement.className = "actor-kind";
    kindElement.textContent = track.isPlayer ? "Player" : "Bot";
    const keyElement = document.createElement("span");
    keyElement.className = "actor-key";
    keyElement.textContent = shortActorKey(track.actorKey);
    followButton.append(swatch, kindElement, keyElement);
    followButton.addEventListener("click", () =>
      options.onFollow(followedKey === track.actorKey ? null : track.actorKey),
    );
    rowElement.append(followButton);
    return rowElement;
  }

  return {
    element: listElement,
    showState: (tracks, colors, followedActorKey) => {
      followedKey = followedActorKey;
      if (tracks !== shownTracks) {
        listElement.replaceChildren(
          ...tracks.map((track) =>
            createActorRow(track, requireTrailColor(colors, track.actorKey)),
          ),
        );
        shownTracks = tracks;
      }
      for (const followButton of listElement.querySelectorAll<HTMLButtonElement>(".actor-button")) {
        followButton.setAttribute(
          "aria-pressed",
          String(followButton.dataset.actorKey === followedActorKey),
        );
      }
    },
  };
}
