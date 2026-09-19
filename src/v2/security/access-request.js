export class AccessRequestError extends Error {
  constructor(code, httpStatus, message) {
    super(message);
    this.name = "AccessRequestError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export function assertCloudflareAccess(request, { allowCrossSiteNavigation = false } = {}) {
  if (!request?.headers?.get("cf-access-jwt-assertion")?.trim()) {
    throw new AccessRequestError("ACCESS_AUTHENTICATION_REQUIRED", 401, "Cloudflare Access authentication is required.");
  }
  if (allowCrossSiteNavigation) return true;
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    throw new AccessRequestError("CROSS_ORIGIN_FORBIDDEN", 403, "Cross-origin access is forbidden.");
  }
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && !["same-origin", "none"].includes(fetchSite)) {
    throw new AccessRequestError("CROSS_ORIGIN_FORBIDDEN", 403, "Cross-origin access is forbidden.");
  }
  return true;
}
