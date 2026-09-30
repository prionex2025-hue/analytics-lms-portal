import { useRouteError } from "react-router-dom";
import ErrorScreen, { isChunkLoadError } from "@/components/common/ErrorScreen";

export default function RouteErrorElement() {
  const error = useRouteError();
  const message = error?.message || "Something went wrong while loading this page.";

  return <ErrorScreen chunkLoadError={isChunkLoadError(message)} message={message} onBack={() => window.history.back()} />;
}
