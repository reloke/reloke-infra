import { HomeType, HOME_TYPE_OPTIONS } from './home.model';

// Re-export HomeType for convenience
export { HomeType, HOME_TYPE_OPTIONS };

/**
 * Represents a search zone (geographic area)
 */
export interface SearchZone {
  id?: number;
  latitude: number;
  longitude: number;
  radius: number;
  label: string;
}

/**
 * Represents a search profile
 */
export interface Search {
  id: number;
  minRent: number | null;
  maxRent: number | null;
  minRoomSurface: number | null;
  maxRoomSurface: number | null;
  minRoomNb: number | null;
  maxRoomNb: number | null;
  homeTypes: HomeType[] | null;
  searchStartDate: string | null;
  searchEndDate: string | null;
  zones: SearchZone[];
  isActivelySearching?: boolean;
  searchStoppedAt?: string | null;
}

/**
 * Payload for creating or updating a search
 */
export interface CreateSearchPayload {
  minRent?: number | null;
  maxRent: number;
  minRoomSurface?: number | null;
  maxRoomSurface?: number | null;
  minRoomNb?: number | null;
  maxRoomNb?: number | null;
  homeTypes?: HomeType[];
  searchStartDate: string;
  searchEndDate: string;
  zones: SearchZone[];
  clientTimeZone?: string;
}

/**
 * Maximum number of search zones allowed
 */
export const MAX_SEARCH_ZONES = 5;

/**
 * Minimum number of search zones required
 */
export const MIN_SEARCH_ZONES = 1;

/**
 * Error messages for search form validation
 */
export const SEARCH_FORM_ERROR_MESSAGES: Record<string, Record<string, string>> = {
  zones: {
    required: 'Au moins une zone de recherche est requise',
    maxZones: 'Vous ne pouvez pas ajouter plus de 5 zones',
  },
  searchStartDate: {
    required: 'La date de début est requise',
    notInPast: 'La date de début ne peut pas être dans le passé',
  },
  searchEndDate: {
    required: 'La date de fin est requise',
    notInPast: 'La date de fin ne peut pas être dans le passé',
    beforeStart: 'La date de fin doit être après la date de début',
  },
  maxRent: {
    required: 'Le budget maximum est requis',
    min: 'Le budget maximum doit être supérieur à 0',
  },
  minRent: {
    min: 'Le budget minimum doit être positif',
    greaterThanMax: 'Le budget minimum doit être inférieur au maximum',
  },
  minRoomSurface: {
    min: 'La surface minimum doit être supérieure à 0',
    greaterThanMax: 'La surface minimum doit être inférieure au maximum',
  },
  maxRoomSurface: {
    min: 'La surface maximum doit être supérieure à 0',
  },
  minRoomNb: {
    min: 'Le nombre de pièces minimum doit être au moins 1',
    greaterThanMax: 'Le nombre minimum doit être inférieur au maximum',
  },
  maxRoomNb: {
    min: 'Le nombre de pièces maximum doit être au moins 1',
  },
};
