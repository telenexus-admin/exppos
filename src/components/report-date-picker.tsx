"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function ReportDatePicker({ selectedDate, activeView }: { selectedDate: string; activeView?: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  function selectDate(value: string) {
    if (!value || loading) return;
    const params = new URLSearchParams();
    params.set("period", "daily");
    params.set("date", value);
    if (activeView && activeView !== "dashboard") params.set("view", activeView);
    setLoading(true);
    router.push(`/app/reports?${params.toString()}`);
  }

  return (
    <label className="report-date-picker">
      <span className="report-date-picker-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" focusable="false">
          <rect x="3" y="5" width="18" height="16" rx="2" />
          <path d="M8 3v4M16 3v4M3 10h18" />
        </svg>
      </span>
      <span className="report-date-picker-copy">
        <small>REPORT DATE</small>
        <input
          type="date"
          aria-label="Choose report date"
          value={selectedDate}
          onChange={(event) => selectDate(event.target.value)}
          disabled={loading}
        />
      </span>
      <span className="report-date-picker-status">{loading ? "Loading…" : "Choose date"}</span>
    </label>
  );
}
