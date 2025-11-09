import { clsx } from "clsx";
import * as React from "react";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={clsx(
        "min-h-16 w-full rounded-md border bg-transparent px-3 py-2 text-base md:text-sm shadow-xs outline-none transition-[color,box-shadow]",
        "border-input placeholder:text-muted-foreground",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:border-ring",
        "aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40",
        "dark:bg-input/30",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
