import { useEffect, useMemo, useState } from "react";
import { Search, ShieldAlert } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { api, type AuditLogEntry } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";

// Backend already enforces admin-only (see routers/audit_log.py) -- this is
// a client-side convenience so a viewer sees an explanatory empty state
// instead of a raw 403 toast, not a real access control boundary (a viewer
// hitting the API directly still gets 403 from the server).
function actionBadgeVariant(action: string): "ok" | "warn" | "neutral" {
  if (action === "login_failed") return "warn";
  if (action.startsWith("login_") || action === "setup") return "ok";
  return "neutral";
}

export function AuditLog() {
  const { t, lang } = useI18n();
  const { role } = useAuth();
  const isAdmin = role === "admin";
  const locale = lang === "de" ? "de-DE" : "en-US";

  const [entries, setEntries] = useState<AuditLogEntry[] | null>(null);
  const [actions, setActions] = useState<string[]>([]);
  const [actionFilter, setActionFilter] = useState("");
  const [usernameFilter, setUsernameFilter] = useState("");
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isAdmin) return;
    api.auditLogActions().then((r) => setActions(r.actions)).catch(() => {});
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    setLoading(true);
    const handle = setTimeout(() => {
      api
        .auditLog({ action: actionFilter || undefined, username: usernameFilter || undefined, q: query || undefined, limit: 300 })
        .then((r) => {
          if (!cancelled) setEntries(r.entries);
        })
        .catch((err) => {
          if (!cancelled) setError(err instanceof Error ? err.message : String(err));
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 250); // debounced -- typed filters shouldn't fire a request per keystroke
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [isAdmin, actionFilter, usernameFilter, query]);

  const sortedActions = useMemo(() => [...actions].sort(), [actions]);

  if (!isAdmin) {
    return (
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("auditLog.title")}</h1>
          <p className="text-sm text-[var(--muted)]">{t("auditLog.subtitle")}</p>
        </div>
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center text-sm text-[var(--muted)]">
            <ShieldAlert className="h-6 w-6" />
            {t("auditLog.adminOnly")}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("auditLog.title")}</h1>
        <p className="text-sm text-[var(--muted)]">{t("auditLog.subtitle")}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("auditLog.filters")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          <div className="relative flex-1 sm:min-w-56">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--muted)]" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("auditLog.searchPlaceholder")}
              className="h-9 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] pl-8 pr-2.5 text-sm outline-none focus:border-[var(--accent)]"
            />
          </div>
          <input
            type="text"
            value={usernameFilter}
            onChange={(e) => setUsernameFilter(e.target.value)}
            placeholder={t("auditLog.usernamePlaceholder")}
            className="h-9 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2.5 text-sm outline-none focus:border-[var(--accent)] sm:w-44"
          />
          <select
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            className="h-9 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2.5 text-sm outline-none focus:border-[var(--accent)] sm:w-52"
          >
            <option value="">{t("auditLog.allActions")}</option>
            {sortedActions.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("auditLog.entries")}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {error ? (
            <p className="px-5 pb-4 text-sm text-[var(--muted)]">{error}</p>
          ) : loading && !entries ? (
            <p className="px-5 pb-4 text-sm text-[var(--muted)]">{t("common.loading")}</p>
          ) : !entries || entries.length === 0 ? (
            <p className="px-5 pb-4 text-sm text-[var(--muted)]">{t("auditLog.noMatch")}</p>
          ) : (
            <div className="overflow-x-auto">
              <div className="flex flex-col divide-y divide-[var(--border)]">
                {entries.map((entry, i) => (
                  <div key={i} className="flex flex-col gap-1 px-5 py-2.5 text-sm sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <Badge variant={actionBadgeVariant(entry.action)}>{entry.action}</Badge>
                      <span className="font-medium">{entry.username}</span>
                      <span className="text-[var(--muted)]">{entry.detail}</span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-[var(--muted)]">
                      <span>{entry.client_ip}</span>
                      <span>{new Date(entry.timestamp).toLocaleString(locale)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
