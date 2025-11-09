import * as React from "react";
import clsx from "clsx";

function Button({ className, ...props }: React.ComponentProps<"button">) {
  return (
    <button
      data-slot="button"
      className={clsx(
        "inline-flex h-9 items-center justify-center gap-2 whitespace-nowrap rounded-md px-4 py-2",
        "text-sm font-medium",
        "bg-primary text-primary-foreground hover:bg-primary/90",
        "outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:border-ring",
        "disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export { Button };
