import React from "react"
import Image from "next/image"

interface LogoProps {
  className?: string
  iconOnly?: boolean
  /** Pixel size of the mark. The wordmark scales with it. */
  size?: number
}

/**
 * The Nexora lockup: the mark as a transparent image, the wordmark as text.
 *
 * The supplied artwork is a glowing blue mark on a near-black background with
 * a white wordmark. Neither survives a light theme as-is — the background
 * would show as a dark square and the white wordmark would disappear. So the
 * mark is keyed to transparency (the blue reads on either theme) and the
 * wordmark is set in text here, inheriting the theme's foreground colour
 * rather than being baked into a picture. See
 * scratch-make-logo-assets.py's header for how the assets were cut.
 */
export default function Logo({ className = "", iconOnly = false, size = 22 }: LogoProps) {
  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <Image
        src="/nexora-mark.png"
        alt="Nexora"
        width={size}
        height={size}
        priority
        className="shrink-0 object-contain"
        style={{ width: size, height: size }}
      />

      {!iconOnly && (
        <span
          className="font-mono font-bold uppercase tracking-[0.18em] text-zinc-900 dark:text-zinc-50"
          style={{ fontSize: Math.max(Math.round(size * 0.5), 10) }}
        >
          Nexora
        </span>
      )}
    </div>
  )
}
