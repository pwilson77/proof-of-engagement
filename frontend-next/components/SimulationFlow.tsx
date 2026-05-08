"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import mermaid from "mermaid";

mermaid.initialize({
  startOnLoad: true,
  theme: "dark",
  securityLevel: "loose",
  fontFamily: "inherit",
});

interface Step {
  id: string;
  nodes: string[];
}

const steps: Step[] = [
  {
    id: "create",
    nodes: ["CA", "CP"],
  },
  {
    id: "execute",
    nodes: ["EA", "SP"],
  },
  {
    id: "validate",
    nodes: ["VA", "VB", "VC", "ER"],
  },
  {
    id: "settle",
    nodes: ["CO", "SS", "TR"],
  },
];

export default function SimulationFlow() {
  const [currentStep, setCurrentStep] = useState(0);
  const [isRunning, setIsRunning] = useState(true);
  const [loopCount, setLoopCount] = useState(0);
  const diagramRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isRunning) return;

    const isLastStep = currentStep === steps.length - 1;
    const delay = isLastStep ? 3000 : 2200;

    const timer = window.setTimeout(() => {
      if (isLastStep) {
        if (loopCount >= 2) {
          setIsRunning(false);
          return;
        }

        setLoopCount((count) => count + 1);
        setCurrentStep(0);
        return;
      }

      setCurrentStep((prev) => prev + 1);
    }, delay);

    return () => window.clearTimeout(timer);
  }, [currentStep, isRunning, loopCount]);

  const handleReset = () => {
    setCurrentStep(0);
    setLoopCount(0);
    setIsRunning(true);
  };

  const handleStepClick = (stepIndex: number) => {
    setCurrentStep(stepIndex);
  };

  const handleResume = () => {
    setIsRunning(true);
  };

  const diagramCode = useMemo(() => {
    const allNodes = steps.flatMap((step) => step.nodes);

    const baseStyleLines = allNodes
      .map(
        (node) =>
          `style ${node} stroke:#2a3a37,stroke-width:1.5px,fill:#0a1513,color:#6f8983`,
      )
      .join('\n');

    const styleLines = steps
      .flatMap((step, idx) => {
        const isActive = idx === currentStep;
        if (!isActive) {
          return [];
        }

        const style =
          'stroke:#2ef2c4,stroke-width:3px,fill:#07100f,color:#2ef2c4';

        return step.nodes.map((node) => `style ${node} ${style}`);
      })
      .join("\n");

    return `
flowchart TD
    CA["🧑‍💻 Creator Agent<br/>create_campaign"]
    EA["⚙️ Executor Agent<br/>performs the task"]
    CP(["Campaign PDA<br/>on-chain escrow"])
    SP(["Score PDAs<br/>per-validator"])

    CA -->|escrow + rules| CP
    CA -->|direct or RFQ| EA
    EA -->|task ref| SP

    subgraph ER ["⚡ MagicBlock Ephemeral Rollup"]
        VA["Validator A<br/>submitValidatorScoreEr"]
        VB["Validator B<br/>submitValidatorScoreEr"]
        VC["Validator C<br/>submitValidatorScoreEr"]
    end

    SP --> VA & VB & VC
    CP -->|delegate_campaign| ER
    ER -->|undelegate| CP

    VA & VB & VC --> CO["ConsensusOrchestrator<br/>aggregates & checks"]

    CO -->|avg ≥ threshold| SS["✅ settle_success<br/>escrow → executor"]
    CO -->|deadline passed| TR["🔄 settle_timeout_refund<br/>escrow → creator"]

    ${baseStyleLines}
    ${styleLines}
`;
  }, [currentStep]);

  useEffect(() => {
    let isCancelled = false;

    const renderDiagram = async () => {
      if (!diagramRef.current) return;

      const { svg } = await mermaid.render(
        `campaign-flow-${currentStep}-${loopCount}`,
        diagramCode,
      );
      if (!isCancelled && diagramRef.current) {
        diagramRef.current.innerHTML = svg;
      }
    };

    renderDiagram().catch((error) => {
      console.error("Failed to render Mermaid diagram", error);
    });

    return () => {
      isCancelled = true;
    };
  }, [currentStep, loopCount, diagramCode]);

  return (
    <section className="border-y border-[#133a34] bg-[#060b0a]/70">
      <div className="max-w-6xl mx-auto px-4 py-16 w-full">
        <h2 className="text-4xl font-bold mb-2 text-white uppercase">
          The <span className="text-[#11e7b8]">Flow</span>
        </h2>
        <p className="text-[#9db8b1] mb-12">
          Watch the complete settlement lifecycle
        </p>

        {/* Mermaid diagram container */}
        <div className="poe-panel rounded-xl p-6 mb-8 overflow-x-auto">
          <div ref={diagramRef} className="min-w-225 mermaid-flow" />
        </div>

        {/* Step indicators */}
        <div className="flex flex-wrap gap-2 mb-8 justify-center">
          {steps.map((step, idx) => (
            <button
              type="button"
              key={step.id}
              onClick={() => handleStepClick(idx)}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-300 ${
                idx === currentStep
                  ? "bg-linear-to-r from-[#08e0b0] to-[#2ef2c4] text-[#072821] scale-105"
                  : "bg-[#0a1a18] text-[#7ca29a] border border-[#1a3a34]"
              } hover:border-[#2ef2c4] cursor-pointer`}
            >
              {step.id === "create" && "📋 Campaign Created"}
              {step.id === "execute" && "⚙️ Executor Works"}
              {step.id === "validate" && "✓ Validators Score"}
              {step.id === "settle" && "✅ Program Settles"}
            </button>
          ))}
        </div>

        {/* Status and controls */}
        <div className="flex items-center justify-between pt-6 border-t border-[#1a3a34]">
          <div className="flex items-center gap-2">
            <div
              className={`w-2 h-2 rounded-full bg-[#2ef2c4] ${
                isRunning ? 'animate-pulse' : ''
              }`}
            />
            <span className="text-sm text-[#9db8b1]">
              {isRunning
                ? "Playing simulation"
                : loopCount >= 3
                  ? `Simulation complete (${loopCount} cycles)`
                  : "Paused on selected step"}
            </span>
          </div>
          <div className="flex items-center gap-3">
            {isRunning && (
              <button
                type="button"
                onClick={() => setIsRunning(false)}
                className="text-sm px-4 py-1.5 rounded-md border border-[#2ef2c4] text-[#2ef2c4] hover:bg-[#2ef2c4]/10 transition"
              >
                Pause autoplay
              </button>
            )}
            {!isRunning && loopCount < 3 && (
              <button
                type="button"
                onClick={handleResume}
                className="text-sm px-4 py-1.5 rounded-md border border-[#2ef2c4] text-[#2ef2c4] hover:bg-[#2ef2c4]/10 transition"
              >
                Resume autoplay
              </button>
            )}
            {!isRunning && (
              <button
                type="button"
                onClick={handleReset}
                className="text-sm px-4 py-1.5 rounded-md border border-[#2ef2c4] text-[#2ef2c4] hover:bg-[#2ef2c4]/10 transition"
              >
                Replay
              </button>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
