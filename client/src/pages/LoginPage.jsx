import { MicrosoftEntryPage } from "@/components/auth/MicrosoftEntryPage";

// Defaults describe the student lecture build; the faculty route in App.jsx
// overrides the headline and lede with its own.
export function LoginPage({
  title = 'Lecture',
  description = 'Open a lesson, watch it through, and ask the tutor whenever something does not land.',
  privacyNotice = 'Your conversations with the voice assistant are saved against your NTU account and reviewed to improve this lesson. They are kept for 90 days.',
  accountHint = 'Use your NTU account to continue.',
}) {
  return (
    <MicrosoftEntryPage
      title={title}
      description={description}
      accountHint={accountHint}
      defaultRedirectPath="/"
      privacyNotice={privacyNotice}
    />
  );
}
