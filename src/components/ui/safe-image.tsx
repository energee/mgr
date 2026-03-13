/**
 * SafeImage — a drop-in `<img>` wrapper for sources that `next/image` cannot handle.
 *
 * Use this for data: URIs, blob: URLs, and dynamic remote URLs where
 * `next/image` requires explicit dimensions or `remotePatterns` config.
 * Centralizes the single `@next/next/no-img-element` suppression.
 */

type SafeImageProps = React.ImgHTMLAttributes<HTMLImageElement> & {
  /** Image source — may be a data: URI, blob: URL, or remote URL. */
  src: string;
  alt: string;
}

export function SafeImage({ alt, ...props }: SafeImageProps) {
  // eslint-disable-next-line @next/next/no-img-element -- centralized: see module docstring
  return <img alt={alt} {...props} />;
}
