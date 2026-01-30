# Gestion des États "Offline" et "Server Error"

## État Actuel et Problèmes
Actuellement, l'application ne gère pas de manière robuste ou visible les pertes de connexion ou les erreurs critiques du serveur.

1.  **Offline** : Il existe un `ConnectivityService` et un `OfflineBannerComponent`, mais ce dernier est probablement discret (bannière) ou non bloquant. L'utilisateur peut continuer à naviguer et potentiellement perdre des données s'il tente des actions qui échouent silencieusement ou partiellement.
2.  **Erreur Serveur (500)** : L'`error.interceptor.ts` est vide. Aucune interception globale n'est faite. Si une erreur 500 survient, l'utilisateur ne voit probablement rien ou juste une erreur console, ou le composant local gère l'erreur maladroitement. Il n'y a pas de feedback global uniforme.

## Solution Implémentée

### 1. Détection Réseau (Offline)
Nous allons transformer l'expérience "Offline" pour être **bloquante**.
-   Utilisation du `ConnectivityService` existant (qui écoute déjà `window.online/offline`).
-   Remplacement (ou modification) de l'affichage : au lieu d'une bannière, nous afficherons une **Modale Plein Écran** (Overlay) z-index très élevé.
-   Cette modale sera impossible à fermer tant que la connexion n'est pas revenue.
-   Message : "Connexion perdue. Nous tentons de vous reconnecter...".

### 2. Intercepteur d'Erreur Serveur (Global)
Nous allons implémenter `error.interceptor.ts`.
-   Interception des `HttpErrorResponse`.
-   Check du status `500` (ou 5xx).
-   Au lieu de rediriger (`router.navigate`), nous allons déclencher l'affichage d'une **Modale d'Erreur Serveur** via un service d'état global (ex: `GlobalErrorService` ou via le `ConnectivityService` étendu).
-   L'utilisateur reste sur sa page (pas de `location.reload` ni navigation).
-   Message : "Erreur serveur. Nous faisons tout pour résoudre le problème." + Bouton [Réessayer].

### 3. Design & UX
-   Les deux modales utiliseront un fond backdrop flouté (`backdrop-blur`) ou semi-transparent sombre.
-   Style cohérent avec la charte "Reloke".

## Résumé Technique
-   **Frontend** : Angular Standalone Components.
-   **Services** : `ConnectivityService` (étendu pour les états d'erreur serveur ? Ou création d'un `GlobalErrorStateService`).
-   **Composants** : `GlobalStatusComponent` (nouveau) intégré dans `AppComponent` qui gère les deux cas (Offline & ServerError) pour couvrir toute l'app.
