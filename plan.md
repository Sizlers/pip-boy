# Pip-Boy Build Plan

**Goal:** Functional wearable computer styled as a Fallout Pip-Boy
**Experience level:** Intermediate (comfortable with RPi, basic soldering, simple circuits)
**Budget:** Flexible, decided per-component
**3D Printer:** Access via makerspace/library

---

## 1. Electronics

### Core Platform
- **Microcontroller:** Raspberry Pi 5 (8GB RAM) — required for local LLM inference
- **Display:** 4" full-colour ePaper (600x400), slow refresh acceptable
- **Storage:** High-endurance MicroSD (64GB+) or NVMe via HAT for model storage

### Confirmed Features
| Feature | Notes |
|---|---|
| Local AI Assistant | Small language model, voice-in (push-to-talk), text-out on screen |
| GPS/Navigation | Real-world location, mapping |
| Environmental sensors | Temp, humidity, barometric pressure, UV |
| Geiger counter | Actual radiation detection module |
| Time/Clock | RTC with alarms, stopwatch, timer |
| Audio output | Speaker for sounds, alerts, and Geiger clicks |
| Microphone input | For push-to-talk voice queries to the AI assistant |

### Open Questions — Electronics

- [x] **Pi Zero 2 W vs Pi 5?** — **DECIDED: Pi 5 (8GB)**
  - Local LLM inference requires the Pi 5's quad-core A76 and 8GB RAM.
  - Pi 5 draws ~3-5W idle, ~8-12W under full inference load. This significantly impacts battery sizing.
  - Consider NVMe HAT for faster model loading (MicroSD is slow for 2-4GB model files).

- [ ] **Microphone selection?**
  - USB microphone: simplest, but uses a USB port and adds bulk.
  - I2S MEMS microphone (e.g., INMP441, SPH0645): tiny, digital, connects via GPIO. Preferred.
  - Analogue electret mic + ADC: possible but more complex, noisier.
  - Placement: needs to be near the user's mouth/face — top edge of the enclosure?
  - Wind/noise filtering: foam cover? Software noise reduction?

- [ ] **Which ePaper display specifically?**
  - Waveshare and Good Display both make 4" colour ePaper panels. Which one? What driver board/HAT?
  - Does it connect via SPI? GPIO pin budget?
  - Refresh rate and partial refresh support for the chosen panel?

- [ ] **GPS module selection?**
  - u-blox NEO-6M (cheap, common, UART) vs NEO-M8N (better sensitivity, faster fix) vs NEO-M9N (newest)?
  - Antenna: chip antenna vs external? External is better for a wrist-mounted device where the body blocks signal.
  - Power draw considerations?

- [ ] **Environmental sensor selection?**
  - BME280 (temp + humidity + pressure) as a single I2C module? Or separate sensors?
  - UV sensor: VEML6075 or LTR-390?
  - Do we want air quality (CCS811/SGP30) as a stretch goal?

- [ ] **Geiger counter module?**
  - Pre-built module (e.g., RadiationD v1.1 with SBM-20 tube) vs building from scratch?
  - Pre-built is recommended at intermediate level — high voltage (400V) is involved.
  - Interface: pulse counting via GPIO interrupt.
  - Size and placement — GM tubes are physically long (~10cm for SBM-20). Will it fit?

- [ ] **RTC module?**
  - DS3231 (I2C, very accurate, ~$2) is the standard choice. Any reason not to use it?
  - Battery backup (CR2032) so time persists when powered off.

- [ ] **Audio output?**
  - Small speaker (e.g., 28mm 8 ohm) driven by what?
  - Pi has PWM audio on GPIO, but it's noisy. Use a small I2S DAC (e.g., MAX98357A)?
  - Volume control: software only, or a physical pot?

- [ ] **Power system?**
  - LiPo cell: what capacity? Pi 5 at load draws ~10W. For 4 hours = ~40Wh = ~10,800mAh @ 3.7V. That's a big battery.
  - Realistic: 5000-6000mAh LiPo gives ~2-3 hours of mixed use (idle + occasional inference bursts).
  - Charging IC: TP4056 is only 1A — too slow for a large cell. Need a higher-current charger (e.g., IP5306, BQ25895, or similar 2-3A IC).
  - 5V boost converter rated for Pi 5 peak current (~5A spikes). Not all boost boards can handle this.
  - Battery gauge IC (MAX17048 or similar) so the UI can show battery level — very Pip-Boy.
  - Estimated battery life target? Needs to be realistic given the Pi 5 power draw.
  - Consider: NVMe HAT adds another ~1-2W when active.

- [ ] **GPIO / bus budget?**
  - SPI: ePaper display
  - I2C: BME280, DS3231, UV sensor, battery gauge
  - I2S: MEMS microphone (input), DAC/amp for speaker (output) — can I2S handle both simultaneously on Pi 5?
  - UART: GPS module
  - GPIO: Geiger counter pulse input, push-to-talk button, navigation buttons/encoder
  - USB: potentially NVMe adapter (or use PCIe on Pi 5 directly)
  - Pi 5 has more GPIO flexibility than Zero 2 W, but the NVMe HAT may occupy some pins. Needs a pin map.

- [ ] **Input method?**
  - Rotary encoder with push button (authentic Pip-Boy feel)?
  - Tactile buttons for tab navigation?
  - **Push-to-talk button** — dedicated, easy to reach. Momentary switch.
  - How many physical controls total?

---

## 2. Appearance / Enclosure

### Concept
Wrist-mounted device that echoes the Pip-Boy 3000 aesthetic — chunky, industrial, with a visible screen and physical controls.

### Open Questions — Appearance

- [ ] **Which Pip-Boy model to reference?**
  - Pip-Boy 3000 (Fallout 3/NV): bulkier, CRT-style screen
  - Pip-Boy 3000 Mark IV (Fallout 4): sleeker, modular
  - Custom/original design inspired by the aesthetic?

- [ ] **Enclosure method?**
  - 3D printed shell (most likely). Material: PLA for prototyping, PETG or ASA for durability?
  - Split-shell design (top/bottom halves with screws)?
  - How does it attach to the forearm? Velcro straps? Hinged clamshell?

- [ ] **Internal layout?**
  - The Geiger tube (SBM-20) is ~105mm long — this likely defines minimum enclosure length.
  - Display window cutout.
  - Speaker grille placement.
  - Antenna considerations (GPS needs sky view — top of enclosure or external antenna routed to the top).
  - Battery compartment (accessible for replacement/inspection?).

- [ ] **Finish and aesthetics?**
  - Paint: metallic/weathered look? Spray paint + weathering techniques?
  - Decals/labels in the Fallout style?
  - LED accents (e.g., green status LED, backlit controls)?

- [ ] **Ergonomics?**
  - Weight budget? All these components add up.
  - Comfort for extended wear — padding, strap design, weight distribution.
  - Screen angle — readable without awkward wrist bending?

- [ ] **Cooling?**
  - Pi 5 **requires active cooling** — especially under sustained LLM inference loads.
  - Small 30mm or 40mm fan + heatsink. The official Pi 5 Active Cooler is effective but bulky — may need a low-profile alternative.
  - Ventilation holes/intake/exhaust routing in the enclosure.
  - Fan noise: acceptable? Can we PWM control the fan speed based on CPU temp?
  - Thermal throttling will tank inference performance if cooling is inadequate.

---

## 3. Software

### Platform & Stack
- **OS:** Raspberry Pi OS Lite (headless, no desktop) — 64-bit required for LLM runtimes
- **Runtime:** Bun (JavaScript/TypeScript runtime) — required by OpenTUI
- **TUI Framework:** OpenTUI (`@opentui/core`) — TypeScript library for terminal UIs
- **Language:** TypeScript (all application code)
- **LLM Runtime:** llama.cpp (called via subprocess or native bindings from TS)
- **STT:** Whisper.cpp (called via subprocess from TS)
- **Build tooling:** Zig (required to build OpenTUI native components)
- **UI Pattern:** Pip-Boy tab layout — tabs across the top, rotary encoder / arrow key navigation

### 3a. Local AI Assistant

#### Concept
Push-to-talk voice input -> speech-to-text -> local LLM inference -> text response displayed on ePaper screen. The user holds a button, asks a question about farming, medical, survival, foraging, weather, or radio/comms, and the answer appears on screen.

#### Knowledge Domains
| Domain | Example Queries |
|---|---|
| Farming/Agriculture | "When should I plant tomatoes in zone 7?" |
| Medical/First Aid | "How do I treat a second-degree burn?" |
| Survival/Bushcraft | "How do I purify water with no filter?" |
| Foraging | "Is chicken of the woods safe to eat?" |
| Weather Interpretation | "Barometer dropping fast — what does that mean?" |
| Radio/Comms | "What frequency is channel 16 marine VHF?" |

#### Open Questions — AI Assistant

- [ ] **Which local LLM?**
  - Pi 5 (8GB) can realistically run ~1-3B parameter models quantized to 4-bit.
  - Candidates:
    - **TinyLlama 1.1B** (Q4_K_M ~700MB): fast, but limited knowledge depth.
    - **Phi-2 2.7B** (Q4_K_M ~1.6GB): better reasoning, Microsoft model, fits in RAM.
    - **Phi-3 Mini 3.8B** (Q4_K_M ~2.2GB): newest, strong for its size, tight fit in 8GB with OS overhead.
    - **Gemma 2B** (Q4_K_M ~1.5GB): Google model, decent general knowledge.
  - Need to benchmark actual inference speed on Pi 5 — expect ~2-5 tokens/sec for 3B models.
  - 10-30 second response time is acceptable per user.

- [ ] **Inference runtime?**
  - **llama.cpp**: most mature, C++, runs on ARM, supports quantized GGUF models. Strong choice.
  - Called from TypeScript via:
    - Subprocess: spawn `llama-cli` or `llama-server`, parse stdout. Simplest.
    - `llama-server` HTTP API: run llama.cpp as a local HTTP server, call from TS with `fetch()`. Clean separation.
    - Native bindings: `node-llama-cpp` npm package — direct bindings, tighter integration but may have ARM/Bun compatibility issues.
  - **Ollama**: wraps llama.cpp, has a REST API. Easy to call from TS, but adds overhead and another daemon.

- [ ] **Speech-to-text (STT)?**
  - **Whisper.cpp**: OpenAI's Whisper model compiled for CPU. The "tiny" or "base" model runs on Pi 5.
    - tiny.en (~75MB): fast but less accurate, English only.
    - base.en (~142MB): better accuracy, still reasonable speed.
  - **Vosk**: lighter weight, offline, good for command-style input.
  - Whisper is better for natural language questions. Vosk is better for short commands.
  - Processing time: Whisper tiny on Pi 5 should transcribe ~5 seconds of audio in ~2-3 seconds.
  - TS integration: spawn `whisper-cli` as subprocess, pipe in WAV audio, capture text output.

- [ ] **RAG (Retrieval-Augmented Generation) or fine-tuning?**
  - A base model won't have deep farming/medical knowledge. Two approaches:
    - **RAG**: Store reference documents (farming guides, first aid manuals, foraging books) as embeddings. Query relevant chunks and feed them to the LLM as context. More flexible, can update knowledge.
    - **Fine-tuning**: Train the model on domain-specific data. Bakes knowledge in, but harder to update and requires compute to train.
  - RAG is likely the better approach.
  - Embedding model options for TypeScript:
    - Run a small GGUF embedding model via llama.cpp (same runtime, no extra dependency).
    - Use `onnxruntime-node` with a small embedding model (e.g., all-MiniLM-L6-v2).
    - Pre-compute embeddings offline and ship as a static index.
  - Vector search: simple cosine similarity in TS (no need for a full DB at this scale), or use a lightweight lib.
  - Storage: a few hundred MB of reference documents + embeddings on the SD card or NVMe.

- [ ] **Context window and prompt design?**
  - System prompt: "You are a survival assistant built into a Pip-Boy wearable device. Give concise, practical answers about farming, medical first aid, survival, foraging, weather, and radio communications. Keep answers under 200 words — they will be displayed on a small screen."
  - Should it maintain conversation context (multi-turn) or treat each push-to-talk as independent?
  - ePaper can display ~20-25 lines of small text at 600x400. Responses need to be short.

- [ ] **Offline knowledge base for RAG?**
  - Source material to include:
    - USDA planting guides, companion planting charts
    - WHO/Red Cross first aid manuals (public domain portions)
    - SAS Survival Handbook key sections
    - Foraging field guides (region-specific?)
    - Barometric/weather interpretation guides
    - Amateur radio band plans, emergency frequencies
  - Legal considerations: need to use public domain or openly licensed material.
  - Format: chunk into paragraphs, generate embeddings, store in a local vector DB (ChromaDB, FAISS, or simple numpy).

### 3b. Core Software

### Open Questions — Core Software

- [x] **UI framework?** — **DECIDED: OpenTUI (TypeScript)**
  - [OpenTUI](https://github.com/anomalyco/opentui) — TypeScript TUI library, uses Bun runtime.
  - Requires Zig to build native components.
  - Provides component model, layout system, styling — maps well to a tab-based Pip-Boy interface.
  - TUI prototype runs over SSH during development, then drives the ePaper in production.
  - **TUI-to-ePaper bridge needed:** OpenTUI renders to a terminal. For the final device, we need to either:
    - Capture terminal output and render it to the ePaper as an image.
    - Or run a real terminal emulator (e.g., `fbterm`) on the Pi's framebuffer, then screenshot to ePaper.
    - Or build a custom OpenTUI renderer that outputs directly to the ePaper driver.
  - Pip-Boy tabs for a real device:
    - **STAT** — clock, battery level, system status, uptime
    - **DATA** — environmental sensors, Geiger counter readings, data logs
    - **MAP** — GPS position, offline map view
    - **AI** — push-to-talk query interface, response display
    - **RADIO** — placeholder/stretch goal

- [ ] **Hardware access from TypeScript?**
  - GPIO/I2C/SPI from Node/Bun:
    - `onoff` (npm): GPIO read/write — for Geiger counter pulses, buttons.
    - `i2c-bus` (npm): I2C communication — for BME280, DS3231, UV sensor, battery gauge.
    - `spi-device` (npm): SPI communication — for ePaper display driver.
    - `serialport` (npm): UART — for GPS module (NMEA parsing).
  - Bun compatibility: these packages use native addons (N-API). Most should work under Bun, but **this needs testing early**. If Bun can't load them, fallback is to use Node for the hardware layer.
  - Audio recording: `arecord` (ALSA CLI) via subprocess to capture mic input to a WAV file, then pass to Whisper.
  - Alternative: write thin C/Zig helpers for any hardware that doesn't have good JS bindings and call via FFI.

- [ ] **Map/navigation approach?**
  - Offline maps? Pre-rendered tiles from OpenStreetMap?
  - How to render a map to a 600x400 ePaper-friendly image?
  - Navigation: simple compass bearing + distance? Turn-by-turn is complex.

- [ ] **Geiger counter software?**
  - Count pulses per minute, convert to CPM, uSv/h, mR/h.
  - Rolling average? Configurable alert threshold?
  - How to display: numeric, bar graph, or both?

- [ ] **Data logging?**
  - Log sensor readings to local storage (SQLite? CSV?)?
  - How much storage? MicroSD in the Pi handles this easily.
  - Export via WiFi? Simple web server to pull data?

- [ ] **Boot time?**
  - Pi OS Lite boots in ~10-15 seconds. Acceptable?
  - Optimize with read-only filesystem to prevent SD card corruption on hard power-off?

- [ ] **Power management software?**
  - Safe shutdown on low battery?
  - Sleep/low-power modes — can we blank the ePaper and put peripherals to sleep?
  - Wake on button press?

- [ ] **Sound design?**
  - Pip-Boy UI sounds (clicks, tab switches)?
  - Geiger counter clicks through the speaker (authentic!)?
  - Alarm/alert tones?

- [ ] **Connectivity?**
  - WiFi for time sync (NTP), map tile downloads, data export?
  - WiFi for downloading updated models or RAG documents?
  - Always-on WiFi or on-demand to save power?

---

## Next Steps

1. ~~Decide on Pi Zero 2 W vs Pi 5~~ — **DECIDED: Pi 5 (8GB)** for local LLM inference.
2. ~~Decide on UI framework~~ — **DECIDED: OpenTUI (TypeScript/Bun)**
3. **Set up Pi 5** — install Pi OS Lite 64-bit, install Bun, install Zig, verify OpenTUI runs.
4. **Validate Bun + hardware libs** — test `i2c-bus`, `onoff`, `spi-device`, `serialport` under Bun on Pi 5. This is a potential blocker.
5. **Benchmark LLM on Pi 5** — build llama.cpp, test Phi-2/Phi-3/TinyLlama inference speed and RAM usage.
6. **Benchmark STT on Pi 5** — build Whisper.cpp, test tiny/base transcription speed with a sample WAV.
7. **Build OpenTUI prototype** — tab layout (STAT, DATA, MAP, AI, RADIO) with placeholder content. Get the navigation and structure working.
8. **Prototype the AI pipeline in TS** — record audio via `arecord` subprocess -> Whisper.cpp subprocess -> llama.cpp HTTP API -> display response in AI tab.
9. **Select and order the ePaper display** — need the exact model to design around.
10. **Draft a GPIO pin map** — assign all peripherals to pins.
11. **Create a rough BOM (Bill of Materials)** with estimated costs.
12. **Start CAD work** on the enclosure once hardware dimensions are known.

## Risk Register

| Risk | Impact | Mitigation |
|---|---|---|
| Pi 5 too power-hungry for wearable battery life | High | Accept short battery life (~2-3 hrs), or add external battery pack |
| LLM inference too slow (>30 sec) | Medium | Use smaller model (TinyLlama), accept less accurate answers |
| 8GB RAM not enough for OS + LLM + STT simultaneously | High | Run STT first, unload, then load LLM. Sequential, not concurrent. |
| Cooling insufficient in enclosed space | High | Proper fan + heatsink, thermal testing before final enclosure design |
| ePaper too slow for AI response display | Low | Responses are text-only, single full refresh is fine |
| Microphone picks up fan noise | Medium | Place mic far from fan, use directional MEMS mic, software noise gate |
| Bun can't load native GPIO/I2C npm packages | High | Fall back to Node.js for hardware layer, or write Zig/C FFI helpers |
| OpenTUI-to-ePaper rendering bridge is complex | Medium | Start with terminal-over-SSH, solve ePaper rendering later as a separate milestone |
| Zig build toolchain issues on ARM64 | Low | Zig has good ARM64 support, but pin to a known-good version |
