export const FR = {
    common: {
        appName: 'Reloke',
        backToHome: "Retour à l'accueil",
        next: 'Suivant',
        back: 'Retour',
        cancel: 'Annuler',
        confirm: 'Confirmer',
        loading: 'Chargement...',
        error: 'Erreur',
        success: 'Succès'
    },
    auth: {
        login: {
            title: 'Bon retour !',
            heroSubtitle: 'Accélérez votre recherche de logement avec des matchs.',
            subtitle: 'Connectez-vous pour continuer votre aventure.',
            emailLabel: 'Email',
            passwordLabel: 'Mot de passe',
            forgotPassword: 'Mot de passe oublié ?',
            submitButton: 'Se connecter',
            submitButtonLoading: 'Connexion...',
            noAccount: 'Pas encore de compte ?',
            createAccount: 'Créer un compte gratuitement',
            emailPlaceholder: 'votre@email.com',
            passwordPlaceholder: '••••••••',
            errorCredentials: 'Email ou mot de passe incorrect.',
            emailRequired: 'Email valide requis',
            passwordRequired: 'Mot de passe requis',
            errors: {
                tooManyRequests: "Trop de tentatives. Veuillez ressayer dans 5 minutes."
            },
        },
        register: {
            heroTitle: 'Rejoignez Reloke',
            heroSubtitle: 'Rejoignez la communauté de switchers la plus exclusive pour simplifier votre recherche de logement.',
            step1Label: 'Email',
            step2Label: 'Vérification',
            step3Label: 'Finalisation',
            codeLabel: 'Code de vérification',
            codePlaceholder: '123456',
            resendCode: 'Renvoyer le code',
            formTitle: 'Créer un compte',
            stepIndicator: 'Étape {{current}} sur {{total}}',
            firstNameLabel: 'Prénom',
            firstNamePlaceholder: 'Jean',
            lastNameLabel: 'Nom',
            lastNamePlaceholder: 'Dupont',
            emailLabel: 'Email',
            emailPlaceholder: 'votre@email.com',
            passwordLabel: 'Mot de passe',
            passwordPlaceholder: '••••••••',
            submitButton: "S'inscrire",
            submitButtonLoading: 'Inscription...',
            verifyButton: 'Vérification...',
            alreadyAccount: 'Déjà un compte ?',
            loginLink: 'Se connecter',
            ifMailExistsOtpSent: 'Si l\'email fourni est valide, un code de vérification a été envoyé',
            errors: {
                emailRequired: 'Email valide requis.',
                passwordLength: '6 caractères minimum.',
                generic: "Une erreur est survenue lors de l'inscription.",
                tooManyRequests: "Trop de tentatives. Veuillez ressayer dans 15 minutes."
            },
            passwordStrength: {
                weak: 'Très faible',
                fair: 'Faible',
                good: 'Moyen',
                strong: 'Bon',
                excellent: 'Excellent',
                secure: 'Mot de passe sécurisé',
                criteria: {
                    length: '8 caractères min.',
                    upper: '1 Majuscule',
                    lower: '1 Minuscule',
                    number: '1 Chiffre',
                    special: '1 Caractère spécial'
                }
            },
            loginRedirect: 'Se connecter maintenant →'
        }
    },
    landing: {
        nav: {
            login: 'Se connecter',
            register: "S'inscrire"
        },
        hero: {
            badge: 'La révolution du logement',
            titlePart1: 'Le',
            titlePart2: 'du logement.',
            subtitle: 'Échangez votre appartement simplement. Matchez avec des locataires qui cherchent ce que vous avez, et qui ont ce que vous cherchez.',
            ctaPrimary: "Commencer l'aventure",
            ctaSecondary: 'En savoir plus',
            socialProof: 'Rejoint par',
            switchers: 'switchers'
        },
        card: {
            title: 'Loft Lumineux',
            location: 'Paris 11ème • 45m²',
            tag1: 'Calme',
            tag2: 'Metro',
            match: 'Match 98%'
        },
        steps: {
            title: 'Comment ça marche ?',
            subtitle: "Trois étapes simples pour changer de vie et d'appartement.",
            step1Title: '1. Créez votre profil',
            step1Desc: 'Renseignez les détails de votre logement actuel et ce que vous recherchez.',
            step2Title: '2. Matchez',
            step2Desc: 'Notre algorithme vous propose des profils compatibles. Likez pour connecter.',
            step3Title: '3. Switchez',
            step3Desc: 'Discutez, visitez et échangez vos clés en toute sécurité.'
        },
        footer: {
            description: "La première plateforme d'échange de logement sécurisée et intelligente.",
            navTitle: 'Navigation',
            legalTitle: 'Légal',
            home: 'Accueil',
            login: 'Se connecter',
            register: "S'inscrire",
            faq: 'FAQ',
            cgu: 'CGU',
            contact: 'Contact',
            copyright: '© 2025 Reloke. Tous droits réservés.',
            privacy: 'Confidentialité',
            cookies: 'Cookies'
        }
    }
};
