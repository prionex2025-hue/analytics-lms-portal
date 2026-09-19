import { Component } from "react";
import { Button } from "@/components/ui/button";

const isChunkLoadError = (message) =>
  message.includes("Failed to fetch dynamically imported module") ||
  message.includes("Importing a module script failed") ||
  message.includes("error loading dynamically imported module");

class AppErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = {
      hasError: false,
      errorMessage: "",
      chunkLoadError: false,
    };
  }

  static getDerivedStateFromError(error) {
    const errorMessage = error?.message || "Something went wrong.";
    return {
      hasError: true,
      errorMessage,
      chunkLoadError: isChunkLoadError(String(errorMessage)),
    };
  }

  componentDidCatch(error, info) {
    // Keep this for production diagnostics integration.
    if (typeof console !== "undefined") {
      console.error("AppErrorBoundary", error, info);
    }
  }

  handleRetry = () => {
    this.setState({
      hasError: false,
      errorMessage: "",
      chunkLoadError: false,
    });
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <section className="grid min-h-screen place-items-center bg-muted p-6">
        <article className="w-full max-w-lg rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
          <h1 className="text-2xl font-semibold text-text-primary">
            {this.state.chunkLoadError ? "Update required" : "Unexpected error"}
          </h1>
          <p className="mt-3 text-sm text-text-secondary">
            {this.state.chunkLoadError
              ? "A newer version of the portal is available. Reload the page to continue with the latest files."
              : this.state.errorMessage}
          </p>
          <div className="mt-5 flex justify-center gap-2">
            <Button type="button" variant="outline" onClick={this.handleRetry}>Retry</Button>
            <Button type="button" onClick={() => window.location.reload()}>Reload</Button>
          </div>
        </article>
      </section>
    );
  }
}

export default AppErrorBoundary;
