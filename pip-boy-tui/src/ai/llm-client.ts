// LLM Client — streaming chat completions via llama-server HTTP API

export interface Message {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface StreamChunk {
  token: string;
  done: boolean;
}

export interface LLMClientOptions {
  baseURL?: string;
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
}

const DEFAULT_SYSTEM_PROMPT = `Pip-Boy survival assistant. Tiny screen. Be brief.

FORMAT — strict:
• Bullet points only (use • character)
• 3-8 bullets. Each bullet 3-8 words max.
• No paragraphs. No prose. No full sentences.
• No intro. No summary. No repeating the question.
• End with one short follow-up question.

Example:
• Boil water 1 min at sea level
• +1 min per 1000m elevation
• Cool before storing
• Filter sediment first with cloth
Need info on chemical purification?`;

export class LLMClient {
  private baseURL: string;
  private maxTokens: number;
  private temperature: number;
  private systemPrompt: string;

  constructor(options: LLMClientOptions = {}) {
    this.baseURL = options.baseURL || "http://127.0.0.1:8080";
    this.maxTokens = options.maxTokens || 3000;
    this.temperature = options.temperature || 0.5;
    this.systemPrompt = options.systemPrompt || DEFAULT_SYSTEM_PROMPT;
  }

  /**
   * Stream a chat completion. Yields tokens as they arrive.
   */
  async *stream(userMessage: string, context?: string): AsyncGenerator<StreamChunk> {
    const messages: Message[] = [
      { role: "system", content: this.systemPrompt },
    ];

    // If we have RAG context, inject it as a separate system message
    if (context) {
      messages.push({
        role: "system",
        content: `Reference info (do not quote directly):\n${context}`,
      });
    }

    messages.push({ role: "user", content: userMessage });

    const response = await fetch(`${this.baseURL}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages,
        max_tokens: this.maxTokens,
        temperature: this.temperature,
        stream: true,
      }),
    });

    if (!response.ok) {
      throw new Error(`LLM server error: ${response.status} ${response.statusText}`);
    }

    if (!response.body) {
      throw new Error("No response body");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      
      if (done) {
        yield { token: "", done: true };
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      
      // SSE format: "data: {...}\n\n"
      const lines = buffer.split("\n");
      buffer = lines.pop() || ""; // Keep incomplete line in buffer

      for (const line of lines) {
        if (!line.trim() || line.startsWith(":")) continue;
        
        if (line.startsWith("data: ")) {
          const data = line.slice(6);
          
          if (data === "[DONE]") {
            yield { token: "", done: true };
            return;
          }

          try {
            const parsed = JSON.parse(data);
            const delta = parsed.choices?.[0]?.delta?.content;
            
            if (delta) {
              yield { token: delta, done: false };
            }
          } catch (e) {
            // Ignore malformed JSON
          }
        }
      }
    }
  }

  /**
   * Non-streaming completion (waits for full response).
   */
  async complete(userMessage: string, context?: string): Promise<string> {
    const chunks: string[] = [];
    
    for await (const chunk of this.stream(userMessage, context)) {
      if (!chunk.done) {
        chunks.push(chunk.token);
      }
    }
    
    return chunks.join("");
  }
}
