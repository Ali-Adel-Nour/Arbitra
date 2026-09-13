'use client';

/**
 * The masthead. A wordmark and one link per route that exists.
 *
 * WHY THIS IS A CLIENT COMPONENT
 * ------------------------------
 * `aria-current="page"` is the only reason. It needs the active pathname, and
 * `usePathname()` is the App Router's way to read it. The alternative — passing
 * the pathname down from a server layout — is not available, because a layout
 * does not receive it. The cost is a few hundred bytes of client JavaScript on
 * every route; the gain is that a keyboard or screen-reader user is told which
 * of the destinations they are already on, which is the same information a
 * sighted user reads from the underline.
 *
 * NO RULE TOKEN UNDER THE MASTHEAD. Each of the seven rule tokens carries a
 * record meaning — inside the hashed preimage, excluded from it, computed here,
 * end of one record. None of them means "chrome ends, content begins", and
 * borrowing the closest one would erode the vocabulary the record screens
 * depend on. Space separates the masthead instead.
 */

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { wordmark } from '@/app/fonts';
import { NAV, ROUTES, SITE } from '@/content/copy';

const FOCUS =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

export function Navbar() {
  const pathname = usePathname();

  return (
    <header className="bg-panel-1 relative">
      <div className="mx-auto flex w-full max-w-[75rem] flex-wrap items-baseline gap-x-10 gap-y-3 px-4 py-5 md:px-6">
        {/* The mark plus the wordmark, in the wordmark's own face. `hover:bg-panel-2`
            paired with `transition-colors duration-100` is the exact treatment
            `DocketEntry` uses for a row — a colour step, never a shift in
            position or size, which is what keeps this inside the same rule
            `hover-motion` holds every interactive row to. */}
        <Link
          href="/"
          className={`hover:bg-panel-2 -mx-2 -my-1 flex items-center gap-2 rounded-[--radius-control] px-2 py-1 transition-colors duration-100 ${FOCUS}`}
        >
          {/* `logo-mark.png` is the shield cropped square out of the source
              banner in `public/logo.jpg`, which is a wide circuitry
              illustration — sized for a hero, not a 28px nav mark. Cropping
              once at build time rather than shrinking the banner in the
              browser keeps the shield legible at nav scale instead of
              rendering it as a smear of background lines. */}
          <Image
            src="/logo-mark.png"
            alt=""
            width={28}
            height={28}
            className="rounded-[--radius-control]"
            priority
          />
          <span className={`${wordmark.className} text-heading text-hi`}>{SITE.name}</span>
        </Link>

        <nav aria-label={NAV.ariaLabel}>
          <ul className="flex flex-wrap gap-x-7 gap-y-1">
            {ROUTES.map((route) => {
              const current = pathname === route.href;
              return (
                <li key={route.href}>
                  <Link
                    href={route.href}
                    aria-current={current ? 'page' : undefined}
                    className={
                      // The active item is the accent as a FOREGROUND, which is
                      // why `--accent-text` exists as its own token: `--accent`
                      // measures 3.54:1 and would fail as 15px text.
                      current
                        ? `text-body text-accent-text transition-colors duration-100 ${FOCUS}`
                        : `text-body text-muted hover:text-hi transition-colors duration-100 ${FOCUS}`
                    }
                  >
                    {route.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>

      {/* The one gradient rail in the application, and it is decorative: the
          nav's own panel ground against the base is what actually separates the
          masthead from the record. Declared in `globals.css`, referenced here
          and nowhere else, which is how `check-design.mjs` holds the cap. */}
      <div aria-hidden className="gradient-rail absolute inset-x-0 bottom-0 h-px" />
    </header>
  );
}
