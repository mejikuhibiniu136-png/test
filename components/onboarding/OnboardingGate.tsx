'use client';
import { AnimatePresence } from 'motion/react';
import { useCallback, useEffect, useState } from 'react';
import { Dashboard } from '@/components/dashboard/Dashboard';
import { Tour } from '@/components/onboarding/Tour';
import { WelcomeScreen } from '@/components/onboarding/WelcomeScreen';
import { TOUR_EVENT, TOUR_KEY, WELCOME_COOKIE } from '@/components/onboarding/constants';
import type { Role } from '@/types';

// Welcome tampil sekali per sesi browser (cookie sesi, dibaca server => tanpa kedip).
// Tur otomatis jalan sekali untuk pengguna baru (localStorage); bisa diputar ulang dari tombol Tutorial.
export function OnboardingGate({ username, role, welcomeSeen }: { username: string; role: Role; welcomeSeen: boolean }) {
  const [entered, setEntered] = useState(welcomeSeen);
  const [tour, setTour] = useState(false);

  const enter = useCallback(() => {
    document.cookie = `${WELCOME_COOKIE}=1; Path=/; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`;
    setEntered(true);
  }, []);

  const closeTour = useCallback(() => { setTour(false); try { localStorage.setItem(TOUR_KEY, '1'); } catch { /* mode privat */ } }, []);

  useEffect(() => {
    if (!entered) return undefined;
    let seen = false;
    try { seen = localStorage.getItem(TOUR_KEY) === '1'; } catch { /* abaikan */ }
    const t = seen ? undefined : setTimeout(() => setTour(true), 900);
    const replay = () => setTour(true);
    window.addEventListener(TOUR_EVENT, replay);
    return () => { clearTimeout(t); window.removeEventListener(TOUR_EVENT, replay); };
  }, [entered]);

  return (
    <>
      {entered && <Dashboard username={username} role={role} />}
      <AnimatePresence>{!entered && <WelcomeScreen key="welcome" username={username} onEnter={enter} />}</AnimatePresence>
      <Tour open={tour} onClose={closeTour} />
    </>
  );
}
