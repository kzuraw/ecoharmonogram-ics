import { afterEach, describe, expect, it, vi } from "vitest";

import {
  convertHtmlToPlainText,
  fetchCollectionSchedule,
} from "../src/ecoharmonogram";
import { createEcoApiMock } from "./fixtures";

const address = {
  town: "Testowo",
  district: "Gmina Testowa",
  street: "Testowa",
  houseNumber: "42A",
  streetSide: "Zabudowa jednorodzinna",
};

describe("fetchCollectionSchedule", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("resolves the configured street side and groups visible collections by date", async () => {
    const fetchMock = createEcoApiMock();
    vi.stubGlobal("fetch", fetchMock);

    const { schedule: result, resolution } =
      await fetchCollectionSchedule(address);

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(resolution).toEqual({
      townId: "1393",
      streetIdsByPeriod: { "11448": ["31325962"] },
    });
    expect(result.sourceChangeDates).toEqual(["2026-08-24 13:09:58"]);
    expect(result.days).toHaveLength(2);
    expect(result.days[0]).toMatchObject({
      date: "2026-09-30",
      categories: [
        { name: "ODPADY ZMIESZANE", description: "" },
        { name: "TWORZYWA", description: "" },
        {
          name: "ODPADY BIO",
          description:
            "Odbiór odpadów BIO będzie realizowany wyłącznie z pojemników.",
        },
      ],
    });
    expect(result.days[0]?.categories.map(({ name }) => name)).not.toContain(
      "TERMINY PŁATNOŚCI",
    );
    expect(result.days[0]?.footers).toEqual([
      "Pojemniki i worki należy wystawić do godziny 6.00 rano.\nPrzed wyrzuceniem zgniataj śmieci.",
    ]);

    const streetRequest = fetchMock.mock.calls.find(([, init]) =>
      String(init?.body).includes("action=getStreets"),
    );
    expect(String(streetRequest?.[1]?.body)).toContain("number=42A");
  });

  it("converts upstream HTML into readable plain text", () => {
    expect(convertHtmlToPlainText("<p>A&nbsp;B<br>Druga linia</p>")).toBe(
      "A B\nDruga linia",
    );
  });

  it("refuses to use an ambiguous or missing street-side match", async () => {
    vi.stubGlobal("fetch", createEcoApiMock());

    await expect(
      fetchCollectionSchedule({
        ...address,
        streetSide: "Nieznany typ",
      }),
    ).rejects.toThrow("Expected one EcoHarmonogram street-side match");
  });

  it("re-resolves the address when a cached street ID no longer works", async () => {
    const successfulFetch = createEcoApiMock() as unknown as typeof fetch;
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const params = new URLSearchParams(String(init?.body));
        if (
          params.get("action") === "getSchedules" &&
          params.get("streetId") === "obsolete-street-id"
        ) {
          return new Response("Not found", { status: 404 });
        }

        return successfulFetch(input, init);
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchCollectionSchedule(address, {
      townId: "1393",
      streetIdsByPeriod: { "11448": ["obsolete-street-id"] },
    });

    expect(result.resolution.streetIdsByPeriod).toEqual({
      "11448": ["31325962"],
    });
    expect(fetchMock).toHaveBeenCalledTimes(7);
  });
});
