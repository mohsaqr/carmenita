import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Sparkles, BookOpen, BarChart3, Upload } from "lucide-react";
import { DashboardLists } from "@/components/DashboardLists";

export default function HomePage() {
  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Carmenita</h1>
        <p className="text-muted-foreground">
          Turn documents, topics, lectures, or imported MCQs into multiple-choice quizzes.
          Study, retake, track improvement.
        </p>
      </header>

      {/*
        Action grid. On mobile it's a single column, on md it's 2x2, and
        on lg it flattens into one row of four. The "Take an exam" card
        embeds ExamPickerCard directly so the user can start a quiz
        without navigating away — this replaces the old dead "Take
        Quizzes" card that pointed at a scroll anchor.
      */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader>
            <Sparkles className="h-6 w-6 text-muted-foreground" />
            <CardTitle>Create questions</CardTitle>
            <CardDescription>
              Generate from a document, a typed topic, a PPTX lecture, or import existing MCQs.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/create">
              <Button className="w-full">Start a new quiz</Button>
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <BookOpen className="h-6 w-6 text-muted-foreground" />
            <CardTitle>Take a quiz</CardTitle>
            <CardDescription>
              Filter your bank by subject, topic, tag, difficulty or Bloom
              level and start a focused exam.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/take">
              <Button className="w-full">Open take-quiz page</Button>
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <Upload className="h-6 w-6 text-muted-foreground" />
            <CardTitle>Import MCQs</CardTitle>
            <CardDescription>
              Paste or upload GIFT / Aiken / Markdown MCQ files — or a PDF with existing questions.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/import">
              <Button variant="outline" className="w-full">Import questions</Button>
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <BarChart3 className="h-6 w-6 text-muted-foreground" />
            <CardTitle>Track performance</CardTitle>
            <CardDescription>
              Per-topic, per-difficulty, per-Bloom-level analytics across trials.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/analytics">
              <Button variant="outline" className="w-full">View analytics</Button>
            </Link>
          </CardContent>
        </Card>
      </div>

      <DashboardLists />
    </div>
  );
}
