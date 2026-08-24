import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { AudioLines, CircleAlert, Loader2, Lock, ShieldCheck } from "lucide-react";
import { useAuth } from "@/auth/useAuth";

// The panel ground is mixed from --primary so each build skins itself: blue on
// the faculty/training builds, LKCMedicine maroon under .gi-root. The flat
// backgroundColor is only the fallback for engines without color-mix().
const PANEL_BACKGROUND = {
  backgroundColor: "#101322",
  backgroundImage: [
    "radial-gradient(115% 85% at 100% 100%, hsl(var(--primary) / 0.95) 0%, hsl(var(--primary) / 0) 60%)",
    "linear-gradient(158deg, color-mix(in oklab, hsl(var(--primary)) 32%, #06090f) 0%, color-mix(in oklab, hsl(var(--primary)) 80%, #06090f) 100%)",
  ].join(", "),
};

// Keeps the headline off the bright corner of the gradient so white text stays
// well past 4.5:1 wherever the panel is widest.
const PANEL_SCRIM = {
  backgroundImage:
    "linear-gradient(125deg, rgba(6,10,26,0.62) 0%, rgba(6,10,26,0.20) 48%, rgba(6,10,26,0) 78%)",
};

// Bar heights for the waveform motif, drawn on a 512x160 box centred on y=80.
const WAVEFORM_BARS = [
  24, 40, 72, 110, 58, 34, 88, 140, 96, 52, 30, 66, 120, 84, 46, 26, 58, 104,
  150, 92, 60, 38, 70, 116, 80, 44, 28, 54, 98, 132, 86, 56, 34, 62, 108, 74,
];

function Waveform() {
  return (
    <svg
      className="pointer-events-none absolute inset-x-0 bottom-[14%] -z-10 hidden w-full opacity-50 lg:block"
      viewBox="0 0 512 160"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="entry-wave-fade" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#fff" stopOpacity="0" />
          <stop offset="0.35" stopColor="#fff" stopOpacity="0.55" />
          <stop offset="1" stopColor="#fff" stopOpacity="1" />
        </linearGradient>
        <mask id="entry-wave-mask">
          <rect width="512" height="160" fill="url(#entry-wave-fade)" />
        </mask>
      </defs>
      <g
        transform="translate(0,80)"
        fill="rgba(255,255,255,0.30)"
        mask="url(#entry-wave-mask)"
      >
        {WAVEFORM_BARS.map((height, index) => (
          <rect
            key={index}
            x={6 + index * 14}
            y={-height / 2}
            width="4"
            height={height}
            rx="2"
          />
        ))}
      </g>
    </svg>
  );
}

function MicrosoftLogo() {
  return (
    <svg width="15" height="15" viewBox="0 0 20 20" aria-hidden="true">
      <rect x="0" y="0" width="9" height="9" fill="#F25022" />
      <rect x="11" y="0" width="9" height="9" fill="#7FBA00" />
      <rect x="0" y="11" width="9" height="9" fill="#00A4EF" />
      <rect x="11" y="11" width="9" height="9" fill="#FFB900" />
    </svg>
  );
}

export function MicrosoftEntryPage({
  // Product name — the panel headline.
  title,
  // One line on what this build is for, under the headline.
  description,
  // Shown under the sign-in button. Optional so only surfaces that actually
  // store a conversation carry a data notice.
  privacyNotice = '',
  defaultRedirectPath,
  // Which account the visitor should reach for — students and staff differ.
  accountHint = 'Use your NTU account to continue.',
  // Small brand lockup at the top of the panel.
  badge = 'LKCMedicine',
  // Institution lines at the foot of the panel; hidden when stacked.
  footerLines = ['Nanyang Technological University', 'Lee Kong Chian School of Medicine'],
  // The lecture/GI build deliberately retains the compact D25 sign-in screen.
  // Faculty uses the newer split-panel presentation.
  variant = 'faculty',
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

  const buttonLabel = busy
    ? "Opening Microsoft…"
    : visibleError
      ? "Try again"
      : "Continue with Microsoft";

  if (variant === 'lecture') {
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

            {privacyNotice ? (
              <p className="mt-8 max-w-sm text-xs leading-relaxed text-slate-400">
                {privacyNotice}
              </p>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-40 overflow-y-auto bg-white">
      <div className="grid min-h-full grid-cols-1 lg:grid-cols-[5fr_6fr]">
        {/* Brand panel */}
        <aside
          className="relative isolate flex flex-col justify-between gap-7 overflow-hidden px-7 pb-14 pt-10 text-white sm:px-10 lg:gap-10 lg:px-12 lg:py-12"
          style={PANEL_BACKGROUND}
        >
          <div className="pointer-events-none absolute inset-0 -z-10" style={PANEL_SCRIM} aria-hidden="true" />
          <Waveform />

          <div className="flex animate-rise-in items-center gap-3 motion-reduce:animate-none">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-white/25 bg-white/15">
              <AudioLines className="size-[18px]" />
            </span>
            <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/75">
              {badge}
            </span>
          </div>

          <div className="animate-rise-in [animation-delay:60ms] motion-reduce:animate-none">
            <h1 className="max-w-[12ch] text-balance text-[2rem] font-semibold leading-[1.06] tracking-[-0.028em] lg:text-[2.9rem]">
              {title}
            </h1>
            {description ? (
              <p className="mt-3 max-w-[36ch] text-[0.95rem] leading-relaxed text-white/80 lg:mt-4">
                {description}
              </p>
            ) : null}
          </div>

          {footerLines.length ? (
            <p className="hidden animate-rise-in border-t border-white/15 pt-4 text-xs leading-relaxed text-white/60 motion-reduce:animate-none lg:block [animation-delay:120ms]">
              {footerLines.map((line) => (
                <span key={line} className="block">
                  {line}
                </span>
              ))}
            </p>
          ) : null}
        </aside>

        {/* Sign-in column */}
        <div className="relative z-10 -mt-5 flex items-start justify-center rounded-t-[22px] bg-white px-7 pb-16 pt-9 sm:px-10 lg:mt-0 lg:items-center lg:rounded-none lg:px-12 lg:py-12">
          <div className="w-full max-w-[372px]">
            <h2 className="animate-rise-in text-[1.6rem] font-semibold tracking-[-0.022em] text-slate-900 motion-reduce:animate-none [animation-delay:90ms]">
              Sign in
            </h2>
            <p className="mt-2.5 animate-rise-in text-[0.925rem] leading-relaxed text-slate-600 motion-reduce:animate-none [animation-delay:150ms]">
              {accountHint}
            </p>

            {visibleError ? (
              <div
                role="alert"
                className="mt-5 flex gap-3 rounded-[10px] border border-red-200 bg-red-50 p-3.5"
              >
                <CircleAlert className="mt-0.5 size-4 shrink-0 text-rose-700" aria-hidden="true" />
                <p className="text-[0.83rem] leading-relaxed text-rose-800">
                  <span className="mb-0.5 block font-semibold">Sign-in didn’t complete</span>
                  {visibleError}
                </p>
              </div>
            ) : null}

            <button
              type="button"
              onClick={handleMicrosoftLogin}
              disabled={busy}
              className="mt-7 flex min-h-[54px] w-full animate-rise-in items-center gap-3.5 rounded-xl bg-primary px-[18px] text-[0.95rem] font-semibold tracking-[-0.005em] text-white shadow-[0_8px_20px_-8px_hsl(var(--primary)/0.65),inset_0_1px_0_rgba(255,255,255,0.18)] transition-[background-color,box-shadow,transform] duration-200 hover:bg-primary/90 hover:shadow-[0_12px_26px_-10px_hsl(var(--primary)/0.7),inset_0_1px_0_rgba(255,255,255,0.18)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-primary active:translate-y-px disabled:cursor-default disabled:opacity-75 disabled:shadow-none motion-reduce:animate-none [animation-delay:210ms]"
            >
              {busy ? (
                <Loader2 className="size-[18px] shrink-0 animate-spin" aria-hidden="true" />
              ) : (
                <span className="grid size-[26px] shrink-0 place-items-center rounded-[7px] bg-white">
                  <MicrosoftLogo />
                </span>
              )}
              {buttonLabel}
            </button>

            {privacyNotice ? (
              <>
                <div className="mt-7 h-px animate-rise-in bg-slate-200 motion-reduce:animate-none [animation-delay:260ms]" />
                <p className="mt-4 flex animate-rise-in gap-2.5 text-[0.78rem] leading-relaxed text-slate-500 motion-reduce:animate-none [animation-delay:300ms]">
                  <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                  <span>{privacyNotice}</span>
                </p>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
