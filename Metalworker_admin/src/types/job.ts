export type JobType = "labour" | "with_material";

export interface Job {
  id: string;
  job_no: string | null;
  job_type: JobType;
  job_given_date: string | null;
  po_status: string | null;
  tool_description: string | null;
  tool_part: string | null;
  quantity: number | null;
  expected_completion_date: string | null;
  expected_completion_note: string | null;
  current_machining_status: string | null;
  status: string;
  drawing_status: string | null;
  drawing_status_note: string | null;
  model_status: string | null;
  created_at: string;
  updated_at: string;
}

export type JobInput = Partial<Omit<Job, "id" | "created_at" | "updated_at">>;

export function getJobTypeLabel(type: JobType): string {
  switch (type) {
    case "labour": return "Labour";
    case "with_material": return "With Material (BO)";
    default: return type;
  }
}
