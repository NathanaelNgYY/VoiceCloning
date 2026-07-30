import { MicrosoftEntryPage } from "@/components/auth/MicrosoftEntryPage";

export function LoginPage() {
  return (
    <MicrosoftEntryPage
      title="Login"
      description="Welcome to LKCMedicine Lecture"
      defaultRedirectPath="/"
    />
  );
}
