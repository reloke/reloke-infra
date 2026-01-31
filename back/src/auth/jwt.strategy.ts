import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        (request: any) => {
          const token = request?.cookies?.access_token;
          console.log('Cookie access_token présent ?', !!token);
          return token;
        },
        ExtractJwt.fromAuthHeaderAsBearerToken(),
      ]),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_SECRET') || 'superSecretKey',
    });
  }

  async validate(payload: any) {
    console.log('Payload reçu dans validate:', payload);
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, mail: true, role: true, tokenVersion: true },
    });
    console.log('Utilisateur trouvé en BDD ?', !!user);

    if (!user) throw new UnauthorizedException('Utilisateur non trouvé');

    // Check token version
    if (
      payload.version !== undefined &&
      payload.version !== user.tokenVersion
    ) {
      throw new UnauthorizedException('Session invalidée');
    }

    return { userId: user.id, email: user.mail, role: user.role };
  }
}
