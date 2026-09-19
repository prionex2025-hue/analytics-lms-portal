import { Suspense, lazy, useEffect, useState } from "react";

const Toaster = lazy(() => import("@/components/ui/sonner").then((module) => ({ default: module.Toaster })));

export default function DeferredToaster() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const scheduleIdle = window.requestIdleCallback || ((callback) => window.setTimeout(callback, 1200));
    const cancelIdle = window.cancelIdleCallback || window.clearTimeout;
    const handle = scheduleIdle(() => setReady(true));

    return () => cancelIdle(handle);
  }, []);

  if (!ready) {
    return null;
  }

  return (
    <Suspense fallback={null}>
      <Toaster />
    </Suspense>
  );
}
