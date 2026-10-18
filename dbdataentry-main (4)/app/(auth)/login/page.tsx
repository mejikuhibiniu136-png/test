import { Suspense } from 'react';
import { AuthForm } from '@/components/forms/AuthForm';

export const metadata = { title: 'Masuk · dbdataentry' };

export default function LoginPage() {
  return <Suspense><AuthForm mode="login" /></Suspense>;
}
