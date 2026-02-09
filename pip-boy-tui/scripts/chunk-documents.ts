#!/usr/bin/env bun
/**
 * chunk-documents.ts — Splits knowledge base source documents into overlapping chunks
 * with metadata (domain, section). Generates a JSON index used by the RAG retrieval module.
 *
 * Usage: bun run scripts/chunk-documents.ts
 * Output: data/knowledge/index.json
 */

import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, basename } from "node:path";

// --- Configuration ---
const SOURCES_DIR = join(import.meta.dir, "../data/knowledge/sources");
const OUTPUT_PATH = join(import.meta.dir, "../data/knowledge/index.json");
const TARGET_CHUNK_WORDS = 200;
const OVERLAP_WORDS = 40;

// --- Types ---
export interface Chunk {
  id: string;
  text: string;
  domain: string;
  section: string;
  source: string;
  /** Pre-computed lowercase tokens for BM25 search */
  tokens: string[];
}

interface Section {
  domain: string;
  section: string;
  text: string;
}

// --- Stopwords for BM25 (common English words that add noise) ---
const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for",
  "of", "with", "by", "from", "is", "are", "was", "were", "be", "been",
  "being", "have", "has", "had", "do", "does", "did", "will", "would",
  "could", "should", "may", "might", "can", "shall", "this", "that",
  "these", "those", "it", "its", "you", "your", "we", "our", "they",
  "their", "he", "she", "his", "her", "as", "if", "not", "no", "so",
  "up", "out", "about", "into", "than", "then", "also", "just", "more",
  "some", "any", "all", "each", "every", "very", "most", "much", "such",
  "only", "own", "same", "other", "both", "few", "many", "how", "what",
  "which", "who", "when", "where", "why", "there", "here",
]);

/**
 * Tokenise text for BM25: lowercase, strip punctuation, remove stopwords, keep words 2+ chars
 */
function tokenise(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !STOPWORDS.has(w));
}

/**
 * Parse a source file into sections based on ## and ### headers
 */
function parseSections(content: string, filename: string): Section[] {
  const lines = content.split("\n");
  const sections: Section[] = [];

  let domain = basename(filename, ".txt");
  let currentSection = "";
  let currentText: string[] = [];

  for (const line of lines) {
    // ## DOMAIN: ... header
    if (line.startsWith("## DOMAIN:")) {
      domain = line.replace("## DOMAIN:", "").trim();
      continue;
    }

    // ### Section header — flush previous section and start new one
    if (line.startsWith("### ")) {
      if (currentSection && currentText.length > 0) {
        sections.push({
          domain,
          section: currentSection,
          text: currentText.join("\n").trim(),
        });
      }
      currentSection = line.replace("### ", "").trim();
      currentText = [];
      continue;
    }

    // Accumulate text lines
    if (currentSection) {
      currentText.push(line);
    }
  }

  // Flush last section
  if (currentSection && currentText.length > 0) {
    sections.push({
      domain,
      section: currentSection,
      text: currentText.join("\n").trim(),
    });
  }

  return sections;
}

/**
 * Split a section into overlapping chunks of ~TARGET_CHUNK_WORDS words
 */
function chunkSection(section: Section, sourceFile: string): Chunk[] {
  const words = section.text.split(/\s+/).filter((w) => w.length > 0);
  const chunks: Chunk[] = [];

  if (words.length <= TARGET_CHUNK_WORDS) {
    // Section fits in one chunk
    const text = section.text.trim();
    if (text.length > 0) {
      chunks.push({
        id: `${sourceFile}:${section.section}:0`,
        text: `[${section.domain} > ${section.section}]\n${text}`,
        domain: section.domain,
        section: section.section,
        source: sourceFile,
        tokens: tokenise(text),
      });
    }
    return chunks;
  }

  // Sliding window with overlap
  let start = 0;
  let chunkIndex = 0;

  while (start < words.length) {
    const end = Math.min(start + TARGET_CHUNK_WORDS, words.length);
    const chunkWords = words.slice(start, end);
    const text = chunkWords.join(" ");

    if (text.trim().length > 0) {
      chunks.push({
        id: `${sourceFile}:${section.section}:${chunkIndex}`,
        text: `[${section.domain} > ${section.section}]\n${text}`,
        domain: section.domain,
        section: section.section,
        source: sourceFile,
        tokens: tokenise(text),
      });
      chunkIndex++;
    }

    // If we've reached the end, stop
    if (end >= words.length) break;

    // Advance by (target - overlap) words
    start += TARGET_CHUNK_WORDS - OVERLAP_WORDS;
  }

  return chunks;
}

// --- Main ---
async function main() {
  console.log("Chunking knowledge base documents...\n");

  const files = await readdir(SOURCES_DIR);
  const txtFiles = files.filter((f) => f.endsWith(".txt")).sort();

  const allChunks: Chunk[] = [];

  for (const file of txtFiles) {
    const content = await readFile(join(SOURCES_DIR, file), "utf-8");
    const sections = parseSections(content, file);
    let fileChunks = 0;

    for (const section of sections) {
      const chunks = chunkSection(section, file);
      allChunks.push(...chunks);
      fileChunks += chunks.length;
    }

    console.log(
      `  ${file}: ${sections.length} sections → ${fileChunks} chunks`
    );
  }

  // Compute corpus-wide stats for BM25
  const avgDocLen =
    allChunks.reduce((sum, c) => sum + c.tokens.length, 0) / allChunks.length;

  // Document frequency for each term
  const df: Record<string, number> = {};
  for (const chunk of allChunks) {
    const seen = new Set<string>();
    for (const token of chunk.tokens) {
      if (!seen.has(token)) {
        df[token] = (df[token] || 0) + 1;
        seen.add(token);
      }
    }
  }

  const index = {
    version: 1,
    created: new Date().toISOString(),
    totalChunks: allChunks.length,
    avgDocLen,
    corpusSize: allChunks.length,
    df,
    chunks: allChunks,
  };

  await writeFile(OUTPUT_PATH, JSON.stringify(index, null, 2));

  console.log(`\nTotal: ${allChunks.length} chunks from ${txtFiles.length} files`);
  console.log(`Average chunk length: ${Math.round(avgDocLen)} tokens`);
  console.log(`Vocabulary size: ${Object.keys(df).length} terms`);
  console.log(`Written to: ${OUTPUT_PATH}`);
}

main().catch((e) => {
  console.error("Error:", e);
  process.exit(1);
});
