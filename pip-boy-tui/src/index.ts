import {
  createCliRenderer,
  BoxRenderable,
  TextRenderable,
  applyScanlines,
  VignetteEffect,
  StyledText,
  t,
  bold,
  dim,
  fg,
  bg,
} from "@opentui/core";
import { LLMClient } from "./ai/llm-client";
import { STT } from "./ai/stt";
import { rag } from "./ai/rag";

import { MapRenderer, type ColoredCell } from "./map/renderer.ts";
import { haversine, bearing, formatDistance, bearingToCompass } from "./map/utils.ts";
import { geocode, suggestZoom } from "./map/geocoder.ts";
import { getRoute, formatDuration } from "./map/router.ts";
import { parseMapVoiceCommand } from "./map/voice-commands.ts";
import { preprocessTranscript } from "./map/voice-preprocessor.ts";
import { getScaledArt } from "./braille-art.ts";

// ─────────────────────────────────────────────
// Theme
// ─────────────────────────────────────────────

const PIP_GREEN = "#00ff00";
const PIP_GREEN_DIM = "#007700";
const PIP_GREEN_DARK = "#003300";
const PIP_BG = "#0a0a0a";

// Styled text helpers — only use inside t`` tagged templates
const g = (s: string) => fg(PIP_GREEN)(s);
const gd = (s: string) => dim(fg(PIP_GREEN_DIM)(s));
const gb = (s: string) => bold(fg(PIP_GREEN)(s));

// ─────────────────────────────────────────────
// Renderer
// ─────────────────────────────────────────────

const renderer = await createCliRenderer({
  exitOnCtrlC: true,
  useMouse: false,
  backgroundColor: PIP_BG,
});

const vignette = new VignetteEffect(0.3);
renderer.addPostProcessFn((buf) => applyScanlines(buf, 0.12, 2));
renderer.addPostProcessFn((buf) => vignette.apply(buf));

const IDLE_TIMEOUT_MS = 60_000;
const TAB_NAMES = ["HOME", "STATUS", "ENV", "MAP", "AI", "RADIO"];
const HOME_TAB_INDEX = 0;
let currentTabIndex = 0;

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function txt(content: ReturnType<typeof t>): TextRenderable {
  return new TextRenderable(renderer, { content });
}

function div(w = 40): TextRenderable {
  return txt(t`${gd("─".repeat(w))}`);
}

function section(...children: (TextRenderable | BoxRenderable)[]): BoxRenderable {
  const box = new BoxRenderable(renderer, { flexDirection: "column", gap: 0 });
  for (const child of children) box.add(child);
  return box;
}

// ─────────────────────────────────────────────
// Header
// ─────────────────────────────────────────────

const header = new BoxRenderable(renderer, {
  id: "header",
  flexDirection: "row",
  justifyContent: "space-between",
  alignItems: "center",
  paddingLeft: 1,
  paddingRight: 1,
  height: 1,
  backgroundColor: PIP_GREEN_DARK,
});
header.add(txt(t`${gb("PIP-BOY 3000")}`));
header.add(txt(t`${gd("v0.1.0")}`));

// ─────────────────────────────────────────────
// Pip-Boy Art
// ─────────────────────────────────────────────

const tabBarText = new TextRenderable(renderer, { id: "tab-bar-text", content: "" });
const tabBarBox = new BoxRenderable(renderer, {
  id: "tab-bar",
  height: 1,
  paddingLeft: 1,
  backgroundColor: PIP_BG,
});
tabBarBox.add(tabBarText);

function renderTabBar() {
  const chunks = [];
  for (let i = 0; i < TAB_NAMES.length; i++) {
    if (i > 0) {
      chunks.push(dim(fg(PIP_GREEN_DIM)("│")));
    }
    const label = ` ${TAB_NAMES[i]} `;
    if (i === currentTabIndex) {
      chunks.push(bold(bg(PIP_GREEN_DARK)(fg(PIP_GREEN)(label))));
    } else {
      chunks.push(dim(fg(PIP_GREEN_DIM)(label)));
    }
  }
  tabBarText.content = new StyledText(chunks);
}

// ─────────────────────────────────────────────
// Content area
// ─────────────────────────────────────────────

const contentArea = new BoxRenderable(renderer, { id: "content-area", flexGrow: 1 });

// ─────────────────────────────────────────────
// Status bar
// ─────────────────────────────────────────────

const statusBar = new BoxRenderable(renderer, {
  id: "status-bar",
  flexDirection: "row",
  justifyContent: "space-between",
  paddingLeft: 1,
  paddingRight: 1,
  height: 1,
  backgroundColor: PIP_GREEN_DARK,
});
statusBar.add(txt(t`${gd("←/→ Navigate")}`));
statusBar.add(txt(t`${gd("BAT: ---% │ GPS: --- │ RAD: --- CPM")}`));

// ─────────────────────────────────────────────
// Root layout
// ─────────────────────────────────────────────

const rootBox = new BoxRenderable(renderer, {
  id: "root-box",
  flexGrow: 1,
  flexDirection: "column",
  border: true,
  borderStyle: "double",
  borderColor: PIP_GREEN_DIM,
});
rootBox.add(header);
rootBox.add(tabBarBox);
rootBox.add(contentArea);
rootBox.add(statusBar);
renderer.root.add(rootBox);

// ─────────────────────────────────────────────
// Panels
// ─────────────────────────────────────────────

function createHomePanel(): BoxRenderable {
  const panel = new BoxRenderable(renderer, {
    id: "panel-home",
    flexGrow: 1,
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 1,
  });

  // Scale art to fit available terminal space
  // Reserve: 2 cols for border, 2 for padding; 4 rows for header/tabbar/statusbar/border
  const cols = (process.stdout.columns || 80) - 4;
  const rows = (process.stdout.rows || 24) - 6;
  const artLines = getScaledArt(cols, rows);

  const art = new BoxRenderable(renderer, { flexDirection: "column", alignItems: "center" });
  for (const line of artLines) {
    art.add(txt(t`${fg(PIP_GREEN)(line)}`));
  }
  panel.add(art);
  return panel;
}

function createStatusPanel(): BoxRenderable {
  const now = new Date();
  const panel = new BoxRenderable(renderer, {
    id: "panel-status",
    flexGrow: 1,
    flexDirection: "column",
    padding: 1,
    gap: 1,
  });

  panel.add(section(txt(t`${gb("CLOCK")}`), div()));
  panel.add(section(
    txt(t`${g("TIME")}      ${gb(now.toLocaleTimeString("en-GB", { hour12: false }))}`),
    txt(t`${g("DATE")}      ${gb(now.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" }))}`),
    txt(t`${g("UPTIME")}    ${gb("00:00:00")}`),
  ));

  panel.add(section(div(), txt(t`${gb("SYSTEM")}`)));
  panel.add(section(
    txt(t`${g("CPU")}       ${gb("--")} ${gd("°C")}`),
    txt(t`${g("RAM")}       ${gb("-- / --")} ${gd("MB")}`),
    txt(t`${g("DISK")}      ${gb("-- / --")} ${gd("GB")}`),
  ));

  panel.add(section(div(), txt(t`${gb("POWER")}`)));
  panel.add(section(
    txt(t`${g("BATTERY")}   ${gb("---%")}  ${gd("░░░░░░░░░░░░░░░░░░░░")}`),
    txt(t`${g("VOLTAGE")}   ${gb("-.--")} ${gd("V")}`),
    txt(t`${g("STATE")}     ${gd("NO SENSOR")}`),
  ));

  return panel;
}

function createEnvPanel(): BoxRenderable {
  const panel = new BoxRenderable(renderer, {
    id: "panel-env",
    flexGrow: 1,
    flexDirection: "column",
    padding: 1,
    gap: 1,
  });

  panel.add(section(txt(t`${gb("ATMOSPHERE")}`), div()));
  panel.add(section(
    txt(t`${g("TEMP")}      ${gb("--.-")} ${gd("°C")}`),
    txt(t`${g("HUMIDITY")}  ${gb("--.-")} ${gd("%")}`),
    txt(t`${g("PRESSURE")}  ${gb("----.-")} ${gd("hPa")}`),
    txt(t`${g("UV INDEX")}  ${gb("--")}`),
    txt(t`${g("TREND")}     ${gd("---")}`),
  ));

  panel.add(section(div(), txt(t`${gb("RADIATION")}`)));
  panel.add(section(
    txt(t`${g("CPM")}       ${gb("---")}`),
    txt(t`${g("DOSE")}      ${gb("-.---")} ${gd("μSv/h")}`),
    txt(t`${g("AVG 5m")}    ${gb("-.---")} ${gd("μSv/h")}`),
    txt(t`${g("PEAK")}      ${gb("-.---")} ${gd("μSv/h")}`),
    txt(t`${g("ALERT")}     ${gd("OFF  (threshold: 0.50 μSv/h)")}`),
    txt(t`${g("STATUS")}    ${gd("NO SENSOR")}`),
  ));

  panel.add(section(div(), txt(t`${gb("DATA LOG")}`)));
  panel.add(section(
    txt(t`${g("LOGGING")}   ${gd("OFF")}`),
    txt(t`${g("ENTRIES")}   ${gb("0")}`),
    txt(t`${g("STORAGE")}   ${gb("--")} ${gd("MB free")}`),
  ));

  return panel;
}

// ─────────────────────────────────────────────
// Map system
// ─────────────────────────────────────────────

// Tile source: use local .mbtiles if MBTILES env var is set, else use mapscii.me HTTP
const TILE_SOURCE = process.env.MBTILES || "http://mapscii.me/";

// Vertical overhead: header(1) + tabbar(1) + map status(1) + map info(1) + status bar(1) + border(2) = 7
// Horizontal overhead: border(2) + map area padding(2) = 4
const MAP_CHROME_ROWS = 7;
const MAP_CHROME_COLS = 4;

/** Compute braille pixel dimensions from current terminal size */
function getMapPixelSize(): { width: number; height: number } {
  const termCols = process.stdout.columns || 80;
  const termRows = process.stdout.rows || 24;
  const charCols = Math.max(20, termCols - MAP_CHROME_COLS);
  const charRows = Math.max(5, termRows - MAP_CHROME_ROWS);
  // Braille: each character = 2 pixels wide, 4 pixels tall
  return { width: charCols * 2, height: charRows * 4 };
}

let mapRenderer: MapRenderer | null = null;
let mapLines: string[] = [];
let mapStatusText: TextRenderable | null = null;
let mapViewText: TextRenderable | null = null;
let mapInfoText: TextRenderable | null = null;

function getMapRenderer(): MapRenderer {
  if (!mapRenderer) {
    const { width, height } = getMapPixelSize();
    mapRenderer = new MapRenderer(width, height, {
      source: TILE_SOURCE,
    });
  }
  return mapRenderer;
}

let mapDrawInFlight = false;

// Map voice control state
let mapIsRecording = false;
let mapRouteInfo: string | null = null; // human-readable route summary
const mapStt = new STT(); // separate STT instance for map tab

async function updateMapView(): Promise<void> {
  if (mapDrawInFlight) return;
  mapDrawInFlight = true;

  try {
    const mr = getMapRenderer();

    // Resize to current terminal dimensions before drawing
    const { width, height } = getMapPixelSize();
    mr.setSize(width, height);

    // Show loading state immediately
    if (mapStatusText) {
      const lat = mr.state.center.lat.toFixed(6);
      const lon = mr.state.center.lon.toFixed(6);
      const z = mr.state.zoom.toFixed(1);
      mapStatusText.content = t`${g("LAT")} ${gb(lat)} ${g("LON")} ${gb(lon)} ${g("Z")} ${gb(z)}`;
    }
    const result = await mr.draw();
    mapLines = result.plainLines;

    // Build per-cell coloured StyledText from coloredCells
    if (mapViewText) {
      const cells = result.coloredCells;
      const chunks: ReturnType<ReturnType<typeof fg>>[] = [];

      for (let row = 0; row < cells.length; row++) {
        if (row > 0) chunks.push(fg(PIP_GREEN)("\n"));

        const rowCells = cells[row]!;
        if (rowCells.length === 0) continue;

        // Run-length encode: group consecutive cells with the same colour
        let runColor = rowCells[0]!.fgHex;
        let runChars = rowCells[0]!.char;

        for (let col = 1; col < rowCells.length; col++) {
          const cell = rowCells[col]!;
          if (cell.fgHex === runColor) {
            runChars += cell.char;
          } else {
            // Flush current run
            const hex = runColor === "#000000" ? PIP_GREEN_DIM : runColor;
            chunks.push(fg(hex)(runChars));
            runColor = cell.fgHex;
            runChars = cell.char;
          }
        }
        // Flush last run
        const hex = runColor === "#000000" ? PIP_GREEN_DIM : runColor;
        chunks.push(fg(hex)(runChars));
      }

      mapViewText.content = new StyledText(chunks);
    }

    // Update status line with scale info
    if (mapStatusText) {
      const lat = result.center.lat.toFixed(6);
      const lon = result.center.lon.toFixed(6);
      const z = result.zoom.toFixed(1);
      mapStatusText.content = t`${g("LAT")} ${gb(lat)} ${g("LON")} ${gb(lon)} ${g("Z")} ${gb(z)} ${gd("│")} ${g("SCALE")} ${gb(result.scale)}`;
    }

    // Update info (route info > waypoint info > default hints)
    if (mapInfoText) {
      if (mapRouteInfo) {
        mapInfoText.content = t`${g("RTE")} ${gb(mapRouteInfo)} ${gd("│ R:Clear")}`;
      } else if (mr.waypoint && mr.gpsPosition) {
        const dist = haversine(mr.gpsPosition, mr.waypoint);
        const bear = bearing(mr.gpsPosition, mr.waypoint);
        mapInfoText.content = t`${g("WPT")} ${gb(formatDistance(dist))} ${gb(bearingToCompass(bear))} ${gb(bear.toFixed(0) + "°")}`;
      } else {
        mapInfoText.content = t`${gd("SPC:Voice │ A/D Pan │ +/- Zoom │ R:Clear")}`;
      }
    }
  } catch (err) {
    // Show error in map area
    if (mapViewText) {
      const msg = err instanceof Error ? err.message : String(err);
      mapViewText.content = t`${gd(`MAP ERROR: ${msg}`)}`;
    }
  } finally {
    mapDrawInFlight = false;
  }
}

function createMapPanel(): BoxRenderable {
  const panel = new BoxRenderable(renderer, {
    id: "panel-map",
    flexGrow: 1,
    flexDirection: "column",
    padding: 0,
  });

  // Status bar at top of map
  mapStatusText = new TextRenderable(renderer, {
    id: "map-status",
    content: t`${gd("Loading map...")}`,
  });
  const statusRow = new BoxRenderable(renderer, {
    flexDirection: "row",
    height: 1,
    paddingLeft: 1,
    backgroundColor: PIP_GREEN_DARK,
  });
  statusRow.add(mapStatusText);
  panel.add(statusRow);

  // Map viewport (braille rendered area)
  mapViewText = new TextRenderable(renderer, {
    id: "map-view",
    content: t`${gd("Fetching tiles...")}`,
  });
  const mapArea = new BoxRenderable(renderer, {
    id: "map-area",
    flexGrow: 1,
    flexDirection: "column",
    paddingLeft: 1,
    paddingRight: 1,
  });
  mapArea.add(mapViewText);
  panel.add(mapArea);

  // Info bar at bottom
  mapInfoText = new TextRenderable(renderer, {
    id: "map-info",
    content: t`${gd("↑↓←→ Pan │ +/- Zoom │ C Centre")}`,
  });
  const infoRow = new BoxRenderable(renderer, {
    flexDirection: "row",
    height: 1,
    paddingLeft: 1,
    backgroundColor: PIP_GREEN_DARK,
  });
  infoRow.add(mapInfoText);
  panel.add(infoRow);

  // Don't trigger initial render here — it will be triggered when the user
  // switches to the MAP tab via switchToTab(). This avoids fetching tiles
  // for a tab that isn't visible yet.

  return panel;
}

/** Handle map-specific key input (only when MAP tab is active) */
function handleMapKey(keyName: string): boolean {
  const mr = getMapRenderer();
  let handled = false;

  switch (keyName) {
    case "up":
    case "k":
      mr.panUp();
      handled = true;
      break;
    case "down":
    case "j":
      mr.panDown();
      handled = true;
      break;
    case "left":
      // Don't consume left/right — they're used for tab navigation
      // Use a/d for map panning instead to avoid conflict
      break;
    case "right":
      break;
    case "a":
      mr.panLeft();
      handled = true;
      break;
    case "d":
      mr.panRight();
      handled = true;
      break;
    case "=":
    case "+":
      mr.zoomIn();
      handled = true;
      break;
    case "-":
    case "_":
      mr.zoomOut();
      handled = true;
      break;
    case "c":
      mr.centerOnGps();
      handled = true;
      break;
    case "w": {
      // Toggle waypoint at current centre
      if (mr.waypoint) {
        mr.clearWaypoint();
      } else {
        mr.setWaypoint(mr.state.center);
      }
      handled = true;
      break;
    }
  }

  if (handled) {
    updateMapView();
  }
  return handled;
}

// AI Tab state
const llmClient = new LLMClient();
const stt = new STT();
const ragReady = rag.load();
if (ragReady) {
  console.log(`RAG: loaded ${rag.chunkCount} knowledge chunks`);
} else {
  console.log("RAG: knowledge index not found — AI will run without context retrieval");
}
let aiConversation: Array<{ role: "user" | "assistant"; text: string }> = [];
let aiIsGenerating = false;
let aiIsRecording = false;
let aiCurrentResponse = "";

let aiChatBox: BoxRenderable | null = null;
let aiStatusText: TextRenderable | null = null;
let aiStreamingText: TextRenderable | null = null;
let aiScrollOffset = 0; // 0 = show latest, positive = scrolled back N messages

/** Helper: create a word-wrapping TextRenderable */
function wtxt(content: ReturnType<typeof t>): TextRenderable {
  return new TextRenderable(renderer, { content, wrapMode: "word" });
}

function createAiPanel(): BoxRenderable {
  const panel = new BoxRenderable(renderer, {
    id: "panel-ai",
    flexGrow: 1,
    flexDirection: "column",
    padding: 0,
    gap: 0,
  });

  // ── Status bar ──
  const initRagStatus = rag.isReady ? `RAG ${rag.chunkCount}` : "NO RAG";
  aiStatusText = txt(
    t`${g("AI")} ${gb("Llama 3.2 3B")} ${gd("│")} ${g(initRagStatus)} ${gd("│")} ${gb("READY")} ${gd("│ SPC:Rec C:Clr ↑↓:Scroll")}`
  );
  const statusRow = new BoxRenderable(renderer, {
    height: 1,
    paddingLeft: 1,
    backgroundColor: PIP_GREEN_DARK,
  });
  statusRow.add(aiStatusText);
  panel.add(statusRow);

  // ── Chat area — plain box, we manage visible messages manually ──
  aiChatBox = new BoxRenderable(renderer, {
    id: "ai-chat-box",
    flexGrow: 1,
    flexDirection: "column",
    overflow: "hidden",
    border: true,
    borderStyle: "single",
    borderColor: PIP_GREEN_DIM,
    paddingLeft: 1,
    paddingRight: 1,
    gap: 1,
  });
  aiChatBox.add(wtxt(t`${gd("[Press SPACE to record a voice question]")}`));
  panel.add(aiChatBox);

  return panel;
}

// Monotonic ID counter for chat bubbles
let bubbleIdCounter = 0;

/**
 * Create a chat bubble for a message.
 * Returns { bubble, body } so we can update `body.content` during streaming.
 */
function chatBubble(
  role: "user" | "assistant",
  text: string,
  streaming = false
): { bubble: BoxRenderable; body: TextRenderable } {
  const isUser = role === "user";
  const id = `bubble-${bubbleIdCounter++}`;

  // Outer row — pushes the bubble left or right
  const row = new BoxRenderable(renderer, {
    id,
    flexDirection: "row",
    justifyContent: isUser ? "flex-start" : "flex-end",
    width: "100%",
  });

  // The bubble itself — capped at 75% width
  const bubble = new BoxRenderable(renderer, {
    id: `${id}-inner`,
    flexDirection: "column",
    width: "75%",
    border: true,
    borderStyle: "single",
    borderColor: isUser ? PIP_GREEN : PIP_GREEN_DIM,
    paddingLeft: 1,
    paddingRight: 1,
  });

  // Label row
  const label = isUser ? "YOU" : "PIP-BOY";
  bubble.add(
    wtxt(isUser ? t`${gb(label)}` : t`${gd(label)}`)
  );

  // Message body — word-wrapped
  const content = streaming ? text + "▊" : text;
  const body = new TextRenderable(renderer, {
    content: isUser ? t`${g(content)}` : t`${fg(PIP_GREEN)(content)}`,
    wrapMode: "word",
  });
  bubble.add(body);

  row.add(bubble);
  return { bubble: row, body };
}

/**
 * Estimate how many terminal rows a message bubble will consume.
 * Accounts for border (2), label (1), gap (1), and word-wrapped text.
 */
function estimateBubbleRows(text: string): number {
  const termCols = process.stdout.columns || 80;
  // Bubble is 75% of chat area width, minus border (2), padding (2), outer border (2), outer padding (2)
  const bubbleTextCols = Math.floor(termCols * 0.75) - 8;
  const safeWidth = Math.max(10, bubbleTextCols);
  // Count wrapped lines
  const lines = text.split("\n");
  let rows = 0;
  for (const line of lines) {
    rows += Math.max(1, Math.ceil((line.length || 1) / safeWidth));
  }
  // + 2 for border top/bottom, +1 for label, +1 for gap between bubbles
  return rows + 4;
}

/**
 * Full re-render of the conversation history in the chat area.
 * Only adds messages that fit within the visible area to avoid overflow artifacts.
 */
function renderAiChat() {
  if (!aiChatBox) return;

  // Remove all children
  for (const child of aiChatBox.getChildren()) {
    aiChatBox.remove(child.id);
  }

  aiStreamingText = null;

  if (aiConversation.length === 0 && !aiIsGenerating) {
    aiChatBox.add(wtxt(t`${gd("[Press SPACE to record a voice question]")}`));
    return;
  }

  // Build full message list including streaming response
  const allMessages = [...aiConversation];
  if (aiIsGenerating) {
    allMessages.push({ role: "assistant" as const, text: aiCurrentResponse });
  }

  // Available rows: terminal height minus chrome (header, tabbar, status bar, ai status, borders, etc.)
  const termRows = process.stdout.rows || 24;
  const availableRows = termRows - 8; // header(1) + tabbar(1) + ai status(1) + status bar(1) + borders(4)

  // Walk backwards from (end - scrollOffset), collecting messages that fit
  const total = allMessages.length;
  const endIdx = total - aiScrollOffset;
  const toShow: number[] = [];
  let usedRows = 0;

  for (let i = endIdx - 1; i >= 0; i--) {
    const rows = estimateBubbleRows(allMessages[i]!.text);
    if (usedRows + rows > availableRows && toShow.length > 0) break;
    toShow.unshift(i);
    usedRows += rows;
  }

  for (const idx of toShow) {
    const msg = allMessages[idx]!;
    const isStreamingMsg = aiIsGenerating && idx === total - 1;
    const { bubble, body } = chatBubble(msg.role, msg.text, isStreamingMsg);
    aiChatBox.add(bubble);
    if (isStreamingMsg) {
      aiStreamingText = body;
    }
  }
}

// Ask the LLM a question (streaming)
async function askAI(question: string) {
  if (aiIsGenerating) return;

  aiIsGenerating = true;
  aiCurrentResponse = "";
  aiScrollOffset = 0; // snap to bottom for new messages

  // Add user question to history
  aiConversation.push({ role: "user", text: question });

  // Retrieve relevant context from knowledge base
  const context = rag.isReady ? rag.getContext(question, 3) : undefined;

  // Update status
  if (aiStatusText) {
    const ragLabel = context ? "+CTX" : "NO CTX";
    aiStatusText.content = t`${g("AI")} ${gb("Llama 3.2 3B")} ${gd("│")} ${g(ragLabel)} ${gd("│")} ${gb("THINKING...")} ${gd("│ SPC:Rec C:Clr")}`;
  }

  // Full re-render to add user bubble + streaming assistant bubble
  renderAiChat();

  try {
    // Stream the response — update the streaming text in-place
    for await (const chunk of llmClient.stream(question, context)) {
      if (!chunk.done) {
        aiCurrentResponse += chunk.token;
        // Update the existing TextRenderable content (no re-render of entire tree)
        if (aiStreamingText) {
          aiStreamingText.content = t`${fg(PIP_GREEN)(aiCurrentResponse + "▊")}`;
        }
      }
    }

    // Finalise: add to history and do a clean re-render
    aiConversation.push({ role: "assistant", text: aiCurrentResponse });
    aiIsGenerating = false;
    aiCurrentResponse = "";
    aiStreamingText = null;

    if (aiStatusText) {
      const ragStatus = rag.isReady ? `RAG ${rag.chunkCount}` : "NO RAG";
      aiStatusText.content = t`${g("AI")} ${gb("Llama 3.2 3B")} ${gd("│")} ${g(ragStatus)} ${gd("│")} ${gb("READY")} ${gd("│ SPC:Rec C:Clr ↑↓:Scroll")}`;
    }

    renderAiChat();
  } catch (err) {
    aiIsGenerating = false;
    aiCurrentResponse = "";
    aiStreamingText = null;
    const errMsg = err instanceof Error ? err.message : String(err);
    aiConversation.push({ role: "assistant", text: `ERROR: ${errMsg}` });

    if (aiStatusText) {
      aiStatusText.content = t`${g("AI")} ${gb("Llama 3.2 3B")} ${gd("│")} ${gb("ERROR")} ${gd("│ SPC:Rec C:Clr")}`;
    }

    renderAiChat();
  }
}

// Clear conversation history
function clearAiChat() {
  if (aiIsGenerating) return; // don't clear mid-stream
  aiConversation = [];
  aiCurrentResponse = "";
  aiStreamingText = null;
  renderAiChat();
  if (aiStatusText) {
    const ragStatus = rag.isReady ? `RAG ${rag.chunkCount}` : "NO RAG";
    aiStatusText.content = t`${g("AI")} ${gb("Llama 3.2 3B")} ${gd("│")} ${g(ragStatus)} ${gd("│")} ${gb("READY")} ${gd("│ SPC:Rec C:Clr ↑↓:Scroll")}`;
  }
}

// Full voice pipeline: record → STT → LLM → display
async function recordAndAsk() {
  if (aiIsGenerating || aiIsRecording) return;

  aiIsRecording = true;

  // Update status to show recording
  if (aiStatusText) {
    aiStatusText.content = t`${g("AI")} ${gb("Llama 3.2 3B")} ${gd("│")} ${gb("● RECORDING...")} ${gd("│ SPC:Stop")}`;
  }

  // Show recording indicator in chat
  if (aiChatBox) {
    aiChatBox.add(
      wtxt(t`${gb("● REC")} ${gd("Listening... press SPACE to stop")}`)
    );
  }

  // Start recording
  stt.startRecording();
}

// Stop recording, transcribe, and send to LLM
async function stopRecordingAndAsk() {
  if (!aiIsRecording) return;

  // Update status
  if (aiStatusText) {
    aiStatusText.content = t`${g("AI")} ${gb("Llama 3.2 3B")} ${gd("│")} ${gb("TRANSCRIBING...")} ${gd("│ SPC:Rec C:Clr")}`;
  }

  try {
    // Stop and transcribe
    const transcription = await stt.stopAndTranscribe();
    aiIsRecording = false;

    if (!transcription) {
      if (aiStatusText) {
        const ragStatus = rag.isReady ? `RAG ${rag.chunkCount}` : "NO RAG";
        aiStatusText.content = t`${g("AI")} ${gb("Llama 3.2 3B")} ${gd("│")} ${g(ragStatus)} ${gd("│")} ${gb("READY")} ${gd("│ SPC:Rec C:Clr ↑↓:Scroll")}`;
      }
      renderAiChat();
      return;
    }

    // Send to LLM
    await askAI(transcription);
  } catch (err) {
    aiIsRecording = false;
    const errMsg = err instanceof Error ? err.message : String(err);
    aiConversation.push({ role: "assistant", text: `STT ERROR: ${errMsg}` });

    if (aiStatusText) {
      aiStatusText.content = t`${g("AI")} ${gb("Llama 3.2 3B")} ${gd("│")} ${gb("STT ERROR")} ${gd("│ SPC:Rec C:Clr")}`;
    }
    renderAiChat();
  }
}

// ─────────────────────────────────────────────
// Map voice control pipeline
// ─────────────────────────────────────────────

/** Start recording for a map voice command */
function mapStartRecording() {
  if (mapIsRecording || mapDrawInFlight) return;
  mapIsRecording = true;

  if (mapStatusText) {
    mapStatusText.content = t`${g("MAP")} ${gb("● RECORDING...")} ${gd("│ SPC:Stop")}`;
  }
  if (mapInfoText) {
    mapInfoText.content = t`${gb("● REC")} ${gd("Say: 'where is ...' or 'navigate from ... to ...'")}`;
  }

  mapStt.startRecording();
}

/** Stop recording, transcribe, parse command, execute */
async function mapStopRecordingAndExecute() {
  if (!mapIsRecording) return;

  if (mapStatusText) {
    mapStatusText.content = t`${g("MAP")} ${gb("TRANSCRIBING...")}`;
  }

  try {
    const rawTranscription = await mapStt.stopAndTranscribe();
    mapIsRecording = false;

    if (!rawTranscription) {
      if (mapStatusText) {
        const mr = getMapRenderer();
        const lat = mr.state.center.lat.toFixed(6);
        const lon = mr.state.center.lon.toFixed(6);
        const z = mr.state.zoom.toFixed(1);
        mapStatusText.content = t`${g("LAT")} ${gb(lat)} ${g("LON")} ${gb(lon)} ${g("Z")} ${gb(z)} ${gd("│ No speech detected")}`;
      }
      await updateMapView();
      return;
    }

    // Pre-process transcript through LLM to fix place name errors
    if (mapStatusText) {
      mapStatusText.content = t`${g("MAP")} ${gb("CORRECTING...")} ${gd(rawTranscription.slice(0, 30))}`;
    }
    const transcription = await preprocessTranscript(rawTranscription);

    // Show raw vs corrected for debugging (only if different)
    if (transcription !== rawTranscription && mapInfoText) {
      mapInfoText.content = t`${gd("heard:")} ${g(rawTranscription.slice(0, 20))} ${gd("→")} ${gb(transcription.slice(0, 20))}`;
    }

    // Parse voice command
    const command = parseMapVoiceCommand(transcription);

    switch (command.type) {
      case "find":
        await handleMapFind(command.query);
        break;

      case "route":
        await handleMapRoute(command.from, command.to);
        break;

      case "clear":
        handleMapClear();
        break;

      case "zoom":
        if (command.direction === "in") getMapRenderer().zoomIn();
        else getMapRenderer().zoomOut();
        await updateMapView();
        break;

      case "unknown":
        // Show what we heard as feedback
        if (mapStatusText) {
          mapStatusText.content = t`${g("MAP")} ${gb("?")} ${gd(transcription.slice(0, 40))}`;
        }
        if (mapInfoText) {
          mapInfoText.content = t`${gd("Try: 'where is <place>' or 'navigate to <place>'")}`;
        }
        break;
    }
  } catch (err) {
    mapIsRecording = false;
    const errMsg = err instanceof Error ? err.message : String(err);
    if (mapStatusText) {
      mapStatusText.content = t`${g("MAP")} ${gb("ERROR")} ${gd(errMsg.slice(0, 40))}`;
    }
    await updateMapView();
  }
}

/** Handle "where is <place>" command */
async function handleMapFind(query: string) {
  if (mapStatusText) {
    mapStatusText.content = t`${g("MAP")} ${gb("SEARCHING...")} ${gd(query.slice(0, 30))}`;
  }

  try {
    const result = await geocode(query);
    if (!result) {
      if (mapStatusText) {
        mapStatusText.content = t`${g("MAP")} ${gb("NOT FOUND")} ${gd(query.slice(0, 30))}`;
      }
      return;
    }

    const mr = getMapRenderer();
    const zoom = Math.min(15.45, suggestZoom(result)); // cap at ~81m scale
    mr.centerOn({ lat: result.lat, lon: result.lon });
    mr.state.zoom = zoom;

    // Set waypoint at found location
    mr.setWaypoint({ lat: result.lat, lon: result.lon });

    // Clear any existing route
    mr.clearRoute();
    mapRouteInfo = null;

    await updateMapView();

    // Show result in status
    if (mapStatusText) {
      const lat = result.lat.toFixed(6);
      const lon = result.lon.toFixed(6);
      const z = zoom.toFixed(1);
      const name = result.displayName.split(",")[0] || query;
      mapStatusText.content = t`${g("LAT")} ${gb(lat)} ${g("LON")} ${gb(lon)} ${g("Z")} ${gb(z)} ${gd("│")} ${g(name.slice(0, 20))}`;
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    if (mapStatusText) {
      mapStatusText.content = t`${g("MAP")} ${gb("GEOCODE ERROR")} ${gd(errMsg.slice(0, 30))}`;
    }
  }
}

/** Handle "navigate from X to Y" command */
async function handleMapRoute(from: string | null, to: string) {
  const mr = getMapRenderer();

  if (mapStatusText) {
    mapStatusText.content = t`${g("MAP")} ${gb("GEOCODING...")} ${gd("resolving addresses")}`;
  }

  try {
    // Resolve "from" — either geocode the address or use current map center
    let fromLatLon: { lat: number; lon: number };
    let fromName: string;

    if (from) {
      const fromResult = await geocode(from);
      if (!fromResult) {
        if (mapStatusText) {
          mapStatusText.content = t`${g("MAP")} ${gb("NOT FOUND")} ${gd("start: " + from.slice(0, 25))}`;
        }
        return;
      }
      fromLatLon = { lat: fromResult.lat, lon: fromResult.lon };
      fromName = fromResult.displayName.split(",")[0] || from;
    } else {
      // Use current map center as start
      fromLatLon = { lat: mr.state.center.lat, lon: mr.state.center.lon };
      fromName = "Current";
    }

    // Resolve "to"
    const toResult = await geocode(to);
    if (!toResult) {
      if (mapStatusText) {
        mapStatusText.content = t`${g("MAP")} ${gb("NOT FOUND")} ${gd("dest: " + to.slice(0, 25))}`;
      }
      return;
    }
    const toLatLon = { lat: toResult.lat, lon: toResult.lon };
    const toName = toResult.displayName.split(",")[0] || to;

    // Get route
    if (mapStatusText) {
      mapStatusText.content = t`${g("MAP")} ${gb("ROUTING...")} ${gd(fromName.slice(0, 15) + " → " + toName.slice(0, 15))}`;
    }

    const route = await getRoute(fromLatLon, toLatLon);
    if (!route) {
      if (mapStatusText) {
        mapStatusText.content = t`${g("MAP")} ${gb("NO ROUTE")} ${gd("could not find route")}`;
      }
      return;
    }

    // Set route on renderer
    mr.setRoute(route.geometry, fromLatLon, toLatLon);

    // Store route info for info bar
    mapRouteInfo = route.summary;

    // Fit map to show entire route
    mr.fitBounds(route.geometry);

    await updateMapView();

    // Show route summary in status
    if (mapStatusText) {
      const lat = mr.state.center.lat.toFixed(6);
      const lon = mr.state.center.lon.toFixed(6);
      const z = mr.state.zoom.toFixed(1);
      mapStatusText.content = t`${g("LAT")} ${gb(lat)} ${g("LON")} ${gb(lon)} ${g("Z")} ${gb(z)} ${gd("│ ROUTE ACTIVE")}`;
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    if (mapStatusText) {
      mapStatusText.content = t`${g("MAP")} ${gb("ROUTE ERROR")} ${gd(errMsg.slice(0, 30))}`;
    }
  }
}

/** Clear route overlay */
function handleMapClear() {
  const mr = getMapRenderer();
  mr.clearRoute();
  mr.clearWaypoint();
  mapRouteInfo = null;
  updateMapView();
}

function createRadioPanel(): BoxRenderable {
  const panel = new BoxRenderable(renderer, {
    id: "panel-radio",
    flexGrow: 1,
    flexDirection: "column",
    padding: 1,
    gap: 1,
  });

  panel.add(section(txt(t`${gb("RADIO")}`), div()));
  panel.add(section(
    txt(t`${gd("NO RADIO MODULE DETECTED")}`),
    new TextRenderable(renderer, { content: "" }),
    txt(t`${gd("This feature requires additional")}`),
    txt(t`${gd("hardware. See plan.md for details.")}`),
  ));

  return panel;
}

// ─────────────────────────────────────────────
// Create panels and show initial
// ─────────────────────────────────────────────

const panels = [
  createHomePanel(),
  createStatusPanel(),
  createEnvPanel(),
  createMapPanel(),
  createAiPanel(),
  createRadioPanel(),
];

contentArea.add(panels[currentTabIndex]!);
renderTabBar();

// ─────────────────────────────────────────────
// Responsive resize — rebuild home panel art
// ─────────────────────────────────────────────

process.stdout.on("resize", () => {
  const wasHome = currentTabIndex === HOME_TAB_INDEX;
  if (wasHome) {
    contentArea.remove(panels[HOME_TAB_INDEX]!.id);
  }
  panels[HOME_TAB_INDEX] = createHomePanel();
  if (wasHome) {
    contentArea.add(panels[HOME_TAB_INDEX]!);
  }
});

// ─────────────────────────────────────────────
// Tab switching
// ─────────────────────────────────────────────

function switchToTab(index: number) {
  if (index === currentTabIndex) return;
  const prev = panels[currentTabIndex];
  if (prev) contentArea.remove(prev.id);
  currentTabIndex = index;
  const next = panels[currentTabIndex];
  if (next) contentArea.add(next);
  renderTabBar();

  // Refresh map when switching to MAP tab
  if (index === MAP_TAB_INDEX) {
    updateMapView();
  }
}

// ─────────────────────────────────────────────
// Idle timer
// ─────────────────────────────────────────────

let idleTimer: ReturnType<typeof setTimeout> | null = null;

function resetIdleTimer() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    switchToTab(HOME_TAB_INDEX);
  }, IDLE_TIMEOUT_MS);
}

// ─────────────────────────────────────────────
// Keyboard
// ─────────────────────────────────────────────

const MAP_TAB_INDEX = TAB_NAMES.indexOf("MAP");
const AI_TAB_INDEX = TAB_NAMES.indexOf("AI");

renderer.keyInput.on("keypress", (key: any) => {
  resetIdleTimer();

  // AI tab push-to-talk
  if (currentTabIndex === AI_TAB_INDEX) {
    if (key.name === "space") {
      if (aiIsRecording) {
        // Second press — stop recording and transcribe
        stopRecordingAndAsk();
      } else if (!aiIsGenerating) {
        // First press — start recording
        recordAndAsk();
      }
      return;
    } else if (key.sequence === "c" || key.sequence === "C") {
      clearAiChat();
      return;
    } else if (key.name === "up") {
      const maxScroll = aiConversation.length + (aiIsGenerating ? 1 : 0) - 1;
      aiScrollOffset = Math.min(aiScrollOffset + 1, Math.max(0, maxScroll));
      renderAiChat();
      return;
    } else if (key.name === "down") {
      aiScrollOffset = Math.max(0, aiScrollOffset - 1);
      renderAiChat();
      return;
    }
  }

  // Map tab: voice control with SPACE + route clear with R
  if (currentTabIndex === MAP_TAB_INDEX) {
    if (key.name === "space") {
      if (mapIsRecording) {
        mapStopRecordingAndExecute();
      } else {
        mapStartRecording();
      }
      return;
    }
    if (key.sequence === "r" || key.sequence === "R") {
      handleMapClear();
      return;
    }
  }

  // If on MAP tab, try map-specific keys first
  if (currentTabIndex === MAP_TAB_INDEX) {
    if (handleMapKey(key.name)) {
      return; // consumed by map
    }
  }

  if (key.name === "left" || key.name === "h") {
    switchToTab(currentTabIndex <= 0 ? TAB_NAMES.length - 1 : currentTabIndex - 1);
  } else if (key.name === "right" || key.name === "l") {
    switchToTab(currentTabIndex >= TAB_NAMES.length - 1 ? 0 : currentTabIndex + 1);
  }
});

resetIdleTimer();
