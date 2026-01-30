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

export const HOME_TYPE_OPTIONS: {
  value: HomeType;
  label: string;
  description: string;
}[] = [
  {
    value: HomeType.CHAMBRE,
    label: 'Chambre',
    description: "Une pièce privative, sans logement entier (espaces parfois partagés).",
  },
  {
    value: HomeType.STUDIO,
    label: 'Studio',
    description: "Une seule pièce, sans chambre séparée (coin cuisine dans la pièce).",
  },
  {
    value: HomeType.T1,
    label: 'T1',
    description: "Une pièce principale + cuisine séparée, sans chambre séparée.",
  },
  {
    value: HomeType.T1_BIS,
    label: 'T1 bis',
    description: "T1 avec un espace en plus (alcôve, mezzanine ou coin nuit).",
  },
  {
    value: HomeType.T2,
    label: 'T2',
    description: "Deux pièces : séjour + 1 chambre.",
  },
  {
    value: HomeType.T2_BIS,
    label: 'T2 bis',
    description: "T2 avec un petit espace en plus (bureau/alcôve/mezzanine).",
  },
  {
    value: HomeType.T3,
    label: 'T3',
    description: "Trois pièces : séjour + 2 chambres.",
  },
  {
    value: HomeType.T3_BIS,
    label: 'T3 bis',
    description: "T3 avec un petit espace en plus (bureau/alcôve/mezzanine).",
  },
  {
    value: HomeType.T4,
    label: 'T4',
    description: "Quatre pièces : séjour + 3 chambres (ou équivalent).",
  },
  {
    value: HomeType.T5,
    label: 'T5',
    description: "Cinq pièces : séjour + 4 chambres (ou équivalent).",
  },
  {
    value: HomeType.T6_PLUS,
    label: 'T6 et +',
    description: "Six pièces ou plus : séjour + 5 chambres (ou équivalent).",
  },
];


export interface HomeImage {
  id: number;
  url: string;
  publicUrl: string;
  homeId: number;
  order: number;
  createdAt: Date;
}

export interface Home {
  id: number;
  userId: number;
  addressFormatted: string;
  addressPlaceId: string;
  street?: string;
  streetNumber?: string;
  postalCode?: string;
  city?: string;
  country: string;
  lat: number;
  lng: number;
  homeType: HomeType;
  nbRooms: number;
  surface: number;
  rent: number;
  description?: string;
  images: HomeImage[];
  createdAt: Date;
  updatedAt: Date;
}

export interface AddressSelection {
  rawInput: string;
  placeId?: string;
  formattedAddress?: string;
  lat?: number;
  lng?: number;
}

export interface CreateHomePayload {
  addressFormatted: string;
  addressPlaceId: string;
  lat: number,
  lng: number,
  homeType: HomeType;
  nbRooms: number;
  surface: number;
  rent: number;
  description?: string;
}

export interface CapturedImage {
  id: string; // UUID temporaire c?t? client
  file?: File | null;
  previewUrl: string;
  isExisting: boolean;
  existingId?: number; // ID en base si image existante
  markedForDeletion?: boolean;
}
