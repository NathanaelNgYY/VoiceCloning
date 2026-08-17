import { MicrosoftEntryPage } from "@/components/auth/MicrosoftEntryPage";

export function LoginPage({
  description = 'Welcome to LKCMedicine Lecture',
  privacyNotice = 'Your conversations with the voice assistant are saved against your NTU account and reviewed to improve this lesson. They are kept for 90 days.',
}) {
  return (
    <MicrosoftEntryPage
      title="Login"
      description={description}
      defaultRedirectPath="/"
      privacyNotice={privacyNotice}
    />
  );
}
