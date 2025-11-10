import clsx from "clsx";
import * as React from "react";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={clsx("ui-input", className)}
      {...props}
    />
  );
}

export { Textarea };
