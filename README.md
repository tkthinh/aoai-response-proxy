# response-proxy

Minimal Node.js proxy that exposes OpenAI-compatible endpoints for Codex CLI and forwards requests to Azure OpenAI using Managed Identity.

## Endpoints

- `GET /healthz`
- `POST /v1/responses`
- `POST /v1/chat/completions`

## Requirements

- Node.js 20+
- Azure App Service or another environment with Managed Identity endpoint variables available
- Azure OpenAI resource using OpenAI-compatible routes

## Configuration

Set these environment variables before starting the server:

### Required

- `AZURE_OPENAI_BASE_URL`  
  Example: `https://your-resource.openai.azure.com`

- `PROXY_API_KEY`  
  Shared bearer token used by Codex CLI when calling the proxy.

### Optional

- `PORT`  
  Default: `3000`

- `AZURE_OPENAI_TOKEN_SCOPE`  
  Default: `https://cognitiveservices.azure.com/.default`  
  Change this if your Azure OpenAI setup requires a different Managed Identity scope.

- `AZURE_OPENAI_API_VERSION`  
  Only useful if your final Azure URL format needs a query-string API version.

- `AZURE_CLIENT_ID`  
  Only needed for user-assigned Managed Identity.

- `MODEL_ALIASES`  
  Comma-separated alias mapping. Example: `gpt-5.2=codex-gpt5-2,gpt-4.1=my-gpt41-deployment`

- `LOG_LEVEL`  
  Default: `INFO`

- `LOG_BODY_LIMIT`  
  Default: `4000`

## Local run

### Windows cmd

```cmd
set AZURE_OPENAI_BASE_URL=https://your-resource.openai.azure.com
set PROXY_API_KEY=change-me
node src\server.js
```

### npm scripts

```cmd
npm start
```

or development watch mode:

```cmd
npm run dev
```

## Codex CLI configuration

Point Codex CLI at the proxy:

```bash
export OPENAI_BASE_URL="https://<proxy-host>"
export OPENAI_API_KEY="<proxy-api-key>"
```

## Notes

- Inbound authentication is validated from `Authorization: Bearer <token>`.
- Outbound authentication uses Managed Identity and does not use an Azure OpenAI API key.
- Streaming responses are passed through directly without SSE reformatting.
- The proxy currently keeps compatibility logic minimal and only applies model alias rewriting plus removal of `api_key` from payloads.