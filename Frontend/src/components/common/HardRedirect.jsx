import { useEffect } from "react";

export default function HardRedirect({ to, message = "Redirecting..." }) {
  useEffect(() => {
    if (typeof window !== "undefined" && to) {
      window.location.replace(to);
    }
  }, [to]);

  return <div className="grid min-h-screen place-items-center text-text-secondary">{message}</div>;
}
