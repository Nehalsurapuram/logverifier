import type { ReactNode } from "react";

import HalftoneFlow from "@/components/ui/halftone-flow";

/**
 * Full-bleed shell: the halftone shader renders as a fixed background layer,
 * app content stacks above it.
 *
 * The shader lives in a sandboxed iframe, so it is marked `pointer-events-none`
 * — otherwise the iframe swallows every click meant for the UI on top of it.
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="relative min-h-screen w-full bg-black text-white">
      <div aria-hidden className="fixed inset-0 z-0">
        <HalftoneFlow className="pointer-events-none h-full w-full" />
        {/* Scrim: keeps text legible over the brightest parts of the shader. */}
        <div className="pointer-events-none absolute inset-0 bg-black/65" />
      </div>

      <div className="relative z-10 flex min-h-screen w-full flex-col">
        {children}
      </div>
    </div>
  );
}

export default AppShell;
