"use client";

import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";

function Tabs({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return <TabsPrimitive.Root {...props} />;
}

function TabsList({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={className}
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: "0.5rem",
        borderBottom: "1px solid var(--ifm-toc-border-color)",
      }}
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
      className={className}
      style={{
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
        gap: "0.5rem",
        padding: "0.5rem 0.75rem",
        fontSize: "0.875rem",
        color: "var(--ifm-color-emphasis-700)",
        borderRadius: "0.375rem 0.375rem 0 0",
        outline: "none",
      }}
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
      className={className}
      style={{
        padding: "1rem 0",
        outline: "none",
      }}
      {...props}
    />
  );
}

export { Tabs, TabsList, TabsTrigger, TabsContent };
