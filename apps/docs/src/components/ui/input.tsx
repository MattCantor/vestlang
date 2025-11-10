import clsx from "clsx";
import * as React from "react";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={clsx("ui-input", className)}
      {...props}
    />
  );
}

export { Input };
