import { vi } from "vitest";

export const townsResponse = {
  towns: [
    {
      id: "1393",
      communityId: "68",
      name: "Testowo",
      district: "Gmina Testowa",
      province: "Dolnośląskie",
    },
  ],
};

export const periodsResponse = {
  schedulePeriods: [
    {
      id: "11448",
      startDate: "2026-01-01",
      endDate: "2026-12-31",
      changeDate: "2026-08-24 13:09:58",
    },
  ],
};

export const streetsResponse = {
  streets: [
    {
      id: "31325616",
      name: "Testowa",
      sides: "Wspólnota",
    },
    {
      id: "31325962",
      name: "Testowa",
      sides: "Zabudowa jednorodzinna",
    },
  ],
};

export const schedulesResponse = {
  schedules: [
    {
      month: "9",
      days: "30",
      year: "2026",
      scheduleDescriptionId: "general",
    },
    {
      month: "9",
      days: "30",
      year: "2026",
      scheduleDescriptionId: "plastic",
    },
    {
      month: "9",
      days: "30",
      year: "2026",
      scheduleDescriptionId: "bio",
    },
    {
      month: "9",
      days: "30",
      year: "2026",
      scheduleDescriptionId: "payment",
    },
    {
      month: "10",
      days: "10",
      year: "2026",
      scheduleDescriptionId: "bulky",
    },
  ],
  scheduleDescription: [
    {
      id: "general",
      name: "ODPADY ZMIESZANE",
      description: "",
      visInCompl: "1",
    },
    {
      id: "plastic",
      name: "TWORZYWA",
      description: "",
      visInCompl: "1",
    },
    {
      id: "bio",
      name: "ODPADY BIO",
      description:
        "Odbiór odpadów BIO&nbsp;będzie realizowany wyłącznie z pojemników.",
      visInCompl: "1",
    },
    {
      id: "payment",
      name: "TERMINY PŁATNOŚCI",
      description: "Płatności należy wnosić kwartalnie.",
      visInCompl: "0",
    },
    {
      id: "bulky",
      name: "WIELKOGABARYTY I ZSEiE",
      description: "Sprzęt elektroniczny, AGD oraz opony",
      visInCompl: "1",
    },
  ],
  footer:
    "<p>Pojemniki i worki należy wystawić do godziny 6.00 rano.<br />Przed wyrzuceniem zgniataj śmieci.</p>",
};

export function createEcoApiMock(): ReturnType<typeof vi.fn> {
  return vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const params = new URLSearchParams(String(init?.body));
    const action = params.get("action");

    let payload = null;
    if (action === "getTowns") {
      payload = townsResponse;
    } else if (action === "getSchedulePeriods") {
      payload = periodsResponse;
    } else if (action === "getStreets") {
      payload = streetsResponse;
    } else if (action === "getSchedules") {
      payload = schedulesResponse;
    }

    if (payload === null) {
      return new Response("Unknown action", { status: 400 });
    }

    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
}
