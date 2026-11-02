import { parseDayFile, parseManifest } from "../domain/contract";
import type { DayFile, Manifest } from "../domain/types";

// The only place the app fetches data. Each payload is validated once here with zod (via the
// domain parsers); ui catches a rejection and shows the error view (enforcement/data-contract.md).

/** Fetches one URL and resolves with its parsed JSON body. */
export type FetchJson = (url: string) => Promise<unknown>;

export interface DataLoader {
  loadManifest(): Promise<Manifest>;
  /** dayFile is relative to the data base URL, as written in MatchSummary.dayFile. */
  loadDayFile(dayFile: string): Promise<DayFile>;
}

/** The browser FetchJson: a non-OK response or a body that is not JSON rejects naming the URL. */
export async function fetchJsonOverHttp(url: string): Promise<unknown> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Could not load ${url}: HTTP ${response.status}`);
  }
  const bodyText = await response.text();
  try {
    return JSON.parse(bodyText);
  } catch (error) {
    throw new Error(`${url} is not valid JSON (${describeError(error)})`, { cause: error });
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The same error if its message already names the URL, otherwise a new one that names it. */
function errorNamingUrl(error: unknown, url: string): Error {
  if (error instanceof Error && error.message.includes(url)) {
    return error;
  }
  return new Error(`Could not load ${url}: ${describeError(error)}`, { cause: error });
}

/**
 * Loads data files once each: calls for a path already loaded or still loading share one promise.
 * A failed load is forgotten, so a later call (a retry) fetches again.
 */
export function createDataLoader(dataBaseUrl: string, fetchJson: FetchJson): DataLoader {
  if (!dataBaseUrl.endsWith("/")) {
    throw new Error(
      `The data base URL "${dataBaseUrl}" must end with "/" so file paths can be appended to it`,
    );
  }
  const manifestLoadingsByUrl = new Map<string, Promise<Manifest>>();
  const dayFileLoadingsByUrl = new Map<string, Promise<DayFile>>();

  function loadOnce<Parsed>(
    loadingsByUrl: Map<string, Promise<Parsed>>,
    url: string,
    parsePayload: (json: unknown) => Parsed,
  ): Promise<Parsed> {
    const existingLoading = loadingsByUrl.get(url);
    if (existingLoading !== undefined) {
      return existingLoading;
    }
    const loading = fetchJson(url).then(
      (json) => {
        try {
          return parsePayload(json);
        } catch (error) {
          throw errorNamingUrl(error, url);
        }
      },
      (error: unknown) => {
        throw errorNamingUrl(error, url);
      },
    );
    loadingsByUrl.set(url, loading);
    loading.catch(() => {
      // The rejection itself still reaches every caller; this only drops the failed cache entry.
      if (loadingsByUrl.get(url) === loading) {
        loadingsByUrl.delete(url);
      }
    });
    return loading;
  }

  return {
    loadManifest: () => {
      const manifestUrl = `${dataBaseUrl}manifest.json`;
      return loadOnce(manifestLoadingsByUrl, manifestUrl, (json) =>
        parseManifest(json, dataBaseUrl),
      );
    },
    loadDayFile: (dayFile) =>
      loadOnce(dayFileLoadingsByUrl, dataBaseUrl + dayFile, (json) => parseDayFile(json)),
  };
}
