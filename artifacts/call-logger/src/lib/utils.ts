import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function maskPhone(digits: string): string {
  const d = digits.replace(/\D/g, "");
  if (d.length <= 4) return d;
  const first = d.slice(0, 4);
  const last = d.slice(-2);
  const masked = "*".repeat(Math.max(0, d.length - 6));
  return `${first}${masked}${last}`;
}

export function formatDuration(seconds: number): string {
  if (seconds === 0) return "0s";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m === 0) return `${s}s`;
  if (s === 0) return `${m}m`;
  return `${m}m ${s}s`;
}

export function formatTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}
