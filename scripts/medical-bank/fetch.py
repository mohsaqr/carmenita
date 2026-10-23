"""Download the medical MCQ benchmarks and normalise them to Carmenita's
PortableQuestion shape, grouped into named sets.

  - Open Medical-LLM Leaderboard MCQ sets (the splits it scores):
    MedQA test, MedMCQA validation, six MMLU medical subsets (test).
  - MedMCQA train (182,822 questions), one set per subject.

PubMedQA is left out (yes/no/maybe about an abstract), and so is the
MedMCQA test split: its answer key is withheld (every `cop` is -1).

Usage: python3 -I scripts/medical-bank/fetch.py <out.json>
Output: {"sets": [{"name", "folder", "source", "questions": [...]}]}
"""
import io
import json
import sys
import urllib.request
from collections import defaultdict

import pyarrow.parquet as pq

API = "https://huggingface.co/api/datasets/openlifescienceai/{name}/parquet/default/{split}"
LEADERBOARD = "MedMCQA"
MEDMCQA_TRAIN = "MedMCQA India"
LETTERS = "ABCDE"

# name, split the leaderboard scores, set name, subject (None = per row)
LEADERBOARD_SETS = [
    ("medqa", "test", "MedQA (USMLE) test", "USMLE"),
    ("medmcqa", "validation", "MedMCQA validation", None),
    ("mmlu_anatomy", "test", "MMLU Anatomy", "Anatomy"),
    ("mmlu_clinical_knowledge", "test", "MMLU Clinical Knowledge", "Clinical Knowledge"),
    ("mmlu_college_biology", "test", "MMLU College Biology", "College Biology"),
    ("mmlu_college_medicine", "test", "MMLU College Medicine", "College Medicine"),
    ("mmlu_medical_genetics", "test", "MMLU Medical Genetics", "Medical Genetics"),
    ("mmlu_professional_medicine", "test", "MMLU Professional Medicine", "Professional Medicine"),
]


def fetch(url):
    with urllib.request.urlopen(url) as r:
        return r.read()


def rows(name, split):
    urls = json.loads(fetch(API.format(name=name, split=split)))
    tables = [pq.read_table(io.BytesIO(fetch(u))).to_pylist() for u in urls]
    return [r for t in tables for r in t]


def clean(s):
    return (s or "").strip()


def question(text, options, correct, explanation, subject, lesson, topic, tags):
    # Taxonomy is lowercased the way the import route stores it.
    return {
        "type": "mcq-single",
        "question": text,
        "options": options,
        "correctAnswer": correct,
        "explanation": explanation,
        "difficulty": "medium",
        "bloomLevel": "understand",
        "subject": subject.lower(),
        "lesson": lesson.lower() if lesson else None,
        "topic": topic.lower(),
        "tags": tags,
        "sourcePassage": "",
    }


def from_nested(r, name, subject):
    """MedQA / MMLU rows: {data: {Question, Options{A..}, Correct Option}}."""
    d = r["data"]
    keys = [k for k in LETTERS if d["Options"].get(k) is not None]
    tag = "medqa" if name == "medqa" else "mmlu"
    return question(clean(d["Question"]), [clean(d["Options"][k]) for k in keys],
                    keys.index(d["Correct Option"]), "", subject, None, subject,
                    [tag, subject.lower()])


def from_medmcqa(r):
    subject = clean(r["subject_name"]) or "Unknown"
    topic = clean(r["topic_name"]) or subject
    return question(clean(r["question"]),
                    [clean(r[k]) for k in ("opa", "opb", "opc", "opd")],
                    int(r["cop"]), clean(r["exp"]), subject,
                    topic if topic != subject else None, topic,
                    ["medmcqa", subject.lower()])


def check(qs, label):
    bad = [q for q in qs if not q["question"] or len(q["options"]) < 2
           or not 0 <= q["correctAnswer"] < len(q["options"])]
    if bad:
        sys.exit(f"{label}: {len(bad)} invalid questions, first: {bad[0]}")


sets = []
for name, split, set_name, subject in LEADERBOARD_SETS:
    raw = rows(name, split)
    qs = [from_medmcqa(r) if subject is None else from_nested(r, name, subject) for r in raw]
    check(qs, set_name)
    sets.append({"name": set_name, "folder": LEADERBOARD,
                 "source": f"openlifescienceai/{name} ({split})", "questions": qs})

by_subject = defaultdict(list)
for r in rows("medmcqa", "train"):
    by_subject[clean(r["subject_name"]) or "Unknown"].append(from_medmcqa(r))
for subject in sorted(by_subject):
    qs = by_subject[subject]
    check(qs, subject)
    sets.append({"name": f"MedMCQA {subject}", "folder": MEDMCQA_TRAIN,
                 "source": "openlifescienceai/medmcqa (train)", "questions": qs})

with open(sys.argv[1], "w") as f:
    json.dump({"sets": sets}, f, ensure_ascii=False)

for s in sets:
    print("%-26s %-34s %6d" % (s["folder"], s["name"], len(s["questions"])))
print("total", sum(len(s["questions"]) for s in sets))
