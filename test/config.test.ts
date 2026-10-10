import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { loadConfig, validateRedirectUri } from "../src/auth/config.js";

describe("configuration", () => {
  it("accepts a loopback redirect and rejects ones the login server cannot catch", () => {
    assert.equal(validateRedirectUri("http://127.0.0.1:8787/callback").port, "8787");
    assert.throws(() => validateRedirectUri("https://example.com/callback"), /127\.0\.0\.1/);
    assert.throws(() => validateRedirectUri("http://127.0.0.1/callback"), /port/);
  });

  it("explains how to provide credentials when none are configured", async () => {
    const saved = {
      WHOOP_CLIENT_ID: process.env.WHOOP_CLIENT_ID,
      WHOOP_CLIENT_SECRET: process.env.WHOOP_CLIENT_SECRET,
      WHOOP_CONFIG_PATH: process.env.WHOOP_CONFIG_PATH,
    };
    delete process.env.WHOOP_CLIENT_ID;
    delete process.env.WHOOP_CLIENT_SECRET;
    process.env.WHOOP_CONFIG_PATH = path.join(tmpdir(), `whoop-mcp-missing-${process.pid}.json`);
    try {
      await assert.rejects(() => loadConfig(), /WHOOP_CLIENT_ID/);
    } finally {
      restore("WHOOP_CLIENT_ID", saved.WHOOP_CLIENT_ID);
      restore("WHOOP_CLIENT_SECRET", saved.WHOOP_CLIENT_SECRET);
      restore("WHOOP_CONFIG_PATH", saved.WHOOP_CONFIG_PATH);
    }
  });
});

function restore(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
