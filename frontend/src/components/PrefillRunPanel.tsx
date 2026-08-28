import { useRef, useState } from "react";
import { Download, Terminal } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { prefillStreamUrl } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

const SERVICE_LABEL: Record<string, string> = {
  steam: "Steam",
  battlenet: "Battle.net",
  epic: "Epic Games",
};

/** "Jetzt herunterladen" button + live SSE log panel. Shared across
 * Steam/BattleNet/Epic since they all trigger the same kind of run. */
export function PrefillRunPanel({ service }: { service: "steam" | "battlenet" | "epic" }) {
  const { t } = useI18n();
  const [running, setRunning] = useState(false);
  const [lines, setLines] = useState<string[]>([]);
  const eventSourceRef = useRef<EventSource | null>(null);
  const logEndRef = useRef<HTMLDivElement | null>(null);

  function start() {
    if (running) return;
    setLines([]);
    setRunning(true);

    const es = new EventSource(prefillStreamUrl(service));
    eventSourceRef.current = es;

    es.addEventListener("started", () => {
      setLines((prev) => [...prev, `-- ${SERVICE_LABEL[service]}-Download gestartet --`]);
    });

    es.onmessage = (event) => {
      setLines((prev) => [...prev, event.data]);
      logEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    };

    es.addEventListener("done", (event) => {
      const exitCode = Number((event as MessageEvent).data);
      setLines((prev) => [...prev, `-- Beendet mit Exit-Code ${exitCode} --`]);
      if (exitCode === 0) {
        toast.success(`${SERVICE_LABEL[service]}: Download abgeschlossen.`);
      } else {
        toast.error(`${SERVICE_LABEL[service]}: Lief mit Exit-Code ${exitCode}.`);
      }
      es.close();
      setRunning(false);
    });

    es.onerror = () => {
      // EventSource fires a generic error both on real connection loss and
      // on the server closing the stream normally in some browsers -- only
      // surface it if we didn't already get a clean "done" event.
      if (eventSourceRef.current === es) {
        setRunning(false);
        es.close();
      }
    };
  }

  return (
    <div className="flex flex-col gap-3">
      <Button variant="outline" onClick={start} disabled={running}>
        <Download className="h-4 w-4" /> {running ? t("prefill.running") : t("prefill.runNow")}
      </Button>

      {lines.length > 0 && (
        <div className="flex flex-col gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3">
          <div className="flex items-center gap-2 text-xs font-medium text-[var(--muted)]">
            <Terminal className="h-3.5 w-3.5" />
            {t("prefill.liveLog")}
            {running && <Badge variant="accent">läuft</Badge>}
          </div>
          <div className="max-h-56 overflow-y-auto rounded-md bg-[var(--bg)] p-2 font-mono text-xs text-[var(--ink)]">
            {lines.map((line, i) => (
              <div key={i} className="whitespace-pre-wrap break-all">
                {line}
              </div>
            ))}
            <div ref={logEndRef} />
          </div>
        </div>
      )}
    </div>
  );
}
