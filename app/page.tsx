import KineticMatrix from "@/components/ui/kinetic-matrix";

export default function Home() {
  return (
    <div className="flex h-screen w-full items-center justify-center bg-neutral-100 p-6 dark:bg-neutral-950">
      {/* Constrained Centered Card Container */}
      <div className="relative h-[600px] max-h-full w-full max-w-5xl overflow-hidden rounded-3xl border border-neutral-300 shadow-2xl dark:border-neutral-800">
        <KineticMatrix className="h-full w-full rounded-3xl" />
      </div>
    </div>
  );
}
