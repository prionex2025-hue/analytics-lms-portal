import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

describe("Dialog", () => {
  it("renders a closed controlled dialog without crashing", () => {
    render(
      <Dialog open={false}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Closed dialog</DialogTitle>
            <DialogDescription>Should stay inert while closed.</DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    );

    expect(screen.queryByText("Closed dialog")).not.toBeInTheDocument();
  });
});
