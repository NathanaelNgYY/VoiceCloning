import {
  InteractionRequiredAuthError,
  PublicClientApplication,
} from "@azure/msal-browser";
import { config } from "@/config";
import { POST_LOGIN_PATH_STORAGE_KEY } from "./constants";

const MICROSOFT_LOGIN_SCOPES = ["openid", "profile", "email"];
const CONSUMER_TENANT_ID = "9188040d-6c67-4c5b-b112-36a304b66dad";

let msalInstancePromise;

function normalizeEmailDomain(domain) {
  return domain.trim().replace(/^@+/, "").toLowerCase();
}

function formatAllowedDomains(domains) {
  return domains.join(", ");
}

function createConfigurationError(variableName) {
  return new Error(`Missing required frontend environment variable: ${variableName}`);
}

function buildMsalConfig() {
  if (!config.entraClientId) {
    throw createConfigurationError("VITE_ENTRA_CLIENT_ID");
  }

  return {
    auth: {
      clientId: config.entraClientId,
      authority: config.entraTenantAuthority,
      redirectUri: config.entraRedirectUri,
    },
    cache: {
      cacheLocation: "sessionStorage",
      storeAuthStateInCookie: false,
    },
  };
}

function getInteractionScopes() {
  return [...MICROSOFT_LOGIN_SCOPES, config.entraApiScope].filter(Boolean);
}

export function shouldAttachApiAccessToken() {
  return isMsalAuthEnabled() && config.apiAuthMode === "entra" && Boolean(config.entraApiScope);
}

function getApiScopes() {
  if (!config.entraApiScope) {
    throw createConfigurationError("VITE_ENTRA_API_SCOPE");
  }

  return [config.entraApiScope];
}

function setStoredPostLoginPath(pathname) {
  if (typeof window === "undefined") {
    return;
  }

  if (!pathname) {
    window.sessionStorage.removeItem(POST_LOGIN_PATH_STORAGE_KEY);
    return;
  }

  window.sessionStorage.setItem(POST_LOGIN_PATH_STORAGE_KEY, pathname);
}

function getAccountUsername(account) {
  return typeof account?.username === "string" ? account.username.toLowerCase() : "";
}

export function isMsalAuthEnabled() {
  return config.authMode === "msal";
}

export function getAllowedEmailDomains() {
  return config.entraAllowedEmailDomains.map(normalizeEmailDomain).filter(Boolean);
}

export function isAllowedAccount(account) {
  const allowedDomains = getAllowedEmailDomains();
  if (allowedDomains.length === 0) {
    return true;
  }

  const username = getAccountUsername(account);
  if (!username || username.includes("#ext#")) {
    return false;
  }

  return allowedDomains.some((domain) => username.endsWith(`@${domain}`));
}

export function getAccountPolicyError(account) {
  if (!account) {
    return "";
  }

  const username = getAccountUsername(account);
  if (!username) {
    return "The signed-in Microsoft account is missing a usable email address.";
  }

  if (username.includes("#ext#")) {
    return "Guest Microsoft accounts are not allowed for this app.";
  }

  if (account.tenantId === CONSUMER_TENANT_ID) {
    return "Personal Microsoft accounts are not allowed for this app.";
  }

  const allowedDomains = getAllowedEmailDomains();
  if (
    allowedDomains.length > 0 &&
    !allowedDomains.some((domain) => username.endsWith(`@${domain}`))
  ) {
    return `Only these Microsoft account domains are allowed for this app: ${formatAllowedDomains(allowedDomains)}.`;
  }

  return "";
}

export function mapAccountToUser(account) {
  if (!account) {
    return null;
  }

  return {
    email: account.username,
    name: account.name || account.username,
    tenantId: account.tenantId || "",
  };
}

export async function initializeMsal() {
  if (!isMsalAuthEnabled()) {
    return null;
  }

  if (!msalInstancePromise) {
    msalInstancePromise = (async () => {
      const instance = new PublicClientApplication(buildMsalConfig());
      await instance.initialize();

      const redirectResult = await instance.handleRedirectPromise();
      const account =
        redirectResult?.account ||
        instance.getActiveAccount() ||
        instance.getAllAccounts()[0] ||
        null;

      if (account) {
        instance.setActiveAccount(account);
      }

      return instance;
    })();
  }

  return msalInstancePromise;
}

export async function getMsalInstance() {
  const instance = await initializeMsal();
  if (!instance) {
    throw new Error("MSAL authentication is not enabled.");
  }
  return instance;
}

export async function getCurrentAccount() {
  const instance = await getMsalInstance();
  const account =
    instance.getActiveAccount() || instance.getAllAccounts()[0] || null;

  if (account) {
    instance.setActiveAccount(account);
  }

  return account;
}

export function consumeStoredPostLoginPath() {
  if (typeof window === "undefined") {
    return "";
  }

  const stored = window.sessionStorage.getItem(POST_LOGIN_PATH_STORAGE_KEY) || "";
  window.sessionStorage.removeItem(POST_LOGIN_PATH_STORAGE_KEY);
  return stored;
}

export async function signInWithMicrosoft(redirectPath = "/") {
  const instance = await getMsalInstance();
  setStoredPostLoginPath(redirectPath);
  await instance.loginRedirect({
    prompt: "select_account",
    scopes: getInteractionScopes(),
  });
}

export async function signOutFromMicrosoft() {
  const instance = await getMsalInstance();
  const account =
    instance.getActiveAccount() || instance.getAllAccounts()[0] || undefined;

  setStoredPostLoginPath("");
  await instance.logoutRedirect({
    account,
    postLogoutRedirectUri: config.entraRedirectUri,
  });
}

export async function acquireApiAccessToken() {
  const instance = await getMsalInstance();
  const account = await getCurrentAccount();

  if (!account) {
    throw new Error("You are not signed in.");
  }

  const scopes = getApiScopes();

  try {
    const tokenResult = await instance.acquireTokenSilent({
      account,
      scopes,
    });

    if (tokenResult.account) {
      instance.setActiveAccount(tokenResult.account);
    }

    return tokenResult.accessToken;
  } catch (error) {
    if (error instanceof InteractionRequiredAuthError) {
      setStoredPostLoginPath(
        typeof window !== "undefined"
          ? `${window.location.pathname}${window.location.search}`
          : "/",
      );
      await instance.acquireTokenRedirect({
        account,
        scopes,
      });
      throw new Error("Redirecting to Microsoft sign-in.");
    }

    throw error;
  }
}

export async function acquireMicrosoftIdToken() {
  const instance = await getMsalInstance();
  const account = await getCurrentAccount();

  if (!account) {
    throw new Error("You are not signed in.");
  }

  try {
    const tokenResult = await instance.acquireTokenSilent({
      account,
      scopes: MICROSOFT_LOGIN_SCOPES,
    });

    if (tokenResult.account) {
      instance.setActiveAccount(tokenResult.account);
    }

    if (!tokenResult.idToken) {
      throw new Error("Microsoft sign-in did not return an ID token.");
    }

    return tokenResult.idToken;
  } catch (error) {
    if (error instanceof InteractionRequiredAuthError) {
      setStoredPostLoginPath(
        typeof window !== "undefined"
          ? `${window.location.pathname}${window.location.search}`
          : "/",
      );
      await instance.acquireTokenRedirect({
        account,
        scopes: MICROSOFT_LOGIN_SCOPES,
      });
      throw new Error("Redirecting to Microsoft sign-in.");
    }

    throw error;
  }
}
