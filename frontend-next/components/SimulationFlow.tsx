'use client';

import { useEffect, useState } from 'react';

interface Step {
  id: string;
  title: string;
  description: string;
  icon: string;
  color: string;
}

const steps: Step[] = [
  {
    id: 'create',
    title: 'Campaign Created',
    description: 'Creator Agent locks USDC escrow on-chain, sets validators & score threshold',
    icon: '📋',
    color: 'from-[#08e0b0] to-[#0dbaa0]',
  },
  {
    id: 'execute',
    title: 'Executor Works',
    description: 'Executor Agent performs task & generates signed proof attestation',
    icon: '⚙️',
    color: 'from-[#11e7b8] to-[#0ac9a0]',
  },
  {
    id: 'validate',
    title: 'Validators Score',
    description: 'Each validator independently scores via MagicBlock Ephemeral Rollup (~50ms)',
    icon: '✓',
    color: 'from-[#2ef2c4] to-[#11e7b8]',
  },
  {
    id: 'settle',
    title: 'Program Settles',
    description: 'If avg score ≥ threshold, escrow releases to executor. Else refunds creator.',
    icon: '✅',
    color: 'from-[#46f5cf] to-[#2ef2c4]',
  },
];

export default function SimulationFlow() {
  const [currentStep, setCurrentStep] = useState(0);
  const [isRunning, setIsRunning] = useState(true);
  const [loopCount, setLoopCount] = useState(0);

  useEffect(() => {
    if (!isRunning) return;

    const interval = setInterval(() => {
      setCurrentStep((prev) => {
        const next = (prev + 1) % steps.length;
        // After completing a full cycle, pause for 3 seconds
        if (next === 0) {
          setLoopCount((count) => {
            // Limit to 3 loops, then stop
            if (count >= 2) {
              setIsRunning(false);
              return 3;
            }
            return count + 1;
          });
          // Pause after completing cycle
          setTimeout(() => {
            if (loopCount < 2) {
              setCurrentStep(0);
            }
          }, 3000);
        }
        return next;
      });
    }, 2000);

    return () => clearInterval(interval);
  }, [isRunning, loopCount]);

  const handleReset = () => {
    setCurrentStep(0);
    setLoopCount(0);
    setIsRunning(true);
  };

  return (
    <section className="border-y border-[#133a34] bg-[#060b0a]/70">
      <div className="max-w-6xl mx-auto px-4 py-16 w-full">
        <h2 className="text-4xl font-bold mb-2 text-white uppercase">
          The <span className="text-[#11e7b8]">Flow</span>
        </h2>
        <p className="text-[#9db8b1] mb-12">Watch how campaigns settle end-to-end</p>

        <div className="space-y-6">
          {/* Timeline visualization */}
          <div className="flex flex-col gap-4">
            {steps.map((step, idx) => {
              const isActive = idx === currentStep;
              const isCompleted = idx < currentStep || (currentStep === 0 && loopCount > 0);

              return (
                <div key={step.id} className="flex items-start gap-4">
                  {/* Step number + connector */}
                  <div className="flex flex-col items-center">
                    <div
                      className={`w-12 h-12 rounded-full flex items-center justify-center font-bold text-lg transition-all duration-300 ${
                        isActive
                          ? `bg-gradient-to-br ${step.color} text-white shadow-lg scale-110`
                          : isCompleted
                            ? 'bg-[#133a34] text-[#2ef2c4] border border-[#2ef2c4]'
                            : 'bg-[#0a1a18] border border-[#1a3a34] text-[#7ca29a]'
                      }`}
                    >
                      {step.icon}
                    </div>
                    {idx < steps.length - 1 && (
                      <div
                        className={`w-1 h-12 mt-2 transition-colors duration-300 ${
                          isCompleted || isActive ? 'bg-[#2ef2c4]' : 'bg-[#1a3a34]'
                        }`}
                      />
                    )}
                  </div>

                  {/* Step content */}
                  <div
                    className={`flex-1 pt-1 transition-all duration-300 ${
                      isActive
                        ? 'poe-panel rounded-xl p-4 border-[#2ef2c4] bg-[#07100f]/80'
                        : 'poe-panel rounded-xl p-4'
                    }`}
                  >
                    <h3 className={`font-semibold text-sm uppercase tracking-wide mb-1 ${isActive ? 'text-[#2ef2c4]' : 'text-white'}`}>
                      {step.title}
                    </h3>
                    <p className="text-sm text-[#90b0a8] leading-relaxed">
                      {step.description}
                    </p>
                  </div>
                </div>
              );
            })}
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
      </div>
    </section>
  );
}
