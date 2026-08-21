import React from "react";

export function WorkspaceSidebar({ children }: { children: React.ReactNode }) {
  return <aside className="border-t border-[#dfe3e8] bg-white lg:min-h-0 lg:overflow-y-auto lg:border-l lg:border-t-0">{children}</aside>;
}
