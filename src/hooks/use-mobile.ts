"use client"

/**
 * Viewport / input-modality detection hooks.
 *
 * - `useIsMobile` — viewport narrower than 768px (phone layout: card lists
 *   instead of data tables).
 * - `useIsTouch` — primary pointer is coarse (touch). Tablets like iPads are
 *   ≥768px so they keep the desktop table layout, but touch targets need
 *   larger hit areas (WCAG 2.5.5); consumers use this to bump row padding,
 *   icon-button sizes, and input heights without changing the phone breakpoint.
 *
 * Both return `false` on the server / first render to avoid hydration
 * mismatches, then update after mount.
 */

import * as React from "react"

const MOBILE_BREAKPOINT = 768

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined)

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    }
    mql.addEventListener("change", onChange)
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return !!isMobile
}

/**
 * True when the device's primary pointer is coarse (finger/stylus rather than
 * a mouse). Used to enlarge touch affordances on tablets that render the
 * desktop table layout (audit 10.1).
 */
export function useIsTouch() {
  const [isTouch, setIsTouch] = React.useState<boolean | undefined>(undefined)

  React.useEffect(() => {
    const mql = window.matchMedia("(pointer: coarse)")
    const onChange = () => setIsTouch(mql.matches)
    mql.addEventListener("change", onChange)
    setIsTouch(mql.matches)
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return !!isTouch
}
