import { timingSafeEqual } from "node:crypto";
import { config } from "./config.js";

function extractBearerToken(headers) {
  const authHeader = headers.authorization;

  if (!authHeader) {
    return null;
  }

  const match = /^Bearer\s+(.+)$/i.exec(authHeader);
  return match?.[1] ?? null;
}

function safeCompare(a, b) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);

  if (left.length !== right.length) {
    return false;
  }

  return timingSafeEqual(left, right);
}

export function validateInboundAuth(headers) {
  if (!config.proxyApiKey) {
    return true;
  }

  const token = extractBearerToken(headers);

  if (!token) {
    return false;
  }

  return safeCompare(token, config.proxyApiKey);
}