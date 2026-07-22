"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Nav link with active state ("/" matches exactly; others by prefix). */
export function NavLink({ href, label }: { href: string; label: string }) {
  const pathname = usePathname();
  const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`rounded-md px-2 py-1 text-sm ${
        active ? "bg-accent/15 font-medium text-accent" : "text-muted hover:text-fg"
      }`}
    >
      {label}
    </Link>
  );
}
