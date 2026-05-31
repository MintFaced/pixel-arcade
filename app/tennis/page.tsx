import type { Metadata } from 'next';
import TennisGame from './TennisGame';
import BackToArcade from '../components/BackToArcade';

export const metadata: Metadata = {
  title: 'XNoun Tennis · Pixel Arcade',
  description: 'A vertical pong battle between 9 hand-drawn XNouns. Pixel Arcade · The Line Gallery · MintFace 2026.',
};

export default function TennisPage() {
  return (
    <>
      <BackToArcade />
      <TennisGame />
    </>
  );
}
