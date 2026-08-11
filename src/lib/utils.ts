import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Compact currency for chart axis ticks: $2.5M / $500k / $0.
// WHY: the old `$${v/1000}k` formatter turned $10,000,000 into "$10000k"
// instead of "$10M".
export function formatCompactMoney(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) {
    const m = value / 1_000_000;
    return `$${Number.isInteger(m) ? m : m.toFixed(1)}M`;
  }
  if (abs >= 1_000) {
    return `$${Math.round(value / 1_000)}k`;
  }
  return `$${Math.round(value)}`;
}
