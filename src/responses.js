import { sendJson } from "./http.js";

export function unauthorized(response, requestId, message = "Unauthorized") {
  sendJson(
    response,
    401,
    {
      error: {
        message,
        type: "invalid_request_error"
      }
    },
    { "x-request-id": requestId }
  );
}

export function badRequest(response, requestId, message) {
  sendJson(
    response,
    400,
    {
      error: {
        message,
        type: "invalid_request_error"
      }
    },
    { "x-request-id": requestId }
  );
}

export function badGateway(response, requestId, message) {
  sendJson(
    response,
    502,
    {
      error: {
        message,
        type: "bad_gateway"
      }
    },
    { "x-request-id": requestId }
  );
}

export function notFound(response) {
  sendJson(response, 404, {
    error: {
      message: "Not found",
      type: "not_found_error"
    }
  });
}