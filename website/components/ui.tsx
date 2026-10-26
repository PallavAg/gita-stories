"use client";

import { CheckCircle2, Info, Loader2, X, XCircle } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { dismissToast, useToasts } from "@/lib/client/toast";

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

type Variant = "primary" | "secondary" | "ghost" | "danger" | "success";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-stone-900 text-white hover:bg-stone-700 disabled:bg-stone-300",
  secondary: "border border-stone-200 bg-white text-stone-700 hover:border-stone-300 hover:bg-stone-50 disabled:text-stone-300",
  ghost: "text-stone-600 hover:bg-stone-100 hover:text-stone-900 disabled:text-stone-300",
  danger: "border border-red-200 bg-white text-red-700 hover:bg-red-50 disabled:text-red-300",
  success: "bg-emerald-600 text-white hover:bg-emerald-500 disabled:bg-emerald-300",
};

export function Button({
  variant = "secondary",
  size = "md",
  loading,
  icon,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md"; loading?: boolean; icon?: ReactNode }) {
  return (
    <button
      type="button"
      {...rest}
      disabled={rest.disabled || loading}
      className={cx(
        "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:cursor-not-allowed",
        size === "sm" ? "h-7 px-2.5 text-xs" : "h-9 px-3.5 text-sm",
        VARIANTS[variant],
        className,
      )}
    >
      {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : icon}
      {children}
    </button>
  );
}

export function IconButton({ label, className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      {...rest}
      className={cx("inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-900 disabled:text-stone-300", className)}
    >
      {children}
    </button>
  );
}

const PILL: Record<string, string> = {
  gray: "bg-stone-100 text-stone-600",
  amber: "bg-amber-100 text-amber-800",
  green: "bg-emerald-100 text-emerald-800",
  red: "bg-red-100 text-red-700",
  blue: "bg-sky-100 text-sky-800",
  orange: "bg-orange-100 text-orange-800",
};

export function Pill({ color = "gray", children, className }: { color?: keyof typeof PILL; children: ReactNode; className?: string }) {
  return <span className={cx("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium", PILL[color], className)}>{children}</span>;
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cx("h-4 w-4 animate-spin", className)} />;
}

export function ProgressBar({ value, className, tone = "orange" }: { value: number; className?: string; tone?: "orange" | "red" | "green" }) {
  return (
    <div className={cx("h-1.5 overflow-hidden rounded-full bg-stone-200", className)}>
      <div
        className={cx("h-full rounded-full transition-[width] duration-700", tone === "red" ? "bg-red-500" : tone === "green" ? "bg-emerald-500" : "bg-orange-500")}
        style={{ width: `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%` }}
      />
    </div>
  );
}

export function Segmented<T extends string>({ value, options, onChange, className }: { value: T; options: { value: T; label: ReactNode; disabled?: boolean; title?: string }[]; onChange: (v: T) => void; className?: string }) {
  return (
    <div className={cx("inline-flex rounded-lg bg-stone-100 p-0.5", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          disabled={o.disabled}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cx(
            "inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:text-stone-300",
            value === o.value ? "bg-white text-stone-900 shadow-sm" : "text-stone-500 hover:text-stone-900",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function ErrorBox({ title, message, action }: { title: string; message: string; action?: ReactNode }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-red-800">
      <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="font-medium">{title}</p>
        <p className="mt-0.5 break-words text-red-700">{message}</p>
        {action && <div className="mt-3">{action}</div>}
      </div>
    </div>
  );
}

export function Toaster() {
  const toasts = useToasts();
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[min(380px,calc(100vw-2rem))] flex-col gap-2">
      {toasts.map((t) => (
        <div key={t.id} className={cx("pointer-events-auto flex items-start gap-2.5 rounded-xl border bg-white p-3 shadow-lg", t.kind === "error" ? "border-red-200" : "border-stone-200")}>
          {t.kind === "error" ? <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" /> : t.kind === "success" ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /> : <Info className="mt-0.5 h-4 w-4 shrink-0 text-stone-500" />}
          <p className="min-w-0 flex-1 break-words text-stone-700">{t.message}</p>
          <button type="button" onClick={() => dismissToast(t.id)} className="text-stone-400 hover:text-stone-700" aria-label="Dismiss">
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
