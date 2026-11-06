"use client";

import { Check, Copy, Info } from "lucide-react";
import { useState } from "react";
import { fmtDate } from "@/lib/names";
import { toast } from "@/lib/client/toast";
import type { ClassInfo } from "@/lib/types";
import { cx, IconButton } from "./ui";

/** the original file name, with a copy button; shown when the (i) icon is toggled */
export function FileNamePanel({ info, className }: { info: ClassInfo; className?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(info.fileName);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast("Couldn't copy — select the text and copy it instead", "error");
    }
  };
  return (
    <div className={cx("flex items-start gap-2 rounded-lg bg-stone-50 px-3 py-2 text-xs", className)}>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] uppercase tracking-wide text-stone-400">File name</p>
        <p className="select-text break-all font-mono text-stone-700">{info.fileName}</p>
        {info.group && <p className="mt-0.5 text-stone-400">in {info.group}</p>}
      </div>
      <IconButton label={copied ? "Copied" : "Copy file name"} onClick={copy} className="h-7 w-7">
        {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
      </IconButton>
    </div>
  );
}

export function FileNameToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <IconButton label="Show original file name" onClick={onToggle} aria-expanded={open} className={cx("h-7 w-7", open && "bg-stone-100 text-stone-900")}>
      <Info className="h-4 w-4" />
    </IconButton>
  );
}

export const dateLabel = (info: ClassInfo) => (info.display.date ? fmtDate(info.display.date) : null);
