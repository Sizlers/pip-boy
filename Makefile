# Pip-Boy Build System
# Works on macOS (brew) and Raspberry Pi OS (apt + install scripts)
#
# Usage:
#   make setup       - Install all dependencies (bun, zig, node packages)
#   make dev         - Run the TUI in dev mode (hot reload)
#   make run         - Run the TUI
#   make setup-ai    - Download and set up LLM + STT models (Pi only)
#   make benchmark   - Run LLM and STT benchmarks (Pi only)
#   make clean       - Remove build artifacts and node_modules
#   make help        - Show this help

.PHONY: setup setup-deps setup-bun setup-zig setup-packages setup-ai \
        dev run benchmark clean help check-deps

SHELL := /bin/bash
OS := $(shell uname -s)
ARCH := $(shell uname -m)
TUI_DIR := pip-boy-tui
AI_DIR := ai-models
MODELS_DIR := $(AI_DIR)/models
BUN := $(shell command -v bun 2>/dev/null)
ZIG := $(shell command -v zig 2>/dev/null)

# Colours (use printf for proper escape handling)
GREEN := \033[0;32m
YELLOW := \033[0;33m
RED := \033[0;31m
NC := \033[0m
ECHO := @printf

# ─────────────────────────────────────────────
# Setup
# ─────────────────────────────────────────────

help:
	@echo ""
	@echo "  Pip-Boy Build System"
	@echo "  ────────────────────"
	@echo ""
	@echo "  $(GREEN)make setup$(NC)        Install all dependencies"
	@echo "  $(GREEN)make dev$(NC)          Run TUI in dev mode (hot reload)"
	@echo "  $(GREEN)make run$(NC)          Run the TUI"
	@echo "  $(GREEN)make setup-ai$(NC)     Download LLM + STT models (Pi)"
	@echo "  $(GREEN)make benchmark$(NC)    Benchmark LLM + STT (Pi)"
	@echo "  $(GREEN)make clean$(NC)        Remove build artifacts"
	@echo "  $(GREEN)make check-deps$(NC)   Verify all dependencies are installed"
	@echo ""

setup: setup-bun setup-zig setup-packages
	@echo ""
	@echo "  $(GREEN)Setup complete.$(NC) Run 'make dev' to start."
	@echo ""

setup-bun:
ifeq ($(BUN),)
ifeq ($(OS),Darwin)
	@echo "  $(YELLOW)Installing Bun via Homebrew...$(NC)"
	brew install oven-sh/bun/bun
else
	@echo "  $(YELLOW)Installing Bun via install script...$(NC)"
	curl -fsSL https://bun.sh/install | bash
	@echo "  $(YELLOW)NOTE: You may need to restart your shell or run:$(NC)"
	@echo "    source ~/.bashrc"
endif
else
	@echo "  $(GREEN)Bun already installed:$(NC) $(shell bun --version)"
endif

setup-zig:
ifeq ($(ZIG),)
ifeq ($(OS),Darwin)
	@echo "  $(YELLOW)Installing Zig via Homebrew...$(NC)"
	brew install zig
else
	@echo "  $(YELLOW)Installing Zig for Linux $(ARCH)...$(NC)"
	@# Pi 5 is aarch64, download pre-built binary
	@if [ "$(ARCH)" = "aarch64" ] || [ "$(ARCH)" = "arm64" ]; then \
		ZIG_URL="https://ziglang.org/download/0.14.1/zig-linux-aarch64-0.14.1.tar.xz"; \
	else \
		ZIG_URL="https://ziglang.org/download/0.14.1/zig-linux-x86_64-0.14.1.tar.xz"; \
	fi; \
	echo "  Downloading from $$ZIG_URL"; \
	curl -fsSL "$$ZIG_URL" | tar -xJ -C /tmp; \
	sudo mv /tmp/zig-linux-*-0.14.1 /opt/zig; \
	sudo ln -sf /opt/zig/zig /usr/local/bin/zig
	@echo "  $(GREEN)Zig installed to /opt/zig$(NC)"
endif
else
	@echo "  $(GREEN)Zig already installed:$(NC) $(shell zig version)"
endif

setup-packages:
	@echo "  $(YELLOW)Installing node packages...$(NC)"
	cd $(TUI_DIR) && bun install

check-deps:
	@echo ""
	@echo "  Dependency Check"
	@echo "  ────────────────"
	@printf "  Bun:  "; if command -v bun >/dev/null 2>&1; then echo "$(GREEN)$$(bun --version)$(NC)"; else echo "$(RED)NOT INSTALLED$(NC)"; fi
	@printf "  Zig:  "; if command -v zig >/dev/null 2>&1; then echo "$(GREEN)$$(zig version)$(NC)"; else echo "$(RED)NOT INSTALLED$(NC)"; fi
	@printf "  Node: "; if [ -d "$(TUI_DIR)/node_modules" ]; then echo "$(GREEN)installed$(NC)"; else echo "$(RED)NOT INSTALLED$(NC) (run make setup)"; fi
	@printf "  OS:   "; echo "$(OS) $(ARCH)"
	@echo ""

# ─────────────────────────────────────────────
# Development
# ─────────────────────────────────────────────

dev:
	cd $(TUI_DIR) && bun run --watch src/index.ts

run:
	cd $(TUI_DIR) && bun run src/index.ts

# ─────────────────────────────────────────────
# AI / LLM / STT (Pi targets)
# ─────────────────────────────────────────────

$(MODELS_DIR):
	mkdir -p $(MODELS_DIR)

setup-ai: $(MODELS_DIR) setup-llama-cpp setup-whisper-cpp download-models
	@echo ""
	@echo "  $(GREEN)AI setup complete.$(NC)"
	@echo "  Models are in ./$(MODELS_DIR)/"
	@echo "  Run 'make benchmark' to test inference speed."
	@echo ""

setup-llama-cpp: $(AI_DIR)
	@echo "  $(YELLOW)Building llama.cpp...$(NC)"
	@if [ ! -d "$(AI_DIR)/llama.cpp" ]; then \
		git clone https://github.com/ggerganov/llama.cpp.git $(AI_DIR)/llama.cpp; \
	fi
	cd $(AI_DIR)/llama.cpp && cmake -B build && cmake --build build --config Release -j$$(nproc 2>/dev/null || sysctl -n hw.ncpu)
	@echo "  $(GREEN)llama.cpp built.$(NC)"

setup-whisper-cpp: $(AI_DIR)
	@echo "  $(YELLOW)Building whisper.cpp...$(NC)"
	@if [ ! -d "$(AI_DIR)/whisper.cpp" ]; then \
		git clone https://github.com/ggerganov/whisper.cpp.git $(AI_DIR)/whisper.cpp; \
	fi
	cd $(AI_DIR)/whisper.cpp && cmake -B build && cmake --build build --config Release -j$$(nproc 2>/dev/null || sysctl -n hw.ncpu)
	@echo "  $(GREEN)whisper.cpp built.$(NC)"

$(AI_DIR):
	mkdir -p $(AI_DIR)

download-models: $(MODELS_DIR)
	@echo "  $(YELLOW)Downloading models...$(NC)"
	@# Whisper tiny.en
	@if [ ! -f "$(MODELS_DIR)/ggml-tiny.en.bin" ]; then \
		echo "  Downloading Whisper tiny.en (~75MB)..."; \
		curl -fsSL -o "$(MODELS_DIR)/ggml-tiny.en.bin" \
			"https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin"; \
	else \
		echo "  $(GREEN)Whisper tiny.en already downloaded.$(NC)"; \
	fi
	@# Whisper base.en
	@if [ ! -f "$(MODELS_DIR)/ggml-base.en.bin" ]; then \
		echo "  Downloading Whisper base.en (~142MB)..."; \
		curl -fsSL -o "$(MODELS_DIR)/ggml-base.en.bin" \
			"https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin"; \
	else \
		echo "  $(GREEN)Whisper base.en already downloaded.$(NC)"; \
	fi
	@# Llama 3.2 3B Instruct Q4_K_M (LLM)
	@if [ ! -f "$(MODELS_DIR)/Llama-3.2-3B-Instruct-Q4_K_M.gguf" ]; then \
		echo "  Downloading Llama 3.2 3B Instruct Q4_K_M (~2.0GB)..."; \
		curl -fsSL -o "$(MODELS_DIR)/Llama-3.2-3B-Instruct-Q4_K_M.gguf" \
			"https://huggingface.co/bartowski/Llama-3.2-3B-Instruct-GGUF/resolve/main/Llama-3.2-3B-Instruct-Q4_K_M.gguf"; \
	else \
		echo "  $(GREEN)Llama 3.2 3B already downloaded.$(NC)"; \
	fi
	@echo "  $(GREEN)All models downloaded.$(NC)"

benchmark: benchmark-llm benchmark-stt

benchmark-llm:
	@echo ""
	@echo "  $(YELLOW)Benchmarking LLM (Llama 3.2 3B)...$(NC)"
	@echo "  Prompt: 'How do I treat a second-degree burn?'"
	@echo "  ────────────────────────────────────────"
	@if [ -f "$(AI_DIR)/llama.cpp/build/bin/llama-cli" ]; then \
		time $(AI_DIR)/llama.cpp/build/bin/llama-cli \
			-m $(MODELS_DIR)/Llama-3.2-3B-Instruct-Q4_K_M.gguf \
			-p "<|begin_of_text|><|start_header_id|>system<|end_header_id|>\nYou are a survival assistant. Answer in bullet points only.<|eot_id|><|start_header_id|>user<|end_header_id|>\nHow do I treat a second-degree burn?<|eot_id|><|start_header_id|>assistant<|end_header_id|>\n" \
			-n 200 \
			--temp 0.5 \
			-ngl 0 \
			2>&1; \
	else \
		echo "  $(RED)llama.cpp not built. Run 'make setup-ai' first.$(NC)"; \
	fi

benchmark-stt:
	@echo ""
	@echo "  $(YELLOW)Benchmarking STT (Whisper tiny.en)...$(NC)"
	@echo "  ────────────────────────────────────────"
	@if [ -f "$(AI_DIR)/whisper.cpp/build/bin/whisper-cli" ]; then \
		if [ -f "test-audio.wav" ]; then \
			time $(AI_DIR)/whisper.cpp/build/bin/whisper-cli \
				-m $(MODELS_DIR)/ggml-tiny.en.bin \
				-f test-audio.wav \
				2>&1; \
		else \
			echo "  $(YELLOW)No test-audio.wav found.$(NC)"; \
			echo "  Record a sample: arecord -f S16_LE -r 16000 -d 5 test-audio.wav"; \
			echo "  Or download one: curl -o test-audio.wav https://github.com/ggerganov/whisper.cpp/raw/master/samples/jfk.wav"; \
		fi \
	else \
		echo "  $(RED)whisper.cpp not built. Run 'make setup-ai' first.$(NC)"; \
	fi

# ─────────────────────────────────────────────
# Cleanup
# ─────────────────────────────────────────────

clean:
	@echo "  $(YELLOW)Cleaning...$(NC)"
	rm -rf $(TUI_DIR)/node_modules
	rm -rf $(AI_DIR)/llama.cpp/build
	rm -rf $(AI_DIR)/whisper.cpp/build
	@echo "  $(GREEN)Clean.$(NC)"

clean-all: clean
	@echo "  $(YELLOW)Removing models and cloned repos...$(NC)"
	rm -rf $(AI_DIR)
	@echo "  $(GREEN)All clean.$(NC)"
