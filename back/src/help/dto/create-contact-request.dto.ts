import {
  IsEmail,
  IsEnum,
  IsString,
  MinLength,
  MaxLength,
} from 'class-validator';

export enum ContactTopic {
  ACCOUNT_ACCESS = 'ACCOUNT_ACCESS',
  REGISTRATION = 'REGISTRATION',
  HOW_IT_WORKS = 'HOW_IT_WORKS',
  PARTNERSHIP = 'PARTNERSHIP',
  OTHER = 'OTHER',
}

export class CreateContactRequestDto {
  @IsEmail({}, { message: 'Adresse email invalide' })
  email: string;

  @IsEnum(ContactTopic, { message: 'Sujet invalide' })
  topic: ContactTopic;

  @IsString()
  @MinLength(10, { message: 'Le message doit contenir au moins 10 caracteres' })
  @MaxLength(2000, {
    message: 'Le message ne peut pas depasser 2000 caracteres',
  })
  description: string;
}
