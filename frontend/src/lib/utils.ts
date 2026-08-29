import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, exponent);
  return `${value.toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

export function formatPercent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

export function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

// Rounds an "hours until X" forecast down to a coarser, more honest unit --
// a forecast built from a short log sample (see cache_forecast.py) has
// real uncertainty, so "in 743 hours" is false precision; "in about 31
// days" (or "in about 2 years" for a very slow-growing cache, rather than
// literally rendering a 5-digit day count) reads as the estimate it is.
export function formatDaysApprox(hours: number): { value: number; unit: "hours" | "days" | "years" } {
  const days = hours / 24;
  if (days < 1) return { value: Math.max(1, Math.round(hours)), unit: "hours" };
  if (days > 365) return { value: Math.max(1, Math.round(days / 365)), unit: "years" };
  return { value: Math.round(days), unit: "days" };
}
