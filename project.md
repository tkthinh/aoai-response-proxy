# Codex CLI Azure OpenAI Response Proxy on Azure App Service

## 1. Overview

This document defines an internal **OpenAI-compatible response proxy** intended for use by **Codex CLI**.

The proxy will:

- expose OpenAI-style HTTP endpoints to clients such as Codex CLI
- authenticate inbound requests to the proxy
- authenticate outbound requests to **Azure OpenAI** using **Managed Identity**
- forward requests to Azure OpenAI
- support **streaming responses**
- return Azure output in a form compatible enough for Codex CLI usage

This proxy is specifically intended to fit the current environment:

- Azure-hosted infrastructure
- App Service already in use
- preference to avoid Azure API keys
- Managed Identity already working in your environment
- Azure OpenAI endpoint in use
- Codex/CLI-style clients that expect `/v1/responses` and/or `/v1/chat/completions`

---

## 2. Background and Problem Statement

Codex CLI expects an **OpenAI-compatible API surface**, typically:

- `POST /v1/responses`
- sometimes `POST /v1/chat/completions`

and authenticates using:

- `OPENAI_BASE_URL`
- `OPENAI_API_KEY`

In your environment, Azure OpenAI is the actual model backend, and outbound authentication should use:

- **Microsoft Entra ID**
- **Managed Identity**
- **no Azure API API key**

Therefore, a proxy is required to bridge:

### Inbound
Codex CLI → OpenAI-style endpoint with bearer token/API-key-like auth

### Outbound
Proxy → Azure OpenAI using Managed Identity bearer token

The proxy must preserve streaming behavior because Codex CLI is sensitive to response shape and latency characteristics.

---

## 3. Goals

### Primary goals
- Provide an OpenAI-compatible HTTP facade for Codex CLI
- Use **Managed Identity** for outbound auth to Azure OpenAI
- Avoid Azure OpenAI API keys entirely
- Support **streaming passthrough**
- Support at least:
  - `POST /v1/responses`
  - `POST /v1/chat/completions`
- Be deployable on **Azure App Service**
- Keep implementation minimal and operationally understandable

### Non-goals for v1
- full OpenAI API surface parity
- function/tool orchestration beyond passthrough
- custom rate limiting per user
- model routing across multiple backends
- token caching optimization beyond SDK defaults
- request transformation beyond compatibility necessities
- advanced observing/replaying of streams
- multi-tenant isolation

---

## 4. Chosen Hosting Model

## Azure App Service

The proxy will be deployed as a dedicated **Azure App Service**.

### Why App Service
This is the right fit for the current environment because:
- you already operate App Service successfully
- spare App Service Plan capacity exists
- the workload is a long-running HTTP API
- streaming HTTP support is needed
- cold start behavior should be minimized
- future extension may require middleware, logging, policy, and health probes

### Why not Function App
Function App is not the preferred choice here because:
- streaming proxy behavior is generally better suited to a continuously running API app
- cold starts are less desirable for CLI interactions
- proxy workloads tend to evolve into more stateful HTTP services operationally

---

## 5. High-Level Architecture

### Request flow

Codex CLI → Response Proxy → Azure OpenAI

### Components

#### 5.1 Codex CLI
Configured with:
- `OPENAI_BASE_URL=https://<proxy-host>`
- `OPENAI_API_KEY=<proxy-secret>`

Codex CLI should call the proxy as though it were an OpenAI-compatible endpoint.

#### 5.2 Response Proxy
Hosted on Azure App Service.

Responsibilities:
- accept inbound OpenAI-style requests
- validate inbound authorization
- parse and validate JSON payload
- rewrite request payload when necessary for Azure compatibility
- obtain Azure bearer token via Managed Identity
- call Azure OpenAI
- stream upstream bytes back to Codex CLI
- preserve status codes and relevant headers
- log safely

#### 5.3 Azure OpenAI
Receives outbound requests from the proxy using Managed Identity.

Endpoint family:
- `https://<resource>.openai.azure.com`

Target API shape:
- typically `/openai/v1/responses`
- typically `/openai/v1/chat/completions`

This document assumes Azure OpenAI, not generic Cognitive Services or Foundry inference endpoints.

---

## 6. Key Design Decision

## Use Azure OpenAI endpoint, not generic Cognitive Services endpoint

The proxy must target the **Azure OpenAI** endpoint family:

- `https://<resource>.openai.azure.com`

not:
- `https://<resource>.cognitiveservices.azure.com`

for this Codex-oriented proxy.

### Reason
Your environment has already shown that:
- Azure OpenAI endpoint works for normal OpenAI-like usage
- Codex expects `/responses`
- compatibility is much closer on the Azure OpenAI v

Using the older or broader Cognitive Services endpoint family would add unnecessary ambiguity and increase the chance of path incompatibility.

---

## 7. Authentication Model

## 7.1 Inbound authentication to proxy

Codex CLI requires an OpenAI-style secret and will send:

- `Authorization: Bearer <token>`

The proxy will validate that inbound bearer token against a configured proxy secret.

### v1 design
Use a single configured inbound shared secret:

- `PROXY_API_KEY`

This is **not** an Azure API key.
It is only the proxy’s own access control secret so that Codex CLI can authenticate in the conventional OpenAI-compatible way.

### Security note
This is acceptable for v1 because Codex CLI expects this auth pattern.
However, it is weaker than Entra-based inbound authentication and should be treated as an application secret.

### Future option
Later, the proxy may be placed behind:
- Entra auth gateway
- API Management
-- private networking
- workload identity-aware caller flows

But v1 will use a bearer-like bearer secret for Codex compatibility.

---

## 7.2 Outbound authentication to Azure OpenAI

The proxy must use:
- **Managed Identity**
- no Azure OpenAI API key
- no client secret
- no certificate secret in app config unless user-assigned MI requires client ID selection

### Managed identity mode
Preferred:
- **system-assigned managed identity**

Optional:
- **user-assigned managed identity** if you intentionally want identity reuse

### Token scope
For Azure OpenAI v OpenAI v1 style access, use the scope appropriate to the Azure OpenAI endpoint as documented in the current Azure docs in your environment.

Because your environment has intersected multiple Azure AI surfaces, this must be verified against the final chosen Azure OpenAI client pattern.

### Recommended for this proxy document
Use the Azure OpenAI scope consistent with your current working Azure OpenAI implementation.
If using the modern Azure OpenAI v OpenAI-compatible v1 path per current Microsoft docs, that may be:

- `https://ai.azure.com/.default`

However, the sample code currently uses:

- `https://cognitiveservices.azure.com/.default`

This mismatch must be resolved in implementation based on the exact Azure OpenAI auth pattern you have validated.

## Design requirement
Before production rollout, confirm which scope works against your exact Azure OpenAI endpoint with Managed Identity and standardize on it.

---

## 8. API Surface

The proxy will expose the following endpoints.

### 8.1 `GET /healthz`
Health endpoint.

Returns:
```json
{"status":"ok"}
```

### 8.2 `POST /v1/responses`
Primary endpoint for Codex CLI and-compatible usage.

Responsibilities:
- accept OpenAI-style Responses API request
- validate request
- rewrite payload as needed
- forward to Azure OpenAI Responses API
- support streaming and non-streaming responses

### 8.3 `POST /v1/chat/completions`
Compatibility endpoint for clients or fallback behaviors that still use chat completions.

Responsibilities:
- accept OpenAI-style Chat Completions request
- validate request
- rewrite payload as needed
- forward to Azure OpenAI Chat Completions API
- support streaming and non-streaming responses

---

## 9. Request Compatibility Requirements

## 9.1 General requirements
The proxy must accept JSON request bodies and require:
- content type: `application/json`
- request body object
- string `model` field

If these conditions are not met, return `400 Bad Request`.

## 9.2 Payload rewriting
The proxy may need to rewrite payloads for Azure compatibility.

Examples:
- model name normalization
- removal or transformation of unsupported fields
- field name mapping between OpenAI-compatible and Azure-compatible request formats
- path-specific payload fixes

This logic belongs in a compatibility layer, not in endpoint handlers directly.

### Requirement
All rewrite behavior must be deterministic, minimal, and documented.

### Non-goal
The proxy is not required to emulate unsupported OpenAI features fully.

---

## 10. Streaming Requirements

Streaming is a core requirement because Codex CLI may depend on progressive output behavior.

## Required behavior
If request payload includes:

```json
"stream": true
```

the proxy must:
- send upstream request in streaming mode
- not buffer the full upstream response before replying
- stream upstream bytes back to the caller as they arrive
- preserve upstream status code
- close upstream/client resources reliably after stream completion

## Error behavior for streaming
If upstream returns an error status before a successful stream begins:
- read upstream body
- return error body directly to caller
- preserve upstream status code
- ensure connections are closed

---

## 11. Configuration

The proxy should be configurable entirely via environment variables.

## Required variables

### `AZ AZURE_OPENAI_BASE_URL`
Azure OpenAI base URL.

Expected example:
- `https://<resource>.openai.azure.com`

or, if the implementation intentionally uses a vopenai/v1`-style base convention, thathttps://<resource>.openai.azure.com/openopenai/v1`

The implementation must standardize one convention and URL helpers must be consistent with it.

### `AZURE_OPENAI_API_VERSION`
Used only if the proxy path construction requires versioned query parameters.

This may be unnecessary if the proxy uses Azure OpenAI’s OpenAI-compatible `/openai/v1/...` route style.

### `AZURE_CLIENT_ID`
Optional.
Only needed if using **user-assigned managed identity**.

### `PROXY_API_KEY`
Required for inbound proxy authentication in v1.

### `LOG_LEVEL`
Logging level, e.g. `INFO`, `DEBUG`, `WARNING`.

### `LOG_BODY_LIMIT`
Maximum characters/bytes of request/response body to log after truncation.

---

## 12. Environment-Specific Design Guidance

Given your current environment:

- Azure App Service is already in use
- Managed Identity already works from App Service to Azure AI
- Azure OpenAI endpoint is now the intended backend
- Codex CLI expects OpenAI-compatible base URL + API key
- LiteLLM is not the desired component for this Codex path if `/responses` compatibility remains problematic

## Recommended deployment pattern
Use a **dedicated small App Service** for the Codex proxy rather than routing Codex through LiteLLM.

### Why
- reduces one layer of translation
- removes LiteLLM `/responses` compatibility ambiguity
- makes troubleshooting much simpler
- lets you tightly control the compatibility surface just for Codex

This is a cleaner architecture for Codex than:
Codex CLI → LiteLLM → Azure OpenAI

Instead prefer:
Codex CLI → Codex Proxy → Azure OpenAI

---

## 13. Azure URL Construction Requirements

This is a sensitive area and must be handled carefully.

The sample code uses helper functions such as:
- `build_azure_url`
- `rewrite_payload_for_azure`

These helpers must be designed around **one clear Azure endpoint style**.

## Preferred style for this proxy
Use Azure OpenAI OpenAI-compatible route style:
- `/openai/v1/responses`
- `/openai/v1/chat/completions`

### Avoid mixing paradigms
Do not mix:
- `/openai/v1/...`
with
- `?api-version=...`
unless the exact endpoint specification requires it.

This matters because your earlier compatibility issues strongly suggest that mixed path/version styles can cause breakage.

## Requirement
The final implementation must choose one validated URL construction strategy and use it consistently.

---

## 14. Token Acquisition Requirements

The proxy must obtain Azure bearer tokens using Managed Identity.

## v1 behavior
Each request may call token acquisition through Azure Identity.

## Implementation note
Azure Identity libraries may internally cache tokens, but the proxy should not assume this blindly unless verified.

## Requirement
Token acquisition failures must return a clear upstream/proxy auth error and be logged with request correlation ID.

---

## 15. Error Handling

## Validation errors
Return `400 Bad Request` for:
- invalid JSON
- non-object JSON
- missing or non-string `model`

## Inbound auth errors
Return `401 Unauthorized` for:
- missing Authorization header when `PROXY_API_KEY` is configured
- malformed Authorization header
- incorrect proxy bearer token

## Upstream connection failures
Return `502 Bad Gateway` for:
- network failures to Azure OpenAI
- DNS resolution issues
- connect/read exceptions before valid upstream response

## Upstream HTTP errors
Return upstream body and status code as-is when reasonable.

Examples:
- 400 from Azure OpenAI
- 401 from Azure OpenAI
- 403 from Azure OpenAI
- 404 from Azure OpenAI
- 429 from Azure OpenAI
- 500/503 from Azure OpenAI

### Reason
Codex CLI or human operators need the actual upstream failure signal.

---

## 16. Logging Requirements

The sample code already includes a useful pattern. Logging should remain structured and safe.

## Must log
- request method
- request path
- request ID / correlation ID
- redacted request headers
- truncated request body
- upstream URL
- upstream method
- upstream status code
- upstream error body truncated
- latency metrics if feasible

## Must not log
- raw inbound proxy secret
- raw Azure bearer token
- full large request bodies without truncation
- sensitive headers unredacted

## Body truncation
Respect `LOG_BODY_LIMIT`.

---

## 17. Security Requirements

## In HTTPS only
Enable HTTPS-only on App Service.

## No anonymous public usage
At minimum require `PROXY_API_KEY`.

## Secret handling
Store `PROXY_API_KEY` in App Service application settings or Key Vault references.
Do not hardcode it.

## Managed Identity
Use system-assigned MI unless user-assigned MI is required.

## Least privilege
Assign only the Azure OpenAI inference role required to the managed identity.

## Optional hardening
Future enhancements may include:
- IP restrictions
- private endpoint or VNet integration
- Front Door / APIM
- Entra-based front-door auth
- per-caller rate limits

---

## 18. Response Compatibility Expectations

This proxy is intended to be “compatible enough” for Codex CLI, not a full reimplementation of OpenAI’s platform.

## Supported expectations
- `/v1/responses`
- `/v1/chat/completions`
- JSON request/response proxying
- stream passthrough
- bearer-style inbound auth
- model passthrough or controlled rewrite

## Not guaranteed
- every OpenAI-specific experimental field
- every tool call behavior
- every response schema nuance
- every future Codex CLI feature

This limitation should be made explicit.

---

## 19. Operational Constraints

## Model support
Only Azure-deployed models actually available in your Azure OpenAI resource can be used.

## Model naming
If Codex CLI expects a model name that differs from Azure deployment naming, the proxy may need model alias translation.

Example:
- incoming model: `gpt-5.2`
- actual Azure deployment: `codex-gpt5-2`

If aliasing is needed, define it explicitly in config or code.

Do not rely on undocumented implicit translation.

## Responses support
Because Codex depends heavily on the Responses API, the proxy should prioritize correctness on `/v1/responses` even if `/v1/chat/completions` is simpler.

---

## 20. Suggested Request Processing Flow

1. Receive request
2. Generate request ID
3. Validate inbound bearer token against `PROXY_API_KEY`
4. Read request body
5. Log redacted incoming request
6. Parse JSON
7. Validate required fields
8. Rewrite payload for Azure compatibility if necessary
9. Build Azure OpenAI URL
10. Acquire bearer token via Managed Identity
11. Send upstream request to Azure OpenAI
12. If streaming:
    - return `StreamingResponse`
    - close upstream resources on completion
13. If non-streaming:
    - read upstream body
    - return response body and status code
14. Log outcome

---

## 21. Suggested API Contract for Codex CLI

### Environment variables on the client
```bash
export OPENAI_BASE_URL="https://<proxy-host>"
export OPENAI_API_KEY="<proxy-api-key>"
```

### Expected request path used by Codex
Typically:
- `POST https://<proxy-host>/v1/responses`

### Optional fallback path
- `POST https://<proxy-host>/v1/chat/completions`

---

## 22. Acceptance Criteria

The proxy is acceptable for v1 if all of the following are true:

1. deployed on Azure App Service
2. App Service Managed Identity enabled
3. outbound auth to Azure OpenAI uses Managed Identity only
4. no Azure OpenAI API key stored or used
5. proxy requires inbound bearer token via v1
6. `GET /healthz` returns success
7. `POST /v1/responses` forwards valid requests successfully
8. streaming responses are passed through successfully
9. `POST /v1/chat/completions` works for compatible requests
10. Azure upstream errors are surfaced clearly
11. logs redact secrets and truncate bodies
12.open if used by Codex CLI behaves correctly for basic interactive requests

---

## 23. Open Issues Requiring Explicit Implementation Decisions

These few details should be settled before coding.

### 23.1 Which token scope is correct?
The sample code uses:
- `https://cognitiveservices.azure.com/.default`

But your Azure OpenAI v1 docs for modern usage may prefer:
- `https://ai.azure.com/.default`

This must be tested and standardized.

### 23.2 Which base URL convention will be used?
Choose one:
- base host only::
  - `https://<resource>.openai.azure.com`
https://<resource>.>` then append `//openai/v1/<path>`
- or full base:
  - `https://<resource>.openai.azure.com/openopenai/v1`

`

But do not build helpers ambiguously.

### 23.3 Is model aliasing needed?
If Azure deployment names differ from Codex-requested names, add explicit alias config.

### 23.4 Which is `/v1/chat/completions` truly needed?
Probably yes for compatibility, but `/v1/responses` is the primary path.

---

## 24. Recommended Implementation Notes for the Coding Agent

The code structure in your sample is generally reasonable, with these environment-aware adjustments:

### Recommended changes
1. Prefer **App Service** deployment assumptions.
2. Standardize on **Azure OpenAI endpoint format** only.
3. Re-check token scope for your exact working Azure OpenAI configuration.
4. Ensure the URL builder cannot accidentally create:
   - double `/openai`
   - mixed `/openai/v1` + `?api-version=...` forms unless explicitly correct
5. Add explicit request correlation IDs.
6. Consider explicit alias mapping for model names.
7. Preserve streaming exactly; do not parse/re-emit SSE unless absolutely necessary.
8. Keep the proxy thin; avoid unnecessary business logic.

### Important implementation warning
Do not assume that because a request is valid OpenAI JSON it is automatically valid Azure OpenAI JSON.
Rewriting must be minimal but sometimes necessary.

---

## 25. Rollout Plan

### Phase 1
- deploy proxy to non-production App Service
- enable Managed Identity
- assign Azure OpenAI RBAC
- verify direct `/v1/responses`
- verify streaming with a simple curl client

### Phase 2
- configure Codex CLI against proxy
- validate basic prompts
- validate longer streaming outputs
- validate error visibility

### Phase 3
- harden logging and auth
- rotate proxy secret
- document allowed model names
- optionally add private access restrictions

---

## 26. Final Design Summary

### Chosen architecture
Codex CLI → Azure App Service proxy → Azure OpenAI

### Outbound auth
Managed Managed Identity`

### Inbound auth
Bearer token backed by `PROXY_API_KEY`

### Main endpoint
`POST /v1/responses`

### Secondary endpoint
`POST /v1/chat/completions`

### Priority behavior
Correct streaming passthrough and minimal translation

### Explicitly avoided
- Azure API key auth
- LiteLLM in this Codex path
- Function App as primary host
- overly broad API emulation
