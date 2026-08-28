import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium", {
  variants: {
    variant: {
      neutral: "bg-[var(--surface-2)] text-[var(--muted)]",
      accent: "bg-[var(--accent-soft)] text-[var(--accent)]",
      ok: "bg-[var(--ok-soft)] text-[var(--ok)]",
      warn: "bg-[var(--warn-soft)] text-[var(--warn)]",
    },
  },
  defaultVariants: { variant: "neutral" },
});

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant, className }))} {...props} />;
}

export { Badge };
