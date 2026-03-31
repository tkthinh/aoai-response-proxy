import { config } from "./config.js";
import { truncate } from "./http.js";

function normalizeBaseUrl(baseUrl) {
  return baseUrl.replace(/\/+$/, "");
}

export function buildAzureUrl(endpointPath) {
  if (!config.azureOpenAiBaseUrl) {
    throw new Error("AZURE_OPENAI_BASE_URL is not configured");
  }

  const normalizedBase = normalizeBaseUrl(config.azureOpenAiBaseUrl);
  const baseWithRoute = normalizedBase.endsWith("/openai/v1") ? normalizedBase : `${normalizedBase}/openai/v1`;
  const url = new URL(`${baseWithRoute}${endpointPath}`);

  if (config.azureOpenAiApiVersion && !baseWithRoute.endsWith("/openai/v1")) {
    url.searchParams.set("api-version", config.azureOpenAiApiVersion);
  }

  return url;
}

export function validateIncomingPayload(payload) {
  if (payload == null || Array.isArray(payload) || typeof payload !== "object") {
    return "Request body must be a JSON object";
  }

  if (typeof payload.model !== "string" || !payload.model.trim()) {
    return "Request body must include a non-empty string model field";
  }

  return null;
}

export function rewritePayloadForAzure(payload) {
  const rewritten = { ...payload };
  const alias = config.modelAliases[rewritten.model];

  if (alias) {
    rewritten.model = alias;
  }

  delete rewritten.api_key;

  return rewritten;
}

export async function acquireManagedIdentityToken() {
  const endpoint = process.env.IDENTITY_ENDPOINT ?? process.env.MSI_ENDPOINT;
  const secret = process.env.IDENTITY_HEADER ?? process.env.MSI_SECRET;

  if (!endpoint || !secret) {
    throw new Error("Managed Identity endpoint is unavailable in the current environment");
  }

  const url = new URL(endpoint);
  url.searchParams.set("resource", config.tokenScope.replace(/\/\.default$/, "/"));
  url.searchParams.set("api-version", "2019-08-01");

  if (config.azureClientId) {
    url.searchParams.set("client_id", config.azureClientId);
  }

  const tokenResponse = await fetch(url, {
    headers: {
      "x-identity-header": secret,
      Metadata: "true"
    }
  });

  if (!tokenResponse.ok) {
    const errorText = await tokenResponse.text();
    throw new Error(`Managed Identity token request failed (${tokenResponse.status}): ${truncate(errorText)}`);
  }

  const tokenPayload = await tokenResponse.json();

  if (!tokenPayload.access_token) {
    throw new Error("Managed Identity token response did not include access_token");
  }

  return tokenPayload.access_token;
}

export function copyResponseHeaders(upstreamHeaders, requestId) {
  const headers = {
    "x-request-id": requestId
  };

  const allowList = [
    "content-type",
    "cache-control",
    "x-ms-request-id",
    "apim-request-id",
    "retry-after"
  ];

  for (const headerName of allowList) {
    const value = upstreamHeaders.get(headerName);

    if (value) {
      headers[headerName] = value;
    }
  }

  return headers;
}