import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BookOpen, RotateCcw, Brain, BarChart3 } from "lucide-react";
import { DashboardLists } from "@/components/DashboardLists";

export default function HomePage() {
  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Study, retake, review, and track your progress.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="border-primary/40">
          <CardHeader className="pb-3">
            <BookOpen className="h-5 w-5 text-primary" />
            <CardTitle className="text-base">Take a quiz</CardTitle>
            <CardDescription className="text-xs">
              Start a focused exam from your question bank.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/take">
              <Button className="w-full" size="sm">Start</Button>
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <RotateCcw className="h-5 w-5 text-muted-foreground" />
            <CardTitle className="text-base">Repeat quizzes</CardTitle>
            <CardDescription className="text-xs">
              Retake past quizzes to improve your score.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/attempts">
              <Button variant="outline" className="w-full" size="sm">View attempts</Button>
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <Brain className="h-5 w-5 text-muted-foreground" />
            <CardTitle className="text-base">Revise</CardTitle>
            <CardDescription className="text-xs">
              Practice questions you&apos;ve gotten wrong.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/analytics#needs-review">
              <Button variant="outline" className="w-full" size="sm">Needs review</Button>
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <BarChart3 className="h-5 w-5 text-muted-foreground" />
            <CardTitle className="text-base">Track progress</CardTitle>
            <CardDescription className="text-xs">
              Per-topic, difficulty, and Bloom-level analytics.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/analytics">
              <Button variant="outline" className="w-full" size="sm">Analytics</Button>
            </Link>
          </CardContent>
        </Card>
      </div>

      <DashboardLists />
    </div>
  );
}
