import { MsalProvider } from "@azure/msal-react";
import { AuthProvider } from "@/auth/AuthProvider";

export function AppProviders({ children, bootstrapError, msalInstance }) {
  const app = <AuthProvider bootstrapError={bootstrapError}>{children}</AuthProvider>;

  if (!msalInstance) {
    return app;
  }

  return <MsalProvider instance={msalInstance}>{app}</MsalProvider>;
}
