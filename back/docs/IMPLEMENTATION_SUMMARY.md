# Résumé de l'Implémentation RGPD / Data Lifecycle

Ce document résume les travaux techniques effectués pour la mise en conformité RGPD et la gestion du cycle de vie des données sur le backend Reloke.

## 1. Base de Données (Prisma)

Une migration majeure (`rgpd_lifecycle_init`) a été appliquée pour supporter les nouvelles fonctionnalités :

*   **Nouveaux Modèles** :
    *   `LegalCase` : Pour la gestion centralisée des litiges/fraudes ("Legal Hold"). Permet de geler la suppression des données.
    *   `DossierFacileLink` : Pour stocker l'état de validation des liens DossierFacile sans conserver les données personnelles ni l'URL complète si non nécessaire.
*   **Modifications de Schéma** :
    *   `User` : Ajout de `deletedAt`, `anonymizedAt`, `deletionScheduledAt`, `lastActivityAt`.
    *   `Message` : Ajout de `isDeleted`, `deletedAt` (Soft Delete) et `redactedAt` (Redaction).
    *   `Report` : Ajout de `resolvedAt`, `closedAt`, et liens vers `LegalCase`.
    *   `Payment` / `Chat` : Ajout des relations vers `LegalCase`.

## 2. Services Backend (`src/gdpr`)

Un nouveau module `GdprModule` a été créé pour encapsuler la logique de conformité.

### 2.1. `DataLifecycleService`
Ce service est le cœur du système de rétention. Il gère :
*   **Suivi d'activité** : `touchUserActivity` pour mettre à jour `lastActivityAt` (rate-limited 10min).
*   **Droit à l'oubli** : `scheduleAccountDeletion` programme la suppression à J+90.
*   **Suppression Finalisée User (Cron)** : `finalizeUserDeletions` (Quotidien 2h00).
    *   Vérifie les contraintes "Legal Hold" (si litige ouvert, annule la suppression).
    *   Supprime images S3 (Home, Identity, Messages).
    *   Supprime données opérationnelles (Home, Search, Chats non liés à des litiges).
    *   **Anonymisation** : Transforme le User (Nom="Deleted", Email="deleted+ID@...") pour conserver l'intégrité des Paiements (obligation 10 ans).
*   **Purge Logs (Cron)** : `purgeOldLogs` supprime les logs techniques > 12 mois.

### 2.2. `ExportService`
*   Génère un export JSON complet des données utilisateur (`/v1/me/data-export`).
*   Inclut : Profil, Recherches, Matchs, Messages, Paiements, Logs.
*   Génère des **URLs signées** temporaires pour permettre le téléchargement des images (Home) sans exposer les clés brutes.

### 2.3. `DossierFacileService` (Mis à jour)
*   Refactorisé pour utiliser la table `DossierFacileLink`.
*   Stocke uniquement l'UUID et le statut de validation.
*   Cron quotidien pour revérifier la validité des liens.

## 3. Endpoints API (`GdprController`)

Préfixe : `/v1/me`

| Méthode | Route | Description |
| :--- | :--- | :--- |
| `POST` | `/delete-account` | Initie la demande de suppression (J+90). |
| `POST` | `/cancel-delete-account` | Annule la demande. |
| `GET` | `/data-export` | Télécharge les données personnelles (JSON). |
| `POST` | `/activity` | Signale une activité (utilisé par le front navigation). |

## 4. Sécurité & Conformité

*   **Idempotence** : Les jobs de suppression sont conçus pour être relancés sans erreur.
*   **Minimisation** : Les messages signalés sont "redactés" (contenu remplacé) au lieu d'être supprimés physiquement si un litige est en cours.
*   **Ségrégation** : Les données archivées pour litige sont identifiées via `LegalCase`.

## 5. Prochaines Étapes
*   Mettre en place l'interface Admin pour gérer les `LegalCase`.
*   Vérifier l'intégration Frontend avec les nouveaux endpoints.
