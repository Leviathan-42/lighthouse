// Shared types between @lighthouse/web and @lighthouse/api.
// Keep this file the single source of truth for wire shapes.

export type ServiceStatus = 'ok' | 'warn' | 'error' | 'idle' | 'deploying';
export type DeployStatus = 'success' | 'running' | 'failed' | 'rolled-back';
export type LogLevel = 'info' | 'warn' | 'error' | 'debug';
export type NodeRole = 'self' | 'server' | 'mobile' | 'cloud';
export type EdgeState = 'active' | 'idle';

export type Tone = 'neutral' | 'ok' | 'warn' | 'error' | 'accent';

export interface Service {
  id: string;
  name: string;
  slug: string;
  category: string;
  host: string;
  status: ServiceStatus;
  uptime: string;
  version: string;
  cpu: number;
  ram: number;
  ramMax: number;
  netIn: number;
  netOut: number;
  container: string | null;
  image: string;
  cpuSpark: number[];
  ramSpark: number[];
  tags: string[];
  alert?: string;
}

export interface TailnetNode {
  id: string;
  name: string;
  role: NodeRole;
  ip: string;
  os: string;
  latency: number;
  x: number;
  y: number;
  exitNode?: boolean;
  subnet?: string;
}

export type TailnetEdge = readonly [
  fromId: string,
  toId: string,
  latencyMs: number,
  state: EdgeState,
];

export interface LogLine {
  t: string;
  lvl: LogLevel;
  msg: string;
}

export interface DeployDiff {
  added: number;
  removed: number;
  files: number;
}

export interface Deploy {
  id: string;
  service: string;
  branch: string;
  sha: string;
  msg: string;
  status: DeployStatus;
  when: string;
  duration: string;
  author: string;
  diff: DeployDiff;
  error?: string;
}

export interface DiffLine {
  type: 'meta' | 'hunk' | 'ctx' | 'add' | 'del';
  line: string;
}

export type DeployPipelineStage =
  | 'checkout'
  | 'build'
  | 'test'
  | 'deploy'
  | 'healthcheck';

export interface DeployEvent {
  deployId: string;
  stage: DeployPipelineStage;
  status: 'started' | 'ok' | 'error' | 'skipped';
  ts: number;
  durationMs?: number;
  message?: string;
}

export interface MetricPoint {
  t: number; // unix ms
  v: number;
}

export interface MetricSeries {
  name: string;
  points: MetricPoint[];
}

export interface ServiceMetrics {
  cpu: MetricSeries;
  ram: MetricSeries;
  netIn: MetricSeries;
  netOut: MetricSeries;
}

export interface HealthSummary {
  ok: boolean;
  checks: Record<string, { ok: boolean; detail?: string }>;
}

export type ViewPage = 'overview' | 'detail' | 'network' | 'deploy';
export interface View {
  page: ViewPage;
  id?: string;
}
