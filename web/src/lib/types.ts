export type SubmissionStatus = 'queued' | 'running' | 'done' | 'infra_error' | 'not_configured' | 'timeout';
export type LeafStatus = 'pass' | 'fail' | 'crash' | 'timeout' | 'memory_error' | 'skipped' | 'error';

export interface Submission {
  id: number;
  kind?: 'push' | 'validation';
  student?: string;
  assignment: string | null;
  repo_name: string | null;
  commit_sha: string | null;
  validation_role?: 'stub' | 'stub_other' | null;
  status: SubmissionStatus;
  passed: number | null;
  total: number | null;
  message: string | null;
  job_log?: string | null;
  attempt: number;
  created_at: string;
  started_at?: string | null;
  finished_at?: string | null;
  duration_ms: number | null;
}

export interface TestResult {
  id: number;
  category_path: string;
  test_name: string;
  status: LeafStatus;
  actual_output: string | null;
  expected_output: string | null;
  error_message: string | null;
  raw_output: string | null;
  valgrind_ok: number | null;
  valgrind_details: string | null;
  duration_ms: number | null;
}

export interface AssignmentSummary {
  slug: string;
  title: string | null;
  published_at: string | null;
  attempts: number;
  latest: { id: number; status: SubmissionStatus; passed: number | null; total: number | null; created_at: string } | null;
}
