# Pip-Boy AI Assistant — Local Inference Plan

## Goal

A fully offline AI assistant on the Pip-Boy. The user holds a push-to-talk button, asks a question (voice), the device transcribes it locally with Whisper.cpp, retrieves relevant knowledge from a local RAG database, sends it to a local LLM via llama.cpp, and displays the text response on screen. Zero internet required.

---

## 1. Architecture Overview

```
┌──────────────────────────────────────────────────────────────┐
│                      AI TAB (TUI)                            │
│                                                              │
│  ┌──────────┐    ┌────────────┐    ┌──────────┐    ┌──────┐ │
│  │   MIC    │───▶│ Whisper.cpp│───▶│   RAG    │───▶│llama │ │
│  │  (I2S)   │    │   (STT)    │    │ Retriever│    │ .cpp │ │
│  └──────────┘    └────────────┘    └──────────┘    └──┬───┘ │
│                                                       │      │
│  ┌──────────┐                                         │      │
│  │  SCREEN  │◀────────────────────────────────────────┘      │
│  │  (ePaper)│    text response displayed                     │
│  └──────────┘                                                │
│                                                              │
│  Push-to-talk button (GPIO) controls the pipeline            │
└──────────────────────────────────────────────────────────────┘
```

### Pipeline in detail

```
1. USER presses PTT button (GPIO interrupt)
2. Audio recording starts (ALSA arecord → WAV file, 16kHz mono)
3. USER releases PTT button
4. Audio recording stops
5. Whisper.cpp transcribes WAV → text (~2-3 sec for 5 sec audio)
6. Query text is embedded → cosine similarity search against knowledge base
7. Top-k relevant chunks retrieved from vector index
8. System prompt + retrieved context + user query assembled into a prompt
9. llama.cpp generates response (~10-30 sec depending on model)
10. Response text displayed in AI tab, streaming token-by-token
```

---

## 2. Key Open Source Projects

### 2a. llama.cpp — LLM Inference

**Repo:** https://github.com/ggerganov/llama.cpp
**Stars:** ~75k+ | **License:** MIT | **Language:** C/C++

The standard for running quantised LLMs on CPU. Supports ARM NEON SIMD on Pi 5. Runs GGUF model files.

**Integration options (from TS):**

| Method | How | Pros | Cons |
|---|---|---|---|
| **llama-server HTTP API** | Run `llama-server` as a daemon, call from TS via `fetch()` | Clean separation, streaming support, well-documented API, OpenAI-compatible endpoints | Extra process to manage, slight HTTP overhead |
| **llama-cli subprocess** | Spawn `llama-cli` per query, parse stdout | Simplest, no daemon, works immediately | No streaming, cold-start per query (model load ~5-10s) |
| **node-llama-cpp** | NPM package, native bindings | Direct integration, no subprocess | May have ARM64/Bun compatibility issues |

**Recommendation: `llama-server` HTTP API.** Start it on boot as a systemd service. It keeps the model loaded in RAM. Our TS code calls `http://localhost:8080/v1/chat/completions` with streaming. This is the most robust and well-tested approach.

### 2b. Whisper.cpp — Speech-to-Text

**Repo:** https://github.com/ggml-org/whisper.cpp
**Stars:** ~37k+ | **License:** MIT | **Language:** C/C++

High-performance C++ port of OpenAI's Whisper model. Runs entirely on CPU with ARM NEON optimisation.

**Integration from TS:**
1. Record audio: spawn `arecord -f S16_LE -r 16000 -c 1 -t wav /tmp/query.wav`
2. Transcribe: spawn `whisper-cli -m models/ggml-base.en.bin -f /tmp/query.wav --no-timestamps -otxt`
3. Read result: `/tmp/query.wav.txt`

This subprocess approach is simple and proven. No need for a persistent daemon — STT is a one-shot operation per query.

**Build flags for Pi 5:**
```bash
cmake -B build -DGGML_ARM_F16=ON
cmake --build build --config Release -j4
```

### 2c. RAG — Retrieval-Augmented Generation

No single "RAG framework" needed — we build a simple pipeline from parts:

| Component | Tool | Notes |
|---|---|---|
| **Embedding model** | `all-MiniLM-L6-v2` via ONNX Runtime, OR a small GGUF embedding model via llama.cpp | Converts text chunks → 384-dim vectors |
| **Vector storage** | Flat JSON/binary file with pre-computed embeddings | At our scale (<10k chunks) we don't need a database |
| **Similarity search** | Cosine similarity in TypeScript | Simple dot product, no external dependency |
| **Document chunking** | Pre-process offline on laptop | Split reference docs into ~200-word chunks |

**Why not a vector database?** We're dealing with a few thousand document chunks at most. A brute-force cosine similarity search over 5,000 384-dimensional vectors takes <10ms in JavaScript. No need for Pinecone/Qdrant/ChromaDB.

**Offline embedding strategy:**
1. On the laptop: chunk all reference documents
2. On the laptop: run each chunk through MiniLM to get embeddings
3. Save as a single JSON file: `[{text: "...", embedding: [0.12, -0.34, ...]}, ...]`
4. Ship this file to the Pi alongside the models
5. At query time: embed the user's question (via the same model), find top-5 nearest chunks

---

## 3. Model Selection — Benchmarks on Pi 5 (8GB)

### LLM Models

| Model | Params | Quant | Size on Disk | Speed (tok/s) | RAM Usage | Notes |
|---|---|---|---|---|---|---|
| **TinyLlama 1.1B** | 1.1B | Q4_K_M | ~650 MB | 15–18 | ~1.2 GB | Fast but shallow knowledge |
| **Qwen2.5 1.5B** | 1.5B | Q4_K_M | ~900 MB | 10–12 | ~1.5 GB | Good balance of speed and reasoning |
| **Phi-2 2.7B** | 2.7B | Q4_K_M | ~1.6 GB | 6–8 | ~2.5 GB | Strong reasoning, Microsoft |
| **Phi-3 Mini 3.8B** | 3.8B | Q4_K_M | ~2.3 GB | 4.5–5.5 | ~3.5 GB | Best quality, tight RAM fit |
| **Qwen2.5 7B** | 7B | Q4_K_M | ~4.2 GB | 1.8–2.4 | ~5.5 GB | Too slow for interactive use |

**Decision: TinyLlama 1.1B (Q4_K_M).** At 15-18 tok/s, a 100-word response takes ~5 seconds. Fast enough to feel responsive. Only ~1.2 GB RAM, leaving massive headroom for OS + TUI + sensors + STT. The shallower reasoning is compensated by RAG — we feed the model the right context, so it doesn't need deep built-in knowledge.

**Future upgrade path:** If we want better answers later, Qwen2.5 1.5B (10-12 tok/s) or Phi-3 Mini (4.5-5.5 tok/s) are drop-in replacements — just swap the GGUF file and restart llama-server.

### Whisper STT Models

| Model | Size | Speed (vs real-time) | WER | Notes |
|---|---|---|---|---|
| **tiny.en** | 75 MB | 3–4x real-time | ~15% | Fast, fine for clear speech in quiet conditions |
| **base.en** | 142 MB | 2–3x real-time | ~12% | Better accuracy, still fast. **Recommended.** |
| **small.en** | 466 MB | 0.8–1x real-time | ~8% | Near real-time, much better accuracy |

**Recommendation: `base.en` with q5_k_m quantisation.** A 5-second voice query transcribes in ~2 seconds. Good enough for push-to-talk.

**Build optimisation:** Compile whisper.cpp with `GGML_ARM_F16=ON`, use 3 threads (leave 1 core for the system).

### Embedding Model

| Model | Dims | Size | Notes |
|---|---|---|---|
| **all-MiniLM-L6-v2** | 384 | ~80 MB (ONNX) | Standard, well-tested, fast |
| **nomic-embed-text-v1.5** | 768 | ~260 MB (GGUF) | Better quality, runs via llama.cpp |
| **bge-small-en-v1.5** | 384 | ~130 MB (ONNX) | Good alternative to MiniLM |

**Recommendation: Pre-compute all embeddings offline on the laptop.** Ship a static index. For query embedding at runtime, use `all-MiniLM-L6-v2` via ONNX Runtime or the same embedding model via llama.cpp's `/v1/embeddings` endpoint.

---

## 4. RAM Budget

The Pi 5 has 8 GB. Here's how it gets allocated:

| Component | RAM | Notes |
|---|---|---|
| Raspberry Pi OS Lite | ~300 MB | Headless, no desktop |
| Bun + TUI process | ~100 MB | OpenTUI + our app |
| llama-server + TinyLlama 1.1B | ~1.3 GB | Model stays resident in RAM |
| Whisper base.en (during STT) | ~200 MB | Only during transcription, can overlap with llama-server |
| RAG index (in memory) | ~50 MB | 5k chunks x 384 dims x 4 bytes = ~7.5 MB + text |
| GPS/sensor overhead | ~20 MB | Negligible |
| **Total** | **~2.0 GB** | Comfortable fit — 6 GB free for OS cache and headroom |

With TinyLlama, RAM is a non-issue. We can comfortably run STT and LLM concurrently if needed, though the pipeline is naturally sequential (transcribe first, then generate).

---

## 5. Knowledge Domains & RAG Content

### Source Material

| Domain | Sources | Notes |
|---|---|---|
| **Farming/Agriculture** | USDA planting guides, permaculture references, companion planting charts | Public domain / CC licensed |
| **Medical/First Aid** | WHO first aid guidelines, Red Cross manuals, Wilderness First Aid | Public portions only |
| **Survival/Bushcraft** | Army Survival Manual (FM 21-76, public domain), bushcraft references | US gov publications are public domain |
| **Foraging/Wild Plants** | Regional foraging guides, plant ID references | Need to be careful about region-specificity |
| **Weather Interpretation** | Barometric interpretation guides, cloud identification, weather signs | Met office educational material |
| **Radio/Communications** | Amateur radio band plans, emergency frequencies, callsign procedures | ITU/national band plans are public |

### Chunking Strategy

- Split documents into ~200-word chunks with ~50-word overlap
- Preserve section headers as metadata (helps retrieval)
- Tag each chunk with its domain (farming, medical, etc.)
- Estimated total: 2,000–5,000 chunks
- Storage: ~5 MB for text + ~8 MB for embeddings = ~13 MB total

### Retrieval at Query Time

```typescript
// Pseudocode for the RAG retrieval step
async function retrieveContext(query: string, topK = 5): Promise<string> {
  const queryEmbedding = await embed(query);
  
  const scored = knowledgeBase.map(chunk => ({
    chunk,
    score: cosineSimilarity(queryEmbedding, chunk.embedding)
  }));
  
  scored.sort((a, b) => b.score - a.score);
  
  return scored
    .slice(0, topK)
    .map(s => s.chunk.text)
    .join("\n\n---\n\n");
}
```

---

## 6. Prompt Design

### System Prompt

```
You are a survival assistant built into a Pip-Boy wearable computer. You give
concise, practical answers about farming, medical first aid, survival, foraging,
weather, and radio communications.

Rules:
- Keep answers under 150 words — they display on a small screen.
- Be direct and actionable. No disclaimers unless safety-critical.
- For medical advice, always note "seek professional help if possible."
- Use bullet points or numbered steps for procedures.
- If you don't know, say so. Don't guess.

Use the CONTEXT below to inform your answer. If the context doesn't help,
answer from general knowledge.
```

### Full Prompt Assembly

```
[System prompt]

CONTEXT:
{retrieved RAG chunks}

USER: {transcribed voice query}

ASSISTANT:
```

### Response constraints

- Max tokens: 200 (hard cap to keep responses ePaper-friendly)
- Temperature: 0.3 (low — we want factual, not creative)
- Stop tokens: `\nUSER:`, `\n---`

---

## 7. Feature Roadmap

### Phase 1: LLM Text Chat (macOS development)
- [ ] Install llama.cpp, download Qwen2.5 1.5B Q4_K_M
- [ ] Start llama-server, verify HTTP API works
- [ ] Build TS client that calls `/v1/chat/completions` with streaming
- [ ] Display streamed response token-by-token in the AI tab
- [ ] Wire up keyboard input: type a question, get an answer
- [ ] Implement system prompt and response length cap

### Phase 2: Speech-to-Text (macOS → Pi)
- [ ] Build whisper.cpp, download base.en model
- [ ] Record test audio via `arecord` (or `sox` on macOS)
- [ ] Transcribe via whisper-cli subprocess
- [ ] Wire PTT key (spacebar on dev, GPIO button on Pi)
- [ ] Audio → transcription → display in AI tab
- [ ] Connect STT output to LLM input (full voice pipeline)

### Phase 3: RAG Knowledge Base
- [ ] Collect and clean reference documents (public domain)
- [ ] Write chunking script (TypeScript, runs on laptop)
- [ ] Generate embeddings for all chunks (MiniLM via ONNX or llama.cpp)
- [ ] Build static index file (JSON with text + embeddings)
- [ ] Implement cosine similarity search in TS
- [ ] Integrate retrieval step between STT and LLM
- [ ] Test with domain-specific questions, tune top-k and chunk size

### Phase 4: Pi 5 Deployment
- [ ] Cross-compile llama.cpp and whisper.cpp for ARM64 (or build on Pi)
- [ ] Benchmark all models on Pi 5 with active cooling
- [ ] Select final model based on speed/quality tradeoff
- [ ] Set up llama-server as a systemd service
- [ ] Test full pipeline: PTT → STT → RAG → LLM → display
- [ ] Profile RAM usage, verify no OOM under load
- [ ] Thermal testing under sustained inference

### Phase 5: Polish
- [ ] Conversation history (last N exchanges shown in AI tab)
- [ ] "Thinking..." animation while inference runs
- [ ] Audio feedback: beep on PTT press/release, chime on response ready
- [ ] Context-aware prompting: inject current sensor readings into prompt
  - e.g., "The barometer reads 1003 hPa and falling" → better weather advice
- [ ] Quick-response cache: hash common queries, serve cached answers instantly
- [ ] Model hot-swap: switch between fast (TinyLlama) and smart (Phi-3) modes

---

## 8. File Layout

```
pip-boy-tui/
  src/
    ai/
      llm-client.ts      — HTTP client for llama-server API (streaming)
      stt.ts             — Whisper.cpp subprocess wrapper
      rag.ts             — embedding search, context retrieval
      knowledge-base.ts  — loads and indexes the chunk database
      prompt.ts          — system prompt assembly
      audio.ts           — audio recording (arecord/sox subprocess)
      ptt.ts             — push-to-talk GPIO button handler
    index.ts             — main TUI (AI tab uses the above)

data/
  models/
    tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf  — LLM model file (~650 MB)
    ggml-base.en.bin                        — Whisper STT model (~142 MB)
  knowledge/
    index.json                    — pre-computed chunk embeddings
    sources/                      — raw reference documents (for rebuilding)

scripts/
  chunk-documents.ts              — document chunking script
  generate-embeddings.ts          — embedding generation script
  build-index.ts                  — combines chunks + embeddings into index.json
```

---

## 9. llama-server Configuration

```bash
# Start llama-server as a systemd service on the Pi
llama-server \
  --model /data/models/tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf \
  --host 127.0.0.1 \
  --port 8080 \
  --ctx-size 2048 \
  --threads 4 \
  --batch-size 512 \
  --n-predict 200 \
  --temp 0.3 \
  --log-disable
```

**API call from TypeScript:**
```typescript
const response = await fetch("http://127.0.0.1:8080/v1/chat/completions", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: `Context:\n${ragContext}\n\nQuestion: ${query}` }
    ],
    max_tokens: 200,
    temperature: 0.3,
    stream: true
  })
});

// Stream tokens as they arrive
const reader = response.body.getReader();
const decoder = new TextDecoder();
while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  const chunk = decoder.decode(value);
  // Parse SSE format, extract token, update UI
}
```

---

## 10. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| TinyLlama answers too shallow/wrong | Medium | RAG compensates. If still insufficient, swap to Qwen2.5 1.5B (drop-in GGUF swap). |
| RAM OOM when running STT + LLM concurrently | Low | TinyLlama + Whisper base.en totals ~2 GB. 6 GB headroom. Not a concern. |
| Whisper accuracy poor with ambient noise + fan | Medium | Directional MEMS mic, foam windscreen, software noise gate, place mic away from fan |
| RAG retrieves wrong context | Medium | Tune chunk size, overlap, and top-k. Test extensively per domain. |
| ONNX Runtime doesn't work on Bun/ARM64 | Medium | Use llama.cpp's `/v1/embeddings` endpoint for runtime embedding instead |
| model files too large for SD card | Low | Use NVMe. Total model storage is <5 GB for all models. |
| Thermal throttling tanks inference speed | High | Active cooling is mandatory. Heatsink + fan. Test before enclosure design. |
| `node-llama-cpp` NPM bindings fail on Bun | Low | We're using HTTP API to llama-server, so no native bindings needed |

---

## 11. Open Questions

- [ ] **Which embedding approach at runtime?** ONNX MiniLM vs llama.cpp `/v1/embeddings`? Need to benchmark both on Pi 5.
- [ ] **Should we support multi-turn conversation?** Increases context window usage. Start with single-turn (each PTT press is independent).
- [ ] **Sensor-augmented prompting:** Should we inject live sensor data (temp, barometric, radiation) into the system prompt so the AI can reference it?
- [ ] **Model updates:** How does the user update models or the knowledge base? USB drive? Brief WiFi connection?
- [ ] **Voice output (TTS)?** Beyond current scope, but a future stretch goal. Would require another model (e.g., Piper TTS, ~50MB).
- [ ] **Multiple model profiles?** "Quick" mode (TinyLlama, <5s) vs "Deep" mode (Phi-3, ~30s) selected by the user?
