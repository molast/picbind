import React from "react";

export function useWorkspaceReactions() {
  const nodes = React.useRef(new Set<HTMLElement>());
  const timers = React.useRef(new Set<number>());
  const showReaction = React.useCallback((emoji: string) => {
    const node = document.createElement("div");
    node.textContent = emoji;
    node.className = "pointer-events-none fixed left-1/2 top-1/2 z-[100] text-5xl workspace-reaction-float";
    document.body.append(node);
    nodes.current.add(node);
    const timer = window.setTimeout(() => {
      node.remove(); nodes.current.delete(node); timers.current.delete(timer);
    }, 1400);
    timers.current.add(timer);
  }, []);
  const disposeReactions = React.useCallback(() => {
    timers.current.forEach((timer) => window.clearTimeout(timer));
    timers.current.clear();
    nodes.current.forEach((node) => node.remove());
    nodes.current.clear();
  }, []);
  return { showReaction, disposeReactions, reactionNodes: nodes, reactionTimers: timers };
}
