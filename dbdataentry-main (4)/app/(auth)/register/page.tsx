import { Suspense } from 'react';
import { AuthForm } from '@/components/forms/AuthForm';

export const metadata = { title: 'Daftar · dbdataentry' };

export default function RegisterPage() {
  return <Suspense><AuthForm mode="register" /></Suspense>;
}
