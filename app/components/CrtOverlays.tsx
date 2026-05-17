/**
 * CRT overlay layers: vignette (corner darkening + magenta corner glow)
 * and noise (animated SVG turbulence).
 *
 * These are pure presentational divs. Styles in globals.css under the class
 * names .crt-vignette and .crt-noise.
 */
export default function CrtOverlays() {
  return (
    <>
      <div className="crt-vignette" aria-hidden="true" />
      <div className="crt-noise" aria-hidden="true" />
    </>
  );
}
