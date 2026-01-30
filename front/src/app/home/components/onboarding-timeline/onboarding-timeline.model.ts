import { Home } from '../../../profile/models/home.model';
import { Search } from '../../../profile/models/search.model';

export enum OnboardingStepKey {
  Account = 'ACCOUNT',
  Home = 'HOME',
  Search = 'SEARCH',
  Kyc = 'KYC',
  Payment = 'PAYMENT',
  Matches = 'MATCHES',
  DossierFacile = 'DOSSIER_FACILE',
  Chat = 'CHAT',
}

export enum OnboardingVisualState {
  Done = 'DONE',
  Active = 'ACTIVE',
  Todo = 'TODO',
  Locked = 'LOCKED',
}

export enum HomeStepState {
  NotCreated = 'NOT_CREATED',
  CreatedIncomplete = 'CREATED_INCOMPLETE',
  Complete = 'COMPLETE',
}

export enum SearchStepState {
  NotCreated = 'NOT_CREATED',
  CreatedIncomplete = 'CREATED_INCOMPLETE',
  Complete = 'COMPLETE',
}

export enum KycStepState {
  Unverified = 'UNVERIFIED',
  Pending = 'PENDING',
  Verified = 'VERIFIED',
  Failed = 'FAILED',
}

export enum PaymentStepState {
  NeverPurchased = 'NEVER_PURCHASED',
  HasCredits = 'HAS_CREDITS',
  NoCreditsButPurchasedBefore = 'NO_CREDITS_BUT_PURCHASED_BEFORE',
}

export enum MatchesStepState {
  NoMatchYet = 'NO_MATCH_YET',
  HasMatches = 'HAS_MATCHES',
}

export enum DossierFacileStepState {
  NotStarted = 'NOT_STARTED',
  LinkAdded = 'LINK_ADDED',
}

export enum ChatStepState {
  NoChatYet = 'NO_CHAT_YET',
  HasActiveChat = 'HAS_ACTIVE_CHAT',
}

export interface OnboardingStepAction {
  label: string;
  routerLink?: string | any[];
  queryParams?: Record<string, any>;
  href?: string;
  target?: string;
}

export interface OnboardingStepViewModel {
  key: OnboardingStepKey;
  isOptional?: boolean;
  visualState: OnboardingVisualState;
  title: string;
  tooltip: string;
  actions?: OnboardingStepAction[];
}

export interface OnboardingDerivedState {
  homeState: HomeStepState;
  searchState: SearchStepState;
  kycState: KycStepState;
  paymentState: PaymentStepState;
  matchesState: MatchesStepState;
  chatState: ChatStepState;
  dossierFacileState: DossierFacileStepState;

  isKycUnlocked: boolean;
  isPaymentUnlocked: boolean;
  isMatchesUnlocked: boolean;
  isChatUnlocked: boolean;

  creditsRemaining: number;
  matchesCount: number;
  activeChatsCount: number;
}

export interface OnboardingDataSnapshot {
  userKycStatus: string | null | undefined;
  home: Home | null;
  search: Search | null;
  creditsRemaining: number;
  hasPurchasedBefore: boolean;
  isInFlow: boolean;
  matchesCount: number;
  activeChatsCount: number;
  dossierFacileState?: DossierFacileStepState;
}

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const isValidNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

export function getHomeStepState(home: Home | null): HomeStepState {
  if (!home) return HomeStepState.NotCreated;

  const hasRequiredFields =
    isNonEmptyString(home.addressPlaceId) &&
    isValidNumber(home.lat) &&
    isValidNumber(home.lng) &&
    isNonEmptyString(home.homeType) &&
    isValidNumber(home.nbRooms) &&
    home.nbRooms > 0 &&
    isValidNumber(home.surface) &&
    home.surface > 0 &&
    isValidNumber(home.rent) &&
    home.rent > 0;

  const imagesCount = Array.isArray(home.images) ? home.images.length : 0;
  const hasEnoughImages = imagesCount >= 3;

  return hasRequiredFields && hasEnoughImages
    ? HomeStepState.Complete
    : HomeStepState.CreatedIncomplete;
}

export function getSearchStepState(search: Search | null): SearchStepState {
  if (!search) return SearchStepState.NotCreated;

  const hasZone =
    Array.isArray(search.zones) &&
    search.zones.length > 0 &&
    search.zones.some((z) => isNonEmptyString(z.label) || (isValidNumber(z.latitude) && isValidNumber(z.longitude)));

  const hasSomeCriteria =
    isValidNumber(search.maxRent) ||
    isValidNumber(search.minRent) ||
    isValidNumber(search.minRoomSurface) ||
    isValidNumber(search.maxRoomSurface) ||
    isValidNumber(search.minRoomNb) ||
    isValidNumber(search.maxRoomNb) ||
    (Array.isArray(search.homeTypes) && search.homeTypes.length > 0);

  return hasZone && hasSomeCriteria ? SearchStepState.Complete : SearchStepState.CreatedIncomplete;
}

export function normalizeKycStatus(raw: string | null | undefined): KycStepState {
  switch (raw) {
    case 'VERIFIED':
      return KycStepState.Verified;
    case 'PROCESSING':
      return KycStepState.Pending;
    case 'REQUIRES_INPUT':
    case 'CANCELED':
      return KycStepState.Failed;
    case 'UNVERIFIED':
    default:
      return KycStepState.Unverified;
  }
}

export function derivePaymentState(creditsRemaining: number, hasPurchasedBefore: boolean): PaymentStepState {
  if (creditsRemaining > 0) return PaymentStepState.HasCredits;
  if (hasPurchasedBefore) return PaymentStepState.NoCreditsButPurchasedBefore;
  return PaymentStepState.NeverPurchased;
}

export function deriveMatchesState(matchesCount: number): MatchesStepState {
  return matchesCount > 0 ? MatchesStepState.HasMatches : MatchesStepState.NoMatchYet;
}

export function deriveChatState(activeChatsCount: number): ChatStepState {
  return activeChatsCount > 0 ? ChatStepState.HasActiveChat : ChatStepState.NoChatYet;
}

export function computeOnboardingDerivedState(snapshot: OnboardingDataSnapshot): OnboardingDerivedState {
  const homeState = getHomeStepState(snapshot.home);
  const searchState = getSearchStepState(snapshot.search);

  const isHomeAndSearchComplete = homeState === HomeStepState.Complete && searchState === SearchStepState.Complete;

  const kycState = normalizeKycStatus(snapshot.userKycStatus);
  const isKycUnlocked = isHomeAndSearchComplete;

  const isKycVerified = kycState === KycStepState.Verified;
  const isPaymentUnlocked = isKycUnlocked && isKycVerified;

  const creditsRemaining = Number.isFinite(snapshot.creditsRemaining) ? snapshot.creditsRemaining : 0;
  const paymentState = derivePaymentState(creditsRemaining, snapshot.hasPurchasedBefore);

  const canEnterMatchingFlow = snapshot.isInFlow || creditsRemaining > 0;
  const isMatchesUnlocked = isPaymentUnlocked && canEnterMatchingFlow;

  const matchesCount = Number.isFinite(snapshot.matchesCount) ? snapshot.matchesCount : 0;
  const matchesState = deriveMatchesState(matchesCount);

  const activeChatsCount = Number.isFinite(snapshot.activeChatsCount) ? snapshot.activeChatsCount : 0;
  const chatState = deriveChatState(activeChatsCount);
  const isChatUnlocked = isMatchesUnlocked && matchesCount > 0;

  return {
    homeState,
    searchState,
    kycState,
    paymentState,
    matchesState,
    chatState,
    dossierFacileState: snapshot.dossierFacileState ?? DossierFacileStepState.NotStarted,

    isKycUnlocked,
    isPaymentUnlocked,
    isMatchesUnlocked,
    isChatUnlocked,

    creditsRemaining,
    matchesCount,
    activeChatsCount,
  };
}

export function computeActiveStepKey(state: OnboardingDerivedState): OnboardingStepKey {
  if (state.homeState !== HomeStepState.Complete) return OnboardingStepKey.Home;
  if (state.searchState !== SearchStepState.Complete) return OnboardingStepKey.Search;
  if (state.kycState !== KycStepState.Verified) return OnboardingStepKey.Kyc;
  if (state.creditsRemaining <= 0) return OnboardingStepKey.Payment;
  if (state.matchesCount <= 0) return OnboardingStepKey.Matches;
  if (state.activeChatsCount <= 0) return OnboardingStepKey.Chat;
  return OnboardingStepKey.Chat;
}

function buildHomeCopy(state: HomeStepState): Pick<OnboardingStepViewModel, 'title' | 'tooltip'> {
  switch (state) {
    case HomeStepState.NotCreated:
      return {
        title: 'Logement sortant à ajouter',
        tooltip: 'Ajoutez votre logement sortant. Il sert à trouver des locataires compatibles.',
      };
    case HomeStepState.CreatedIncomplete:
      return {
        title: 'Logement à compléter',
        tooltip: 'Votre logement est créé, mais incomplet. Ajoutez les infos manquantes et des photos.',
      };
    case HomeStepState.Complete:
      return {
        title: 'Logement complété',
        tooltip: 'Parfait, votre logement sortant est complet.',
      };
  }
}

function buildSearchCopy(state: SearchStepState): Pick<OnboardingStepViewModel, 'title' | 'tooltip'> {
  switch (state) {
    case SearchStepState.NotCreated:
      return {
        title: 'Recherche à ajouter',
        tooltip: 'Définissez vos critères. Ils servent à vous proposer des matchs adaptés.',
      };
    case SearchStepState.CreatedIncomplete:
      return {
        title: 'Recherche à compléter',
        tooltip: 'Votre recherche est enregistrée, mais incomplète. Ajoutez vos zones, budget, dates.',
      };
    case SearchStepState.Complete:
      return {
        title: 'Recherche complétée',
        tooltip: 'Parfait, vos critères sont complets.',
      };
  }
}

function buildKycCopy(state: KycStepState, locked: boolean): Pick<OnboardingStepViewModel, 'title' | 'tooltip'> {
  if (locked) {
    return {
      title: 'Étape verrouillée',
      tooltip: 'Complétez d’abord votre logement sortant et votre recherche.',
    };
  }

  switch (state) {
    case KycStepState.Unverified:
      return {
        title: 'Identité à vérifier',
        tooltip: 'Vérifiez votre identité (18+). Cela protège la communauté et rend les matchs plus fiables.',
      };
    case KycStepState.Pending:
      return {
        title: 'Vérification en cours',
        tooltip: 'Votre vérification est en cours. Revenez dans quelques minutes.',
      };
    case KycStepState.Verified:
      return {
        title: 'Identité vérifiée',
        tooltip: 'Votre identité est vérifiée. Vous pouvez passer à l’étape suivante.',
      };
    case KycStepState.Failed:
      return {
        title: 'Vérification à relancer',
        tooltip: 'Votre vérification n’a pas abouti. Relancez-la pour accéder au matching.',
      };
  }
}

function buildPaymentCopy(
  state: PaymentStepState,
  locked: boolean,
  prereqLocked: boolean
): Pick<OnboardingStepViewModel, 'title' | 'tooltip'> {
  if (locked) {
    if (prereqLocked) {
      return {
        title: 'Étape verrouillée',
        tooltip: 'Complétez d’abord votre logement sortant et votre recherche.',
      };
    }
    return {
      title: 'Étape verrouillée',
      tooltip: 'Vérifiez d’abord votre identité pour accéder aux packs.',
    };
  }

  switch (state) {
    case PaymentStepState.NeverPurchased:
      return {
        title: 'Pack à activer',
        tooltip: 'Activez un pack de matchs. Sans pack, aucun matching ne peut démarrer.',
      };
    case PaymentStepState.HasCredits:
      return {
        title: 'Pack actif',
        tooltip: 'Vous avez des crédits. Reloke peut vous proposer des matchs compatibles.',
      };
    case PaymentStepState.NoCreditsButPurchasedBefore:
      return {
        title: 'Crédits épuisés',
        tooltip: 'Vos crédits sont épuisés. Rechargez pour continuer à recevoir des matchs.',
      };
  }
}

function buildMatchesCopy(
  state: MatchesStepState,
  locked: boolean,
  creditsRemaining: number,
  prereqLocked: boolean,
  kycLocked: boolean
): Pick<OnboardingStepViewModel, 'title' | 'tooltip'> {
  if (locked) {
    if (prereqLocked) {
      return {
        title: 'Étape verrouillée',
        tooltip: 'Complétez d’abord votre logement sortant et votre recherche.',
      };
    }
    if (kycLocked) {
      return {
        title: 'Étape verrouillée',
        tooltip: 'Vérifiez d’abord votre identité pour accéder aux matchs.',
      };
    }
    return {
      title: 'Étape verrouillée',
      tooltip: 'Activez un pack pour entrer dans le flux de matching.',
    };
  }

  if (state === MatchesStepState.HasMatches) {
    const extra = creditsRemaining > 0 ? ' Nous continuons à chercher d’autres matchs.' : '';
    return {
      title: 'Matchs disponibles',
      tooltip: `Vous avez des matchs. Consultez-les et lancez la discussion.${extra}`,
    };
  }

  return {
    title: 'Matchs en recherche',
    tooltip: 'Nous recherchons des compatibilités. Vos premiers matchs arriveront dès qu’ils sont disponibles.',
  };
}

function buildDossierFacileCopy(
  state: DossierFacileStepState
): Pick<OnboardingStepViewModel, 'title' | 'tooltip'> {
  switch (state) {
    case DossierFacileStepState.LinkAdded:
      return {
        title: 'Dossier prêt',
        tooltip: 'Votre dossier DossierFacile est prêt. Vous pouvez le partager quand c’est nécessaire.',
      };
    case DossierFacileStepState.NotStarted:
    default:
      return {
        title: 'Dossier renforcé (optionnel)',
        tooltip:
          'Préparez un dossier solide via DossierFacile. Cela peut faciliter l’acceptation par les propriétaires.',
      };
  }
}

function buildChatCopy(
  state: ChatStepState,
  locked: boolean,
  prereqLocked: boolean,
  kycLocked: boolean,
  matchesLocked: boolean
): Pick<OnboardingStepViewModel, 'title' | 'tooltip'> {
  if (locked) {
    if (prereqLocked) {
      return {
        title: 'Étape verrouillée',
        tooltip: 'Complétez d’abord votre logement sortant et votre recherche.',
      };
    }
    if (kycLocked) {
      return {
        title: 'Étape verrouillée',
        tooltip: 'Vérifiez d’abord votre identité pour accéder au chat.',
      };
    }
    if (matchesLocked) {
      return {
        title: 'Étape verrouillée',
        tooltip: 'Activez un pack pour entrer dans le flux de matching.',
      };
    }
    return {
      title: 'Étape verrouillée',
      tooltip: 'Obtenez d’abord un match pour démarrer un chat.',
    };
  }

  switch (state) {
    case ChatStepState.HasActiveChat:
      return {
        title: 'Discussion lancée',
        tooltip:
          'Vous avez commencé à discuter. Avancez vers une visite et finalisez votre mobilité.',
      };
    case ChatStepState.NoChatYet:
    default:
      return {
        title: 'Démarrer un échange',
        tooltip: 'Quand vous avez un match, ouvrez le chat pour organiser la suite.',
      };
  }
}

export function buildOnboardingSteps(state: OnboardingDerivedState, activeKey: OnboardingStepKey): OnboardingStepViewModel[] {
  const prereqLocked = !state.isKycUnlocked;
  const kycStepLocked = prereqLocked;
  const kycNotVerified = state.kycState !== KycStepState.Verified;
  const paymentLocked = !state.isPaymentUnlocked;
  const matchesLocked = !state.isMatchesUnlocked;
  const chatLocked = !state.isChatUnlocked;

  const homeActionLabel =
    state.homeState === HomeStepState.NotCreated
      ? 'Ajouter mon logement'
      : state.homeState === HomeStepState.Complete
        ? 'Modifier mon logement sortant'
        : 'Compléter mon logement';

  const searchActionLabel =
    state.searchState === SearchStepState.NotCreated
      ? 'Ajouter ma recherche'
      : state.searchState === SearchStepState.Complete
        ? 'Modifier ma recherche'
        : 'Compléter ma recherche';

  const base: Array<Omit<OnboardingStepViewModel, 'visualState'>> = [
    {
      key: OnboardingStepKey.Account,
      title: 'Compte créé',
      tooltip: 'Félicitations, votre compte est prêt. Passons à la suite.',
    },
    {
      key: OnboardingStepKey.Home,
      ...buildHomeCopy(state.homeState),
      actions: [{ label: homeActionLabel, routerLink: '/profile/outgoing' }],
    },
    {
      key: OnboardingStepKey.Search,
      ...buildSearchCopy(state.searchState),
      actions: [{ label: searchActionLabel, routerLink: '/profile/searcher' }],
    },
    {
      key: OnboardingStepKey.Kyc,
      ...buildKycCopy(state.kycState, prereqLocked),
      actions: prereqLocked
        ? [
            { label: 'Compléter mon logement', routerLink: '/profile/outgoing' },
            { label: 'Compléter ma recherche', routerLink: '/profile/searcher' },
          ]
        : state.kycState === KycStepState.Verified
          ? undefined
          : [{ label: 'Vérifier mon identité', routerLink: '/profile/account' }],
    },
    {
      key: OnboardingStepKey.Payment,
      ...buildPaymentCopy(state.paymentState, paymentLocked, prereqLocked),
      actions: paymentLocked
        ? prereqLocked
          ? [
              { label: 'Compléter mon logement', routerLink: '/profile/outgoing' },
              { label: 'Compléter ma recherche', routerLink: '/profile/searcher' },
            ]
          : [{ label: 'Vérifier mon identité', routerLink: '/profile/account' }]
        : [{ label: 'Activer un pack', routerLink: '/matching/payment' }],
    },
    {
      key: OnboardingStepKey.Matches,
      ...buildMatchesCopy(state.matchesState, matchesLocked, state.creditsRemaining, prereqLocked, kycNotVerified),
      actions: matchesLocked
        ? prereqLocked
          ? [
              { label: 'Compléter mon logement', routerLink: '/profile/outgoing' },
              { label: 'Compléter ma recherche', routerLink: '/profile/searcher' },
            ]
          : kycNotVerified
            ? [{ label: 'Vérifier mon identité', routerLink: '/profile/account' }]
            : [{ label: 'Activer un pack', routerLink: '/matching/payment' }]
        : [{ label: 'Voir mes matchs', routerLink: '/matching/feed' }],
    },
    {
      key: OnboardingStepKey.DossierFacile,
      isOptional: true,
      ...buildDossierFacileCopy(state.dossierFacileState),
      actions: [
        {
          label: 'Ouvrir DossierFacile',
          href: 'https://www.dossierfacile.logement.gouv.fr/',
          target: '_blank',
        },
        {
          label: 'Ajouter mon lien',
          routerLink: '/profile/account',
        },
      ],
    },
    {
      key: OnboardingStepKey.Chat,
      ...buildChatCopy(state.chatState, chatLocked, prereqLocked, kycNotVerified, matchesLocked),
      actions: chatLocked
        ? prereqLocked
          ? [
              { label: 'Compléter mon logement', routerLink: '/profile/outgoing' },
              { label: 'Compléter ma recherche', routerLink: '/profile/searcher' },
            ]
          : kycNotVerified
            ? [{ label: 'Vérifier mon identité', routerLink: '/profile/account' }]
            : matchesLocked
              ? [{ label: 'Activer un pack', routerLink: '/matching/payment' }]
              : [{ label: 'Voir mes matchs', routerLink: '/matching/feed' }]
        : [{ label: 'Ouvrir le chat', routerLink: '/matching/chat' }],
    },
  ];

  const resolveVisualState = (stepKey: OnboardingStepKey): OnboardingVisualState => {
    if (stepKey === OnboardingStepKey.Account) return OnboardingVisualState.Done;

    if (stepKey === OnboardingStepKey.Kyc && kycStepLocked) return OnboardingVisualState.Locked;
    if (stepKey === OnboardingStepKey.Payment && paymentLocked) return OnboardingVisualState.Locked;
    if (stepKey === OnboardingStepKey.Matches && matchesLocked) return OnboardingVisualState.Locked;
    if (stepKey === OnboardingStepKey.Chat && chatLocked) return OnboardingVisualState.Locked;

    const isDone =
      (stepKey === OnboardingStepKey.Home && state.homeState === HomeStepState.Complete) ||
      (stepKey === OnboardingStepKey.Search && state.searchState === SearchStepState.Complete) ||
      (stepKey === OnboardingStepKey.Kyc && state.kycState === KycStepState.Verified) ||
      (stepKey === OnboardingStepKey.Payment && state.paymentState === PaymentStepState.HasCredits) ||
      (stepKey === OnboardingStepKey.Matches && state.matchesState === MatchesStepState.HasMatches) ||
      (stepKey === OnboardingStepKey.DossierFacile && state.dossierFacileState === DossierFacileStepState.LinkAdded) ||
      (stepKey === OnboardingStepKey.Chat && state.chatState === ChatStepState.HasActiveChat);

    if (isDone) return OnboardingVisualState.Done;
    if (stepKey === activeKey) return OnboardingVisualState.Active;
    return OnboardingVisualState.Todo;
  };

  return base.map((step) => ({
    ...step,
    visualState: resolveVisualState(step.key),
  }));
}
