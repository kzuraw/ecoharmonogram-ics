import { env, exports } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { refreshCalendar } from "../src/index";
import type { CalendarMetadata } from "../src/types";
import { createEcoApiMock } from "./fixtures";

const workerEnv = env as unknown as Env;
const calendarUrl = "https://example.com/calendar/test-token.ics";

describe("calendar Worker", () => {
  beforeEach(async () => {
    await workerEnv.CALENDAR_KV.delete("calendar.ics");
    await workerEnv.CALENDAR_KV.delete("address-resolution.v1");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("hides every route except the tokenized subscription path", async () => {
    const fetchMock = createEcoApiMock();
    vi.stubGlobal("fetch", fetchMock);

    const response = await exports.default.fetch(
      "https://example.com/calendar.ics",
    );

    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("lazily initializes KV and serves subsequent requests from the snapshot", async () => {
    const fetchMock = createEcoApiMock();
    vi.stubGlobal("fetch", fetchMock);

    const first = await exports.default.fetch(calendarUrl);
    const calendar = await first.text();

    expect(first.status).toBe(200);
    expect(first.headers.get("Content-Type")).toBe(
      "text/calendar; charset=utf-8",
    );
    expect(first.headers.get("X-Calendar-Event-Count")).toBe("2");
    expect(first.headers.get("ETag")).toMatch(/^"[a-f\d]{64}"$/);
    expect(calendar.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(calendar.match(/DTSTART;VALUE=DATE:20260930/g)).toHaveLength(1);
    expect(calendar).toContain("ODPADY ZMIESZANE");
    expect(calendar).toContain("TWORZYWA");
    expect(calendar).toContain("ODPADY BIO");
    expect(calendar).not.toContain("TERMINY PŁATNOŚCI");

    const callsAfterInitialization = fetchMock.mock.calls.length;
    const second = await exports.default.fetch(calendarUrl);
    expect(second.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(callsAfterInitialization);
  });

  it("supports HEAD and ETag revalidation", async () => {
    vi.stubGlobal("fetch", createEcoApiMock());
    const first = await exports.default.fetch(calendarUrl);
    const etag = first.headers.get("ETag")!;

    const head = await exports.default.fetch(
      new Request(calendarUrl, { method: "HEAD" }),
    );
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");

    const notModified = await exports.default.fetch(
      new Request(calendarUrl, { headers: { "If-None-Match": etag } }),
    );
    expect(notModified.status).toBe(304);
    expect(await notModified.text()).toBe("");
  });

  it("keeps timestamps and the ETag stable when the source is unchanged", async () => {
    const fetchMock = createEcoApiMock();
    vi.stubGlobal("fetch", fetchMock);
    const initial = await exports.default.fetch(calendarUrl);
    const expectedCalendar = await initial.text();
    const expectedEtag = initial.headers.get("ETag");
    const before =
      await workerEnv.CALENDAR_KV.getWithMetadata<CalendarMetadata>(
        "calendar.ics",
        "text",
      );

    fetchMock.mockClear();

    const metadata = await refreshCalendar(
      workerEnv,
      new Date("2030-01-01T00:00:00.000Z"),
    );
    const after = await workerEnv.CALENDAR_KV.getWithMetadata<CalendarMetadata>(
      "calendar.ics",
      "text",
    );

    expect(metadata.lastModified).toBe(before.metadata?.lastModified);
    expect(metadata.etag).toBe(expectedEtag);
    expect(after.value).toBe(expectedCalendar);
    expect(after.metadata).toEqual(before.metadata);
    expect(
      fetchMock.mock.calls.map(([, init]) =>
        new URLSearchParams(String(init?.body)).get("action"),
      ),
    ).toEqual(["getSchedulePeriods", "getSchedules"]);
  });

  it("does not overwrite the last good snapshot after an upstream failure", async () => {
    vi.stubGlobal("fetch", createEcoApiMock());
    const initial = await exports.default.fetch(calendarUrl);
    const expectedCalendar = await initial.text();
    const before =
      await workerEnv.CALENDAR_KV.getWithMetadata<CalendarMetadata>(
        "calendar.ics",
        "text",
      );

    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("offline"))),
    );
    await expect(refreshCalendar(workerEnv)).rejects.toThrow(
      "failed after 2 attempts",
    );

    const after = await workerEnv.CALENDAR_KV.getWithMetadata<CalendarMetadata>(
      "calendar.ics",
      "text",
    );
    expect(after.value).toBe(expectedCalendar);
    expect(after.metadata).toEqual(before.metadata);
  });
});
