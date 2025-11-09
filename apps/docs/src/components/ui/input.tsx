import clsx from "clsx";
import * as React from "react";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={clsx(
        // base
        "h-9 w-full min-w-0 rounded-md border bg-transparent px-3 py-1 text-base md:text-sm shadow-xs outline-none transition-[color,box-shadow]",
        // colors
        "border-input placeholder:text-muted-foreground",
        // file input
        "file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground",
        // disabled
        "disabled:cursor-not-allowed disabled:opacity-50 disabled:pointer-events-none",
        // focus + ring
        "focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:border-ring",
        // invalid
        "aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40",
        // dark surface
        "dark:bg-input/30",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
