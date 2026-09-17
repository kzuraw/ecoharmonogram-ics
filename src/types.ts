export interface Env {
  CALENDAR_KV: KVNamespace;
  CALENDAR_TOKEN: string;
  ECO_TOWN: string;
  ECO_DISTRICT: string;
  ECO_STREET: string;
  ECO_HOUSE_NUMBER: string;
  ECO_STREET_SIDE: string;
}

export interface AddressConfig {
  town: string;
  district: string;
  street: string;
  houseNumber: string;
  streetSide: string;
}

export interface CollectionCategory {
  name: string;
  description: string;
}

export interface CollectionDay {
  date: string;
  categories: CollectionCategory[];
  footers: string[];
}

export interface CalendarMetadata {
  etag: string;
  eventCount: number;
  lastModified: string;
  sourceHash: string;
  sourceChangeDates: string[];
}

export interface CollectionSchedule {
  days: CollectionDay[];
  sourceChangeDates: string[];
}

export interface AddressResolution {
  townId: string;
  streetIdsByPeriod: Record<string, string[]>;
}

export interface CachedAddressResolution extends AddressResolution {
  addressHash: string;
}

export interface ResolvedCollectionSchedule {
  schedule: CollectionSchedule;
  resolution: AddressResolution;
}
