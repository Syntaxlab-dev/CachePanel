import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Sparkles, X } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

const DISMISS_KEY = "cachepanel-onboarding-dismissed";

/** Shown on the Dashboard until the user has configured at least one
 * service (Steam, Battle.net, or Epic has a non-empty selection) or
 * dismisses it manually -- whichever comes first. Re-checks the "has
 * anything been configured" condition on every mount rather than only
 * trusting the dismissal flag, so it naturally stops showing itself once
 * real usage starts even if someone never clicked dismiss. */
export function OnboardingBanner() {
  const { t } = useI18n();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (localStorage.getItem(DISMISS_KEY) === "1") return;

    api
      .exportSelection()
      .then((bundle) => {
        const hasAnything =
          bundle.steam_app_ids.length > 0 ||
          bundle.battlenet_codes.length > 0 ||
          bundle.epic_app_ids.length > 0;
        setVisible(!hasAnything);
      })
      .catch(() => {
        // If the check itself fails, don't block the dashboard on it --
        // just skip showing the banner rather than erroring the page.
      });
  }, []);

  function dismiss() {
    localStorage.setItem(DISMISS_KEY, "1");
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <Card className="border-[var(--accent)] bg-[var(--accent-soft)]">
      <CardContent className="flex items-start gap-4 p-5">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--accent)] text-[var(--accent-ink)]">
          <Sparkles className="h-4 w-4" />
        </div>
        <div className="flex-1">
          <p className="font-medium text-[var(--ink)]">{t("dashboard.onboarding.title")}</p>
          <p className="mt-0.5 text-sm text-[var(--muted)]">{t("dashboard.onboarding.body")}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Link to="/settings">
              <Button size="sm">{t("dashboard.onboarding.steamLink")}</Button>
            </Link>
            <Link to="/battlenet">
              <Button size="sm" variant="outline">
                {t("dashboard.onboarding.battlenetLink")}
              </Button>
            </Link>
          </div>
        </div>
        <Button variant="ghost" size="icon" onClick={dismiss} aria-label={t("dashboard.onboarding.dismiss")}>
          <X className="h-4 w-4" />
        </Button>
      </CardContent>
    </Card>
  );
}
