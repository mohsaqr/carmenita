"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import type { ChatbotPromptFormat } from "@/lib/formats/chatbot-prompts";
import type { ImportResult } from "@/components/ImportCard";
import { StepIndicator } from "./StepIndicator";
import { FormatPicker } from "./FormatPicker";
import type { MetadataValues } from "./MetadataForm";
import { PromptAndImport } from "./PromptAndImport";
import { PostImportActions } from "./PostImportActions";

const STEPS = ["Format", "Generate & Import", "What next?"];

type Step = 0 | 1 | 2;

export function ImportWizard() {
  const [step, setStep] = useState<Step>(0);
  const [format, setFormat] = useState<ChatbotPromptFormat | null>(null);
  const [metadata, setMetadata] = useState<MetadataValues>({
    n: 10,
    topic: "",
    subject: "",
    lesson: "",
    source: "",
  });
  const [importText, setImportText] = useState("");
  const [importSourceLabel, setImportSourceLabel] = useState("");
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

  function handleFormatSelect(f: ChatbotPromptFormat) {
    setFormat(f);
    setStep(1);
  }

  function handleImported(result: ImportResult) {
    if (result.count === 0) {
      toast.error("No questions were imported — check the format and try again.");
      return;
    }
    setImportResult(result);
    setStep(2);
  }

  function handleImportMore() {
    setImportResult(null);
    setImportText("");
    setImportSourceLabel("");
    setStep(0);
  }

  function handleBack() {
    setStep((s) => Math.max(0, s - 1) as Step);
  }

  function handleStepClick(target: number) {
    if (target < step) setStep(target as Step);
  }

  return (
    <div className="space-y-6">
      <StepIndicator steps={STEPS} currentStep={step} onStepClick={handleStepClick} />

      {step === 0 && <FormatPicker onSelect={handleFormatSelect} />}

      {step === 1 && format && (
        <>
          <PromptAndImport
            format={format}
            metadata={metadata}
            onMetadataChange={(patch) => setMetadata((m) => ({ ...m, ...patch }))}
            importText={importText}
            importSourceLabel={importSourceLabel}
            onImportTextChange={setImportText}
            onImportSourceLabelChange={setImportSourceLabel}
            onImported={handleImported}
          />
          <div className="flex justify-start">
            <Button variant="outline" onClick={handleBack}>
              <ArrowLeft className="h-4 w-4" />
              Back
            </Button>
          </div>
        </>
      )}

      {step === 2 && importResult && (
        <PostImportActions imported={importResult} onImportMore={handleImportMore} />
      )}
    </div>
  );
}
