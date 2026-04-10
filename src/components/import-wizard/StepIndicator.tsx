import { Check } from "lucide-react";

interface StepIndicatorProps {
  steps: string[];
  currentStep: number;
  onStepClick: (step: number) => void;
}

export function StepIndicator({ steps, currentStep, onStepClick }: StepIndicatorProps) {
  return (
    <nav aria-label="Import wizard progress" className="flex items-center justify-between gap-2">
      {steps.map((label, i) => {
        const completed = i < currentStep;
        const active = i === currentStep;

        return (
          <div key={label} className="flex flex-1 items-center gap-2">
            <button
              type="button"
              disabled={!completed}
              onClick={() => completed && onStepClick(i)}
              className={[
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-medium transition-colors",
                completed
                  ? "bg-primary text-primary-foreground cursor-pointer hover:bg-primary/90"
                  : active
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground",
                !completed && "cursor-default",
              ]
                .filter(Boolean)
                .join(" ")}
              aria-current={active ? "step" : undefined}
            >
              {completed ? <Check className="h-4 w-4" /> : i + 1}
            </button>
            <span
              className={[
                "hidden text-sm sm:inline",
                active ? "font-medium text-foreground" : "text-muted-foreground",
              ].join(" ")}
            >
              {label}
            </span>
            {i < steps.length - 1 && (
              <div
                className={[
                  "mx-2 h-px flex-1",
                  completed ? "bg-primary" : "bg-border",
                ].join(" ")}
              />
            )}
          </div>
        );
      })}
    </nav>
  );
}
