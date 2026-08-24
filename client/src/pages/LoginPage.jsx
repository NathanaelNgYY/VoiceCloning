import { MicrosoftEntryPage } from "@/components/auth/MicrosoftEntryPage";

// Defaults describe the student lecture build; the faculty route in App.jsx
// overrides the headline and lede with its own.
export function LoginPage({
  title = 'Login',
  description = 'Welcome to LKCMedicine Lecture',
  privacyNotice = 'Your conversations with the voice assistant are saved against your NTU account and reviewed to improve this lesson. They are kept for 90 days.',
  accountHint = 'Use your NTU account to continue.',
  variant = 'lecture',
}) {
  return (
    <MicrosoftEntryPage
      title={title}
      description={description}
      accountHint={accountHint}
      defaultRedirectPath="/"
      privacyNotice={privacyNotice}
      variant={variant}
    />
  );
}
