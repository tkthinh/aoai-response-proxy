import { randomUUID } from "node:crypto";
import {
  acquireManagedIdentityToken,
  buildAzureUrl,
  copyResponseHeaders,
  rewritePayloadForAzure,
  validateIncomingPayload
} from "./azure.js";
import { validateInboundAuth } from "./auth.js";
import { readJsonBody, redactHeaders, truncate } from "./http.js";
import { log } from "./logger.js";
import { badGateway, badRequest, unauthorized } from "./responses.js";

async function proxyUpstreamRequest(request, response, endpointPath, options = {}) {
  const { upstreamMethod = request.method, requestBody, stream = false } = options;
  const requestId = randomUUID();
  const startedAt = Date.now();

  if (!validateInboundAuth(request.headers)) {
    log("WARNING", "Inbound authentication failed", {
      requestId,
      path: request.url,
      method: request.method
    });
    unauthorized(response, requestId);
    return;
  }

  let upstreamUrl;
  let accessToken;

  try {
    upstreamUrl = buildAzureUrl(endpointPath);
    accessToken = await acquireManagedIdentityToken();
  } catch (error) {
    log("ERROR", "Failed preparing upstream request", {
      requestId,
      error: error.message
    });
    badGateway(response, requestId, error.message);
    return;
  }

  log("INFO", "Proxying request", {
    requestId,
    method: request.method,
    path: request.url,
    upstreamMethod,
    upstreamUrl: upstreamUrl.toString(),
    headers: redactHeaders(request.headers),
    requestBody: truncate(requestBody),
    stream
  });

  let upstreamResponse;

  try {
    const headers = {
      authorization: `Bearer ${accessToken}`
    };

    if (requestBody != null) {
      headers["content-type"] = "application/json";
    }

    upstreamResponse = await fetch(upstreamUrl, {
      method: upstreamMethod,
      headers,
      body: requestBody
    });
  } catch (error) {
    log("ERROR", "Upstream request failed", {
      requestId,
      upstreamUrl: upstreamUrl.toString(),
      error: error.message
    });
    badGateway(response, requestId, `Upstream request failed: ${error.message}`);
    return;
  }

  const responseHeaders = copyResponseHeaders(upstreamResponse.headers, requestId);

  if (!upstreamResponse.ok) {
    const errorBody = await upstreamResponse.text();

    log("WARNING", "Upstream returned error response", {
      requestId,
      upstreamStatus: upstreamResponse.status,
      upstreamBody: truncate(errorBody),
      durationMs: Date.now() - startedAt
    });

    response.writeHead(upstreamResponse.status, responseHeaders);
    response.end(errorBody);
    return;
  }

  if (stream && upstreamResponse.body) {
    response.writeHead(upstreamResponse.status, responseHeaders);

    try {
      for await (const chunk of upstreamResponse.body) {
        response.write(chunk);
      }

      response.end();

      log("INFO", "Completed streaming response", {
        requestId,
        upstreamStatus: upstreamResponse.status,
        durationMs: Date.now() - startedAt
      });
    } catch (error) {
      log("ERROR", "Streaming response failed", {
        requestId,
        error: error.message,
        durationMs: Date.now() - startedAt
      });

      if (!response.headersSent) {
        badGateway(response, requestId, `Streaming response failed: ${error.message}`);
      } else {
        response.destroy(error);
      }
    }

    return;
  }

  const responseText = await upstreamResponse.text();

  log("INFO", "Completed non-streaming response", {
    requestId,
    upstreamStatus: upstreamResponse.status,
    responseBody: truncate(responseText),
    durationMs: Date.now() - startedAt
  });

  response.writeHead(upstreamResponse.status, {
    ...responseHeaders,
    "content-length": Buffer.byteLength(responseText)
  });
  response.end(responseText);
}

export async function handleProxyRequest(request, response, endpointPath) {
  if (!request.headers["content-type"]?.toLowerCase().includes("application/json")) {
    badRequest(response, randomUUID(), "Content-Type must be application/json");
    return;
  }

  let payload;

  try {
    payload = (await readJsonBody(request)).parsed;
  } catch (error) {
    badRequest(response, randomUUID(), error.message);
    return;
  }

  const validationError = validateIncomingPayload(payload);

  if (validationError) {
    badRequest(response, randomUUID(), validationError);
    return;
  }

  const rewrittenPayload = rewritePayloadForAzure(payload);

  await proxyUpstreamRequest(request, response, endpointPath, {
    upstreamMethod: "POST",
    requestBody: JSON.stringify(rewrittenPayload),
    stream: rewrittenPayload.stream === true
  });
}

export async function handleModelsRequest(request, response) {
  await proxyUpstreamRequest(request, response, "/models", {
    upstreamMethod: "GET"
  });
}
