"use client";
import { useEffect, useState } from "react";
import { countdownText } from "@/lib/next-action";

/** "2 h 15 m left" / "3 h 05 m late". `initial` is the server's text, so the first render matches; then it ticks every minute. */
export function Countdown({ deadline, initial }: { deadline: number; initial: string }) {
  const [text, setText] = useState(initial);
  useEffect(() => {
    const id = setInterval(() => setText(countdownText(deadline, Date.now())), 60_000);
    return () => clearInterval(id);
  }, [deadline]);
  return <span className="tabular-nums">{text}</span>;
}
