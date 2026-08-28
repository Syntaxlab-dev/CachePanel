import { useEffect, useMemo, useState } from "react";
import { AlertCircle, CheckSquare, Download, HardDrive, Save, Search, Square } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { api, type SteamGame } from "@/lib/api";

export function Steam() {
  const [games, setGames] = useState<SteamGame[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [sizes, setSizes] = useState<Record<string, string> | null>(null);
  const [totalSize, setTotalSize] = useState<string | null>(null);
  const [loadingSizes, setLoadingSizes] = useState(false);

  useEffect(() => {
    api
      .steamLibrary()
      .then((data) => {
        setGames(data.games);
        setSelected(new Set(data.games.filter((g) => g.selected).map((g) => g.app_id)));
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Unbekannter Fehler"));
  }, []);

  const filtered = useMemo(() => {
    if (!games) return [];
    const q = search.trim().toLowerCase();
    return q ? games.filter((g) => g.name.toLowerCase().includes(q)) : games;
  }, [games, search]);

  function toggle(appId: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(appId) ? next.delete(appId) : next.add(appId);
      return next;
    });
  }

  function selectAllFiltered() {
    setSelected((prev) => {
      const next = new Set(prev);
      filtered.forEach((g) => next.add(g.app_id));
      return next;
    });
  }

  function deselectAllFiltered() {
    setSelected((prev) => {
      const next = new Set(prev);
      filtered.forEach((g) => next.delete(g.app_id));
      return next;
    });
  }

  async function handleSave() {
    setSaving(true);
    try {
      await api.saveSteamSelection(Array.from(selected));
      toast.success(`${selected.size} Spiele gespeichert.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Speichern fehlgeschlagen");
    } finally {
      setSaving(false);
    }
  }

  async function handleRunNow() {
    setRunning(true);
    try {
      const result = await api.runPrefill("steam");
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

  async function handleLoadSizes() {
    setLoadingSizes(true);
    try {
      const result = await api.steamSizeStatus();
      const map: Record<string, string> = {};
      result.apps.forEach((a) => (map[a.name] = a.size));
      setSizes(map);
      setTotalSize(result.total_size);
      toast.success("Downloadgrößen geladen.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Größen konnten nicht geladen werden");
    } finally {
      setLoadingSizes(false);
    }
  }

  if (error) {
    return (
      <div className="flex flex-col gap-2 rounded-lg border border-[var(--danger)] bg-[var(--danger-soft)] p-4 text-sm text-[var(--danger)]">
        <div className="flex items-center gap-2">
          <AlertCircle className="h-4 w-4" /> Steam-Bibliothek konnte nicht geladen werden: {error}
        </div>
        <Link to="/settings" className="w-fit underline underline-offset-2">
          Zu den Einstellungen →
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Steam</h1>
          <p className="text-sm text-[var(--muted)]">
            {games ? `${games.length} Spiele in deiner Bibliothek · ${selected.size} ausgewählt` : "Lade Bibliothek…"}
            {totalSize && <span className="ml-2 text-[var(--ink)]">· {totalSize} gesamt</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={handleLoadSizes} disabled={loadingSizes}>
            <HardDrive className="h-4 w-4" /> {loadingSizes ? "Ermittle Größen…" : "Downloadgrößen laden"}
          </Button>
          <Button variant="outline" onClick={handleRunNow} disabled={running}>
            <Download className="h-4 w-4" /> {running ? "Läuft…" : "Jetzt herunterladen"}
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            <Save className="h-4 w-4" /> {saving ? "Speichert…" : "Auswahl speichern"}
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted)]" />
          <Input
            placeholder="Spiel suchen…"
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Button variant="outline" size="sm" onClick={selectAllFiltered}>
          <CheckSquare className="h-3.5 w-3.5" /> {search ? "Treffer auswählen" : "Alle auswählen"}
        </Button>
        <Button variant="outline" size="sm" onClick={deselectAllFiltered}>
          <Square className="h-3.5 w-3.5" /> {search ? "Treffer abwählen" : "Alle abwählen"}
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="max-h-[65vh] divide-y divide-[var(--border)] overflow-y-auto">
            {filtered.map((game) => (
              <label
                key={game.app_id}
                className="flex cursor-pointer items-center gap-3 px-4 py-2.5 text-sm hover:bg-[var(--surface-2)]"
              >
                <Checkbox checked={selected.has(game.app_id)} onCheckedChange={() => toggle(game.app_id)} />
                {game.icon_url ? (
                  <img src={game.icon_url} alt="" className="h-8 w-8 rounded" />
                ) : (
                  <div className="h-8 w-8 rounded bg-[var(--surface-2)]" />
                )}
                <span className="flex-1">{game.name}</span>
                {sizes?.[game.name] && <Badge variant="neutral">{sizes[game.name]}</Badge>}
                {game.playtime_minutes > 0 && (
                  <Badge variant="neutral">{Math.round(game.playtime_minutes / 60)} Std. gespielt</Badge>
                )}
              </label>
            ))}
            {games && filtered.length === 0 && (
              <p className="px-4 py-6 text-sm text-[var(--muted)]">Keine Treffer für "{search}".</p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
