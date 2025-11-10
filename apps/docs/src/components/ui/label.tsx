import * as LabelPrimitive from "@radix-ui/react-label";
import clsx from "clsx";
import React from "react";

export function Label({
  className,
  ...props
}: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={clsx("ui-label", className)}
      {...props}
    />
  );
}
