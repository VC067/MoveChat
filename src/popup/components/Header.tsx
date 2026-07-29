import React from 'react';
import { ArrowLeft, Settings as SettingsIcon, X, Star } from 'lucide-react';
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

  const handleStarClick = (e: React.MouseEvent) => {
    e.preventDefault();
    const url = 'https://github.com/VC067/MoveChat';
    if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.create) {
      chrome.tabs.create({ url });
    } else {
      window.open(url, '_blank');
    }
  };

  const showBack = view !== 'home';

  return (
    <header className="flex items-center justify-between px-4 py-3 bg-background select-none border-b border-border/40">
      <div className="flex items-center gap-1.5 min-w-0">
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
        <span className="font-semibold text-base tracking-tight text-foreground truncate">MoveChat</span>
      </div>

      <div className="flex items-center gap-1.5 flex-shrink-0">
        {rightAction}

        <button
          onClick={handleStarClick}
          className="group flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium bg-neutral-100/90 hover:bg-neutral-200/80 dark:bg-white/[0.06] dark:hover:bg-white/[0.12] text-neutral-600 hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-white border border-neutral-200 dark:border-white/10 transition-all duration-150 active:scale-95 cursor-pointer backdrop-blur-md"
          title="Star MoveChat on GitHub"
          aria-label="Star MoveChat on GitHub"
        >
          <Star className="w-3.5 h-3.5 fill-none stroke-[1.75] text-neutral-500 group-hover:text-neutral-800 dark:text-neutral-400 dark:group-hover:text-white flex-shrink-0 transition-colors" />
          <span className="tracking-tight">Star on GitHub</span>
        </button>

        {view !== 'settings' && (
          <button
            onClick={onGoToSettings}
            className="p-1.5 rounded-lg hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            aria-label="Settings"
          >
            <SettingsIcon className="w-[18px] h-[18px]" />
          </button>
        )}
        <button
          onClick={handleClose}
          className="p-1.5 rounded-lg hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
          aria-label="Close"
        >
          <X className="w-[18px] h-[18px]" />
        </button>
      </div>
    </header>
  );
};
