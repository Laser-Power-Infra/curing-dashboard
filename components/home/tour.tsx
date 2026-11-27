"use client";
// First-visit guided tour in a native <dialog>. Shown once per browser; the button opens it again.
import { useEffect, useRef, useState } from "react";

const SEEN = "curing.homeTourSeen";
const STEPS = [
  {
    title: "यह कार्ड क्या है / What a card means",
    body: "हर कार्ड एक ड्रम है। उस पर लिखा है अगला काम क्या है और कब तक करना है। / Each card is one drum. It shows the next job and the time limit.",
  },
  {
    title: "बड़ा बटन / The big button",
    body: "ड्रम टैंक में डालने के बाद बड़ा बटन दबाएँ। हर काम के बाद ऐसा ही करें। / Tap the big button when you load the drum. Do the same after every step.",
  },
  {
    title: "रंग / Colours",
    body: "लाल मतलब देर हो गई – अभी करें। पीला मतलब जल्दी करना है। हरा मतलब सब ठीक। / Red means late – act now. Amber means due soon. Green means all OK.",
  },
];
const BTN = "inline-flex items-center justify-center rounded-md px-4 text-base font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700";

export function Tour() {
  const dialog = useRef<HTMLDialogElement>(null);
  const [step, setStep] = useState(0);
  const open = () => {
    setStep(0);
    dialog.current?.showModal();
  };

  useEffect(() => {
    try {
      if (localStorage.getItem(SEEN)) return;
      localStorage.setItem(SEEN, "1");
    } catch {
      return; // storage blocked: do not pop up on every visit
    }
    dialog.current?.showModal();
  }, []);

  const s = STEPS[step];
  const last = step === STEPS.length - 1;
  return (
    <>
      <button type="button" onClick={open} className={`${BTN} min-h-11 border border-slate-300 bg-white !text-sm text-slate-800 hover:bg-slate-50`}>
        सीखें · Show tour
      </button>
      <dialog ref={dialog} aria-labelledby="tour-title" className="m-auto w-[min(92vw,26rem)] rounded-xl bg-white p-0 text-slate-900 shadow-xl backdrop:bg-black/50">
        <div className="space-y-4 p-5">
          <p className="text-sm font-medium text-slate-600">
            {step + 1} / {STEPS.length}
          </p>
          <h2 id="tour-title" className="text-xl font-semibold">
            {s.title}
          </h2>
          <p className="text-lg leading-7">{s.body}</p>
          <div className="flex flex-wrap justify-between gap-2">
            <button type="button" onClick={() => dialog.current?.close()} className={`${BTN} min-h-12 text-slate-700 hover:bg-slate-100`}>
              बंद करें / Close
            </button>
            <div className="flex gap-2">
              {step > 0 && (
                <button type="button" onClick={() => setStep(step - 1)} className={`${BTN} min-h-12 border border-slate-300 bg-white text-slate-800 hover:bg-slate-50`}>
                  पीछे / Back
                </button>
              )}
              <button type="button" autoFocus onClick={() => (last ? dialog.current?.close() : setStep(step + 1))} className={`${BTN} min-h-12 bg-blue-700 text-(--on-solid) hover:bg-blue-800`}>
                {last ? "समझ गया / Got it" : "आगे / Next"}
              </button>
            </div>
          </div>
        </div>
      </dialog>
    </>
  );
}
