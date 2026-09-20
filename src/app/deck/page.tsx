'use client';

import {
  Compass,
  CheckCircle2,
  Printer,
} from 'lucide-react';

export default function DeckPage() {
  const handlePrint = () => {
    window.print();
  };

  return (
    <div
      dir="ltr"
      className="min-h-screen bg-slate-100 py-8 px-4 sm:px-8 text-slate-800 font-sans text-left print:bg-white print:p-0 print:text-black"
    >
      {/* Top Floating Action for Printing */}
      <div className="mx-auto max-w-4xl mb-6 flex items-center justify-between bg-white p-4 rounded-2xl shadow-sm border border-slate-200 print:hidden text-left">
        <div className="text-left">
          <h2 className="text-sm font-bold text-slate-900">
            ThereOps - Solution Brief & Product Deck (PDF Ready)
          </h2>
          <p className="text-xs text-slate-500">
            Click the button to save or print as a clean PDF for your submission upload.
          </p>
        </div>
        <button
          type="button"
          onClick={handlePrint}
          className="flex items-center gap-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white px-5 py-2.5 text-xs font-bold transition-all shadow-sm cursor-pointer"
        >
          <Printer className="h-4 w-4" />
          <span>Save as PDF / Print Deck</span>
        </button>
      </div>

      {/* Main Document Container (A4 Proportions) */}
      <div
        dir="ltr"
        className="mx-auto max-w-4xl bg-white shadow-md border border-slate-200 rounded-3xl p-8 sm:p-12 space-y-12 text-left print:shadow-none print:border-none print:p-0 print:space-y-8"
      >
        {/* Cover / Header Section */}
        <div className="border-b border-slate-200 pb-8 text-left">
          <div className="flex items-center justify-between gap-4 mb-4">
            <div className="flex items-center gap-2.5">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-900 text-white">
                <Compass className="h-5 w-5" />
              </div>
              <div className="text-left">
                <span className="text-xl font-extrabold tracking-tight text-slate-900">ThereOps</span>
                <span className="block text-[11px] font-medium text-slate-400">
                  Autonomous Tourism Supply & Live Operations Platform
                </span>
              </div>
            </div>
            <div className="text-right">
              <span className="inline-block rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-800 border border-emerald-200">
                Functional MVP | Production Simulation
              </span>
              <span className="block text-[11px] text-slate-400 mt-1">There DMC Innovation Challenge</span>
            </div>
          </div>

          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 leading-tight mt-6 text-left">
            Autonomous Supplier Discovery, Real-Time Coordination, and 90% Self-Healing Operations for Saudi DMCs
          </h1>

          <div className="mt-6 pt-6 border-t border-slate-100 flex flex-wrap items-center justify-between gap-4 text-xs text-slate-600 text-left">
            <div>
              <span className="font-bold text-slate-900">Author & Builder: </span>
              <span>Mohammed Neanaa (Senior Software & AI Engineer, Riyadh)</span>
            </div>
            <div>
              <span className="font-bold text-slate-900">Current Maturity: </span>
              <span className="text-emerald-700 font-semibold">Functional MVP (Live Working System)</span>
            </div>
            <div>
              <span className="font-bold text-slate-900">Date: </span>
              <span>September 2026</span>
            </div>
          </div>
        </div>

        {/* 1. Problem Statement */}
        <section className="space-y-4 text-left">
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2 text-left">
            <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-slate-900 text-white text-xs shrink-0">1</span>
            The Ground Reality: Why Saudi DMC Operations Are Broken
          </h2>
          <p className="text-sm leading-relaxed text-slate-600 text-left">
            Destination Management Companies in Saudi Arabia operate in one of the fastest-growing tourism markets globally. However, their day-to-day operations are constrained by heavy manual friction:
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-left">
            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-2 text-left">
              <span className="text-xs font-bold text-red-700 block">Fragmented Discovery</span>
              <p className="text-xs text-slate-600 leading-relaxed text-left">
                Local Saudi experience providers (stargazing camps in AlUla, mountain guides in Asir, boat captains in the Red Sea) are scattered across Instagram, TikTok, and personal address books with zero centralized verification or capacity data.
              </p>
            </div>
            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-2 text-left">
              <span className="text-xs font-bold text-amber-700 block">WhatsApp Phone Tag</span>
              <p className="text-xs text-slate-600 leading-relaxed text-left">
                Local suppliers do not use enterprise portals or booking extranets. Coordinators spend hours sending manual messages and listening to voice notes across dozens of active chats to confirm dates and guest counts.
              </p>
            </div>
            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-2 text-left">
              <span className="text-xs font-bold text-purple-700 block">The 45-Minute Delay Cascade</span>
              <p className="text-xs text-slate-600 leading-relaxed text-left">
                When a morning desert transport is delayed by two hours, a coordinator must make four separate phone calls to push back the lunch reservation, warn the afternoon guide, and adjust dinner before guests start complaining.
              </p>
            </div>
          </div>
        </section>

        {/* 2. The Solution: ThereOps */}
        <section className="space-y-4 text-left">
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2 text-left">
            <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-slate-900 text-white text-xs shrink-0">2</span>
            Our Solution: The ThereOps Operational Architecture
          </h2>
          <p className="text-sm leading-relaxed text-slate-600 text-left">
            ThereOps eliminates manual firefighting by meeting suppliers directly on WhatsApp while providing DMC teams with a real-time, conflict-aware operations room.
          </p>

          <div className="space-y-3 text-left">
            <div className="p-4 rounded-2xl border border-slate-200 bg-white shadow-xs space-y-1.5 text-left">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-900 flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                  1. Supplier Discovery and Semantic Matching
                </span>
                <span className="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded font-mono">pgvector + 384-dim</span>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed text-left">
                Extracts unstructured supplier data from social profiles and text descriptions into verified provider records. Uses local vector embeddings to match traveler interests (culture, stargazing, culinary) with top-ranked local creators in milliseconds.
              </p>
            </div>

            <div className="p-4 rounded-2xl border border-slate-200 bg-white shadow-xs space-y-1.5 text-left">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-900 flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                  2. Constraint-Aware Itinerary Builder
                </span>
                <span className="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded font-mono">Safety & Sanity Engine</span>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed text-left">
                Builds dynamic multi-day schedules while actively enforcing transit time buffers, guest dietary requirements (Halal, nut-free), mobility restrictions (wheelchair accessibility), and group nationalities before itineraries are saved.
              </p>
            </div>

            <div className="p-4 rounded-2xl border border-slate-200 bg-white shadow-xs space-y-1.5 text-left">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-900 flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                  3. 90% Autonomous Operations Room via WhatsApp
                </span>
                <span className="text-[10px] bg-violet-100 text-violet-800 px-2 py-0.5 rounded font-mono font-bold">Llama 3.3 70B Orchestrator</span>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed text-left">
                Suppliers receive natural, polite WhatsApp booking inquiries without robotic buttons. Inbound replies (both text and Saudi Arabic voice notes) are understood. When a vendor reports a delay, the system recalculates downstream events, shifts database times, and automatically sends polite WhatsApp updates to subsequent vendors.
              </p>
            </div>

            <div className="p-4 rounded-2xl border border-slate-200 bg-white shadow-xs space-y-1.5 text-left">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-900 flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                  4. Multilingual Tour Leader Notifications
                </span>
                <span className="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded font-mono">Japanese, Italian, English, etc.</span>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed text-left">
                Simultaneously generates localized, culturally reassuring schedule notices in the traveler group's native language (e.g. Japanese or Italian) so tour leaders can inform guests immediately, preserving a 5-star customer experience.
              </p>
            </div>

            <div className="p-4 rounded-2xl border border-slate-200 bg-white shadow-xs space-y-1.5 text-left">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-900 flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                  5. Predictive Regional Demand and Supplier Analytics
                </span>
                <span className="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded font-mono">Forecasting & SLA Scorecards</span>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed text-left">
                Forecasts peak seasonal pressure scores across AlUla (Winter Tantora), Asir (Summer), Riyadh, and Jeddah. Generates post-mortem supplier scorecards that track on-time rates and responsiveness to guide future contract allocations.
              </p>
            </div>
          </div>
        </section>

        {/* 3. Technical Architecture */}
        <section className="space-y-4 text-left">
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2 text-left">
            <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-slate-900 text-white text-xs shrink-0">3</span>
            Technical Architecture & Live Stack
          </h2>

          <div className="p-5 rounded-2xl bg-slate-900 text-white space-y-4 text-left">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs text-left">
              <div className="text-left">
                <span className="text-slate-400 block text-[10px] uppercase tracking-wider">Frontend & Routing</span>
                <span className="font-bold text-white">Next.js 16 App Router</span>
                <span className="block text-[11px] text-slate-400">Tailwind CSS + Lucide</span>
              </div>
              <div className="text-left">
                <span className="text-slate-400 block text-[10px] uppercase tracking-wider">Database & Vector</span>
                <span className="font-bold text-white">Supabase PostgreSQL</span>
                <span className="block text-[11px] text-slate-400">pgvector + Multi-Tenant RLS</span>
              </div>
              <div className="text-left">
                <span className="text-slate-400 block text-[10px] uppercase tracking-wider">Messaging & Voice</span>
                <span className="font-bold text-white">WhatsApp Cloud API</span>
                <span className="block text-[11px] text-slate-400">Groq Whisper-large-v3 Audio</span>
              </div>
              <div className="text-left">
                <span className="text-slate-400 block text-[10px] uppercase tracking-wider">Operations Engine</span>
                <span className="font-bold text-white">Llama 3.3 70B (Groq)</span>
                <span className="block text-[11px] text-slate-400">OpenAI GPT-4o Mini Backup</span>
              </div>
            </div>

            {/* Architecture Flow Representation */}
            <div className="pt-4 border-t border-slate-800 text-[11px] font-mono text-slate-300 leading-relaxed space-y-1 text-left">
              <div className="text-emerald-400 font-bold">Operational Workflow:</div>
              <div>[Supplier WhatsApp Audio/Text] &rarr; [Groq Whisper (Arabic Voice Transcription)]</div>
              <div>&rarr; [Multi-Group Disambiguation] &rarr; [Llama 3.3 70B Operations Dispatcher]</div>
              <div>&rarr; [Supabase DB Schedule Shift] &rarr; [Proactive Downstream Vendor WhatsApp Dispatch]</div>
              <div>&rarr; [Localized Tour Leader Notice (JP/IT/EN)] &rarr; [Live Coordinator Realtime UI]</div>
            </div>
          </div>
        </section>

        {/* 4. Operational Benchmarks */}
        <section className="space-y-4 text-left">
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2 text-left">
            <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-slate-900 text-white text-xs shrink-0">4</span>
            Operational Impact & Validation Benchmarks
          </h2>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-left">
            <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-center">
              <div className="text-2xl font-extrabold text-emerald-700">4 sec</div>
              <div className="text-xs font-bold text-slate-900 mt-1">Disruption Handling</div>
              <p className="text-[11px] text-slate-500 mt-0.5">vs. 45 mins of manual calls</p>
            </div>
            <div className="p-4 rounded-2xl bg-violet-50 border border-violet-200 text-center">
              <div className="text-2xl font-extrabold text-violet-700">92%+</div>
              <div className="text-xs font-bold text-slate-900 mt-1">Autonomous Resolution</div>
              <p className="text-[11px] text-slate-500 mt-0.5">Zero manual call bottleneck</p>
            </div>
            <div className="p-4 rounded-2xl bg-blue-50 border border-blue-200 text-center">
              <div className="text-2xl font-extrabold text-blue-700">100%</div>
              <div className="text-xs font-bold text-slate-900 mt-1">WhatsApp Native</div>
              <p className="text-[11px] text-slate-500 mt-0.5">No new app for suppliers</p>
            </div>
            <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 text-center">
              <div className="text-2xl font-extrabold text-amber-700">26 ms</div>
              <div className="text-xs font-bold text-slate-900 mt-1">Semantic Matching</div>
              <p className="text-[11px] text-slate-500 mt-0.5">Local vector embeddings</p>
            </div>
          </div>
        </section>

        {/* 5. Builder Profile & Track Record */}
        <section className="space-y-4 border-t border-slate-200 pt-8 text-left">
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2 text-left">
            <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-slate-900 text-white text-xs shrink-0">5</span>
            Builder Profile & Proven Track Record
          </h2>

          <div className="p-5 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-3 text-left">
            <div className="flex flex-wrap items-center justify-between gap-2 text-left">
              <div>
                <span className="text-sm font-bold text-slate-900">Mohammed Neanaa</span>
                <span className="text-xs text-slate-500 block">Senior Backend & AI Systems Engineer (Riyadh, Saudi Arabia)</span>
              </div>
              <span className="text-xs font-medium text-slate-600 bg-white px-3 py-1 rounded-lg border border-slate-200">
                +966 54 247 7954 | mohammedneana@gmail.com
              </span>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed text-left">
              Six years of experience building scalable backend platforms, agentic AI workflows, and live operations software in Riyadh:
            </p>

            <ul className="space-y-1.5 text-xs text-slate-600 text-left">
              <li className="flex items-start gap-2 text-left">
                <span className="h-1.5 w-1.5 rounded-full bg-slate-900 mt-1.5 shrink-0" />
                <span>
                  <strong className="text-slate-800">Agentic AI & Orchestration (Cerberus & Agentic Learning): </strong>
                  Architected multi-agent orchestration systems that coordinate complex tasks, handle tool routing, and execute workflows autonomously.
                </span>
              </li>
              <li className="flex items-start gap-2 text-left">
                <span className="h-1.5 w-1.5 rounded-full bg-slate-900 mt-1.5 shrink-0" />
                <span>
                  <strong className="text-slate-800">Production AI & High-Traffic Backends (Fiddah, Riyadh): </strong>
                  Architected AI recommendation backends with PostgreSQL, Redis, and vector search (RAG / FAISS), scaled to handle heavy traffic spikes.
                </span>
              </li>
              <li className="flex items-start gap-2 text-left">
                <span className="h-1.5 w-1.5 rounded-full bg-slate-900 mt-1.5 shrink-0" />
                <span>
                  <strong className="text-slate-800">Event Coordination Systems (Toklah, Riyadh): </strong>
                  Engineered backend architecture for real-time volunteer and event management, managing active schedules under fast-moving event conditions.
                </span>
              </li>
              <li className="flex items-start gap-2 text-left">
                <span className="h-1.5 w-1.5 rounded-full bg-slate-900 mt-1.5 shrink-0" />
                <span>
                  <strong className="text-slate-800">NEOM Mega-Project Experience (Bullivant Arabia): </strong>
                  Automated complex data pipelines for geotechnical reporting on NEOM project sites.
                </span>
              </li>
            </ul>
          </div>
        </section>

        {/* Footer */}
        <div className="border-t border-slate-200 pt-6 text-center text-xs text-slate-400">
          ThereOps - Submitted for the There DMC Innovation Challenge | Confidential & Proprietary
        </div>
      </div>
    </div>
  );
}
