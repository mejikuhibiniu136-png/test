'use client';
import { MotionConfig } from 'motion/react';

// reducedMotion="user": pengguna dengan "kurangi gerakan" di OS tidak melihat animasi transform/layout.
export function MotionProvider({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
