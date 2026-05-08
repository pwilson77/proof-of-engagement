'use client';

import { useEffect, useState } from 'react';
import mermaid from 'mermaid';

mermaid.initialize({
  startOnLoad: true,
  theme: 'dark',
  securityLevel: 'loose',
  fontFamily: 'inherit',
});

interface Step {
  id: string;
  nodes: string[];
}

const steps: Step[] = [
  {
    id: 'create',
    nodes: ['CA', 'CP'],
  },
  {
    id: 'execute',
    nodes: ['EA', 'SP'],
  },
  {
    id: 'validate',
    nodes: ['VA', 'VB', 'VC', 'ER'],
  },
  {
    id: 'settle',
    nodes: ['CO', 'SS', 'TR'],
  },
];

export default function SimulationFlow() {
  const [currentStep, setCurrentStep] = useState(0);
  const [isRunning, setIsRunning] = useState(true);
  const [loopCount, setLoopCount] = useState(0);
  const [mermaidId, setMermaidId] = useState('mermaid-0');

  useEffect(() => {
    mermaid.contentLoaded();
  }, [mermaidId]);

  useEffect(() => {
    if (!isRunning) return;

    const interval = setInterval(() => {
      setCurrentStep((prev) => {
        const next = (prev + 1) % steps.length;
        if (next === 0) {
          setLoopCount((count) => {
            if (count >= 2) {
              setIsRunning(false);
              return 3;
            }
            return count + 1;
          });
          setTimeout(() => {
            if (loopCount < 2) {
              setCurrentStep(0);
            }
          }, 3000);
        }
        return next;
      });
    }, 2500);

    return () => clearInterval(interval);
  }, [isRunning, loopCount]);

  const handleReset = () => {
    setCurrentStep(0);
    setLoopCount(0);
    setIsRunning(true);
  };

  const getNodeStyle = (nodeId: string, isActive: boolean, isCompleted: boolean) => {
    if (isActive) {
      return `stroke:#2ef2c4, stroke-width:3px, fill:#07100f`;
    }
    if (isCompleted) {
      return `stroke:#46f5cf, stroke-width:2px, fill:#07100f`;
    }
    return '';
  };

  const diagramCode = `
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

    ${steps.map((step, idx) => {
      const isActive = idx === currentStep;
      const isCompleted = idx < currentStep || (currentStep === 0 && loopCount > 0);
      return step.nodes
        .map(
          (node) =>
            `${isActive ? `style ${node} stroke:#2ef2c4,stroke-width:3px,fill:#07100f,color:#2ef2c4` : isCompleted ? `style ${node} stroke:#46f5cf,stroke-width:2px,fill:#07100f,color:#46f5cf` : ''}`,
        )
        .join('\n');
    })}
`;

  return (
    <section className="border-y border-[#133a34] bg-[#060b0a]/70">
      <div className="max-w-6xl mx-auto px-4 py-16 w-full">
        <h2 className="text-4xl font-bold mb-2 text-white uppercase">
          The <span className="text-[#11e7b8]">Flow</span>
        </h2>
        <p className="text-[#9db8b1] mb-12">Watch the complete settlement lifecycle</p>

        {/* Mermaid diagram container */}
        <div className="poe-panel rounded-xl p-6 mb-8 overflow-x-auto">
          <div className="mermaid" key={mermaidId}>
            {diagramCode}
          </div>
        </div>

        {/* Step indicators */}
        <div className="flex flex-wrap gap-2 mb-8 justify-center">
          {steps.map((step, idx) => (
            <div
              key={step.id}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-300 ${
                idx === currentStep
                  ? 'bg-gradient-to-r from-[#08e0b0] to-[#2ef2c4] text-[#072821] scale-105'
                  : idx < currentStep || (currentStep === 0 && loopCount > 0)
                    ? 'bg-[#133a34] text-[#2ef2c4] border border-[#2ef2c4]'
                    : 'bg-[#0a1a18] text-[#7ca29a] border border-[#1a3a34]'
              }`}
            >
              {step.id === 'create' && '📋 Campaign Created'}
              {step.id === 'execute' && '⚙️ Executor Works'}
              {step.id === 'validate' && '✓ Validators Score'}
              {step.id === 'settle' && '✅ Program Settles'}
            </div>
          ))}
        </div>

        {/* Status and controls */}
        <div className="flex items-center justify-between pt-6 border-t border-[#1a3a34]">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-[#2ef2c4] animate-pulse" />
            <span className="text-sm text-[#9db8b1]">
              {isRunning ? 'Playing simulation' : `Simulation complete (${loopCount} cycles)`}
            </span>
          </div>
          {!isRunning && (
            <button
              onClick={handleReset}
              className="text-sm px-4 py-1.5 rounded-md border border-[#2ef2c4] text-[#2ef2c4] hover:bg-[#2ef2c4]/10 transition"
            >
              Replay
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

