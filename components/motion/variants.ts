import type { Transition, Variants } from 'motion/react';

// Preset terpusat: satu "bahasa gerak" untuk seluruh aplikasi. Hanya transform + opacity (dikomposit
// GPU, tidak memicu layout/paint) sehingga tetap mulus di perangkat murah.
export const EASE_OUT: [number, number, number, number] = [0.22, 1, 0.36, 1];
export const SPRING: Transition = { type: 'spring', stiffness: 420, damping: 32, mass: 0.9 };
export const SPRING_SOFT: Transition = { type: 'spring', stiffness: 260, damping: 28 };
export const SPRING_SNAPPY: Transition = { type: 'spring', stiffness: 600, damping: 36 };

export const pageVariants: Variants = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.28, ease: EASE_OUT, when: 'beforeChildren', staggerChildren: 0.06 } },
  exit: { opacity: 0, y: -8, transition: { duration: 0.16, ease: 'easeIn' } },
};

export const itemVariants: Variants = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: { duration: 0.32, ease: EASE_OUT } },
};

export const rowVariants: Variants = {
  hidden: { opacity: 0, x: -8 },
  show: { opacity: 1, x: 0, transition: SPRING_SOFT },
  exit: { opacity: 0, x: 24, transition: { duration: 0.18 } },
};
