import * as React from "react";
import clsx from "clsx";

function Button({ className, ...props }: React.ComponentProps<"button">) {
  return (
    <button
      data-slot="button"
      className={clsx("ui-button", className)}
      {...props}
    />
  );
}

export { Button };
