import assert from "node:assert/strict";
import test from "node:test";
import { formatOffsetDateTime, localDateFromOffset, startOfLocalDayUtc } from "../src/dates.js";

test("startOfLocalDayUtc uses the zone offset, including DST boundaries", () => {
  assert.equal(startOfLocalDayUtc("2026-11-16", "America/New_York"), "2026-11-16T05:00:00.000Z");
  assert.equal(startOfLocalDayUtc("2026-11-22", "America/New_York"), "2026-11-22T05:00:00.000Z");
  // 2026-03-08 is the US spring-forward day; midnight is still EST (UTC-5).
  assert.equal(startOfLocalDayUtc("2026-03-08", "America/New_York"), "2026-03-08T05:00:00.000Z");
  // 2026-11-01 is the US fall-back day; midnight is still EDT (UTC-4).
  assert.equal(startOfLocalDayUtc("2026-11-01", "America/New_York"), "2026-11-01T04:00:00.000Z");
  assert.equal(startOfLocalDayUtc("2026-11-16", "UTC"), "2026-11-16T00:00:00.000Z");
});

test("formatOffsetDateTime applies the record offset and does not invent a zone", () => {
  assert.equal(
    formatOffsetDateTime("2022-04-24T02:25:44.774Z", "-05:00"),
    "2022-04-23T21:25:44.774-05:00",
  );
  assert.equal(
    formatOffsetDateTime("2022-04-24T10:25:44.774Z", "-05:00"),
    "2022-04-24T05:25:44.774-05:00",
  );
  assert.equal(formatOffsetDateTime("2026-11-16T05:00:00.000Z", "Z"), "2026-11-16T05:00:00.000Z");
});

test("localDateFromOffset and formatOffsetDateTime follow the record offset past midnight and on DST days", () => {
  assert.equal(localDateFromOffset("2026-11-23T05:15:00.000Z", "-05:00"), "2026-11-23");
  assert.equal(
    formatOffsetDateTime("2026-11-23T05:15:00.000Z", "-05:00"),
    "2026-11-23T00:15:00.000-05:00",
  );
  // 2026-03-08 spring-forward; a 07:00 EDT wake uses the record's -04:00 offset.
  assert.equal(localDateFromOffset("2026-03-08T11:00:00.000Z", "-04:00"), "2026-03-08");
  assert.equal(
    formatOffsetDateTime("2026-03-08T11:00:00.000Z", "-04:00"),
    "2026-03-08T07:00:00.000-04:00",
  );
  // 2026-11-01 fall-back; 01:30 can be EDT or EST depending on the record offset.
  assert.equal(formatOffsetDateTime("2026-11-01T05:30:00.000Z", "-04:00"), "2026-11-01T01:30:00.000-04:00");
  assert.equal(formatOffsetDateTime("2026-11-01T06:30:00.000Z", "-05:00"), "2026-11-01T01:30:00.000-05:00");
  assert.equal(localDateFromOffset("2026-11-22T16:30:00.000Z", "+09:00"), "2026-11-23");
});

test("localDateFromOffset rejects an invalid timestamp", () => {
  assert.throws(() => localDateFromOffset("not-a-timestamp", "-05:00"), /Invalid timestamp/);
});

