import React from "react";

export function useWorkspaceToast(duration = 1800) {
  const [message, setMessage] = React.useState<string | null>(null);
  const timerRef = React.useRef<number | null>(null);

  const showToast = React.useCallback((nextMessage: string) => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    setMessage(nextMessage);
    timerRef.current = window.setTimeout(() => {
      setMessage(null);
      timerRef.current = null;
    }, duration);
  }, [duration]);

  React.useEffect(() => () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
  }, []);

  return { toastMessage: message, showToast };
}
