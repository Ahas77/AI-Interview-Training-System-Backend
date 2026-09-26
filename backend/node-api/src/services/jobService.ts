export type JobStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface AnalysisJob {
  id: string;
  status: JobStatus;
  createdAt: string;
}

const jobs = new Map<string, AnalysisJob>();

export function createJob(): AnalysisJob {
  const job = { id: crypto.randomUUID(), status: 'queued' as const, createdAt: new Date().toISOString() };
  jobs.set(job.id, job);
  return job;
}

export function getJob(id: string): AnalysisJob | undefined {
  return jobs.get(id);
}
