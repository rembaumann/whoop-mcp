import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseArgs } from "../src/cli.js";

describe("CLI arguments", () => {
  it("defaults to stdio so MCP clients can spawn the binary", () => {
    assert.deepEqual(parseArgs([]), { kind: "stdio" });
    assert.deepEqual(parseArgs(["serve"]), { kind: "stdio" });
    assert.deepEqual(parseArgs(["serve", "--transport", "stdio"]), { kind: "stdio" });
  });

  it("parses login, logout, and HTTP options", () => {
    assert.deepEqual(parseArgs(["login"]), { kind: "login" });
    assert.deepEqual(parseArgs(["logout", "--revoke"]), { kind: "logout", revoke: true });
    assert.deepEqual(parseArgs(["--http", "--port", "4000", "--host", "127.0.0.1"]), {
      kind: "http",
      port: 4000,
      host: "127.0.0.1",
    });
    assert.deepEqual(parseArgs(["--help"]), { kind: "help" });
  });

  it("rejects unknown commands and a page port that is not a port", () => {
    assert.throws(() => parseArgs(["explode"]), /Unknown command/);
    assert.throws(() => parseArgs(["serve", "--port", "80"]), /HTTP transport/);
    assert.throws(() => parseArgs(["--http", "--port", "0"]), /--port/);
  });
});
