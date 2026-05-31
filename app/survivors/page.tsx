import type { Metadata } from 'next';
import SurvivorsGame from './SurvivorsGame';
import BackToArcade from '../components/BackToArcade';

export const metadata: Metadata = {
  title: 'DICKBUTT SURVIVORS · Gooch Island',
  description: 'Survive 15 minutes on Gooch Island. CDB CC0 horde survival.',
};

export default function SurvivorsPage() {
  return (
    <>
      <BackToArcade />
      <SurvivorsGame />
    </>
  );
}
