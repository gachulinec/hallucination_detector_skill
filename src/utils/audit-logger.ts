import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

interface AuditEntry {
  timestamp: string;
  event: string;
  module: string;
  claim_id?: number;
  duration_ms?: number;
  details?: Record<string, unknown>;
}

export class AuditLogger {
  private filePath: string;
  private apiCallCount: number = 0;

  constructor(filePath: string) {
    this.filePath = filePath;
    const dir = dirname(filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  log(entry: Omit<AuditEntry, "timestamp">): void {
    const fullEntry: AuditEntry = {
      ...entry,
      timestamp: new Date().toISOString(),
    };
    appendFileSync(
      this.filePath,
      JSON.stringify(fullEntry) + "\n",
      "utf-8"
    );
  }

  logApiCall(module: string, model: string, claimId?: number): void {
    this.apiCallCount++;
    this.log({
      event: "api_call",
      module,
      claim_id: claimId,
      details: { model, call_number: this.apiCallCount },
    });
  }

  logModuleStart(module: string): void {
    this.log({ event: "module_start", module });
  }

  logModuleEnd(module: string, durationMs: number): void {
    this.log({ event: "module_end", module, duration_ms: durationMs });
  }

  logToolUse(
    module: string,
    toolName: string,
    claimId?: number,
    resultSummary?: string
  ): void {
    this.log({
      event: "tool_use",
      module,
      claim_id: claimId,
      details: { tool: toolName, result_summary: resultSummary?.slice(0, 200) },
    });
  }

  logError(module: string, error: string, claimId?: number): void {
    this.log({
      event: "error",
      module,
      claim_id: claimId,
      details: { error },
    });
  }

  getApiCallCount(): number {
    return this.apiCallCount;
  }
}
