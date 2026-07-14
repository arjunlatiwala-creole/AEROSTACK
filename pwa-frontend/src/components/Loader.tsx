import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";

type LoaderProps = {
  description?: string;
  iconClassName?: string;
  descriptionClassName?: string;
};

const Loader = ({description, iconClassName, descriptionClassName}: LoaderProps) => {
  return (
    <div className="flex justify-center p-4 gap-2" aria-live="polite">
      <Loader2 className={cn("w-6 h-6 animate-spin  text-primary", iconClassName)} aria-label="Loading" />
      {description && <p className={cn("text-muted-foreground", descriptionClassName)} aria-label={description}>{description}</p>}
    </div>
  );
};

export default Loader;
