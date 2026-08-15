import type { ReactNode } from 'react';

/**
 * Menu klik-kanan generik — dipakai terminal (SSH/lokal) dan log viewer
 * untuk Copy/Paste. Pola overlay+posisi sama persis dengan FileContextMenu
 * di FileBrowser, disatukan di sini supaya tidak diulang tiga kali.
 */

export interface ContextMenuPosition {
  x: number;
  y: number;
}

interface ContextMenuProps {
  position: ContextMenuPosition;
  onClose: () => void;
  children: ReactNode;
}

export function ContextMenu({ position, onClose, children }: ContextMenuProps) {
  const left = Math.min(position.x, window.innerWidth - 180);
  const top = Math.min(position.y, window.innerHeight - 120);

  return (
    <>
      <div
        className="fixed inset-0 z-40"
        onClick={onClose}
        onContextMenu={(e) => {
          e.preventDefault();
          onClose();
        }}
      />
      <div
        className="fixed z-50 min-w-[160px] rounded border border-line bg-raised py-1 text-xs shadow-lg"
        style={{ left, top }}
      >
        {children}
      </div>
    </>
  );
}

export function ContextMenuItem({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="block w-full px-3 py-1.5 text-left text-dim hover:bg-hover focus:outline-none disabled:cursor-not-allowed disabled:text-faint disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}
