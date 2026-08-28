import { useEffect, useState, type FormEvent } from "react";
import { AlertCircle, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { PrefillRunPanel } from "@/components/PrefillRunPanel";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

export function Epic() {
  const { t } = useI18n();
  const [appIds, setAppIds] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newId, setNewId] = useState("");

  useEffect(() => {
    api
      .epicSelection()
      .then((data) => setAppIds(data.app_ids))
      .catch((err) => setError(err instanceof Error ? err.message : "Unbekannter Fehler"));
  }, []);

  async function persist(next: string[]) {
    setAppIds(next);
    try {
      await api.saveEpicSelection(next);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Speichern fehlgeschlagen");
    }
  }

  function handleAdd(e: FormEvent) {
    e.preventDefault();
    const value = newId.trim();
    if (!value) return;
    if (appIds?.includes(value)) {
      toast.error("Ist schon in der Auswahl.");
      return;
    }
    persist([...(appIds ?? []), value]);
    toast.success(`"${value}" hinzugefügt.`);
    setNewId("");
  }

  function handleRemove(id: string) {
    persist((appIds ?? []).filter((x) => x !== id));
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-[var(--danger)] bg-[var(--danger-soft)] p-4 text-sm text-[var(--danger)]">
        <AlertCircle className="h-4 w-4" /> Epic-Auswahl konnte nicht geladen werden: {error}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("epic.title")}</h1>
          <p className="text-sm text-[var(--muted)]">
            {t("epic.subtitle")}
          </p>
        </div>
      </div>

      <PrefillRunPanel service="epic" />

      <Card>
        <CardHeader>
          <CardTitle>{t("epic.addTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleAdd} className="flex gap-2">
            <Input
              placeholder={t("epic.addPlaceholder")}
              value={newId}
              onChange={(e) => setNewId(e.target.value)}
            />
            <Button type="submit">
              <Plus className="h-4 w-4" /> {t("epic.add")}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("epic.selected")} ({appIds?.length ?? 0})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {!appIds || appIds.length === 0 ? (
            <p className="px-5 pb-5 text-sm text-[var(--muted)]">{t("epic.noneSelected")}</p>
          ) : (
            <div className="divide-y divide-[var(--border)]">
              {appIds.map((id) => (
                <div key={id} className="flex items-center justify-between px-5 py-2.5 text-sm">
                  <span>{id}</span>
                  <Button variant="ghost" size="icon" onClick={() => handleRemove(id)}>
                    <Trash2 className="h-4 w-4 text-[var(--danger)]" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
