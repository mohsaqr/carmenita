import { Badge } from "@/components/ui/badge";
import {
  FORMAT_DESCRIPTIONS,
  type ChatbotPromptFormat,
} from "@/lib/formats/chatbot-prompts";

interface FormatPickerProps {
  onSelect: (format: ChatbotPromptFormat) => void;
}

const FORMATS: ChatbotPromptFormat[] = ["markdown", "gift", "aiken"];

export function FormatPicker({ onSelect }: FormatPickerProps) {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {FORMATS.map((f) => {
        const info = FORMAT_DESCRIPTIONS[f];
        const recommended = f === "markdown";
        return (
          <button
            key={f}
            type="button"
            onClick={() => onSelect(f)}
            className="flex flex-col gap-2 rounded-xl border bg-card p-5 text-left shadow-sm transition-colors hover:border-primary hover:bg-primary/5"
          >
            <div className="flex items-center gap-2">
              <span className="font-semibold">{info.label}</span>
              {recommended && <Badge className="text-[10px] h-4 px-1">Recommended</Badge>}
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">{info.long}</p>
          </button>
        );
      })}
    </div>
  );
}
