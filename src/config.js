function parseInteger(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function parseModelAliases(raw) {
  if (!raw?.trim()) {
    return {};
  }

  return raw
    .split(",")
    .map((pair) => pair.trim())
    .filter(Boolean)
    .reduce((acc, pair) => {
      const [source, target] = pair.split("=").map((part) => part?.trim());

      if (source && target) {
        acc[source] = target;
      }

      return acc;
    }, {});
}

export const config = {
  port: parseInteger(process.env.PORT, 3000),
  logLevel: (process.env.LOG_LEVEL ?? "INFO").toUpperCase(),
  logBodyLimit: parseInteger(process.env.LOG_BODY_LIMIT, 4000),
  tokenScope: process.env.AZURE_OPENAI_TOKEN_SCOPE ?? "https://cognitiveservices.azure.com/.default",
  azureOpenAiBaseUrl: process.env.AZURE_OPENAI_BASE_URL ?? "",
  azureOpenAiApiVersion: process.env.AZURE_OPENAI_API_VERSION ?? "",
  azureClientId: process.env.AZURE_CLIENT_ID ?? "",
  proxyApiKey: process.env.PROXY_API_KEY ?? "",
  modelAliases: parseModelAliases(process.env.MODEL_ALIASES ?? "")
};