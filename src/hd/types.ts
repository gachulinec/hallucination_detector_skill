/** Types of a skill run: its state file and the tasks the agent works on. */

export type Mode = "standard" | "faithfulness";
export type Profile = "thorough" | "quick";
export type Origin = "external" | "self";
export type Independence = "required" | "recommended" | "none";
export type ModelTier = "standard" | "strongest";
export type ExecutedBy = "subagent" | "main";
export type TaskKind = "extract" | "questions" | "sample" | "sample-judgments" | "verify" | "judge" | "ground";
export type Stage =
  | "extract"
  | "questions"
  | "samples"
  | "sample-judgments"
  | "verify"
  | "judge"
  | "ground"
  | "done"
  | "failed";
export type ActiveStage = Exclude<Stage, "done" | "failed">;
/** "retried": the whole result was rejected and a retry task replaced it */
export type TaskStatus = "pending" | "done" | "retried" | "failed";

export interface TaskRecord {
  /** The task file is tasks/<id>.md, the result results/<id>.json */
  id: string;
  kind: TaskKind;
  /** 1 for the first attempt, 2 for the retry */
  attempt: number;
  /** Claims this attempt covers; for sample tasks the questions, by claim ID */
  claim_ids: number[];
  /** The chunk of an extract task */
  chunk_id?: number;
  /** 1–3 for sample tasks */
  sample_index?: number;
  independence: Independence;
  model_tier: ModelTier;
  status: TaskStatus;
  executed_by?: ExecutedBy;
  error?: string;
}

export interface RunOptions {
  profile: Profile;
  origin: Origin;
  /** Language of explanations and reasoning in the report */
  language: string;
  /** False when the agent cannot start subagents */
  subagents: boolean;
  agent?: string;
  models: string[];
}

export interface RunState extends RunOptions {
  version: string;
  created: string;
  mode: Mode;
  /** How task files tell agents to call hd, e.g. node "/path/hd.mjs" */
  hd_command: string;
  stage: Stage;
  tasks: TaskRecord[];
  warnings: string[];
  failure?: string;
  finished?: string;
}
