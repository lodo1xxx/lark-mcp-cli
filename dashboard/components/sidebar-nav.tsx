"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { href: "/", label: "Dashboard" },
  { href: "/agents", label: "Agents" },
  { href: "/projects", label: "Projects" },
  { href: "/insights", label: "Insights" },
  { href: "/quota", label: "Quota" },
  { href: "/audit", label: "Audit" },
  { href: "/add-platform", label: "Add Platform" },
];

export function SidebarNav() {
  const pathname = usePathname();
  return (
    <nav className="w-52 shrink-0 border-r border-zinc-200 bg-white flex flex-col py-6 px-4 gap-1">
      <div className="mb-6 px-2">
        <span className="text-sm font-semibold text-zinc-500 uppercase tracking-widest">
          Lark Bridge
        </span>
      </div>
      {NAV_ITEMS.map(({ href, label }) => {
        const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={`rounded-md px-3 py-2 text-sm font-medium transition-colors ${
              active
                ? "bg-zinc-100 text-zinc-900"
                : "text-zinc-500 hover:bg-zinc-50 hover:text-zinc-800"
            }`}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
