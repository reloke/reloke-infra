# Audit Technique & Stratégie de Test - SwitchKey

## 1. Introduction
Ce document présente un audit approfondi de l'application SwitchKey (Backend) et définit la stratégie de test pour assurer une couverture maximale des fonctionnalités et prévenir les régressions.

## 2. État Actuel (Janvier 2026)
L'application dispose d'une base solide de tests unitaires et de tests de bout en bout (E2E) pour les fonctionnalités critiques liées au RGPD.

**Statistiques de tests :**
- **Suites de tests :** 15 unitaires, 2 E2E.
- **Points forts :** Excellente couverture des flux RGPD (anonymisation, suppression planifiée, purge S3).
- **Points d'attention :** Certaines suites de tests unitaires (Admin, Auth) présentent des régressions dues à l'évolution rapide des dépendances.

## 3. Cartographie Fonctionnelle & Couverture
| Module | Fonctionnalité | État du Test | Risque |
| :--- | :--- | :--- | :--- |
| **Auth** | Inscription / Connexion / Google OAuth | Unitaire (Opérationnel ✅) | Élevé |
| **User** | Profil / KYC (Identity) / Didit | Partiel | Moyen |
| **Home** | Création logement / Upload images S3 | Unitaire | Faible |
| **Matching** | Algorithme (Direct & Triangle) | Unitaire (Opérationnel ✅) | Critique |
| **Payment** | Flux Stripe / Remboursements | Unitaire / Mocks | Critique |
| **Chat** | Messagerie temps réel / Pièces jointes | Unitaire (Opérationnel ✅) | Moyen |
| **GDPR** | Purge / Droit à l'oubli / Logs | E2E (Complet ✅) | Faible |
| **Admin** | Dashboard / Bannissement / Dashboard financier | Unitaire (Opérationnel ✅) | Moyen |

## 4. Organisation des Tests
Pour maintenir un projet propre et évolutif, nous suivons cette convention :

### A. Tests Unitaires (`*.spec.ts`)
- **Emplacement :** Dans le répertoire de l'implémentation (ex: `src/auth/auth.service.spec.ts`).
- **Objectif :** Tester la logique métier d'un service ou contrôleur de manière isolée.
- **Règle :** Toutes les dépendances externes (Prisma, Mail, S3) DOIVENT être mockées.

### B. Tests de Bout en Bout (`*.e2e-spec.ts`)
- **Emplacement :** Dans le répertoire racine `test/`.
- **Objectif :** Tester des flux complets via des requêtes HTTP réelles (Supertest).
- **Règle :** Utiliser une base de données de test et mocker uniquement les services tiers (Stripe, SES).

## 5. Guide d'Exécution (Contre les régression)
Pour vérifier qu'aucune modification n'a cassé l'existant, lancez les commandes suivantes dans l'ordre :

1. **Tests Unitaires :** `npm run test`
2. **Tests E2E :** `npm run test:e2e` (vérifiez que votre base est synchronisée avec `npx prisma db push`)
3. **Couverture Globale :** `npm run test:cov`

## 6. Recommandations de Sécurité & Fiabilité
- **Validation Strict (Prisma) :** Toujours vérifier les Enums dans les tests pour éviter les erreurs de type SQL (ex: `ReportStatus`).
- **Mocks Stripe :** Utiliser des simulations de Webhooks Stripe complets pour tester les échecs de paiement sans compte réel.
- **Réseau :** Aucun test ne doit dépendre d'une connexion internet active (Mocks obligatoires pour S3/AWS).

## 7. Roadmap Qualité
- [x] Correction des tests unitaires critiques (`Auth`, `Admin`, `Chat`, `TriangleMatching`).
- [ ] Augmenter la couverture de `PaymentService` (Simulation de divers échecs Stripe).
- [ ] Ajouter des tests intégrés pour le flux de Matching complet (Enqueuing -> Worker -> Result).
- [ ] Mise en place d'une CI/CD (GitHub Actions) pour lancer les tests à chaque Push.
