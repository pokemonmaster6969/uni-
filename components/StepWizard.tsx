import React from 'react';
import { Step } from '../types';
import { Check, ChevronRight } from 'lucide-react';

interface Props {
  currentStep: Step;
  steps: string[];
}

export const StepWizard: React.FC<Props> = ({ currentStep, steps }) => {
  return (
    <div className="mb-8">
      <div className="flex items-center justify-between relative">
        <div className="absolute left-0 top-1/2 transform -translate-y-1/2 w-full h-1 bg-gray-200 -z-10" />
        {steps.map((label, index) => {
          const isCompleted = index < currentStep;
          const isCurrent = index === currentStep;
          
          return (
            <div key={index} className="flex flex-col items-center bg-transparent">
              <div 
                className={`w-10 h-10 rounded-full flex items-center justify-center border-2 transition-all duration-300
                  ${isCompleted ? 'bg-green-500 border-green-500 text-white' : 
                    isCurrent ? 'bg-brand-blue border-brand-blue text-white shadow-lg scale-110' : 
                    'bg-white border-gray-300 text-gray-400'}`}
              >
                {isCompleted ? <Check size={20} /> : <span>{index + 1}</span>}
              </div>
              <span className={`mt-2 text-xs font-semibold uppercase tracking-wider ${isCurrent ? 'text-brand-blue' : 'text-gray-400'}`}>
                {label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};