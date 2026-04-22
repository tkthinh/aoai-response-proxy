# Codex CLI Azure OpenAI Response Proxy

## Summary

A small OpenAI-compatible proxy for Codex CLI, hosted on Azure App Service and backed by Azure OpenAI. The proxy accepts OpenAI-style requests, authenticates callers with a shared bearer token, authenticates to Azure OpenAI with Managed Identity, and forwards both streaming and non-streaming responses.

## Goals

- Expose OpenAI-compatible endpoints for Codex CLI
- Use Managed Identity for outbound Azure OpenAI auth
- Avoid Azure OpenAI API keys
- Preserve streaming behavior
- Keep the service thin, simple, and App Service-friendly

## Non-goals

- Full OpenAI API parity
- Multi-tenant isolation
- Complex tool orchestration
- Advanced replay/observability features
- Per-user rate limiting or backend routing

## Architecture

**Flow:** Codex CLI → Response Proxy → Azure OpenAI

### Client
Codex CLI is configured with:
- `OPENAI_BASE_URL=https://<proxy-host>`
- `OPENAI_API_KEY=<proxy-secret>`

### Proxy
Responsibilities:
- validate inbound bearer auth
- validate and minimally rewrite requests
- acquire Azure bearer token with Managed Identity
- forward requests to Azure OpenAI
- pass through status codes, headers, and streaming bodies
- log safely with redaction and truncation

### Backend
Use the Azure OpenAI endpoint family:
- `https://<resource>.openai.azure.com`

Prefer OpenAI-compatible Azure routes:
- `/openai/v1/models`
- `/openai/v1/responses`
- `/openai/v1/chat/completions`

Do not mix URL styles unless explicitly required.

## Hosting

Deploy as a dedicated **Azure App Service**.

Why:
- long-running HTTP API fits App Service well
- streaming support is important
- cold starts are less desirable for CLI usage
- easier operational model than Function App for this proxy shape

## Authentication

### Inbound
Use a shared secret:
- `PROXY_API_KEY`

Expected caller header:
- `Authorization: Bearer <token>`

### Outbound
Use Managed Identity only:
- prefer system-assigned Managed Identity
- support user-assigned identity via `AZURE_CLIENT_ID` if needed
- do not use Azure OpenAI API keys

### Token scope
Standardize on the scope that matches the actual Azure OpenAI configuration in use. Common candidates:
- `https://cognitiveservices.azure.com/.default`
- `https://ai.azure.com/.default`

This must be verified in the target environment before production rollout.

## API Surface

### `GET /healthz`
Returns:
```json
{"status":"ok"}
```

### `GET /v1/models`
Proxy Azure OpenAI model listing for OpenAI-compatible clients.

### `POST /v1/responses`
Primary endpoint for Codex CLI. Must support streaming and non-streaming passthrough.

### `POST /v1/chat/completions`
Compatibility endpoint for clients that still use chat completions.

## Request Rules

For JSON body endpoints:
- require `Content-Type: application/json`
- require request body to be a JSON object
- require `model` to be a non-empty string
- return `400 Bad Request` on validation failure

Compatibility rewriting should be minimal and deterministic, for example:
- model alias mapping
- removal of unsupported fields
- path-specific fixes only when necessary

## Streaming

If `"stream": true`:
- send upstream request in streaming mode
- do not buffer the full response
- forward upstream bytes as they arrive
- preserve upstream status code
- close resources correctly

If upstream fails before a stream begins:
- return upstream error body directly
- preserve upstream status code

## Configuration

Environment variables:

- `AZURE_OPENAI_BASE_URL` — Azure OpenAI base URL
- `AZURE_OPENAI_API_VERSION` — optional, only if required by chosen URL style
- `AZURE_OPENAI_TOKEN_SCOPE` — Managed Identity token scope
- `AZURE_CLIENT_ID` — optional for user-assigned Managed Identity
- `PROXY_API_KEY` — inbound shared secret
- `MODEL_ALIASES` — optional model alias mapping
- `LOG_LEVEL` — logging level
- `LOG_BODY_LIMIT` — truncation limit for logged bodies
- `PORT` — server port

## Error Handling

- `400 Bad Request` — invalid JSON, invalid body shape, missing/invalid `model`
- `401 Unauthorized` — missing or invalid proxy bearer token
- `502 Bad Gateway` — token acquisition failure, network failure, or upstream connection issue
- Upstream HTTP errors should generally be returned with original status code and body

## Logging

Must log:
- request method and path
- request ID / correlation ID
- redacted headers
- truncated request body where applicable
- upstream URL and method
- upstream status
- truncated upstream error body
- latency if available

Must not log:
- raw `PROXY_API_KEY`
- raw Azure bearer tokens
- large untruncated sensitive payloads

## Security

- Enable HTTPS only
- Require `PROXY_API_KEY` at minimum
- Store secrets in App Service settings or Key Vault references
- Use least-privilege Azure RBAC for the Managed Identity
- Future hardening can include private networking, APIM, Front Door, or IP restrictions

## Operational Notes

- Only Azure-deployed models available in the target Azure OpenAI resource can be used
- If Codex model names differ from Azure deployment names, configure explicit aliases
- Prioritize correctness of `/v1/responses`; `/v1/chat/completions` is secondary compatibility
- Keep the proxy thin and avoid unnecessary business logic

## Acceptance Criteria

The proxy is acceptable when it:
1. runs on Azure App Service
2. uses Managed Identity for outbound Azure OpenAI auth
3. uses no Azure OpenAI API key
4. requires inbound bearer auth via `PROXY_API_KEY`
5. returns success on `GET /healthz`
6. supports `GET /v1/models`
7. forwards `POST /v1/responses`
8. preserves streaming behavior
9. supports `POST /v1/chat/completions`
10. surfaces Azure upstream errors clearly
11. redacts secrets and truncates logged bodies

## Rollout

### Phase 1
- deploy to non-production App Service
- enable Managed Identity
- grant Azure OpenAI RBAC
- verify `/v1/models` and `/v1/responses`
- verify streaming with curl

### Phase 2
- point Codex CLI to the proxy
- validate interactive requests and longer streams
- validate error visibility

### Phase 3
- harden auth and logging
- rotate proxy secret
- document supported model names
- optionally add private access controls