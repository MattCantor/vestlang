"use client";

import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import clsx from "clsx";

function Tabs({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root className={clsx("w-full", className)} {...props} />
  );
}

function TabsList({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={clsx(
        "flex w-full flex-wrap gap-2 border-b",
        "border-[var(--card-border)]",
        className,
      )}
      {...props}
    />
  );
}

function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={clsx(
        "relative -mb-px inline-flex items-center gap-2 rounded-t-md px-3 py-2 text-sm",
        "text-muted-foreground hover:text-foreground",
        "data-[state=active]:text-foreground",
        "outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
        // bottom border indicator
        "after:absolute after:inset-x-0 after:-bottom-[1px] after:h-[2px] after:rounded-full after:bg-transparent",
        "data-[state=active]:after:bg-primary",
        className,
      )}
      {...props}
    />
  );
}

function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={clsx("py-4 focus:outline-none", className)}
      {...props}
    />
  );
}

export { Tabs, TabsList, TabsTrigger, TabsContent };
