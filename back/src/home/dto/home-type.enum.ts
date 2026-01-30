export enum HomeType {
  CHAMBRE = 'CHAMBRE',
  STUDIO = 'STUDIO',
  T1 = 'T1',
  T1_BIS = 'T1_BIS',
  T2 = 'T2',
  T2_BIS = 'T2_BIS',
  T3 = 'T3',
  T3_BIS = 'T3_BIS',
  T4 = 'T4',
  T5 = 'T5',
  T6_PLUS = 'T6_PLUS',
}

export const HomeTypeLabels: Record<HomeType, string> = {
  [HomeType.CHAMBRE]: 'Chambre',
  [HomeType.STUDIO]: 'Studio',
  [HomeType.T1]: 'T1',
  [HomeType.T1_BIS]: 'T1 bis',
  [HomeType.T2]: 'T2',
  [HomeType.T2_BIS]: 'T2 bis',
  [HomeType.T3]: 'T3',
  [HomeType.T3_BIS]: 'T3 bis',
  [HomeType.T4]: 'T4',
  [HomeType.T5]: 'T5',
  [HomeType.T6_PLUS]: 'T6 et +',
};

export const HomeTypeDescriptions: Record<HomeType, string> = {
  [HomeType.CHAMBRE]:
    "Chambre simple, souvent chez l'habitant ou en colocation.",
  [HomeType.STUDIO]:
    'Une seule pièce avec kitchenette dans la pièce principale.',
  [HomeType.T1]: 'Une pièce principale + cuisine séparée.',
  [HomeType.T1_BIS]: 'T1 avec coin nuit ou double séjour.',
  [HomeType.T2]: 'Deux pièces principales (séjour + chambre).',
  [HomeType.T2_BIS]: 'T2 avec coin nuit ou double séjour.',
  [HomeType.T3]: 'Trois pièces principales.',
  [HomeType.T3_BIS]: 'T3 avec coin nuit ou double séjour.',
  [HomeType.T4]: 'Quatre pièces principales.',
  [HomeType.T5]: 'Cinq pièces principales.',
  [HomeType.T6_PLUS]: 'Six pièces et plus.',
};
