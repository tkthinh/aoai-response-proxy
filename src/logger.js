import { config } from "./config.js";

const LOG_LEVELS = {
  DEBUG: 10,
  INFO: 20,
  WARNING: 30,
  ERROR: 40
};

function shouldLog(level) {
  return (LOG_LEVELS[level] ?? LOG_LEVELS.INFO) >= (LOG_LEVELS[config.logLevel] ?? LOG_LEVELS.INFO);
}

export function log(level, message, fields = {}) {
  if (!shouldLog(level)) {
    return;
  }

  const payload = {
    level,
    message,
    timestamp: new Date().toISOString(),
    ...fields
  };

  const writer = level === "ERROR" ? console.error : console.log;
  writer(JSON.stringify(payload));
}