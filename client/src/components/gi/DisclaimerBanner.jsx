import { useState } from 'react';
import { X } from 'lucide-react';

const STORAGE_KEY = 'gi-disclaimer-dismissed';

function readDismissed() {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function DisclaimerBanner() {
  const [dismissed, setDismissed] = useState(readDismissed);

  if (dismissed) return null;

  const handleDismiss = () => {
    try {
      localStorage.setItem(STORAGE_KEY, 'true');
    } catch {
      // Private-browsing / blocked storage: dismiss for this session only.
    }
    setDismissed(true);
  };

  return (
    <div className="flex items-center justify-center gap-2 bg-amber-50 px-4 py-2 text-center text-xs text-amber-800">
      <p>This chatbot provides educational information about GI bleeding only.</p>
      <button
        type="button"
        aria-label="Dismiss disclaimer"
        className="shrink-0 rounded p-0.5 hover:bg-amber-100"
        onClick={handleDismiss}
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}
