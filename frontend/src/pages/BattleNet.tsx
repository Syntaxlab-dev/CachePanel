import { useEffect, useMemo, useState } from "react";
import { AlertCircle, CheckSquare, Download, Save, Square } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { api, type BattleNetProductDto } from "@/lib/api";

export function BattleNet() {
  const [products, setProducts] = useState<BattleNetProductDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    api
      .battlenetCatalog()
      .then((data) => {
        setProducts(data.products);
        setSelected(new Set(data.products.filter((p) => p.selected).map((p) => p.code)));
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Unbekannter Fehler"));
  }, []);

  const grouped = useMemo(() => {
    if (!products) return {};
    return products.reduce<Record<string, BattleNetProductDto[]>>((acc, p) => {
      (acc[p.publisher] ??= []).push(p);
      return acc;
    }, {});
  }, [products]);

  function toggle(code: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(code) ? next.delete(code) : next.add(code);
      return next;
    });
  }

  function selectAll() {
    if (!products) return;
    setSelected(new Set(products.map((p) => p.code)));
  }

  function selectNone() {
    setSelected(new Set());
  }

  async function handleSave() {
    setSaving(true);
    try {
      await api.saveBattlenetSelection(Array.from(selected));
      toast.success(`${selected.size} Produkte gespeichert.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Speichern fehlgeschlagen");
    } finally {
      setSaving(false);
    }
  }

  async function handleRunNow() {
    setRunning(true);
    try {
      const result = await api.runPrefill("battlenet");
      if (result.exit_code === 0) {
        toast.success("Download gestartet/abgeschlossen.");
      } else {
        toast.error(`Lief mit Exit-Code ${result.exit_code}.`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Download-Start fehlgeschlagen");
    } finally {
      setRunning(false);
    }
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-[var(--danger)] bg-[var(--danger-soft)] p-4 text-sm text-[var(--danger)]">
        <AlertCircle className="h-4 w-4" /> Battle.net-Katalog konnte nicht geladen werden: {error}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Battle.net</h1>
          <p className="text-sm text-[var(--muted)]">
            {products
              ? `${products.length} Produkte verfügbar · ${selected.size} ausgewählt`
              : "Lade Katalog…"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={handleRunNow} disabled={running}>
            <Download className="h-4 w-4" /> {running ? "Läuft…" : "Jetzt herunterladen"}
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            <Save className="h-4 w-4" /> {saving ? "Speichert…" : "Auswahl speichern"}
          </Button>
        </div>
      </div>

      {products && products.length > 0 && (
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={selectAll}>
            <CheckSquare className="h-3.5 w-3.5" /> Alle auswählen
          </Button>
          <Button variant="outline" size="sm" onClick={selectNone}>
            <Square className="h-3.5 w-3.5" /> Alle abwählen
          </Button>
        </div>
      )}

      {Object.entries(grouped).map(([publisher, items]) => (
        <Card key={publisher}>
          <CardHeader>
            <CardTitle>{publisher}</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-1 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((p) => (
              <label
                key={p.code}
                className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm hover:bg-[var(--surface-2)]"
              >
                <Checkbox checked={selected.has(p.code)} onCheckedChange={() => toggle(p.code)} />
                <span>{p.name}</span>
              </label>
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
