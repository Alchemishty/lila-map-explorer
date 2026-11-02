import { afterEach, describe, expect, it, vi } from "vitest";
import { buildDayFileJson, buildManifestJson } from "../domain/contractTestFixtures";
import { createDataLoader, fetchJsonOverHttp } from "./loader";

const dataBaseUrl = "./data/";
const dayFilePath = "days/GrandRift/2026-02-10.json";

function createRecordingFetch(payloadByUrl: Readonly<Record<string, unknown>>) {
  const requestedUrls: string[] = [];
  const fetchJson = async (url: string): Promise<unknown> => {
    requestedUrls.push(url);
    if (!Object.hasOwn(payloadByUrl, url)) {
      throw new Error(`HTTP 404 for ${url}`);
    }
    return payloadByUrl[url];
  };
  return { requestedUrls, fetchJson };
}

describe("createDataLoader", () => {
  it("loads and parses manifest.json from the data base URL", async () => {
    const { requestedUrls, fetchJson } = createRecordingFetch({
      "./data/manifest.json": buildManifestJson(),
    });
    const manifest = await createDataLoader(dataBaseUrl, fetchJson).loadManifest();
    expect(requestedUrls).toEqual(["./data/manifest.json"]);
    expect(manifest.maps[0]?.imageUrl).toBe("./data/minimaps/GrandRift.jpg");
  });

  it("rejects with a message naming the URL when the file is missing (404)", async () => {
    const { fetchJson } = createRecordingFetch({});
    const loader = createDataLoader(dataBaseUrl, fetchJson);
    await expect(loader.loadDayFile(dayFilePath)).rejects.toThrow(
      "./data/days/GrandRift/2026-02-10.json",
    );
    await expect(loader.loadManifest()).rejects.toThrow("./data/manifest.json");
  });

  it("rejects with a message naming the URL when the day file breaks the contract", async () => {
    const { fetchJson } = createRecordingFetch({
      "./data/days/GrandRift/2026-02-10.json": { ...buildDayFileJson(), schemaVersion: 2 },
    });
    const loading = createDataLoader(dataBaseUrl, fetchJson).loadDayFile(dayFilePath);
    await expect(loading).rejects.toThrow(
      /\.\/data\/days\/GrandRift\/2026-02-10\.json.*schemaVersion/s,
    );
  });

  it("makes one fetch for two calls with the same path, in flight and after", async () => {
    const { requestedUrls, fetchJson } = createRecordingFetch({
      "./data/days/GrandRift/2026-02-10.json": buildDayFileJson(),
    });
    const loader = createDataLoader(dataBaseUrl, fetchJson);
    const firstLoading = loader.loadDayFile(dayFilePath);
    const secondLoading = loader.loadDayFile(dayFilePath);
    expect(secondLoading).toBe(firstLoading);
    const firstDayFile = await firstLoading;
    expect(await loader.loadDayFile(dayFilePath)).toBe(firstDayFile);
    expect(requestedUrls).toEqual(["./data/days/GrandRift/2026-02-10.json"]);
  });

  it("forgets a failed load so a later call fetches again", async () => {
    const payloadByUrl: Record<string, unknown> = {};
    const { requestedUrls, fetchJson } = createRecordingFetch(payloadByUrl);
    const loader = createDataLoader(dataBaseUrl, fetchJson);
    await expect(loader.loadManifest()).rejects.toThrow("./data/manifest.json");
    payloadByUrl["./data/manifest.json"] = buildManifestJson();
    const manifest = await loader.loadManifest();
    expect(manifest.schemaVersion).toBe(1);
    expect(requestedUrls).toEqual(["./data/manifest.json", "./data/manifest.json"]);
  });

  it("refuses a data base URL that does not end with a slash", () => {
    const { fetchJson } = createRecordingFetch({});
    expect(() => createDataLoader("./data", fetchJson)).toThrow('must end with "/"');
  });
});

describe("fetchJsonOverHttp", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects naming the URL and status on a non-OK response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("not found", { status: 404 })),
    );
    await expect(fetchJsonOverHttp("./data/manifest.json")).rejects.toThrow(
      "Could not load ./data/manifest.json: HTTP 404",
    );
  });

  it("rejects naming the URL when the body is not JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html>", { status: 200 })),
    );
    await expect(fetchJsonOverHttp("./data/manifest.json")).rejects.toThrow(
      "./data/manifest.json is not valid JSON",
    );
  });

  it("returns the parsed JSON body on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response('{"schemaVersion":1}', { status: 200 })),
    );
    expect(await fetchJsonOverHttp("./data/manifest.json")).toEqual({ schemaVersion: 1 });
  });
});
