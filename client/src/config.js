function readWindowOrigin() {
  if (typeof window === "undefined" || !window.location?.origin) {
    return "http://localhost:5173";
  }

  return window.location.origin;
}

function readAllowedEmailDomains() {
  const plural = import.meta.env.VITE_ENTRA_ALLOWED_EMAIL_DOMAINS;
  const single = import.meta.env.VITE_ENTRA_ALLOWED_EMAIL_DOMAIN;
  const raw = plural ?? single ?? "";

  return raw
    .split(",")
    .map((value) => value.trim().replace(/^@+/, "").toLowerCase())
    .filter(Boolean);
}

export const config = {
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL ?? "",
  apiAuthMode: import.meta.env.VITE_API_AUTH_MODE ?? "none",
  demoMode: (import.meta.env.VITE_DEMO_MODE ?? "true") !== "false",
  enableAvatar: (import.meta.env.VITE_ENABLE_AVATAR ?? "false") === "true",
  authMode: import.meta.env.VITE_AUTH_MODE ?? "mock",
  entraClientId: import.meta.env.VITE_ENTRA_CLIENT_ID ?? "",
  entraTenantAuthority:
    import.meta.env.VITE_ENTRA_TENANT_AUTHORITY ??
    "https://login.microsoftonline.com/common",
  entraApiScope: import.meta.env.VITE_ENTRA_API_SCOPE ?? "",
  entraRedirectUri:
    import.meta.env.VITE_ENTRA_REDIRECT_URI ?? readWindowOrigin(),
  entraAllowedEmailDomains: readAllowedEmailDomains(),
};
