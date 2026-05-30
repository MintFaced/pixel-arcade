import type { Metadata } from 'next';
import GameLobby from './GameLobby';

export const metadata: Metadata = {
  title: 'PIXEL ARCADE',
  description: 'Select a game from the Pixel Arcade cabinet.',
};

export default function GameLobbyPage() {
  return <GameLobby />;
}
