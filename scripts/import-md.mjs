#!/usr/bin/env node
/**
 * Import a Carmenita-format Markdown file directly into the database.
 * Usage: node scripts/import-md.mjs path/to/file.md [sourceLabel]
 */
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";

// ── Inline minimal markdown parser (avoids TS import issues) ────────

function parseMarkdownMinimal(text) {
  const blocks = text.split(/^---$/m).map(b => b.trim()).filter(Boolean);
  const questions = [];
  const warnings = [];

  for (const block of blocks) {
    if (!block.startsWith("## Q")) continue;
    try {
      const lines = block.split("\n");
      const fields = {};
      const options = [];
      let correctIndices = [];
      let questionText = "";
      let inQuestion = false;

      for (const line of lines) {
        if (line.startsWith("## Q")) continue;
        const fieldMatch = line.match(/^\*\*(\w[\w\s]*?):\*\*\s*(.*)$/);
        if (fieldMatch) {
          const key = fieldMatch[1].trim().toLowerCase();
          const val = fieldMatch[2].trim();
          fields[key] = val;
          inQuestion = key === "question";
          continue;
        }
        const optMatch = line.match(/^- \[([ x])\]\s+(.+)$/);
        if (optMatch) {
          inQuestion = false;
          if (optMatch[1] === "x") correctIndices.push(options.length);
          options.push(optMatch[2].trim());
          continue;
        }
        if (inQuestion && line.trim()) {
          questionText += " " + line.trim();
        }
      }

      const q = fields["question"] || "";
      const fullQuestion = (q + questionText).trim();
      if (!fullQuestion || options.length < 2) {
        warnings.push("Skipped block: missing question or < 2 options");
        continue;
      }

      const type = fields["type"] || (options.length === 2 &&
        options.some(o => /^true$/i.test(o)) ? "true-false" :
        correctIndices.length > 1 ? "mcq-multi" : "mcq-single");

      questions.push({
        type,
        question: fullQuestion,
        options,
        correctAnswer: type === "mcq-multi" ? correctIndices : (correctIndices[0] ?? 0),
        explanation: fields["explanation"] || "",
        difficulty: fields["difficulty"] || "medium",
        bloomLevel: fields["bloom"] || fields["bloom level"] || "understand",
        subject: fields["subject"] || null,
        lesson: fields["lesson"] || null,
        topic: fields["topic"] || "imported",
        tags: (fields["tags"] || "").split(/[,;]/).map(t => t.trim()).filter(Boolean),
        sourcePassage: fields["source"] || fields["source passage"] || "",
      });
    } catch (err) {
      warnings.push(`Parse error: ${err.message}`);
    }
  }
  return { questions, warnings };
}

// ── Main ────────────────────────────────────────────────────────────

const mdPath = process.argv[2];
const sourceLabel = process.argv[3] || null;

if (!mdPath) {
  console.error("Usage: node scripts/import-md.mjs <file.md> [sourceLabel]");
  process.exit(1);
}

const text = readFileSync(mdPath, "utf-8");
const { questions, warnings } = parseMarkdownMinimal(text);

if (questions.length === 0) {
  console.error("No questions parsed.");
  if (warnings.length) console.error("Warnings:", warnings);
  process.exit(1);
}

console.log(`Parsed ${questions.length} questions (${warnings.length} warnings)`);
if (warnings.length > 0) {
  warnings.slice(0, 5).forEach((w) => console.log(`  warn: ${w}`));
  if (warnings.length > 5) console.log(`  ... and ${warnings.length - 5} more`);
}

const db = new Database("./carmenita.db");
const baseTime = Date.now();
const total = questions.length;

const insert = db.prepare(`
  INSERT INTO questions
    (id, type, question, options, correct_answer, explanation,
     difficulty, bloom_level, subject, lesson, topic, tags,
     source_passage, source_type, source_document_id, source_label,
     notes, parent_question_id, variation_type, created_at, user_id)
  VALUES
    (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'markdown-import', NULL, ?, NULL, NULL, NULL, ?, NULL)
`);

const tx = db.transaction(() => {
  for (let i = 0; i < total; i++) {
    const q = questions[i];
    insert.run(
      randomUUID(),
      q.type,
      q.question,
      JSON.stringify(q.options),
      JSON.stringify(q.correctAnswer),
      q.explanation,
      q.difficulty,
      q.bloomLevel,
      q.subject,
      q.lesson,
      q.topic.trim().toLowerCase(),
      JSON.stringify(q.tags),
      q.sourcePassage,
      sourceLabel,
      new Date(baseTime + (total - 1 - i)).toISOString(),
    );
  }
});

tx();
db.close();
console.log(`Imported ${total} questions into carmenita.db`);
