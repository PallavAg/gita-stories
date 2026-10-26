"use client";

import { BookOpen, Sparkles } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { isActive, useJobs } from "@/lib/client/jobs";
import { cx } from "./ui";
import { UpdateButton } from "./update-button";

export function Nav() {
  const path = usePathname();
  const jobs = useJobs();
  const running = jobs?.jobs.filter(isActive).length ?? 0;
  const link = (href: string, label: string, icon: React.ReactNode, on: boolean, badge?: number) => (
    <Link href={href} className={cx("inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-sm font-medium transition-colors", on ? "bg-stone-900 text-white" : "text-stone-600 hover:bg-stone-100 hover:text-stone-900")}>
      {icon}
      {label}
      {!!badge && <span className={cx("ml-0.5 rounded-full px-1.5 text-xs", on ? "bg-white/20" : "bg-orange-500 text-white")}>{badge}</span>}
    </Link>
  );
  return (
    <header className="sticky top-0 z-40 border-b border-stone-200 bg-white/85 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-orange-500 text-white">ॐ</span>
          Gita Stories
        </Link>
        <nav className="ml-auto flex items-center gap-1">
          {link("/", "Library", <BookOpen className="h-4 w-4" />, path === "/" || path.startsWith("/class"))}
          {link("/ai", "AI runs", <Sparkles className="h-4 w-4" />, path.startsWith("/ai"), running)}
          <UpdateButton />
        </nav>
      </div>
    </header>
  );
}
