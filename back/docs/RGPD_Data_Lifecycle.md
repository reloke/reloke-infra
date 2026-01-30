# Documentation Data Lifecycle, RGPD et Conservation des Données (Reloke)

## 1. Vue d'ensemble RGPD et Cycle de Vie des Données

Ce document décrit l'implémentation des politiques de conservation, suppression, anonymisation et portabilité des données pour la plateforme Reloke, en conformité avec le RGPD. L'objectif est de garantir la minimisation des données tout en respectant les obligations légales (facturation) et les besoins de sécurité (lutte contre la fraude/harcèlement).

### Définitions Clés
- **Base Active** : Données nécessaires au fonctionnement immédiat du service pour l'utilisateur.
- **Archivage "Produit"** : Données toujours accessibles à l'utilisateur mais classées comme archivées (ex: Matchs inactifs > 6 mois). *Hors scope de ce dev, déjà implémenté.*
- **Archivage Intermédiaire (Accès Restreint)** : Données inaccessibles à l'utilisateur, conservées uniquement pour des besoins légaux ou de gestion de litiges (Administrateurs uniquement).
- **Suppression / Anonymisation** : Destruction irréversible ou transformation rendant l'identification impossible.

---

## 2. Règles de Conservation

| Catégorie de Données | Durée de Rétention Active | Action Fin de Vie | Exception "Legal Hold" (Litige) |
| :--- | :--- | :--- | :--- |
| **Compte Utilisateur** | Tant qu'actif. Inactivité > 2 ans. | Suppression ou Anonymisation complète. | Archivage intermédiaire 5 ans après clôture incident. |
| **Logement / Recherche** | Tant que compte actif. | Suppression avec le compte. | Idem. |
| **Matchs** | Tant que compte actif. | Suppression anonymisée avec le compte. | Archivage transactionnel si litige. |
| **Messagerie** | Tant que compte actif. | Suppression avec le compte. Suppression unitaire par user possible (Redaction). | Archivage intermédiaire 5 ans si lié à un signalement. |
| **Paiements (Stripe)** | 10 ans (obligation légale). | Conservation 10 ans en base (User anonymisé). | Conservation étendue si contentieux en cours. |
| **Logs Connexion / Sécurité** | 12 mois glissants. | Suppression automatique (Purge). | Conservation étendue si incident de sécurité. |
| **DossierFacile** | Tant que compte actif. | Suppression liens et UUIDs. | - |

---

## 3. Architecture Technique

### 3.1. Modifications du Schéma de Données (Prisma)

Pour supporter ces fonctionnalités, le schéma de base de données sera enrichi :

1.  **Généralisation de la Suppression/Anonymisation** :
    *   Champs `deletedAt`, `anonymizedAt`, `deletionScheduledAt` sur `User`.
    *   Champs `deletedAt`, `isDeleted`, `redactedAt` sur `Message` pour permettre la "soft delete" et la redaction de contenu tout en préservant l'intégrité des conversations si nécessaire (ex: harcèlement).

2.  **Gestion des Litiges (Legal Hold)** :
    *   Nouveau modèle `LegalCase` : Centralise les dossiers de fraude, harcèlement ou litige paiement.
    *   Permet de "geler" la suppression automatique d'un compte ou de données spécifiques tant que le dossier n'est pas clos + délai de prescription (5 ans).

3.  **Traçabilité DossierFacile** :
    *   Nouveau modèle `DossierFacileLink` : Stocke uniquement l'UUID, le statut de vérification et la date de contrôle, sans conserver de données personnelles issues du dossier.

### 3.2. Services Backend

*   **`DataLifecycleService`** : Orchestrateur principal. Gère :
    *   La détection de l'inactivité (`lastActivityAt`).
    *   La planification des suppressions (`deletionScheduledAt`).
    *   L'exécution des jobs de suppression/anonymisation.
    *   La vérification des contraintes "Legal Hold".
*   **`ExportService`** : Génère un JSON complet des données utilisateur pour le droit à la portabilité (RGPD Art. 20).
*   **`DossierFacileService`** : Vérifie l'accessibilité des liens DossierFacile sans parser les PII.

### 3.3. Jobs Planifiés (Cron)

| Job Name | Fréquence | Description |
| :--- | :--- | :--- |
| `scheduleInactiveUsersDeletion` | Hebdo | Détecte inactivité > 2 ans -> Programme suppression (J+90) + Email alerte. |
| `finalizeUserDeletions` | Quotidien | Exécute suppression définitive pour les comptes programmés (hors Legal Hold). Anonymise paiements, supprime S3, purge tables. |
| `purgeLogs` | Mensuel | Supprime logs > 12 mois (Connection, Notification). |
| `recheckDossierFacileLinks` | Ponctuel | Vérifie validité des liens DossierFacile actifs. |

---

## 4. Workflows Clés

### 4.1. Suppression de Compte ("Droit à l'oubli")
1.  **Demande Utilisateur** : POST `/v1/me/delete-account`.
2.  **Immédiat** : Compte passe en `PENDING_DELETION`. Accès bloqué. Suppression programmée à J+90 (délai technique/sûreté).
3.  **J+90 (Job `finalizeUserDeletions`)** :
    *   Check `LegalCase` : Si litige ouvert -> Passage en `ANONYMIZED` (restreint) mais conservation données.
    *   Si OK ->
        *   **Paiements** : Conservation entrées `Payment` mais anonymisation du `User` lié (Nom="Deleted", Email="deleted+ID@invalid").
        *   **S3** : Suppression physique des images (Home, Identity, Messages).
        *   **DB** : Suppression cascades des données métiers (Chat, Home, Match...).
        *   **User** : Anonymisation irréversible des champs PII.

### 4.2. Suppression Message par Utilisateur
1.  **Action** : DELETE message.
2.  **Traitement** : 
    *   Contenu remplacé par "Message supprimé".
    *   Flag `isDeleted` = true.
    *   Suppression immédiate des PJ (images S3) associées.
    *   Si logué dans un litige, une copie "snapshot" peut persister dans `LegalCase` (archivage restreint), mais l'original visible est purgé.

---

## 5. Sécurité et Accès

*   L'accès aux données en "Archivage Intermédiaire" (Legal Hold) est strictement réservé aux Administrateurs habilités.
*   Tout accès à ces données est audité (`AdminAuditLog`).
*   Les exports de données (Portabilité) sont générés à la demande et accessibles uniquement par l'utilisateur propriétaire authentifié.
