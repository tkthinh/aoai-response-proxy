import { createServer } from "node:http";
import { config } from "./config.js";
import { sendJson } from "./http.js";
import { log } from "./logger.js";
import { handleProxyRequest } from "./proxy.js";
import { notFound } from "./responses.js";

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

  if (request.method === "GET" && url.pathname === "/healthz") {
    sendJson(response, 200, { status: "ok" });
    return;
  }

  if (request.method === "POST" && url.pathname === "/v1/responses") {
    await handleProxyRequest(request, response, "/responses");
    return;
  }

  if (request.method === "POST" && url.pathname === "/v1/chat/completions") {
    await handleProxyRequest(request, response, "/chat/completions");
    return;
  }

  notFound(response);
});

server.listen(config.port, () => {
  log("INFO", "Server started", {
    port: config.port
  });
});