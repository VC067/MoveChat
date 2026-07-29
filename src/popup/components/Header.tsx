import React from 'react';
import { ArrowLeft, Settings as SettingsIcon, X } from 'lucide-react';
import logo from '../../assets/logo.png';

interface HeaderProps {
  view: string;
  onBack: () => void;
  onGoToSettings: () => void;
  rightAction?: React.ReactNode;
}

export const Header: React.FC<HeaderProps> = ({ view, onBack, onGoToSettings, rightAction }) => {
  const handleClose = () => {
    window.close();
  };

  const showBack = view !== 'home';

  return (
    <header className="flex items-center justify-between px-4 py-3 bg-background select-none">
      <div className="flex items-center gap-1">
        {showBack && (
          <button
            onClick={onBack}
            className="p-1 -ml-1 rounded-lg hover:bg-secondary text-foreground transition-colors cursor-pointer"
            aria-label="Go back"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
        )}
        <img src={logo} alt="" className="w-6 h-6 flex-shrink-0 mt-0.5" />
        <span className="font-semibold text-base tracking-tight text-foreground">MoveChat</span>
      </div>

      <div className="flex items-center gap-1">
        {rightAction}
        {view !== 'settings' && (
          <button
            onClick={onGoToSettings}
            className="p-2 rounded-lg hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            aria-label="Settings"
          >
            <SettingsIcon className="w-[18px] h-[18px]" />
          </button>
        )}
        <button
          onClick={handleClose}
          className="p-2 rounded-lg hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
          aria-label="Close"
        >
          <X className="w-[18px] h-[18px]" />
        </button>
      </div>
    </header>
  );
};
