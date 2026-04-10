import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Info } from "lucide-react";
import {
  FORMAT_DESCRIPTIONS,
  type ChatbotPromptFormat,
} from "@/lib/formats/chatbot-prompts";

export interface MetadataValues {
  n: number;
  topic: string;
  subject: string;
  lesson: string;
  source: string;
}

interface MetadataFormProps {
  format: ChatbotPromptFormat;
  metadata: MetadataValues;
  onChange: (patch: Partial<MetadataValues>) => void;
}

const FORMAT_HINTS: Record<ChatbotPromptFormat, string> = {
  markdown:
    "Markdown supports all metadata: difficulty, Bloom level, topic, tags, explanation, and source citation.",
  gift:
    "GIFT carries question text and feedback but not difficulty, Bloom level, or per-question tags.",
  aiken:
    "Aiken is the simplest format — output will not include explanations, difficulty, Bloom level, or any metadata. Consider Markdown if you need those.",
};

export function MetadataForm({ format, metadata, onChange }: MetadataFormProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <div>
          <span className="font-medium text-foreground">
            {FORMAT_DESCRIPTIONS[format].label}
          </span>
          {" — "}
          {FORMAT_HINTS[format]}
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <div className="space-y-1.5">
          <Label htmlFor="wiz-n">Number of questions</Label>
          <Input
            id="wiz-n"
            type="number"
            min="1"
            max="50"
            value={metadata.n}
            onChange={(e) => onChange({ n: parseInt(e.target.value, 10) || 10 })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="wiz-subject">Subject</Label>
          <Input
            id="wiz-subject"
            value={metadata.subject}
            onChange={(e) => onChange({ subject: e.target.value })}
            placeholder="biology"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="wiz-lesson">Lesson</Label>
          <Input
            id="wiz-lesson"
            value={metadata.lesson}
            onChange={(e) => onChange({ lesson: e.target.value })}
            placeholder="photosynthesis"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="wiz-topic">Topic</Label>
          <Input
            id="wiz-topic"
            value={metadata.topic}
            onChange={(e) => onChange({ topic: e.target.value })}
            placeholder="light reactions"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="wiz-source">
          Source material (optional — you can also paste it directly into the chatbot after)
        </Label>
        <Textarea
          id="wiz-source"
          value={metadata.source}
          onChange={(e) => onChange({ source: e.target.value })}
          rows={4}
          placeholder="Paste your notes, textbook excerpt, or article here. Leave blank to fill in inside the chatbot."
          className="font-mono text-xs"
        />
      </div>
    </div>
  );
}
