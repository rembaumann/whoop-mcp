import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createWhoopServer, type WhoopServerDeps } from "./server.js";

export interface HttpServerOptions extends WhoopServerDeps {
  host: string;
  port: number;
}

/**
 * Optional Streamable HTTP transport. Binds to loopback unless a host is
 * passed explicitly. Each POST gets its own stateless server instance.
 */
export async function startHttpServer(options: HttpServerOptions): Promise<{ url: string; close: () => Promise<void> }> {
  const loopback = options.host === "127.0.0.1" || options.host === "localhost" || options.host === "::1";

  const httpServer = createServer(async (request, response) => {
    try {
      await handle(request, response, options, loopback);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Internal error";
      if (!response.headersSent) {
        response.writeHead(500, { "Content-Type": "application/json" });
      }
      response.end(JSON.stringify({ error: message }));
    }
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(options.port, options.host, () => {
      httpServer.off("error", reject);
      resolve();
    });
  });

  const address = httpServer.address();
  const port = address && typeof address === "object" ? address.port : options.port;
  const hostForUrl = options.host === "::1" ? "[::1]" : options.host;
  const url = `http://${hostForUrl}:${port}/mcp`;

  return {
    url,
    close: () =>
      new Promise((resolve, reject) => {
        httpServer.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

async function handle(
  request: IncomingMessage,
  response: ServerResponse,
  deps: WhoopServerDeps,
  loopback: boolean,
): Promise<void> {
  if (loopback) {
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    response.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Accept, Mcp-Session-Id, MCP-Protocol-Version, Last-Event-ID",
    );
  }

  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }

  const host = request.headers.host ?? "127.0.0.1";
  const url = new URL(request.url ?? "/", `http://${host}`);

  if (url.pathname === "/health") {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ ok: true }));
    return;
  }

  if (url.pathname !== "/mcp") {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  if (loopback && !isLoopbackHost(request.headers.host)) {
    response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("This server only accepts loopback Host headers.");
    return;
  }

  let parsedBody: unknown;
  if (request.method === "POST") {
    parsedBody = await readJsonBody(request);
  }

  const server = createWhoopServer(deps);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  response.on("close", () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(request, response, parsedBody);
}

function isLoopbackHost(hostHeader: string | undefined): boolean {
  if (!hostHeader) return false;
  let hostname = hostHeader;
  if (hostname.startsWith("[")) {
    const end = hostname.indexOf("]");
    hostname = end === -1 ? hostname : hostname.slice(1, end);
  } else {
    hostname = hostname.replace(/:\d+$/, "");
  }
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";
}

function readJsonBody(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 1_000_000) {
        reject(new Error("Request body is too large."));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) {
        resolve(undefined);
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("Request body must be JSON."));
      }
    });
    request.on("error", reject);
  });
}
