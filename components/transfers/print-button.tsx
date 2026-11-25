"use client";
import { btnClass } from "@/components/ui";

export function PrintButton() {
  return (
    <button type="button" onClick={() => window.print()} className={btnClass()}>
      Print
    </button>
  );
}
