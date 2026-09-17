import { describe, expect, it } from "vitest";

import { generateCalendar } from "../src/calendar";

describe("generateCalendar", () => {
  const calendar = generateCalendar(
    [
      {
        date: "2026-09-30",
        categories: [
          { name: "ODPADY ZMIESZANE", description: "" },
          {
            name: "ODPADY BIO",
            description:
              "Odbiór odpadów BIO będzie realizowany wyłącznie z pojemników.",
          },
          { name: "TWORZYWA", description: "" },
        ],
        footers: ["Pojemniki należy wystawić do godziny 6.00 rano."],
      },
    ],
    new Date("2026-09-17T08:00:00.000Z"),
  );

  it("creates one transparent all-day event with a previous-day 15:00 alarm", () => {
    expect(calendar.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    expect(calendar).toContain("X-WR-CALNAME:Odbiór odpadów\r\n");
    expect(calendar).toContain("DTSTART;VALUE=DATE:20260930\r\n");
    expect(calendar).toContain("DTEND;VALUE=DATE:20261001\r\n");
    expect(calendar).toContain(
      "UID:collection-20260930@ecoharmonogram-ics\r\n",
    );
    expect(calendar).toContain("SUMMARY:Odbiór odpadów\r\n");
    expect(calendar).toContain("TRANSP:TRANSPARENT\r\n");
    expect(calendar).toContain("TRIGGER:-PT9H\r\n");
    expect(calendar).toMatch(
      /DESCRIPTION:Rodzaje odpadów:\\n- ODPADY ZMIESZANE/,
    );
    expect(calendar).toContain("ODPADY BIO");
    expect(calendar).toContain("Informacje dodatkowe:");
  });

  it("uses CRLF and folds every physical line to at most 75 UTF-8 octets", () => {
    expect(calendar.replaceAll("\r\n", "")).not.toContain("\n");

    for (const line of calendar.split("\r\n")) {
      expect(new TextEncoder().encode(line).byteLength).toBeLessThanOrEqual(75);
    }
  });
});
