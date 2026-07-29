import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Loader2, Lock } from "lucide-react";
import { useAuth } from "@/auth/useAuth";

export function MicrosoftEntryPage({
  title,
  description,
  defaultRedirectPath,
  badge,
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const auth = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!auth.isAuthenticated) {
      return;
    }

    setIsLoading(false);
  }, [auth.isAuthenticated]);

  const handleMicrosoftLogin = async () => {
    setIsLoading(true);
    setError("");

    try {
      if (auth.authMode === "mock") {
        await new Promise((resolve) => setTimeout(resolve, 1200));
      }

      const routeFromState =
        typeof location.state?.from === "string"
          ? location.state.from
          : defaultRedirectPath;

      await auth.signIn(routeFromState);

      if (auth.authMode === "mock") {
        navigate(routeFromState, { replace: true });
      }
    } catch (loginError) {
      setIsLoading(false);
      setError(
        loginError instanceof Error
          ? loginError.message
          : "Microsoft sign-in could not be started.",
      );
    }
  };

  const visibleError = error || auth.error;

  const busy = isLoading || auth.isLoading;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#ededed] px-4 py-12">
      <div className="w-full max-w-2xl rounded-3xl bg-white px-8 py-16 shadow-xl shadow-slate-300/40 sm:px-14">
        <div className="flex flex-col items-center text-center">
          {badge ? (
            <span className="mb-4 rounded-full bg-primary-soft px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-primary">
              {badge}
            </span>
          ) : null}

          <h1 className="text-4xl font-bold tracking-tight text-slate-900">{title}</h1>
          <p className="mt-5 max-w-sm text-base leading-relaxed text-slate-400">{description}</p>

          <button
            type="button"
            onClick={handleMicrosoftLogin}
            disabled={busy}
            className="mt-10 flex w-full max-w-sm cursor-pointer items-center gap-4 rounded-2xl bg-primary-soft px-5 py-4 text-left transition-all duration-200 hover:bg-primary/10 hover:shadow-sm active:scale-[0.99] disabled:pointer-events-none disabled:opacity-75"
          >
            <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary text-white">
              {busy ? (
                <Loader2 className="size-5 animate-spin" />
              ) : (
                <Lock className="size-5" />
              )}
            </span>

            <span className="min-w-0">
              <span className="block text-sm font-bold text-slate-900">
                {busy ? "Authenticating…" : "Sign in with your Microsoft account"}
              </span>
              <span className="mt-0.5 block text-xs text-slate-400">Single sign-on (SSO)</span>
            </span>
          </button>

          {visibleError ? (
            <p className="mt-4 text-sm text-red-600" role="alert">
              {visibleError}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
