import HalftoneFlowDemo from "@/components/halftone-flow-demo";

export default function HalftoneFlowPage() {
  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-neutral-100 p-6 dark:bg-neutral-950">
      <div className="w-full max-w-5xl">
        <HalftoneFlowDemo />
      </div>
    </div>
  );
}
