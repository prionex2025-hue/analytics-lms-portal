import { useEffect, useMemo, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function TypedConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  expectedText,
  inputLabel = "Type confirmation",
  confirmLabel = "Confirm",
  confirmVariant = "default",
  onConfirm,
}) {
  const [typedText, setTypedText] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!open) {
      setTypedText("");
      setIsLoading(false);
    }
  }, [open]);

  const canConfirm = useMemo(() => typedText.trim() === String(expectedText || ""), [expectedText, typedText]);

  const handleConfirm = async () => {
    setIsLoading(true);
    try {
      await onConfirm?.(typedText.trim());
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-2">
          <Label htmlFor="typed-confirm-input" className="text-sm font-medium text-text-primary">{inputLabel}</Label>
          <p className="text-xs text-text-secondary">
            Type <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs font-semibold text-text-primary select-all">{expectedText}</code> to continue.
          </p>
          <Input
            id="typed-confirm-input"
            value={typedText}
            onChange={(event) => setTypedText(event.target.value)}
            disabled={isLoading}
            autoComplete="off"
            spellCheck={false}
            className="h-10 rounded-lg font-mono"
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isLoading}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className={confirmVariant === "destructive" ? "bg-danger hover:bg-danger/90" : ""}
            disabled={!canConfirm || isLoading}
            onClick={handleConfirm}
          >
            {isLoading ? "Processing..." : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
