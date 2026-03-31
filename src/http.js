import { config } from "./config.js";

export function truncate(value, limit = config.logBodyLimit) {
  if (value == null) {
    return value;
  }

  const stringValue = typeof value === "string" ? value : JSON.stringify(value);

  if (stringValue.length <= limit) {
    return stringValue;
  }

  return `${stringValue.slice(0, limit)}…[truncated]`;
}

export function redactHeaders(headers) {
  const redacted = {};

  for (const [key, value] of Object.entries(headers)) {
    if (["authorization", "x-api-key"].includes(key.toLowerCase())) {
      redacted[key] = "[redacted]";
    } else {
      redacted[key] = value;
    }
  }

  return redacted;
}

export function sendJson(response, statusCode, payload, headers = {}) {
  const body = JSON.stringify(payload);

  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    ...headers
  });

  response.end(body);
}

export async function readJsonBody(request) {
  const chunks = [];

  for await (const chunk of request) {
    chunks.push(chunk);
  }

  const rawBody = Buffer.concat(chunks).toString("utf8");

  if (!rawBody) {
    throw new Error("Request body is required");
  }

  let parsed;

  try {
    parsed = JSON.parse(rawBody);
  } catch {
    throw new Error("Request body must be valid JSON");
  }

  return { rawBody, parsed };
}