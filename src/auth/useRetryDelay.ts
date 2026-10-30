import { useEffect, useState } from 'react';
export function useRetryDelay() {
  const [until, setUntil] = useState(0);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (until <= Date.now()) return;
    setNow(Date.now());
    const timer = setInterval(() => {
      const time = Date.now();
      setNow(time);
      if (time >= until) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [until]);
  return {
    remaining: Math.max(0, Math.ceil((until - now) / 1000)),
    deferUntil: (deadline: number) => {
      setNow(Date.now());
      setUntil(deadline);
    },
  };
}
