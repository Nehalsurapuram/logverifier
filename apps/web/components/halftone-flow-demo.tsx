"use client";

import HalftoneFlow from "@/components/ui/halftone-flow";

export default function HalftoneFlowDemo() {
  return (
    <div className="relative h-[420px] w-full overflow-hidden rounded-xl bg-black">
      <HalftoneFlow className="absolute inset-0 h-full w-full" />
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-2xl font-semibold tracking-tight text-white">
          Halftone Flow
        </span>
      </div>
    </div>
  );
}
