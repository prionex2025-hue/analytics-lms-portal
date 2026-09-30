import { Component } from "react";
import ErrorScreen, { isChunkLoadError } from "@/components/common/ErrorScreen";

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
      <ErrorScreen
        chunkLoadError={this.state.chunkLoadError}
        message={this.state.errorMessage}
        onRetry={this.handleRetry}
      />
    );
  }
}

export default AppErrorBoundary;
