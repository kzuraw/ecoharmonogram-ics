import { calculateCalendarEtag, generateCalendar } from "./calendar";
import { fetchCollectionSchedule } from "./ecoharmonogram";
import type {
  AddressConfig,
  CachedAddressResolution,
  CalendarMetadata,
} from "./types";

const CALENDAR_KEY = "calendar.ics";
const ADDRESS_RESOLUTION_KEY = "address-resolution.v1";

function requireBinding(value: string | undefined, name: string): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new Error(`Missing required binding: ${name}`);
  }
  return normalized;
}

function getAddressConfigFromEnv(env: Env): AddressConfig {
  return {
    town: requireBinding(env.ECO_TOWN, "ECO_TOWN"),
    district: requireBinding(env.ECO_DISTRICT, "ECO_DISTRICT"),
    street: requireBinding(env.ECO_STREET, "ECO_STREET"),
    houseNumber: requireBinding(env.ECO_HOUSE_NUMBER, "ECO_HOUSE_NUMBER"),
    streetSide: requireBinding(env.ECO_STREET_SIDE, "ECO_STREET_SIDE"),
  };
}

function getCalendarPath(env: Env): string {
  return `/calendar/${encodeURIComponent(requireBinding(env.CALENDAR_TOKEN, "CALENDAR_TOKEN"))}.ics`;
}

function logError(event: string, error: unknown): void {
  console.error(
    JSON.stringify({
      event,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    }),
  );
}

export async function refreshCalendar(
  env: Env,
  generatedAt = new Date(),
): Promise<CalendarMetadata> {
  const address = getAddressConfigFromEnv(env);
  const addressHash = await calculateCalendarEtag(JSON.stringify(address));
  const cachedResolution = await env.CALENDAR_KV.get<CachedAddressResolution>(
    ADDRESS_RESOLUTION_KEY,
    "json",
  );
  const reusableResolution =
    cachedResolution?.addressHash === addressHash
      ? cachedResolution
      : undefined;
  const { schedule, resolution } = await fetchCollectionSchedule(
    address,
    reusableResolution,
  );
  const nextResolution: CachedAddressResolution = {
    addressHash,
    ...resolution,
  };

  if (JSON.stringify(cachedResolution) !== JSON.stringify(nextResolution)) {
    await env.CALENDAR_KV.put(
      ADDRESS_RESOLUTION_KEY,
      JSON.stringify(nextResolution),
    );
  }

  const sourceHash = await calculateCalendarEtag(JSON.stringify(schedule));
  const current = await env.CALENDAR_KV.getWithMetadata<CalendarMetadata>(
    CALENDAR_KEY,
    "text",
  );

  if (
    current.value !== null &&
    current.metadata !== null &&
    current.metadata.sourceHash === sourceHash
  ) {
    console.log(
      JSON.stringify({
        event: "calendar.refresh.unchanged",
        eventCount: current.metadata.eventCount,
        lastModified: current.metadata.lastModified,
        sourceChangeDates: current.metadata.sourceChangeDates,
      }),
    );
    return current.metadata;
  }

  const calendar = generateCalendar(schedule.days, generatedAt);
  const metadata: CalendarMetadata = {
    etag: await calculateCalendarEtag(calendar),
    eventCount: schedule.days.length,
    lastModified: generatedAt.toISOString(),
    sourceHash,
    sourceChangeDates: schedule.sourceChangeDates,
  };

  await env.CALENDAR_KV.put(CALENDAR_KEY, calendar, { metadata });
  console.log(
    JSON.stringify({
      event: "calendar.refresh.success",
      eventCount: metadata.eventCount,
      lastModified: metadata.lastModified,
      sourceChangeDates: metadata.sourceChangeDates,
    }),
  );
  return metadata;
}

async function getSnapshot(
  env: Env,
): Promise<{ calendar: string; metadata: CalendarMetadata }> {
  let stored = await env.CALENDAR_KV.getWithMetadata<CalendarMetadata>(
    CALENDAR_KEY,
    "text",
  );

  if (stored.value === null || stored.metadata === null) {
    await refreshCalendar(env);
    stored = await env.CALENDAR_KV.getWithMetadata<CalendarMetadata>(
      CALENDAR_KEY,
      "text",
    );
  }

  if (stored.value === null || stored.metadata === null) {
    throw new Error("Calendar snapshot was not stored");
  }

  return { calendar: stored.value, metadata: stored.metadata };
}

function createResponseHeaders(metadata: CalendarMetadata): Headers {
  return new Headers({
    "Cache-Control": "private, max-age=3600, must-revalidate",
    "Content-Disposition": 'inline; filename="ecoharmonogram.ics"',
    "Content-Type": "text/calendar; charset=utf-8",
    ETag: metadata.etag,
    "Last-Modified": new Date(metadata.lastModified).toUTCString(),
    "X-Calendar-Event-Count": metadata.eventCount.toString(),
    "X-Calendar-Last-Updated": metadata.lastModified,
  });
}

async function handleFetch(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname !== getCalendarPath(env)) {
    return new Response("Not found", { status: 404 });
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", {
      status: 405,
      headers: { Allow: "GET, HEAD" },
    });
  }

  try {
    const stored = await getSnapshot(env);
    const headers = createResponseHeaders(stored.metadata);
    if (request.headers.get("If-None-Match") === stored.metadata.etag) {
      return new Response(null, { status: 304, headers });
    }

    return new Response(request.method === "HEAD" ? null : stored.calendar, {
      status: 200,
      headers,
    });
  } catch (error) {
    logError("calendar.serve.error", error);
    return new Response("Calendar is temporarily unavailable", {
      status: 503,
      headers: { "Retry-After": "3600" },
    });
  }
}

export default {
  fetch: handleFetch,
  async scheduled(
    _controller: ScheduledController,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<void> {
    try {
      await refreshCalendar(env);
    } catch (error) {
      logError("calendar.refresh.error", error);
      throw error;
    }
  },
} satisfies ExportedHandler<Env>;
