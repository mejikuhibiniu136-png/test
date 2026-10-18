'use client';
import { motion, type HTMLMotionProps } from 'motion/react';
import type { ReactNode } from 'react';

type Variant = 'primary' | 'ghost' | 'danger' | 'subtle';
const STYLES: Record<Variant, string> = {
  primary: 'bg-gradient-to-r from-cyan-400 to-violet-500 text-slate-950 font-semibold shadow-[0_0_24px_-6px_rgb(34_211_238/0.6)] hover:shadow-[0_0_32px_-4px_rgb(34_211_238/0.8)]',
  ghost: 'border border-white/10 bg-white/[0.04] text-slate-200 hover:border-white/20 hover:bg-white/[0.08]',
  subtle: 'text-slate-300 hover:bg-white/[0.06]',
  danger: 'border border-rose-400/30 bg-rose-500/10 text-rose-200 hover:bg-rose-500/20',
};

interface Props extends Omit<HTMLMotionProps<'button'>, 'children'> {
  variant?: Variant;
  size?: 'sm' | 'md';
  children: ReactNode;
}

export function Button({ variant = 'ghost', size = 'md', className = '', children, disabled, ...rest }: Props) {
  return (
    <motion.button
      whileHover={disabled ? undefined : { y: -1 }}
      whileTap={disabled ? undefined : { scale: 0.97 }}
      transition={{ type: 'spring', stiffness: 500, damping: 30 }}
      disabled={disabled}
      className={`inline-flex min-h-9 cursor-pointer items-center justify-center gap-2 rounded-xl text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${size === 'sm' ? 'px-3 py-1.5 text-xs' : 'px-4 py-2'} ${STYLES[variant]} ${className}`}
      {...rest}
    >
      {children}
    </motion.button>
  );
}
