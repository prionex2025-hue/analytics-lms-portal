import { useDispatch } from "react-redux";
import { logoutStudent, setSessionConflict } from "@/features/Students/authSlice";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export default function SessionConflictDialog() {
  const dispatch = useDispatch();

  return (
    <Dialog open onOpenChange={(open) => dispatch(setSessionConflict(open))}>
      <DialogContent showCloseButton={false} className="max-w-md">
        <DialogHeader>
          <DialogTitle>Session changed in another tab</DialogTitle>
          <DialogDescription>
            Your session was updated elsewhere. Please continue with the latest session or logout.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="justify-end">
          <Button variant="outline" onClick={() => dispatch(setSessionConflict(false))}>Continue Here</Button>
          <Button onClick={() => dispatch(logoutStudent())}>Logout</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
