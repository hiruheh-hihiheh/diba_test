import type { ReactNode } from "react";
import { useSidebar } from "../../hooks/useSidebar";

interface AdminModalProps {
  open: boolean;
  onClose?: () => void;
  children: ReactNode;
  zIndex?: number;
}

export default function AdminModal({ open, onClose, children, zIndex = 50 }: AdminModalProps) {
  const { collapsed } = useSidebar();
  
  if (!open) return null;
  
  const leftPadding = collapsed ? '80px' : '280px';
  
  return (
    <div 
      className="fixed bottom-0 right-0 flex items-center justify-center p-4 transition-all duration-300 overflow-hidden"
      style={{ top: '72px', left: leftPadding, zIndex }}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      {children}
    </div>
  );
}
