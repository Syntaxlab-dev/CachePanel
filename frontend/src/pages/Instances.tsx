import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Server, Plus, Trash2, RefreshCw, PlayCircle, Copy, ShieldAlert, Key } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { InfoTooltip } from "@/components/InfoTooltip";
import { api, type InstanceToken, type SlaveInstance, type SlaveInstanceStatus } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";

const SERVICES: ("steam" | "battlenet" | "epic")[] = ["steam", "battlenet", "epic"];

// Backend already enforces admin-only on every /api/instance-tokens and
// /api/instances endpoint (see routers/instance_tokens.py,
// routers/instances.py) -- this is a client-side convenience so a viewer
// sees an explanatory empty state instead of a wall of 403 toasts, not a
// real access control boundary.
export function Instances() {
  const { t } = useI18n();
  const { role } = useAuth();
  const isAdmin = role === "admin";

  const [tokens, setTokens] = useState<InstanceToken[] | null>(null);
  const [newTokenLabel, setNewTokenLabel] = useState("");
  const [creatingToken, setCreatingToken] = useState(false);
  const [justCreatedToken, setJustCreatedToken] = useState<string | null>(null);
  const [deletingTokenId, setDeletingTokenId] = useState<number | null>(null);

  const [instances, setInstances] = useState<SlaveInstance[] | null>(null);
  const [newName, setNewName] = useState("");
  const [newBaseUrl, setNewBaseUrl] = useState("");
  const [newInstanceToken, setNewInstanceToken] = useState("");
  const [addingInstance, setAddingInstance] = useState(false);
  const [removingInstanceId, setRemovingInstanceId] = useState<number | null>(null);

  const [summary, setSummary] = useState<SlaveInstanceStatus[] | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [triggering, setTriggering] = useState<string | null>(null); // `${instanceId}:${service}`

  function reloadTokens() {
    api.listInstanceTokens().then((r) => setTokens(r.tokens)).catch(() => setTokens(null));
  }

  function reloadInstances() {
    api.listInstances().then((r) => setInstances(r.instances)).catch(() => setInstances(null));
  }

  function reloadSummary() {
    if (!isAdmin) return;
    setLoadingSummary(true);
    api
      .instancesSummary()
      .then((r) => setSummary(r.instances))
      .catch(() => setSummary(null))
      .finally(() => setLoadingSummary(false));
  }

  useEffect(() => {
    if (!isAdmin) return;
    reloadTokens();
    reloadInstances();
    reloadSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  async function handleCreateToken(e: FormEvent) {
    e.preventDefault();
    const label = newTokenLabel.trim();
    if (!label) return;
    setCreatingToken(true);
    try {
      const result = await api.createInstanceToken(label);
      setJustCreatedToken(result.token);
      setNewTokenLabel("");
      reloadTokens();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("instances.tokenCreateFailed"));
    } finally {
      setCreatingToken(false);
    }
  }

  async function handleCopyToken() {
    if (!justCreatedToken) return;
    try {
      await navigator.clipboard.writeText(justCreatedToken);
      toast.success(t("instances.tokenCopied"));
    } catch {
      // Clipboard API can fail (permissions, insecure context) -- the raw
      // value stays visible on screen either way.
    }
  }

  async function handleDeleteToken(id: number) {
    if (!window.confirm(t("instances.tokenDeleteConfirm"))) return;
    setDeletingTokenId(id);
    try {
      await api.deleteInstanceToken(id);
      toast.success(t("instances.tokenDeleted"));
      reloadTokens();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("instances.tokenDeleteFailed"));
    } finally {
      setDeletingTokenId(null);
    }
  }

  async function handleAddInstance(e: FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    const baseUrl = newBaseUrl.trim();
    const token = newInstanceToken.trim();
    if (!name || !baseUrl || !token) return;
    setAddingInstance(true);
    try {
      await api.addInstance(name, baseUrl, token);
      toast.success(t("instances.added"));
      setNewName("");
      setNewBaseUrl("");
      setNewInstanceToken("");
      reloadInstances();
      reloadSummary();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("instances.addFailed"));
    } finally {
      setAddingInstance(false);
    }
  }

  async function handleRemoveInstance(id: number) {
    if (!window.confirm(t("instances.removeConfirm"))) return;
    setRemovingInstanceId(id);
    try {
      await api.removeInstance(id);
      toast.success(t("instances.removed"));
      reloadInstances();
      reloadSummary();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("instances.removeFailed"));
    } finally {
      setRemovingInstanceId(null);
    }
  }

  async function handleTriggerPrefill(instanceId: number, service: "steam" | "battlenet" | "epic") {
    const key = `${instanceId}:${service}`;
    setTriggering(key);
    try {
      const result = await api.triggerRemotePrefill(instanceId, service);
      if (result.exit_code === 0) {
        toast.success(t("instances.prefillSuccess").replace("{service}", service));
      } else {
        toast.error(t("instances.prefillFailed").replace("{service}", service));
      }
      reloadSummary();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("instances.prefillFailed").replace("{service}", service));
    } finally {
      setTriggering(null);
    }
  }

  if (!isAdmin) {
    return (
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("instances.title")}</h1>
          <p className="text-sm text-[var(--muted)]">{t("instances.subtitle")}</p>
        </div>
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center text-sm text-[var(--muted)]">
            <ShieldAlert className="h-6 w-6" />
            {t("instances.adminOnly")}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("instances.title")}</h1>
        <p className="text-sm text-[var(--muted)]">{t("instances.subtitle")}</p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Server className="h-4 w-4" /> {t("instances.summaryTitle")}
          </CardTitle>
          <Button type="button" variant="outline" size="sm" onClick={reloadSummary} disabled={loadingSummary}>
            <RefreshCw className={loadingSummary ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} /> {t("instances.refresh")}
          </Button>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {!summary || summary.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">{t("instances.noInstances")}</p>
          ) : (
            summary.map((entry) => (
              <div key={entry.id} className="flex flex-col gap-2 rounded-lg border border-[var(--border)] p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{entry.name}</span>
                    <span className="text-xs text-[var(--muted)]">{entry.base_url}</span>
                    {entry.error ? (
                      <Badge variant="warn">{t("instances.unreachable")}</Badge>
                    ) : (
                      <Badge variant="ok">{t("instances.online")}</Badge>
                    )}
                  </div>
                </div>
                {entry.error ? (
                  <p className="text-xs text-[var(--muted)]">{entry.error}</p>
                ) : (
                  entry.status && (
                    <div className="flex flex-wrap gap-4 text-xs text-[var(--muted)]">
                      <span>{t("instances.hitRatio")}: {entry.status.hit_ratio_percent.toFixed(1)}%</span>
                      <span>{t("instances.bandwidthSaved")}: {entry.status.bandwidth_saved_gb.toFixed(1)} GB</span>
                      <span>{t("instances.totalRequests")}: {entry.status.total_requests}</span>
                    </div>
                  )
                )}
                <div className="flex flex-wrap gap-2 pt-1">
                  {SERVICES.map((service) => {
                    const key = `${entry.id}:${service}`;
                    return (
                      <Button
                        key={service}
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={triggering !== null || !!entry.error}
                        onClick={() => handleTriggerPrefill(entry.id, service)}
                      >
                        <PlayCircle className="h-3.5 w-3.5" />
                        {triggering === key ? t("instances.triggering") : service}
                      </Button>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Plus className="h-4 w-4" /> {t("instances.registerTitle")}
            <InfoTooltip text={t("instances.registerTooltip")} />
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {instances && instances.length > 0 && (
            <div className="flex flex-col divide-y divide-[var(--border)] rounded-lg border border-[var(--border)]">
              {instances.map((inst) => (
                <div key={inst.id} className="flex items-center justify-between px-3 py-2 text-sm">
                  <span className="flex flex-col">
                    <span className="font-medium">{inst.name}</span>
                    <span className="text-xs text-[var(--muted)]">{inst.base_url}</span>
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={removingInstanceId === inst.id}
                    onClick={() => handleRemoveInstance(inst.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" /> {t("instances.remove")}
                  </Button>
                </div>
              ))}
            </div>
          )}

          <form onSubmit={handleAddInstance} className="flex flex-col gap-3 border-t border-[var(--border)] pt-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="instance_name" className="text-sm font-medium">
                {t("instances.nameLabel")}
              </label>
              <Input id="instance_name" value={newName} onChange={(e) => setNewName(e.target.value)} required />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="instance_url" className="text-sm font-medium">
                {t("instances.urlLabel")}
              </label>
              <Input
                id="instance_url"
                placeholder="http://10.0.0.x:8090"
                value={newBaseUrl}
                onChange={(e) => setNewBaseUrl(e.target.value)}
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="instance_token" className="text-sm font-medium">
                {t("instances.tokenLabel")}
                <InfoTooltip text={t("instances.tokenLabelTooltip")} />
              </label>
              <Input
                id="instance_token"
                type="password"
                value={newInstanceToken}
                onChange={(e) => setNewInstanceToken(e.target.value)}
                required
              />
            </div>
            <div>
              <Button type="submit" disabled={addingInstance}>
                {addingInstance ? t("instances.adding") : t("instances.add")}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Key className="h-4 w-4" /> {t("instances.ownTokensTitle")}
            <InfoTooltip text={t("instances.ownTokensTooltip")} />
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {justCreatedToken && (
            <div className="flex flex-col gap-2 rounded-lg border border-[var(--accent)] bg-[var(--accent-soft)] p-3">
              <p className="text-sm font-medium text-[var(--accent)]">{t("instances.tokenCreatedNotice")}</p>
              <code className="break-all rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2 text-xs">
                {justCreatedToken}
              </code>
              <div className="flex items-center gap-2">
                <Button type="button" variant="outline" size="sm" onClick={handleCopyToken}>
                  <Copy className="h-3.5 w-3.5" /> {t("instances.tokenCopy")}
                </Button>
                <p className="text-xs text-[var(--muted)]">{t("instances.tokenNeverShownAgain")}</p>
              </div>
            </div>
          )}

          {tokens === null ? (
            <p className="text-sm text-[var(--muted)]">{t("instances.tokensLoadFailed")}</p>
          ) : tokens.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">{t("instances.tokensEmpty")}</p>
          ) : (
            <div className="flex flex-col divide-y divide-[var(--border)] rounded-lg border border-[var(--border)]">
              {tokens.map((tok) => (
                <div key={tok.id} className="flex items-center justify-between px-3 py-2 text-sm">
                  <span className="flex flex-col">
                    <span className="font-medium">{tok.label}</span>
                    <span className="text-xs text-[var(--muted)]">
                      {new Date(tok.created_date).toLocaleDateString()}
                    </span>
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={deletingTokenId === tok.id}
                    onClick={() => handleDeleteToken(tok.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" /> {t("instances.tokenDelete")}
                  </Button>
                </div>
              ))}
            </div>
          )}

          <form onSubmit={handleCreateToken} className="flex flex-col gap-3 border-t border-[var(--border)] pt-4 sm:flex-row sm:items-end">
            <div className="flex flex-1 flex-col gap-1.5">
              <label htmlFor="new_instance_token_label" className="text-sm font-medium">
                {t("instances.tokenNameLabel")}
              </label>
              <Input
                id="new_instance_token_label"
                placeholder={t("instances.tokenNamePlaceholder")}
                value={newTokenLabel}
                onChange={(e) => setNewTokenLabel(e.target.value)}
                required
              />
            </div>
            <Button type="submit" disabled={creatingToken}>
              {creatingToken ? t("instances.tokenCreating") : t("instances.tokenCreate")}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
