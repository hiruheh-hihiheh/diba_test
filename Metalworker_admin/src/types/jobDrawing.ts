export interface JobDrawing {
  id: string;
  job_id: string;
  file_url: string;
  public_id: string | null;
  file_name: string | null;
  file_type: string | null;
  version: number | null;
  is_primary: boolean;
  received_date: string | null;
  notes: string | null;
  uploaded_by: string | null;
  created_at: string;
  updated_at: string;
}

export type JobDrawingInput = Partial<Omit<JobDrawing, "id" | "created_at" | "updated_at">>;
