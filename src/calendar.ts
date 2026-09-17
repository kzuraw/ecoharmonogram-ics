import type { CollectionDay } from "./types";

const CALENDAR_NAME = "Odbiór odpadów";
const encoder = new TextEncoder();

function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
}

function foldLine(line: string): string {
  const lines: string[] = [];
  let current = "";
  let byteLength = 0;
  let limit = 75;

  for (const character of line) {
    const characterBytes = encoder.encode(character).byteLength;
    if (byteLength + characterBytes > limit && current.length > 0) {
      lines.push(current);
      current = character;
      byteLength = characterBytes;
      limit = 74;
      continue;
    }

    current += character;
    byteLength += characterBytes;
  }

  lines.push(current);
  return lines.join("\r\n ");
}

function formatCompactDate(value: string): string {
  return value.replaceAll("-", "");
}

function getNextDate(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day! + 1));
  return date.toISOString().slice(0, 10);
}

function formatUtcTimestamp(value: Date): string {
  return value
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

function buildDescription(day: CollectionDay): string {
  const sections = [
    `Rodzaje odpadów:\n${day.categories
      .map((category) => `- ${category.name}`)
      .join("\n")}`,
  ];
  const instructions = day.categories.filter(
    (category) => category.description.length > 0,
  );

  if (instructions.length > 0) {
    sections.push(
      `Informacje:\n${instructions
        .map((category) => `- ${category.name}: ${category.description}`)
        .join("\n")}`,
    );
  }

  if (day.footers.length > 0) {
    sections.push(`Informacje dodatkowe:\n${day.footers.join("\n")}`);
  }

  return sections.join("\n\n");
}

export function generateCalendar(
  days: CollectionDay[],
  generatedAt: Date,
): string {
  const timestamp = formatUtcTimestamp(generatedAt);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//ecoharmonogram-ics//PL",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(CALENDAR_NAME)}`,
    "X-WR-TIMEZONE:Europe/Warsaw",
    "REFRESH-INTERVAL;VALUE=DURATION:P1D",
    "X-PUBLISHED-TTL:P1D",
  ];

  for (const day of days) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:collection-${formatCompactDate(day.date)}@ecoharmonogram-ics`,
      `DTSTAMP:${timestamp}`,
      `LAST-MODIFIED:${timestamp}`,
      `DTSTART;VALUE=DATE:${formatCompactDate(day.date)}`,
      `DTEND;VALUE=DATE:${formatCompactDate(getNextDate(day.date))}`,
      `SUMMARY:${escapeText(CALENDAR_NAME)}`,
      `DESCRIPTION:${escapeText(buildDescription(day))}`,
      "TRANSP:TRANSPARENT",
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      `DESCRIPTION:${escapeText(`${CALENDAR_NAME} jutro`)}`,
      "TRIGGER:-PT9H",
      "END:VALARM",
      "END:VEVENT",
    );
  }

  lines.push("END:VCALENDAR");
  return `${lines.map(foldLine).join("\r\n")}\r\n`;
}

export async function calculateCalendarEtag(calendar: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(calendar),
  );
  const hex = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `"${hex}"`;
}
