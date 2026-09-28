/** HTML headers. Preview stays frameable. Production only names grok.com, not a script CSP. */

export function documentHeaders(env: { deployed?: boolean }): Record<string, string> {
  const headers: Record<string, string> = {
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin",
    "permissions-policy": "camera=(), geolocation=(), payment=(), usb=()",
  };
  if (env.deployed) {
    headers["strict-transport-security"] = "max-age=31536000; includeSubDomains";
    headers["content-security-policy"] = "frame-ancestors 'self' https://grok.com";
  }
  return headers;
}
