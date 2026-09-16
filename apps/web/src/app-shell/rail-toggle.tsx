"use client";

import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useOptimistic, useTransition } from "react";
import { toggleRail } from "./rail-preference.js";

export function RailToggleForm({ collapsed }: { readonly collapsed: boolean }) {
  const [isPending, startTransition] = useTransition();
  const [optimisticCollapsed, setOptimistic] = useOptimistic(
    collapsed,
    (state) => !state
  );

  return (
    <form className="hidden lg:block">
      <button
        aria-label={optimisticCollapsed ? "Развернуть рельс" : "Свернуть рельс"}
        className="topbar__btn"
        title={optimisticCollapsed ? "Развернуть рельс" : "Свернуть рельс"}
        type="button"
        disabled={isPending}
        onClick={() => {
          // Мгновенное переключение класса
          const shell = document.querySelector(".shell");
          if (shell) {
            shell.classList.toggle("shell--narrow");
          }
          
          startTransition(() => {
            setOptimistic(!collapsed);
            const formData = new FormData();
            formData.append("свернуть", optimisticCollapsed ? "нет" : "да");
            toggleRail(formData);
          });
        }}
      >
        {optimisticCollapsed ? (
          <PanelLeftOpen aria-hidden="true" size={15} />
        ) : (
          <PanelLeftClose aria-hidden="true" size={15} />
        )}
      </button>
    </form>
  );
}
