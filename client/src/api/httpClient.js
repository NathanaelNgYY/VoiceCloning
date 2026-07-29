import { config } from "@/config";
import {
    acquireApiAccessToken,
    shouldAttachApiAccessToken,
} from "@/auth/msalClient";
function readBrowserOrigin() {
    if (typeof window === "undefined" || !window.location?.origin) {
        return "";
    }
    return window.location.origin;
}
function buildNetworkErrorMessage() {
    const origin = readBrowserOrigin();
    const target = config.apiBaseUrl || "the configured backend endpoint";
    if (origin) {
        return `Could not reach the backend at ${target}. Make sure it is running and that backend CORS_ALLOW_ORIGIN allows ${origin}.`;
    }
    return `Could not reach the backend at ${target}. Make sure it is running.`;
}
async function post(body) {
    const headers = { "Content-Type": "application/json" };

    if (shouldAttachApiAccessToken()) {
        const accessToken = await acquireApiAccessToken();
        headers.Authorization = `Bearer ${accessToken}`;
    }

    let response;
    try {
        response = await fetch(config.apiBaseUrl, {
            method: "POST",
            headers,
            body: JSON.stringify(body),
        });
    }
    catch {
        throw new Error(buildNetworkErrorMessage());
    }
    if (!response.ok) {
        let errorMessage = `API request failed with status ${response.status}`;
        let errorCode = "";
        try {
            const payload = await response.json();
            if (payload?.error?.message) {
                errorMessage = payload.error.message;
            }
            if (payload?.error?.code) {
                errorCode = payload.error.code;
            }
        }
        catch {
            // Leave the generic fallback when the backend error body is missing or invalid.
        }
        const error = new Error(errorMessage);
        error.status = response.status;
        error.code = errorCode;
        throw error;
    }
    return (await response.json());
}
export const httpClient = {
    chat: (req) => post(req),
    getCourse: (req) => post(req),
    searchCourses: (req) => post(req),
    transcribe: (req) => post(req),
    avatarSession: (req) => post(req),
    voiceOptions: (req) => post(req),
    ttsSession: (req) => post(req),
    realtimeSession: (req) => post(req),
};
