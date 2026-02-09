// Speech-to-Text — records audio via sox/arecord, transcribes via whisper.cpp
import { spawn } from "child_process";
import { existsSync, unlinkSync, readFileSync } from "fs";
import { resolve } from "path";

export interface STTOptions {
  whisperBin?: string;
  whisperModel?: string;
  /** macOS uses "rec" (sox), Pi uses "arecord" */
  recordCommand?: "rec" | "arecord";
  sampleRate?: number;
  tmpDir?: string;
}

/** Project root: pip-boy-tui/src/ai/ → ../../.. → pip-boy/ */
const PROJECT_ROOT = resolve(import.meta.dir, "../../..");

/** Find the whisper binary — tries both root and ai-models/ locations */
function findWhisperBin(): string {
  const searchDirs = [
    resolve(PROJECT_ROOT, "whisper.cpp/build/bin"),
    resolve(PROJECT_ROOT, "ai-models/whisper.cpp/build/bin"),
  ];
  const names = ["whisper-cli", "main", "whisper"];
  for (const dir of searchDirs) {
    for (const name of names) {
      const p = resolve(dir, name);
      if (existsSync(p)) return p;
    }
  }
  return "whisper-cli";
}

/** Find the whisper model file */
function findWhisperModel(): string {
  const candidates = [
    resolve(PROJECT_ROOT, "models/ggml-base.en.bin"),
    resolve(PROJECT_ROOT, "ai-models/models/ggml-base.en.bin"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return candidates[0]!;
}

const DEFAULTS: Required<STTOptions> = {
  whisperBin: findWhisperBin(),
  whisperModel: findWhisperModel(),
  recordCommand: process.platform === "darwin" ? "rec" : "arecord",
  sampleRate: 16000,
  tmpDir: "/tmp",
};

export class STT {
  private opts: Required<STTOptions>;
  private recordProcess: ReturnType<typeof spawn> | null = null;
  private wavPath: string;

  constructor(options: STTOptions = {}) {
    this.opts = { ...DEFAULTS, ...options };
    this.wavPath = resolve(this.opts.tmpDir, "pipboy-recording.wav");
  }

  /**
   * Start recording audio from the microphone.
   * Call stopAndTranscribe() when done.
   */
  startRecording(): void {
    // Clean up any previous recording
    if (existsSync(this.wavPath)) {
      unlinkSync(this.wavPath);
    }

    if (this.opts.recordCommand === "rec") {
      // macOS: sox's `rec` command
      this.recordProcess = spawn("rec", [
        "-r", String(this.opts.sampleRate),
        "-c", "1",         // mono
        "-b", "16",        // 16-bit
        "-e", "signed",    // signed int
        this.wavPath,
      ], {
        stdio: ["pipe", "pipe", "pipe"],
      });
    } else {
      // Linux (Pi): arecord
      this.recordProcess = spawn("arecord", [
        "-f", "S16_LE",
        "-r", String(this.opts.sampleRate),
        "-c", "1",
        "-t", "wav",
        this.wavPath,
      ], {
        stdio: ["pipe", "pipe", "pipe"],
      });
    }
  }

  /**
   * Stop recording and transcribe the audio.
   * Returns the transcribed text.
   */
  async stopAndTranscribe(): Promise<string> {
    // Stop recording
    if (this.recordProcess) {
      // Send SIGINT to stop gracefully (writes WAV header)
      this.recordProcess.kill("SIGINT");

      // Wait for process to exit
      await new Promise<void>((resolve) => {
        if (!this.recordProcess) return resolve();
        this.recordProcess.on("close", () => resolve());
        // Timeout safety
        setTimeout(() => resolve(), 3000);
      });
      this.recordProcess = null;
    }

    // Verify recording exists
    if (!existsSync(this.wavPath)) {
      throw new Error("No recording found");
    }

    // Transcribe with whisper.cpp
    const text = await this.transcribe(this.wavPath);

    // Clean up
    if (existsSync(this.wavPath)) {
      unlinkSync(this.wavPath);
    }

    return text.trim();
  }

  /**
   * Cancel an in-progress recording without transcribing.
   */
  cancelRecording(): void {
    if (this.recordProcess) {
      this.recordProcess.kill("SIGKILL");
      this.recordProcess = null;
    }
    if (existsSync(this.wavPath)) {
      unlinkSync(this.wavPath);
    }
  }

  get isRecording(): boolean {
    return this.recordProcess !== null;
  }

  /**
   * Transcribe a WAV file using whisper-cli.
   */
  private transcribe(wavPath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const args = [
        "-m", this.opts.whisperModel,
        "-f", wavPath,
        "--no-timestamps",
        "-t", "4",
        "--language", "en",
      ];

      const proc = spawn(this.opts.whisperBin, args, {
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (data: Buffer) => {
        stdout += data.toString();
      });

      proc.stderr.on("data", (data: Buffer) => {
        stderr += data.toString();
      });

      proc.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(`whisper-cli exited with code ${code}: ${stderr}`));
          return;
        }

        // whisper-cli outputs transcription on stdout, one line per segment
        // Strip any leading/trailing whitespace and [BLANK_AUDIO] markers
        const text = stdout
          .split("\n")
          .map(line => line.trim())
          .filter(line => line && !line.includes("[BLANK_AUDIO]"))
          .join(" ")
          .trim();

        resolve(text);
      });

      proc.on("error", (err) => {
        reject(new Error(`Failed to run whisper-cli: ${err.message}`));
      });
    });
  }
}
