'use client';
import { motion, type HTMLMotionProps } from 'motion/react';
import { rowVariants } from '@/components/motion/variants';

// Baris tabel dengan layout animation: saat baris lain dihapus/ditambah, sisanya meluncur ke posisi
// baru (bukan melompat), dan baris yang dihapus keluar dengan exit animation. Bungkus daftar dengan
// <AnimatePresence initial={false}>.
export function AnimatedRow({ children, ...rest }: HTMLMotionProps<'tr'>) {
  return (
    <motion.tr layout="position" variants={rowVariants} initial="hidden" animate="show" exit="exit"
      whileHover={{ backgroundColor: 'rgba(255,255,255,0.035)' }} {...rest}>{children}</motion.tr>
  );
}
