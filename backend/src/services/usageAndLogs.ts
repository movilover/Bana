import type { BackendConfig } from '../config.js';

export interface UsageCounterEntry {
  category: string;
  providerId: string;
  operation: string;
  requestsCount: number;
  successCount: number;
  errorCount: number;
  lastUsedAt: string;
}

export interface BackendErrorLogEntry {
  id: string;
  category: string;
  providerId: string;
  severity: 'info' | 'warning' | 'error';
  message: string;
  endpoint?: string;
  actorUid?: string;
  createdAt: string;
}

export class UsageAndLogStore {
  private counters = new Map<string, UsageCounterEntry>();
  private errorLogs: BackendErrorLogEntry[] = [];
  private maxLogs = 200;

  recordUsage(params: {
    category: string;
    providerId: string;
    operation: string;
    ok: boolean;
  }) {
    const key = `${params.category}::${params.providerId}::${params.operation}`;
    const existing = this.counters.get(key) || {
      category: params.category,
      providerId: params.providerId,
      operation: params.operation,
      requestsCount: 0,
      successCount: 0,
      errorCount: 0,
      lastUsedAt: new Date().toISOString(),
    };
    existing.requestsCount += 1;
    if (params.ok) existing.successCount += 1;
    else existing.errorCount += 1;
    existing.lastUsedAt = new Date().toISOString();
    this.counters.set(key, existing);
  }

  recordError(
    params: {
      category: string;
      providerId: string;
      severity?: 'info' | 'warning' | 'error';
      message: string;
      endpoint?: string;
      actorUid?: string;
    },
    config?: BackendConfig
  ) {
    const entry: BackendErrorLogEntry = {
      id: `err_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      category: params.category,
      providerId: params.providerId,
      severity: params.severity || 'error',
      message: params.message.slice(0, 500),
      endpoint: params.endpoint,
      actorUid: params.actorUid,
      createdAt: new Date().toISOString(),
    };
    this.errorLogs.unshift(entry);
    if (this.errorLogs.length > this.maxLogs) {
      this.errorLogs = this.errorLogs.slice(0, this.maxLogs);
    }

    // Optional best-effort sync to Supabase if service credentials are configured
    if (config?.supabaseUrl && config?.supabaseServiceRoleKey) {
      fetch(`${config.supabaseUrl.replace(/\/$/, '')}/rest/v1/api_error_logs`, {
        method: 'POST',
        headers: {
          apikey: config.supabaseServiceRoleKey,
          Authorization: `Bearer ${config.supabaseServiceRoleKey}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({
          category: entry.category,
          provider_id: entry.providerId,
          severity: entry.severity,
          message: entry.message,
          endpoint: entry.endpoint || '',
          actor_uid: entry.actorUid || '',
        }),
      }).catch(() => {});
    }

    return entry;
  }

  getUsageSummary(): UsageCounterEntry[] {
    return Array.from(this.counters.values()).sort((a, b) => b.requestsCount - a.requestsCount);
  }

  getRecentErrors(limit = 50): BackendErrorLogEntry[] {
    return this.errorLogs.slice(0, limit);
  }
}
