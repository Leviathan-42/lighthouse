import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type { DeployEvent, LogLine, TailnetNode } from '@lighthouse/shared';
import { api, sseUrl } from './api';

export function useServices() {
  return useQuery({ queryKey: ['services'], queryFn: api.services, refetchInterval: 5_000 });
}

export function useService(id: string | undefined) {
  return useQuery({
    queryKey: ['service', id],
    queryFn: () => api.service(id!),
    enabled: Boolean(id),
    refetchInterval: 5_000,
  });
}

export function useServiceMetrics(id: string | undefined, range = '5m') {
  return useQuery({
    queryKey: ['service-metrics', id, range],
    queryFn: () => api.serviceMetrics(id!, range),
    enabled: Boolean(id),
    refetchInterval: 10_000,
  });
}

export function useServiceLogs(id: string | undefined, tail = 200) {
  return useQuery({
    queryKey: ['service-logs', id, tail],
    queryFn: () => api.serviceLogs(id!, tail),
    enabled: Boolean(id),
    refetchInterval: 3_000,
  });
}

export function useRestartService() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.restartService,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['services'] }),
  });
}

export function useRedeployService() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.redeployService(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['deploys'] }),
  });
}

export function useTailnetDevices() {
  return useQuery({ queryKey: ['tailnet-devices'], queryFn: api.tailnetDevices, refetchInterval: 10_000 });
}

export function useTailnetTrafficStream() {
  const [snapshot, setSnapshot] = useState<{ devices: TailnetNode[]; ts: number } | null>(null);
  useEffect(() => {
    const es = new EventSource(sseUrl('/tailnet/traffic'));
    es.addEventListener('snapshot', (ev) => {
      try {
        setSnapshot(JSON.parse((ev as MessageEvent).data));
      } catch { /* ignore */ }
    });
    es.onerror = () => { /* stay open; EventSource auto-reconnects */ };
    return () => es.close();
  }, []);
  return snapshot;
}

export function useDeploys(limit = 50) {
  return useQuery({ queryKey: ['deploys', limit], queryFn: () => api.deploys(limit), refetchInterval: 5_000 });
}

export function useDeploy(id: string | undefined) {
  return useQuery({
    queryKey: ['deploy', id],
    queryFn: () => api.deploy(id!),
    enabled: Boolean(id),
    refetchInterval: 3_000,
  });
}

export function useDeployEvents(id: string | undefined) {
  return useQuery({
    queryKey: ['deploy-events', id],
    queryFn: () => api.deployEvents(id!),
    enabled: Boolean(id),
  });
}

export function useDeployEventsStream(id: string | undefined) {
  const [events, setEvents] = useState<DeployEvent[]>([]);
  useEffect(() => {
    if (!id) return;
    setEvents([]);
    const es = new EventSource(sseUrl(`/deploys/${id}/events`));
    es.addEventListener('stage', (ev) => {
      try {
        const e = JSON.parse((ev as MessageEvent).data) as DeployEvent;
        setEvents((prev) => [...prev, e]);
      } catch { /* ignore */ }
    });
    return () => es.close();
  }, [id]);
  return events;
}

export function useServiceLogsStream(id: string | undefined) {
  const [lines, setLines] = useState<LogLine[]>([]);
  useEffect(() => {
    if (!id) return;
    setLines([]);
    const es = new EventSource(sseUrl(`/services/${id}/logs`));
    es.addEventListener('log', (ev) => {
      try {
        const line = JSON.parse((ev as MessageEvent).data) as LogLine;
        setLines((prev) => (prev.length >= 500 ? [...prev.slice(-499), line] : [...prev, line]));
      } catch { /* ignore */ }
    });
    return () => es.close();
  }, [id]);
  return lines;
}

export function useRollback() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.rollbackDeploy,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['deploys'] }),
  });
}

export function useCancelDeploy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.cancelDeploy,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['deploys'] }),
  });
}
