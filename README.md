# whoop-mcp

An open-source [Model Context Protocol](https://modelcontextprotocol.io) server that lets an AI assistant read **your** WHOOP data through [WHOOP's official Developer API (v2)](https://developer.whoop.com/api).

It is a local, read-only bridge. You register your own WHOOP app, sign in once in the browser, and the access token stays on your machine. The server speaks stdio, so Claude Desktop, Cursor, and other MCP clients can launch it. Streamable HTTP is available when you want to run it as a local service.

WHOOP is a trademark of WHOOP, Inc. This project is not affiliated with, endorsed by, or sponsored by WHOOP.

## What you can ask

After it is connected, an assistant can look up:

- your profile (name, email, user id) and body measurements (height, weight, max heart rate)
- physiological cycles and day strain
- recovery, including HRV, resting heart rate, and the recovery score
- sleep, including stage durations and sleep performance
- workouts, including sport, strain, and heart-rate zones

List tools accept a date range and WHOOP's cursor pagination (`next_token`, up to 25 records per page).

## Create a WHOOP developer app

WHOOP requires each integration to use its own OAuth client. There is no shared API key in this project.

1. You need a WHOOP membership. Developer login uses the same account.
2. Open the [WHOOP Developer Dashboard](https://developer-dashboard.whoop.com/) and create an app (you may be asked to create a team first). Enable every scope you want this server to use:
   - `read:profile`
   - `read:body_measurement`
   - `read:cycles`
   - `read:recovery`
   - `read:sleep`
   - `read:workout`
   - `offline` (required for a refresh token)
3. Register this redirect URI exactly:

   ```text
   http://127.0.0.1:8787/callback
   ```

   WHOOP only redirects to URIs you registered. The login command listens on that address to catch the callback.
4. Copy the **Client ID** and **Client Secret**. Keep the secret out of git, chat, and screenshots.

Docs for this flow: [Getting started](https://developer.whoop.com/docs/developing/getting-started/) and [OAuth 2.0](https://developer.whoop.com/docs/developing/oauth).

## Install

Node.js 20 or newer is required.

**With npx**, from GitHub (no clone required):

```bash
npx -y github:rembaumann/whoop-mcp --help
```

That uses the default branch. After the package is published to npm, `npx -y whoop-mcp` is the same command.

**From a checkout**:

```bash
git clone https://github.com/rembaumann/whoop-mcp.git
cd whoop-mcp
npm install
npm run build
node dist/cli.js --help
```

`npm install` from a git checkout runs the build. You can also point an MCP client at `dist/cli.js` directly.

## Sign in

Put your app credentials in the environment, or in a file outside the repo.

```bash
export WHOOP_CLIENT_ID="your-client-id"
export WHOOP_CLIENT_SECRET="your-client-secret"
# Optional. This default must match the redirect URI on the WHOOP app.
export WHOOP_REDIRECT_URI="http://127.0.0.1:8787/callback"
```

Or copy the example config and fill it in:

```bash
mkdir -p ~/.whoop-mcp
cp config.example.json ~/.whoop-mcp/config.json
# edit ~/.whoop-mcp/config.json
```

Environment variables win over the config file. Then:

```bash
npx -y github:rembaumann/whoop-mcp login
```

From a checkout, run `node dist/cli.js login` instead.

The command opens a browser, WHOOP asks you to approve the scopes, and the redirect lands on `127.0.0.1`. Tokens are written to `~/.whoop-mcp/tokens.json` with permissions `0600`.

Check or remove them:

```bash
npx -y github:rembaumann/whoop-mcp status
npx -y github:rembaumann/whoop-mcp logout
npx -y github:rembaumann/whoop-mcp logout --revoke
```

`status` prints the expiry and scopes, never the tokens. `logout` deletes the local token file. `logout --revoke` also calls `DELETE /v2/user/access`.

Access tokens are short-lived. The server refreshes them automatically and stores the rotated refresh token. WHOOP invalidates the previous refresh token as soon as a new one is issued, so refreshes are serialized.

## Configure an MCP client

Use stdio. The client starts the process; you do not run a server yourself. Sign in with `whoop-mcp login` in a terminal first, using the same `WHOOP_CLIENT_ID`, `WHOOP_CLIENT_SECRET`, and token path the client will use.

### Claude Desktop

Edit `claude_desktop_config.json` (on macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "whoop": {
      "command": "npx",
      "args": ["-y", "github:rembaumann/whoop-mcp"],
      "env": {
        "WHOOP_CLIENT_ID": "your-client-id",
        "WHOOP_CLIENT_SECRET": "your-client-secret"
      }
    }
  }
}
```

After an npm publish, you can replace the args with `["-y", "whoop-mcp"]`.

From a checkout, replace the command with an absolute path:

```json
{
  "mcpServers": {
    "whoop": {
      "command": "node",
      "args": ["/absolute/path/to/whoop-mcp/dist/cli.js"],
      "env": {
        "WHOOP_CLIENT_ID": "your-client-id",
        "WHOOP_CLIENT_SECRET": "your-client-secret"
      }
    }
  }
}
```

Restart Claude Desktop after saving.

### Cursor

Add the same `mcpServers` entry in Cursor Settings → MCP, or in `~/.cursor/mcp.json` (global) or `.cursor/mcp.json` (project). Restart the MCP server from the Cursor MCP panel after saving.

### Other stdio clients

Any client that can spawn a process can use:

| | |
| --- | --- |
| Command | `npx` |
| Args | `-y`, `github:rembaumann/whoop-mcp` |
| Env | `WHOOP_CLIENT_ID`, `WHOOP_CLIENT_SECRET` |

That includes the [MCP Inspector](https://github.com/modelcontextprotocol/inspector):

```bash
npx @modelcontextprotocol/inspector node dist/cli.js
```

### Optional Streamable HTTP

stdio is the default. To serve MCP over HTTP on loopback:

```bash
npx -y github:rembaumann/whoop-mcp serve --transport http --port 3333
```

The endpoint is `http://127.0.0.1:3333/mcp`. Point a client that supports Streamable HTTP at that URL. The process still reads the same local token file. Binding to a non-loopback host is possible with `--host`, and it prints a warning: this is personal health data, so leave it on `127.0.0.1` unless you add your own access control.

## Tools

Responses are the JSON objects WHOOP returns. Field names match the [public API reference](https://developer.whoop.com/api) and the [OpenAPI document](https://api.prod.whoop.com/developer/doc/openapi.json). `score_state` is `SCORED`, `PENDING_SCORE`, or `UNSCORABLE`. Score objects are present when the state is `SCORED`.

| Tool | WHOOP endpoint | Scope |
| --- | --- | --- |
| `whoop_auth_status` | local token file only | — |
| `whoop_get_profile` | `GET /v2/user/profile/basic` | `read:profile` |
| `whoop_get_body_measurement` | `GET /v2/user/measurement/body` | `read:body_measurement` |
| `whoop_list_cycles` | `GET /v2/cycle` | `read:cycles` |
| `whoop_get_cycle` | `GET /v2/cycle/{cycleId}` | `read:cycles` |
| `whoop_list_recoveries` | `GET /v2/recovery` | `read:recovery` |
| `whoop_get_recovery_for_cycle` | `GET /v2/cycle/{cycleId}/recovery` | `read:recovery` |
| `whoop_list_sleep` | `GET /v2/activity/sleep` | `read:sleep` |
| `whoop_get_sleep` | `GET /v2/activity/sleep/{sleepId}` | `read:sleep` |
| `whoop_get_sleep_for_cycle` | `GET /v2/cycle/{cycleId}/sleep` | `read:sleep` |
| `whoop_list_workouts` | `GET /v2/activity/workout` | `read:workout` |
| `whoop_get_workout` | `GET /v2/activity/workout/{workoutId}` | `read:workout` |

List tools take:

- `start` — inclusive. An ISO-8601 timestamp, or `YYYY-MM-DD` (UTC midnight).
- `end` — exclusive. WHOOP defaults this to now. A date-only value includes that whole UTC day (`2022-04-24` is sent as `2022-04-25T00:00:00.000Z`).
- `limit` — 1 to 25. WHOOP's default is 10.
- `next_token` — the `next_token` from the previous response. It is sent as the query parameter `nextToken`. When `next_token` is absent, there are no further pages.

Cycle strain and workout strain are on a 0–21 scale. Recovery score and the sleep percentages are 0–100. Sleep stage times are milliseconds. A cycle with no `end` is the one currently in progress.

WHOOP's default rate limits are 100 requests per minute and 10,000 per day. A `429` comes back as a tool error and includes the reset hint when WHOOP sends one.

## Configuration reference

| Variable | Default | Purpose |
| --- | --- | --- |
| `WHOOP_CLIENT_ID` | — | OAuth client id from your WHOOP app |
| `WHOOP_CLIENT_SECRET` | — | OAuth client secret |
| `WHOOP_REDIRECT_URI` | `http://127.0.0.1:8787/callback` | Must match the app's registered redirect URI |
| `WHOOP_TOKEN_PATH` | `~/.whoop-mcp/tokens.json` | Where the access and refresh tokens are stored |
| `WHOOP_CONFIG_PATH` | `~/.whoop-mcp/config.json` | Optional JSON file with `client_id`, `client_secret`, and `redirect_uri` |

## Privacy

- The tools only read WHOOP data, plus the local token file. `logout --revoke` is the one write, and it is a CLI command, not a tool.
- Your client secret and tokens are not committed by this repository. `.gitignore` ignores `.env`, `config.json`, and `tokens.json`. Do not paste them into an issue.
- Tokens are stored in `~/.whoop-mcp/tokens.json` (`0600`) inside `~/.whoop-mcp` (`0700`). The MCP client you configure is the thing that receives API responses.
- This server does not have an account of its own and does not send your WHOOP data to a project-operated backend. Traffic goes to `api.prod.whoop.com` and back to the assistant on your machine.
- Disconnect by running `whoop-mcp logout --revoke`, and remove the app in the WHOOP Developer Dashboard if you no longer want it to be able to request access.
- Error messages strip the client secret and refresh token if WHOOP echoes them.

## Development

```bash
npm install
npm test
npm run typecheck
npm run build
```

Tests use Node's built-in test runner and mocked WHOOP responses, including the sample records published in the API docs. CI runs the same checks on Node 20 and 22.

## License

[MIT](./LICENSE)
