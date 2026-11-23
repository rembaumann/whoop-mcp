import assert from "node:assert/strict";
import test from "node:test";
import { formatOffsetDateTime, startOfLocalDayUtc } from "../src/dates.js";

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
