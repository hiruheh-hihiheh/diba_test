// src/pages/Placeholder.tsx
// Temporary placeholder for pages that will be built in later phases

import { useLocation } from "react-router-dom";
import { Construction } from "lucide-react";

export default function PlaceholderPage() {
  const location = useLocation();

  const pageName = location.pathname
    .split("/")
    .filter(Boolean)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1).replace(/-/g, " "))
    .join(" > ") || "Page";

  return (
    <div className="flex flex-col items-center justify-center py-32 animate-fade-in">
      <div className="w-16 h-16 rounded-2xl bg-primary-muted flex items-center justify-center mb-4">
        <Construction size={32} className="text-primary" />
      </div>
      <h2 className="text-xl font-bold text-text">{pageName}</h2>
      <p className="text-sm text-text-muted mt-2 text-center max-w-md">
        This page is under construction and will be available in a future phase.
      </p>
    </div>
  );
}
