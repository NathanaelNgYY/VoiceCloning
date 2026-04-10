import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export default function Spinner({ className, size = 14 }) {
  return <Loader2 className={cn("animate-spin text-muted-foreground", className)} size={size} />;
}
