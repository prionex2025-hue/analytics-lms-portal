import { Card, CardContent } from "@/components/ui/card";

export default function StatCard({ title, value, suffix }) {
  return (
    <Card className="h-full rounded-xl border-border bg-card shadow-sm">
      <CardContent className="flex h-full flex-col justify-between px-3 py-3 sm:px-4 sm:py-4">
        <p className="min-h-8 text-[11px] leading-tight text-text-secondary sm:min-h-0 sm:text-sm">{title}</p>
        <p className="mt-2 break-words text-xl font-bold leading-none text-text-primary sm:text-3xl">
          {value}
          {suffix ? <span className="text-xs font-medium text-text-secondary sm:text-base"> {suffix}</span> : null}
        </p>
      </CardContent>
    </Card>
  );
}
