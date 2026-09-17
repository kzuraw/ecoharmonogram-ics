import type {
  AddressConfig,
  AddressResolution,
  CollectionCategory,
  CollectionDay,
  CollectionSchedule,
  ResolvedCollectionSchedule,
} from "./types";

const API_URL = "https://ecoharmonogram.pl/api/api.php";
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_ATTEMPTS = 2;

interface Town {
  id: string;
  name: string;
  district: string;
}

interface SchedulePeriod {
  id: string;
  startDate: string;
  endDate: string;
  changeDate: string;
}

interface Street {
  id: string;
  name: string;
  sides: string;
}

interface ScheduleEntry {
  month: string;
  days: string;
  year: string;
  scheduleDescriptionId: string;
}

interface ScheduleDescription {
  id: string;
  name: string;
  description: string;
  visInCompl: string;
}

interface ScheduleResponse {
  schedules: ScheduleEntry[];
  scheduleDescription: ScheduleDescription[];
  footer: string;
}

interface MutableCollectionDay {
  categories: Map<string, CollectionCategory>;
  footers: Set<string>;
}

interface ResolvedAddress extends AddressResolution {
  periods: SchedulePeriod[];
}

function normalize(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("pl-PL");
}

function generateClientId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function requireArray<T>(value: unknown, field: string): T[] {
  if (!Array.isArray(value)) {
    throw new Error(`EcoHarmonogram response is missing ${field}`);
  }

  return value as T[];
}

function decodeHtmlEntities(value: string): string {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };

  return value.replace(
    /&(#x[\da-f]+|#\d+|[a-z]+);/gi,
    (match, entity: string) => {
      if (entity.startsWith("#x")) {
        return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
      }

      if (entity.startsWith("#")) {
        return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
      }

      return named[entity.toLowerCase()] ?? match;
    },
  );
}

export function convertHtmlToPlainText(value: string): string {
  return decodeHtmlEntities(
    value
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p\s*>/gi, "\n")
      .replace(/<li\b[^>]*>/gi, "- ")
      .replace(/<\/li\s*>/gi, "\n")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/\u00a0/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join("\n");
}

function isValidDate(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function formatIsoDate(entry: ScheduleEntry, dayValue: string): string {
  const year = Number.parseInt(entry.year, 10);
  const month = Number.parseInt(entry.month, 10);
  const day = Number.parseInt(dayValue, 10);

  if (!isValidDate(year, month, day)) {
    throw new Error(
      `EcoHarmonogram returned an invalid date: ${entry.year}-${entry.month}-${dayValue}`,
    );
  }

  return `${year.toString().padStart(4, "0")}-${month
    .toString()
    .padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
}

type EcoHarmonogramRequest = (
  action: string,
  payload: Record<string, string>,
) => Promise<unknown>;

function createEcoHarmonogramRequest(): EcoHarmonogramRequest {
  const clientId = generateClientId();

  return async function request(
    action: string,
    payload: Record<string, string>,
  ): Promise<unknown> {
    const body = new URLSearchParams({
      ...payload,
      action,
      funcVersion: "3",
      appVersion: "107",
      systemId: "1",
      clientId,
      lng: "pl",
    });

    let lastError: unknown;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        const response = await fetch(API_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "X-Requested-With": "XMLHttpRequest",
          },
          body,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });

        if (!response.ok) {
          throw new Error(
            `EcoHarmonogram ${action} failed with HTTP ${response.status}`,
          );
        }

        const text = (await response.text()).replace(/^\uFEFF/, "");
        return JSON.parse(text) as unknown;
      } catch (error) {
        lastError = error;
      }
    }

    throw new Error(
      `EcoHarmonogram ${action} failed after ${MAX_ATTEMPTS} attempts`,
      {
        cause: lastError,
      },
    );
  };
}

async function fetchTown(
  request: EcoHarmonogramRequest,
  config: AddressConfig,
): Promise<Town> {
  const response = await request("getTowns", { townName: config.town });
  if (!isRecord(response)) {
    throw new Error("EcoHarmonogram returned an invalid town response");
  }

  const matches = requireArray<Town>(response.towns, "towns").filter(
    (town) =>
      normalize(town.name) === normalize(config.town) &&
      normalize(town.district) === normalize(config.district),
  );

  if (matches.length !== 1) {
    throw new Error(
      `Expected one EcoHarmonogram town match, received ${matches.length}`,
    );
  }

  return matches[0]!;
}

async function fetchPeriods(
  request: EcoHarmonogramRequest,
  townId: string,
): Promise<SchedulePeriod[]> {
  const response = await request("getSchedulePeriods", { townId });
  if (!isRecord(response)) {
    throw new Error(
      "EcoHarmonogram returned an invalid schedule-period response",
    );
  }

  const periods = requireArray<SchedulePeriod>(
    response.schedulePeriods,
    "schedulePeriods",
  );
  if (periods.length === 0) {
    throw new Error("EcoHarmonogram returned no schedule periods");
  }

  return periods;
}

async function fetchStreetIds(
  request: EcoHarmonogramRequest,
  config: AddressConfig,
  townId: string,
  periodId: string,
): Promise<string[]> {
  const response = await request("getStreets", {
    streetName: config.street,
    number: config.houseNumber,
    townId,
    schedulePeriodId: periodId,
    groupId: "1",
    choosedStreetIds: "",
  });
  if (!isRecord(response)) {
    throw new Error("EcoHarmonogram returned an invalid street response");
  }

  const matches = requireArray<Street>(response.streets, "streets").filter(
    (street) =>
      normalize(street.name) === normalize(config.street) &&
      normalize(street.sides) === normalize(config.streetSide),
  );

  if (matches.length !== 1) {
    throw new Error(
      `Expected one EcoHarmonogram street-side match, received ${matches.length}`,
    );
  }

  const ids = matches[0]!.id
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
  if (ids.length === 0) {
    throw new Error("EcoHarmonogram returned a street without an ID");
  }

  return ids;
}

async function fetchScheduleResponse(
  request: EcoHarmonogramRequest,
  periodId: string,
  streetId: string,
): Promise<ScheduleResponse> {
  const response = await request("getSchedules", {
    streetId,
    schedulePeriodId: periodId,
  });
  if (!isRecord(response)) {
    throw new Error("EcoHarmonogram returned an invalid schedule response");
  }

  return {
    schedules: requireArray<ScheduleEntry>(response.schedules, "schedules"),
    scheduleDescription: requireArray<ScheduleDescription>(
      response.scheduleDescription,
      "scheduleDescription",
    ),
    footer: typeof response.footer === "string" ? response.footer : "",
  };
}

async function resolveAddress(
  request: EcoHarmonogramRequest,
  config: AddressConfig,
  cachedResolution?: AddressResolution,
): Promise<ResolvedAddress> {
  const townId =
    cachedResolution?.townId ?? (await fetchTown(request, config)).id;
  const periods = await fetchPeriods(request, townId);
  const streetIdsByPeriod: Record<string, string[]> = {};

  for (const period of periods) {
    streetIdsByPeriod[period.id] =
      cachedResolution?.streetIdsByPeriod[period.id] ??
      (await fetchStreetIds(request, config, townId, period.id));
  }

  return { townId, periods, streetIdsByPeriod };
}

async function fetchScheduleForAddress(
  request: EcoHarmonogramRequest,
  address: ResolvedAddress,
): Promise<ResolvedCollectionSchedule> {
  const days = new Map<string, MutableCollectionDay>();

  for (const period of address.periods) {
    const streetIds = address.streetIdsByPeriod[period.id]!;
    for (const streetId of streetIds) {
      const response = await fetchScheduleResponse(
        request,
        period.id,
        streetId,
      );
      const descriptions = new Map(
        response.scheduleDescription.map((description) => [
          description.id,
          description,
        ]),
      );
      const footer = convertHtmlToPlainText(response.footer);

      for (const entry of response.schedules) {
        const description = descriptions.get(entry.scheduleDescriptionId);
        if (!description || description.visInCompl !== "1") {
          continue;
        }

        const category: CollectionCategory = {
          name: description.name.trim(),
          description: convertHtmlToPlainText(description.description),
        };

        for (const dayValue of entry.days.split(";")) {
          if (dayValue.trim().length === 0) {
            continue;
          }

          const date = formatIsoDate(entry, dayValue.trim());
          const day = days.get(date) ?? {
            categories: new Map<string, CollectionCategory>(),
            footers: new Set<string>(),
          };
          day.categories.set(normalize(category.name), category);
          if (footer.length > 0) {
            day.footers.add(footer);
          }
          days.set(date, day);
        }
      }
    }
  }

  if (days.size === 0) {
    throw new Error("EcoHarmonogram returned no visible collection dates");
  }

  const collectionDays: CollectionDay[] = [...days.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, day]) => ({
      date,
      categories: [...day.categories.values()],
      footers: [...day.footers],
    }));

  const schedule: CollectionSchedule = {
    days: collectionDays,
    sourceChangeDates: [
      ...new Set(address.periods.map(({ changeDate }) => changeDate)),
    ].sort(),
  };

  return {
    schedule,
    resolution: {
      townId: address.townId,
      streetIdsByPeriod: address.streetIdsByPeriod,
    },
  };
}

export async function fetchCollectionSchedule(
  config: AddressConfig,
  cachedResolution?: AddressResolution,
): Promise<ResolvedCollectionSchedule> {
  const request = createEcoHarmonogramRequest();

  try {
    const address = await resolveAddress(request, config, cachedResolution);
    return await fetchScheduleForAddress(request, address);
  } catch (error) {
    if (cachedResolution === undefined) {
      throw error;
    }
  }

  const address = await resolveAddress(request, config);
  return fetchScheduleForAddress(request, address);
}
