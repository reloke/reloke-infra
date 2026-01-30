import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

export interface AddressComponents {
  streetNumber?: string;
  route?: string;
  locality?: string;
  postalCode?: string;
  country?: string;
}

export interface ValidatedAddress {
  formattedAddress: string;
  lat: number;
  lng: number;
  components: AddressComponents;
}

interface PlaceDetailsResult {
  result?: {
    geometry?: {
      location?: {
        lat: number;
        lng: number;
      };
    };
    address_components?: Array<{
      long_name: string;
      short_name: string;
      types: string[];
    }>;
    formatted_address?: string;
  };
  status: string;
}

@Injectable()
export class GooglePlacesService {
  private readonly logger = new Logger(GooglePlacesService.name);
  private readonly apiKey: string | undefined;
  private readonly timeout: number;
  private readonly baseUrl =
    'https://maps.googleapis.com/maps/api/place/details/json';

  constructor(private configService: ConfigService) {
    this.apiKey = this.configService.get<string>('GOOGLE_MAPS_API_KEY');
    this.timeout =
      this.configService.get<number>('GOOGLE_MAPS_TIMEOUT') || 5000;

    if (!this.apiKey || this.apiKey === 'VOTRE_CLE_API_GOOGLE') {
      this.logger.warn(
        'GOOGLE_MAPS_API_KEY is not configured - address validation will be mocked',
      );
    }
  }

  async validateAndEnrichAddress(
    placeId: string,
    formattedAddress: string,
  ): Promise<ValidatedAddress> {
    // If API key not configured, return mock data for development
    if (!this.apiKey || this.apiKey === 'VOTRE_CLE_API_GOOGLE') {
      this.logger.warn('Using mock address validation (no API key configured)');
      return this.getMockValidatedAddress(formattedAddress);
    }

    try {
      const response = await axios.get<PlaceDetailsResult>(this.baseUrl, {
        params: {
          place_id: placeId,
          key: this.apiKey,
          fields: 'geometry,address_components,formatted_address',
        },
        timeout: this.timeout,
      });

      const result = response.data.result;

      if (
        response.data.status !== 'OK' ||
        !result ||
        !result.geometry ||
        !result.geometry.location
      ) {
        throw new BadRequestException(
          'Impossible de vérifier cette adresse. Veuillez réessayer.',
        );
      }

      const { lat, lng } = result.geometry.location;
      const addressComponents = this.parseAddressComponents(
        result.address_components || [],
      );

      // Validation : vérifier que l'adresse est suffisamment précise
      this.validateAddressCompleteness(addressComponents);

      return {
        formattedAddress: result.formatted_address || formattedAddress,
        lat,
        lng,
        components: addressComponents,
      };
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }

      this.logger.error(
        `Google Places API error: ${error.message}`,
        error.stack,
      );
      throw new BadRequestException(
        'Impossible de vérifier cette adresse. Veuillez réessayer.',
      );
    }
  }

  private parseAddressComponents(
    components: Array<{
      long_name: string;
      short_name: string;
      types: string[];
    }>,
  ): AddressComponents {
    const result: AddressComponents = {};

    for (const component of components) {
      const types = component.types;

      if (types.includes('street_number')) {
        result.streetNumber = component.long_name;
      }
      if (types.includes('route')) {
        result.route = component.long_name;
      }
      if (
        types.includes('locality') ||
        types.includes('postal_town') ||
        types.includes('administrative_area_level_2')
      ) {
        result.locality = result.locality || component.long_name;
      }
      if (types.includes('postal_code')) {
        result.postalCode = component.long_name;
      }
      if (types.includes('country')) {
        result.country = component.long_name;
      }
    }

    return result;
  }

  private validateAddressCompleteness(components: AddressComponents): void {
    const missingFields: string[] = [];

    // Le numéro de rue n'est pas toujours obligatoire (certaines adresses n'en ont pas)
    // mais la rue, ville et code postal sont obligatoires
    if (!components.route) {
      missingFields.push('rue');
    }
    if (!components.locality) {
      missingFields.push('ville');
    }
    if (!components.postalCode) {
      missingFields.push('code postal');
    }
    if (!components.country) {
      missingFields.push('pays');
    }

    if (missingFields.length > 0) {
      throw new BadRequestException(
        `Cette adresse n'est pas assez précise. Éléments manquants : ${missingFields.join(', ')}.`,
      );
    }
  }

  /**
   * Mock address validation for development without API key
   */
  private getMockValidatedAddress(formattedAddress: string): ValidatedAddress {
    return {
      formattedAddress:
        formattedAddress || '12 Rue des Lilas, 75001 Paris, France',
      lat: 48.8566,
      lng: 2.3522,
      components: {
        streetNumber: '12',
        route: 'Rue des Lilas',
        locality: 'Paris',
        postalCode: '75001',
        country: 'France',
      },
    };
  }
}
