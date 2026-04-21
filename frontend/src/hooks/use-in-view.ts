"use client";

import { useEffect, useRef, useState } from "react";

interface Options extends IntersectionObserverInit {
  /**
   * Once true, stay true even if the element scrolls back off-screen.
   * Prevents media thumbnails from being torn down and re-fetched as
   * the user scrolls a long list. Default: true.
   */
  once?: boolean;
}

/**
 * Reports whether the referenced element is within the (optionally
 * expanded) viewport. Used to defer heavy thumbnail network requests
 * for bundle cards that haven't scrolled into view yet.
 */
export function useInView<T extends HTMLElement>(opts: Options = {}) {
  const { once = true, root, rootMargin, threshold } = opts;
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Server-rendered or ancient browser — skip lazy loading, render eagerly.
    if (typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setInView(true);
            if (once) io.unobserve(entry.target);
          } else if (!once) {
            setInView(false);
          }
        }
      },
      { root, rootMargin, threshold },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [once, root, rootMargin, threshold]);

  return { ref, inView };
}
