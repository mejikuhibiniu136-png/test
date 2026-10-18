'use client';
import { motion, type HTMLMotionProps } from 'motion/react';
import { itemVariants, pageVariants } from '@/components/motion/variants';

// <PageTransition> memutar fade+slide halaman; <StaggerItem> di dalamnya masuk berurutan (stagger).
// Variants menular dari induk ke anak, jadi anak tidak perlu initial/animate sendiri.
export function PageTransition({ children, ...rest }: HTMLMotionProps<'div'>) {
  return <motion.div variants={pageVariants} initial="hidden" animate="show" exit="exit" {...rest}>{children}</motion.div>;
}

export function StaggerItem({ children, ...rest }: HTMLMotionProps<'div'>) {
  return <motion.div variants={itemVariants} {...rest}>{children}</motion.div>;
}
